import {
  evaluerGarde,
  type ClasseRisque,
  type EtapeGarde,
  type ValidationGarde,
} from "@missionpilot/engines";
import type {
  derogationCreationSchema,
  derogationDecisionSchema,
  derogationsQuerySchema,
} from "@missionpilot/shared";
import { aPermission } from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  estAssocie,
  exigerMissionModifiable,
  exigerMissionVisible,
  filtreVisibilite,
  voitToutesLesMissions,
  type MissionAcces,
} from "../missions/acces.js";
import { methodeEffectiveMission } from "./missions.js";
import { trouverBrique } from "./resolution.js";

/*
 * Dérogations (STD-07) : exception motivée à la méthode d'une mission,
 * approuvée selon la classe de risque EFFECTIVE de la brique (moteur
 * `qualite`, `evaluerGarde`), tracée et visible au tableau de bord.
 *
 * - Demander : `methode.deroger` et mission modifiable ; la brique existe
 *   dans la version figée ; motif obligatoire. La demande vaut l'étape de
 *   l'auteur : `validation_auteur` (R1) ou `validation_consultant` (R2, R3) ;
 *   R0 et R1 sont donc approuvées dès la demande (garde automatique ou
 *   validation de l'auteur), journalisées comme les autres.
 * - Décider l'étape suivante (dans l'ordre de la garde) :
 *   relecture du chef de mission → chef ou directeur de la mission, ou
 *   associé ; revue du second expert (R3) → expert métier ou associé ;
 *   signature (R3) → directeur de la mission ou associé. Mission visible,
 *   jamais le demandeur (MPM04 en base), quatre yeux en R3. Un refus
 *   motivé clôt la dérogation.
 */

interface DerogationLigne {
  id: string;
  mission_id: string;
  brique_code: string;
  nature: string;
  description: string | null;
  motif: string;
  classe_risque: ClasseRisque;
  statut: "demandee" | "approuvee" | "refusee";
  demandeur_id: string;
  demandeur_nom: string | null;
  cree_le: string;
  decide_le: string | null;
}

const COLONNES = `d.id, d.mission_id, d.brique_code, d.nature, d.description, d.motif, d.classe_risque,
  d.statut, d.demandeur_id, u.nom AS demandeur_nom, d.cree_le, d.decide_le`;

async function validations(db: Db, derogationId: string) {
  const r = await db.query(
    `SELECT v.etape, v.decision, v.acteur_id, u.nom AS acteur_nom, v.commentaire, v.cree_le
     FROM derogation_validations v LEFT JOIN utilisateurs u ON u.id = v.acteur_id
     WHERE v.derogation_id = $1 ORDER BY v.cree_le, v.etape`,
    [derogationId],
  );
  return r.rows as {
    etape: EtapeGarde;
    decision: "approuve" | "refuse";
    acteur_id: string;
    acteur_nom: string | null;
    commentaire: string | null;
    cree_le: string;
  }[];
}

function evaluer(
  d: DerogationLigne,
  vals: { etape: EtapeGarde; decision: string; acteur_id: string }[],
) {
  const approuvees: ValidationGarde[] = vals
    .filter((v) => v.decision === "approuve")
    .map((v) => ({ etape: v.etape, acteur: v.acteur_id }));
  return evaluerGarde(d.classe_risque, approuvees, { auteur: d.demandeur_id });
}

async function detail(db: Db, d: DerogationLigne) {
  const vals = await validations(db, d.id);
  const e = evaluer(d, vals);
  return {
    ...d,
    validations: vals,
    garde: {
      etapes_requises: e.etapesRequises,
      etapes_faites: e.etapesFaites,
      prochaine_etape: d.statut === "demandee" ? e.prochaineEtape : null,
      complete: e.complete,
    },
  };
}

async function lireDerogation(db: Db, id: string, verrouiller = false): Promise<DerogationLigne> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM derogations d LEFT JOIN utilisateurs u ON u.id = d.demandeur_id
     WHERE d.id = $1 ${verrouiller ? "FOR UPDATE OF d" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Dérogation");
  return r.rows[0] as DerogationLigne;
}

