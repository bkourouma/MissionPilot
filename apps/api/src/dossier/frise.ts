import { construireFrise, type EvenementFrise } from "@missionpilot/engines";
import { aPermission } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";

/*
 * Frise chronologique du client (DOS-06), alimentée EN LECTURE par les tables existantes,
 * chaque source selon les droits du lecteur : missions visibles (`mission.lire` : création,
 * signature, clôture), notations publiées (`notation.lire`, mission visible), alertes KPI
 * (`kpi.lire`, mission visible), contenus validés du plan stratégique (`plan.lire`, mission
 * visible), décisions du dossier (faits et états financiers). Aucun montant, coût, taux ni
 * marge (FIN-02) : seulement des libellés et des dates. Fusion et tri stables par le moteur
 * `construireFrise` ; chaque source est bornée à `limite` événements (les plus récents).
 */

export interface EvenementDossier extends EvenementFrise {
  /** Mission de rattachement, pour un lien (null pour un événement du dossier). */
  mission_id: string | null;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

const ev = (
  type: EvenementFrise["type"],
  id: string,
  date: unknown,
  libelle: string,
  missionId: string | null = null,
): EvenementDossier => ({ type, id, date: iso(date), libelle, mission_id: missionId });

async function missions(db: Db, auth: Auth, clientId: string, limite: number) {
  if (!aPermission(auth.roles, "mission.lire")) return [];
  const r = await db.query(
    `SELECT m.id, m.intitule, m.cree_le, m.date_signature::text AS date_signature, m.cloturee_le
     FROM missions m WHERE m.client_id = $1 AND ${filtreVisibilite(2, 3)}
     ORDER BY m.cree_le DESC, m.id LIMIT $4`,
    [clientId, voitToutesLesMissions(auth), auth.utilisateurId, limite],
  );
  return r.rows.flatMap((m) => {
    const id = m.id as string;
    const titre = m.intitule as string;
    const liste = [ev("mission", `${id}:creation`, m.cree_le, `Mission créée : ${titre}`, id)];
    if (m.date_signature)
      liste.push(
        ev("mission", `${id}:signature`, m.date_signature, `Mission signée : ${titre}`, id),
      );
    if (m.cloturee_le)
      liste.push(ev("mission", `${id}:cloture`, m.cloturee_le, `Mission clôturée : ${titre}`, id));
    return liste;
  });
}

async function notations(db: Db, auth: Auth, clientId: string, limite: number) {
  if (!aPermission(auth.roles, "notation.lire") || !aPermission(auth.roles, "mission.lire"))
    return [];
  const r = await db.query(
    `SELECT e.id, e.le, v.numero, m.id AS mission_id, m.intitule
     FROM notation_evenements e
     JOIN notation_versions v ON v.id = e.version_id
     JOIN notations n ON n.id = v.notation_id
     JOIN missions m ON m.id = n.mission_id
     WHERE n.client_id = $1 AND e.action = 'publication' AND ${filtreVisibilite(2, 3)}
     ORDER BY e.le DESC, e.id LIMIT $4`,
    [clientId, voitToutesLesMissions(auth), auth.utilisateurId, limite],
  );
  return r.rows.map((x) =>
    ev(
      "notation",
      x.id,
      x.le,
      `Notation publiée (version ${x.numero}) : ${x.intitule}`,
      x.mission_id,
    ),
  );
}

async function alertes(db: Db, auth: Auth, clientId: string, limite: number) {
  if (!aPermission(auth.roles, "kpi.lire") || !aPermission(auth.roles, "mission.lire")) return [];
  const r = await db.query(
    `SELECT a.id, a.code, a.periode_cle, a.detectee_le, k.libelle, m.id AS mission_id
     FROM kpi_alertes a
     JOIN kpi_definitions k ON k.id = a.kpi_id
     JOIN missions m ON m.id = k.mission_id
     WHERE k.client_id = $1 AND ${filtreVisibilite(2, 3)}
     ORDER BY a.detectee_le DESC, a.id LIMIT $4`,
    [clientId, voitToutesLesMissions(auth), auth.utilisateurId, limite],
  );
  return r.rows.map((x) =>
    ev(
      "alerte",
      x.id,
      x.detectee_le,
      `Alerte KPI « ${x.libelle} » : ${x.code} (${x.periode_cle})`,
      x.mission_id,
    ),
  );
}

const TYPES_PLAN: Record<string, string> = {
  vision_mission: "vision et mission",
  axe: "axe stratégique",
  objectif: "objectif",
};

async function decisionsPlan(db: Db, auth: Auth, clientId: string, limite: number) {
  if (!aPermission(auth.roles, "plan.lire") || !aPermission(auth.roles, "mission.lire")) return [];
  const r = await db.query(
    `SELECT v.id, v.cree_le, el.type, m.id AS mission_id
     FROM plan_element_versions v
     JOIN plan_elements el ON el.id = v.element_id
     JOIN plans_strategiques p ON p.id = el.plan_id
     JOIN missions m ON m.id = p.mission_id
     WHERE m.client_id = $1 AND v.statut_contenu = 'valide'
       AND el.type IN ('vision_mission', 'axe', 'objectif') AND ${filtreVisibilite(2, 3)}
     ORDER BY v.cree_le DESC, v.id LIMIT $4`,
    [clientId, voitToutesLesMissions(auth), auth.utilisateurId, limite],
  );
  return r.rows.map((x) =>
    ev(
      "decision",
      x.id,
      x.cree_le,
      `Plan stratégique : ${TYPES_PLAN[x.type as string] ?? "élément"} validé`,
      x.mission_id,
    ),
  );
}

async function decisionsDossier(db: Db, clientId: string, limite: number) {
  const faits = await db.query(
    `SELECT d.id, d.decision, d.cree_le, f.cle FROM dossier_faits_decisions d
     JOIN dossier_faits f ON f.id = d.fait_id
     WHERE f.client_id = $1 ORDER BY d.cree_le DESC, d.id LIMIT $2`,
    [clientId, limite],
  );
  const etats = await db.query(
    `SELECT d.id, d.decision, d.automatique, d.cree_le, e.exercice FROM dossier_etats_decisions d
     JOIN dossier_etats_financiers e ON e.id = d.etat_id
     WHERE e.client_id = $1 ORDER BY d.cree_le DESC, d.id LIMIT $2`,
    [clientId, limite],
  );
  return [
    ...faits.rows.map((x) =>
      ev(
        "fait",
        x.id,
        x.cree_le,
        `Fait « ${x.cle} » ${x.decision === "confirme" ? "confirmé" : "rejeté"}`,
      ),
    ),
    ...etats.rows.map((x) =>
      ev(
        "decision",
        x.id,
        x.cree_le,
        `États financiers ${x.exercice} ${x.decision === "rejete" ? "rejetés" : x.automatique ? "acceptés (contrôles passés)" : "acceptés après revue"}`,
      ),
    ),
  ];
}

/** Frise du client pour ce lecteur (dossier visible, vérifié par l'appelant). */
export async function friseDossier(
  db: Db,
  auth: Auth,
  clientId: string,
  options: { limite: number; ordre: "recent_d_abord" | "ancien_d_abord" },
) {
  // Une ligne de plus par source : une source plus longue que la frise la signale tronquée.
  const n = options.limite + 1;
  const sources = [
    await notations(db, auth, clientId, n),
    await missions(db, auth, clientId, n),
    await decisionsPlan(db, auth, clientId, n),
    await decisionsDossier(db, clientId, n),
    await alertes(db, auth, clientId, n),
  ];
  const frise = construireFrise(sources, options);
  return { evenements: frise.evenements, tronquee: frise.tronquee };
}
