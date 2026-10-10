import {
  aPermission,
  REGISTRE_ACTIONS_AUTOMATISATION,
  type IssueExecutionAutomatisation,
  type TypeActionAutomatisation,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { interdit, introuvable } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  exigerMissionVisible,
  filtreVisibilite,
  peutModifierMission,
  voitToutesLesMissions,
} from "../missions/acces.js";
import { defaireAction } from "./actions.js";
import { annulationImpossible, avecErreursAutomatisation, decisionExiste } from "./erreurs.js";

/*
 * Journal des exécutions (AUT-06), annulation et brouillons tracés.
 * - Lecture (`automatisation.lire`) : exécutions sans mission, ou d'une mission que
 *   l'utilisateur voit (règles de `exigerMissionVisible`) ; une exécution d'autrui ou d'un
 *   autre cabinet répond 404.
 * - Annulation (`automatisation.gerer` ET la permission de l'action, mission visible) : action
 *   annulable et réussie seulement (doublé en base, MPU03), une fois ; l'effet est défait par
 *   le même circuit qu'un humain (facture encore en brouillon supprimée, brouillon annulé).
 * - Brouillons : décision humaine unique (validé, modifié, rejeté) par le chef ou le directeur
 *   de la mission, ou qui modifie toutes les missions (« l'IA propose, l'expert dispose »,
 *   étendu aux automatisations).
 */

const CLE_TRI = `lpad(((extract(epoch FROM x.cree_le) * 1000000)::bigint)::text, 17, '0')`;

const visibilite = (pToutes: number, pUtilisateur: number) =>
  `(x.mission_id IS NULL OR EXISTS (SELECT 1 FROM missions m WHERE m.id = x.mission_id
     AND ${filtreVisibilite(pToutes, pUtilisateur)}))`;