async function enregistrerValidation(
  db: Db,
  auth: Auth,
  derogationId: string,
  etape: EtapeGarde,
  decision: "approuve" | "refuse",
  commentaire: string | null,
) {
  await db.query(
    `INSERT INTO derogation_validations (cabinet_id, derogation_id, etape, decision, acteur_id, commentaire)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.cabinetId, derogationId, etape, decision, auth.utilisateurId, commentaire],
  );
}

async function cloturer(db: Db, id: string, statut: "approuvee" | "refusee") {
  await db.query(`UPDATE derogations SET statut = $2, decide_le = now() WHERE id = $1`, [
    id,
    statut,
  ]);
}

export async function demanderDerogation(
  db: Db,
  auth: Auth,
  missionId: string,
  corps: z.infer<typeof derogationCreationSchema>,
) {
  await exigerMissionModifiable(db, auth, missionId);
  const methode = await methodeEffectiveMission(db, missionId);
  if (!methode) throw conflit("Lier d'abord une méthode à la mission.");
  const brique = trouverBrique(methode, corps.brique_code);
  if (!brique) throw requeteInvalide("Brique inconnue dans la méthode de la mission.");
  if (corps.nature === "retirer_brique" && !brique.active) {
    throw conflit("Cette brique n'est pas active : rien à retirer.");
  }
  if (corps.nature === "activer_brique" && brique.active) {
    throw conflit("Cette brique est déjà active.");
  }
  const r = await db.query(
    `INSERT INTO derogations (cabinet_id, mission_id, mission_methode_id, brique_code, nature,
       description, motif, classe_risque, demandeur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      auth.cabinetId,
      missionId,
      methode.liaison.id,
      corps.brique_code,
      corps.nature,
      corps.description ?? null,
      corps.motif,
      brique.classe_risque,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  const premiere = evaluer(
    { classe_risque: brique.classe_risque, demandeur_id: auth.utilisateurId } as DerogationLigne,
    [],
  ).prochaineEtape;
  if (premiere === "validation_auteur" || premiere === "validation_consultant") {
    await enregistrerValidation(db, auth, id, premiere, "approuve", null);
  }
  const d = await lireDerogation(db, id);
  const e = evaluer(d, await validations(db, id));
  if (e.complete) await cloturer(db, id, "approuvee");
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "derogation.demander",
    entite: "derogation",
    entiteId: id,
    details: {
      mission_id: missionId,
      brique_code: corps.brique_code,
      nature: corps.nature,
      classe_risque: brique.classe_risque,
      approuvee_automatiquement: e.complete,
    },
  });
  return detail(db, await lireDerogation(db, id));
}

/** Habilitation à l'étape (rôle sur la mission) ; le moteur contrôle ensuite les cumuls. */
function habilite(auth: Auth, mission: MissionAcces, etape: EtapeGarde): boolean {
  const responsable =
    mission.chef_id === auth.utilisateurId || mission.directeur_id === auth.utilisateurId;
  switch (etape) {
    case "relecture_chef_mission":
      return aPermission(auth.roles, "methode.deroger") && (responsable || estAssocie(auth));
    case "revue_second_expert":
      return auth.roles.includes("expert_metier") || estAssocie(auth);
    case "signature_directeur_mission":
      return mission.directeur_id === auth.utilisateurId || estAssocie(auth);
    default:
      return false;
  }
}

export async function deciderDerogation(
  db: Db,
  auth: Auth,
  id: string,
  corps: z.infer<typeof derogationDecisionSchema>,
) {
  const avant = await lireDerogation(db, id);
  const mission = await exigerMissionVisible(db, auth, avant.mission_id, true);
  const d = await lireDerogation(db, id, true);
  if (d.statut !== "demandee")
    throw new AppError(409, "DEROGATION_DECIDEE", "Dérogation déjà décidée.");
  if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
  const vals = await validations(db, id);
  const prochaine = evaluer(d, vals).prochaineEtape;
  if (corps.etape !== prochaine) {
    throw new AppError(
      409,
      "ETAPE_INATTENDUE",
      "Cette étape de la garde n'est pas la prochaine à franchir.",
    );
  }
  if (!habilite(auth, mission, corps.etape) || auth.utilisateurId === d.demandeur_id)
    throw interdit();
  if (corps.decision === "approuve") {
    const apres = evaluer(d, [
      ...vals,
      { etape: corps.etape, decision: "approuve", acteur_id: auth.utilisateurId },
    ]);
    if (apres.violations.length > 0) {
      throw new AppError(
        403,
        "SEPARATION_DES_TACHES",
        "Cette personne tient déjà un autre rôle dans la garde de cette dérogation.",
      );
    }
    await enregistrerValidation(db, auth, id, corps.etape, "approuve", corps.commentaire ?? null);
    if (apres.complete) await cloturer(db, id, "approuvee");
  } else {
    await enregistrerValidation(db, auth, id, corps.etape, "refuse", corps.commentaire ?? null);
    await cloturer(db, id, "refusee");
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "derogation.decider",
    entite: "derogation",
    entiteId: id,
    details: { etape: corps.etape, decision: corps.decision, mission_id: d.mission_id },
  });
  return detail(db, await lireDerogation(db, id));
}

export async function lireDerogationVisible(db: Db, auth: Auth, id: string) {
  const d = await lireDerogation(db, id);
  await exigerMissionVisible(db, auth, d.mission_id);
  return detail(db, d);
}

export async function listerDerogationsMission(db: Db, auth: Auth, missionId: string) {
  await exigerMissionVisible(db, auth, missionId);
  const r = await db.query(
    `SELECT ${COLONNES} FROM derogations d LEFT JOIN utilisateurs u ON u.id = d.demandeur_id
     WHERE d.mission_id = $1 ORDER BY d.cree_le DESC, d.id DESC`,
    [missionId],
  );
  // Une requête à la fois sur le client de la transaction.
  const elements = [];
  for (const d of r.rows as DerogationLigne[]) elements.push(await detail(db, d));
  return { elements };
}

/** Tableau de bord des dérogations (STD-07) : missions visibles seulement. */
export async function tableauDerogations(
  db: Db,
  auth: Auth,
  q: z.infer<typeof derogationsQuerySchema>,
) {
  const curseur = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES}, m.intitule AS mission_intitule, d.cree_le::text AS cle_tri
     FROM derogations d JOIN missions m ON m.id = d.mission_id
     LEFT JOIN utilisateurs u ON u.id = d.demandeur_id
     WHERE ${filtreVisibilite(1, 2)} AND ($3::text IS NULL OR d.statut = $3)
       AND ($4::timestamptz IS NULL OR (d.cree_le, d.id) < ($4::timestamptz, $5::uuid))
     ORDER BY d.cree_le DESC, d.id DESC
     LIMIT $6`,
    [
      voitToutesLesMissions(auth),
      auth.utilisateurId,
      q.statut ?? null,
      curseur?.[0] ?? null,
      curseur?.[1] ?? null,
      q.limite + 1,
    ],
  );
  const compteurs = await db.query(
    `SELECT d.statut, count(*)::int AS nombre
     FROM derogations d JOIN missions m ON m.id = d.mission_id
     WHERE ${filtreVisibilite(1, 2)} GROUP BY d.statut`,
    [voitToutesLesMissions(auth), auth.utilisateurId],
  );
  return {
    ...paginer(r.rows, q.limite),
    compteurs: Object.fromEntries(
      ["demandee", "approuvee", "refusee"].map((s) => [
        s,
        (compteurs.rows.find((c) => c.statut === s)?.nombre as number | undefined) ?? 0,
      ]),
    ),
  };
}