export async function listerExecutions(
  db: Db,
  auth: Auth,
  q: {
    automatisation_id?: string | undefined;
    issue?: IssueExecutionAutomatisation | undefined;
    limite: number;
    curseur?: string | undefined;
  },
) {
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT x.id, x.automatisation_id, a.nom AS automatisation_nom, x.version, x.issue, x.raison,
       x.mode_execution, x.executant_id, u.nom AS executant_nom, x.mission_id,
       mi.intitule AS mission_intitule, e.code AS evenement_code, e.payload AS evenement_payload,
       e.cree_le AS evenement_le, x.cree_le, ${CLE_TRI} AS cle_tri
     FROM automatisation_executions x
     JOIN automatisations a ON a.id = x.automatisation_id
     JOIN automatisation_evenements e ON e.id = x.evenement_id
     LEFT JOIN utilisateurs u ON u.id = x.executant_id
     LEFT JOIN missions mi ON mi.id = x.mission_id
     WHERE ${visibilite(1, 2)}
       AND ($3::uuid IS NULL OR x.automatisation_id = $3)
       AND ($4::text IS NULL OR x.issue = $4)
       AND ($5::text IS NULL OR (${CLE_TRI}, x.id) < ($5, $6::uuid))
     ORDER BY cle_tri DESC, x.id DESC LIMIT $7`,
    [
      voitToutesLesMissions(auth),
      auth.utilisateurId,
      q.automatisation_id ?? null,
      q.issue ?? null,
      apres?.[0] ?? null,
      apres?.[1] ?? null,
      q.limite + 1,
    ],
  );
  const page = paginer(r.rows as { id: string; cle_tri: string }[], q.limite);
  const ids = page.elements.map((x) => x.id);
  const actions = await db.query(
    `SELECT ac.id, ac.execution_id, ac.indice, ac.type, ac.classe_risque, ac.vers_client,
       ac.annulable, ac.autorisee, ac.refus, r.statut, r.code, r.message, r.entite_type,
       r.entite_id, r.cree_le AS resultat_le, an.motif AS annulation_motif,
       an.cree_le AS annulee_le, ua.nom AS annulee_par_nom
     FROM automatisation_actions ac
     LEFT JOIN automatisation_action_resultats r ON r.action_id = ac.id
     LEFT JOIN automatisation_annulations an ON an.action_id = ac.id
     LEFT JOIN utilisateurs ua ON ua.id = an.auteur_id
     WHERE ac.execution_id = ANY ($1::uuid[]) ORDER BY ac.execution_id, ac.indice`,
    [ids],
  );
  const parExecution = new Map<string, Record<string, unknown>[]>();
  for (const a of actions.rows) {
    const { execution_id, statut, ...reste } = a as Record<string, unknown>;
    const liste = parExecution.get(execution_id as string) ?? [];
    liste.push({ ...reste, statut: statut ?? "en_file" });
    parExecution.set(execution_id as string, liste);
  }
  return {
    ...page,
    elements: page.elements.map((x) => ({ ...x, actions: parExecution.get(x.id) ?? [] })),
  };
}

export async function annulerAction(
  db: Db,
  auth: Auth,
  actionId: string,
  motif: string,
): Promise<void> {
  // Verrou consultatif (les tables en ajout seul n'accordent pas UPDATE, donc pas FOR UPDATE) ;
  // l'index unique des annulations reste la barrière finale.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `automatisation_action:${actionId}`,
  ]);
  const r = await db.query(
    `SELECT ac.id, ac.type, ac.annulable, r.statut, r.entite_id, r.details,
       EXISTS (SELECT 1 FROM automatisation_annulations an WHERE an.action_id = ac.id) AS annulee
     FROM automatisation_actions ac
     JOIN automatisation_executions x ON x.id = ac.execution_id
     LEFT JOIN automatisation_action_resultats r ON r.action_id = ac.id
     WHERE ac.id = $1 AND ${visibilite(2, 3)}`,
    [actionId, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  const a = r.rows[0] as
    | {
        id: string;
        type: TypeActionAutomatisation;
        annulable: boolean;
        statut: string | null;
        entite_id: string | null;
        details: Record<string, unknown> | null;
        annulee: boolean;
      }
    | undefined;
  if (!a) throw introuvable("Action");
  const permission = REGISTRE_ACTIONS_AUTOMATISATION[a.type].permission;
  if (permission && !aPermission(auth.roles, permission)) throw interdit();
  if (!a.annulable) throw annulationImpossible("Cette action ne s'annule pas.");
  if (a.annulee) throw annulationImpossible("Cette action est déjà annulée.");
  if (a.statut !== "reussie") throw annulationImpossible("Seule une action réussie s'annule.");
  await defaireAction(db, auth, { ...a, details: a.details ?? {} }, motif);
  await avecErreursAutomatisation(() =>
    db.query(
      `INSERT INTO automatisation_annulations (cabinet_id, action_id, motif, auteur_id)
       VALUES ($1, $2, $3, $4)`,
      [auth.cabinetId, actionId, motif, auth.utilisateurId],
    ),
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "annulation",
    entite: "automatisation_action",
    entiteId: actionId,
    details: { type: a.type, motif },
  });
}

/* ----- Brouillons tracés ----- */

const CLE_TRI_BROUILLON = `lpad(((extract(epoch FROM b.cree_le) * 1000000)::bigint)::text, 17, '0')`;
const VISIBLE_BROUILLON = (pToutes: number, pUtilisateur: number) =>
  `EXISTS (SELECT 1 FROM missions m WHERE m.id = b.mission_id AND ${filtreVisibilite(pToutes, pUtilisateur)})`;

const COLONNES_BROUILLON = `b.id, b.action_id, b.mission_id, mi.intitule AS mission_intitule,
  b.nature, b.titre, b.corps, b.cree_le, d.decision, d.texte_final, d.motif AS decision_motif,
  d.cree_le AS decision_le, ud.nom AS decideur_nom`;
const DEPUIS_BROUILLON = `automatisation_brouillons b
  JOIN missions mi ON mi.id = b.mission_id
  LEFT JOIN automatisation_brouillon_decisions d ON d.brouillon_id = b.id
  LEFT JOIN utilisateurs ud ON ud.id = d.auteur_id`;

export async function listerBrouillons(
  db: Db,
  auth: Auth,
  q: { a_valider?: "true" | "false" | undefined; limite: number; curseur?: string | undefined },
) {
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES_BROUILLON}, ${CLE_TRI_BROUILLON} AS cle_tri FROM ${DEPUIS_BROUILLON}
     WHERE ${VISIBLE_BROUILLON(1, 2)}
       AND ($3::boolean IS NULL OR (d.id IS NULL) = $3)
       AND ($4::text IS NULL OR (${CLE_TRI_BROUILLON}, b.id) < ($4, $5::uuid))
     ORDER BY cle_tri DESC, b.id DESC LIMIT $6`,
    [
      voitToutesLesMissions(auth),
      auth.utilisateurId,
      q.a_valider === undefined ? null : q.a_valider === "true",
      apres?.[0] ?? null,
      apres?.[1] ?? null,
      q.limite + 1,
    ],
  );
  return paginer(r.rows as { id: string; cle_tri: string }[], q.limite);
}

async function lireBrouillon(db: Db, auth: Auth, id: string, verrouiller = false) {
  if (verrouiller) {
    // Verrou consultatif : table en ajout seul (pas de FOR UPDATE sans droit UPDATE).
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `automatisation_brouillon:${id}`,
    ]);
  }
  const r = await db.query(
    `SELECT ${COLONNES_BROUILLON} FROM ${DEPUIS_BROUILLON}
     WHERE b.id = $1 AND ${VISIBLE_BROUILLON(2, 3)}`,
    [id, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  if (!r.rows[0]) throw introuvable("Brouillon");
  return r.rows[0] as Record<string, unknown> & { decision: string | null };
}

export async function deciderBrouillon(
  db: Db,
  auth: Auth,
  id: string,
  d: { decision: "validee" | "modifiee" | "rejetee"; texte_final?: string; motif?: string },
) {
  const b = await lireBrouillon(db, auth, id, true);
  // Décision du chef ou du directeur de la mission (ou de qui modifie toutes les missions).
  const mission = await exigerMissionVisible(db, auth, b.mission_id as string);
  if (!peutModifierMission(auth, mission)) throw interdit();
  if (b.decision) throw decisionExiste();
  await avecErreursAutomatisation(() =>
    db.query(
      `INSERT INTO automatisation_brouillon_decisions (cabinet_id, brouillon_id, decision,
         texte_final, motif, auteur_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [auth.cabinetId, id, d.decision, d.texte_final ?? null, d.motif ?? null, auth.utilisateurId],
    ),
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: `brouillon_${d.decision}`,
    entite: "automatisation_brouillon",
    entiteId: id,
    details: { mission_id: b.mission_id },
  });
  return lireBrouillon(db, auth, id);
}
