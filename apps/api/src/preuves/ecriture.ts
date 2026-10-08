import {
  ASSERTIONS_MISSION_MAX,
  DIMENSIONS_MISSION_MAX,
  PREUVES_MISSION_MAX,
  type assertionCorrectionSchema,
  type assertionCreationSchema,
  type preuveCorrectionSchema,
  type preuveCreationSchema,
} from "@missionpilot/shared";
import { rangClasseRisque, type ClasseRisque } from "@missionpilot/engines";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, interdit } from "../errors.js";
import type { MissionAcces } from "../missions/acces.js";
import { aHabilitationExpert, exigerAuteurMembre } from "./acces.js";

/*
 * Écritures du registre des preuves, toutes en ajout seul : une identité (preuve, assertion), puis
 * des versions. Appelées dans la transaction de la route, mission verrouillée
 * (`exigerMissionEcrivable`), qui journalise ensuite.
 */

export type CorpsPreuve = z.infer<typeof preuveCreationSchema>;
export type CorpsPreuveCorrigee = z.infer<typeof preuveCorrectionSchema>;
export type CorpsAssertion = z.infer<typeof assertionCreationSchema>;
export type CorpsAssertionCorrigee = z.infer<typeof assertionCorrectionSchema>;

async function exigerPlafond(
  db: Db,
  table: "preuves" | "assertions",
  missionId: string,
  max: number,
) {
  // `table` est un choix entre deux constantes de ce module (jamais une valeur reçue).
  const r = await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE mission_id = $1`, [
    missionId,
  ]);
  if ((r.rows[0].n as number) >= max) {
    throw new AppError(
      409,
      "PLAFOND_ATTEINT",
      `Cette mission atteint le plafond de ${max} éléments pour ce registre.`,
    );
  }
}

/** Les codes de dimension doivent exister (actifs) pour la mission, ou figurer déjà sur la version précédente. */
export async function verifierDimensions(
  db: Db,
  missionId: string,
  codes: readonly string[],
  dejaPresentes: readonly string[] = [],
): Promise<void> {
  const aVerifier = [...new Set(codes)].filter((c) => !dejaPresentes.includes(c));
  if (aVerifier.length === 0) return;
  const r = await db.query(
    `SELECT code FROM preuve_dimensions WHERE mission_id = $1 AND actif AND code = ANY ($2::text[])`,
    [missionId, aVerifier],
  );
  const connus = new Set(r.rows.map((l) => l.code as string));
  const inconnues = aVerifier.filter((c) => !connus.has(c));
  if (inconnues.length > 0) {
    throw new AppError(
      400,
      "DIMENSION_INCONNUE",
      `Dimension inconnue pour cette mission : ${inconnues.slice(0, 5).join(", ")}.`,
    );
  }
}

export async function creerDimension(
  db: Db,
  auth: Auth,
  missionId: string,
  code: string,
  libelle: string,
): Promise<string> {
  const n = await db.query(
    `SELECT count(*)::int AS n FROM preuve_dimensions WHERE mission_id = $1`,
    [missionId],
  );
  if ((n.rows[0].n as number) >= DIMENSIONS_MISSION_MAX) {
    throw new AppError(409, "PLAFOND_ATTEINT", "Trop de dimensions pour cette mission.");
  }
  const r = await db.query(
    `INSERT INTO preuve_dimensions (cabinet_id, mission_id, code, libelle, cree_par)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [auth.cabinetId, missionId, code, libelle, auth.utilisateurId],
  );
  return r.rows[0].id as string;
}

async function insererVersionPreuve(
  db: Db,
  auth: Auth,
  preuveId: string,
  version: number,
  c: CorpsPreuve,
  motif: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO preuve_versions (cabinet_id, preuve_id, version, type_source, source_precise,
       date_preuve, auteur_id, fiabilite, extrait, fichier_id, reponse_id, document_id, dimensions,
       nominatif, accord_nominatif, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text[], $14, $15, $16, $17)`,
    [
      auth.cabinetId,
      preuveId,
      version,
      c.type_source,
      c.source_precise,
      c.date_preuve,
      c.auteur_id ?? auth.utilisateurId,
      c.fiabilite,
      c.extrait ?? null,
      c.fichier_id ?? null,
      c.reponse_id ?? null,
      c.document_id ?? null,
      c.dimensions,
      c.nominatif,
      c.accord_nominatif,
      motif,
      auth.utilisateurId,
    ],
  );
}

export async function creerPreuve(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  c: CorpsPreuve,
): Promise<string> {
  await exigerPlafond(db, "preuves", mission.id, PREUVES_MISSION_MAX);
  await verifierDimensions(db, mission.id, c.dimensions);
  // Auteur désigné (autre que soi) : membre actif de la mission (doublé en base, MPV02).
  if (c.auteur_id !== undefined && c.auteur_id !== auth.utilisateurId) {
    await exigerAuteurMembre(db, mission.id, c.auteur_id);
  }
  const r = await db.query(
    `INSERT INTO preuves (cabinet_id, mission_id, client_id, cree_par)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [auth.cabinetId, mission.id, mission.client_id, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  await insererVersionPreuve(db, auth, id, 1, c, null);
  return id;
}

export async function corrigerPreuve(
  db: Db,
  auth: Auth,
  preuve: {
    id: string;
    mission_id: string;
    version: number;
    dimensions: string[];
    auteur_id: string;
  },
  c: CorpsPreuveCorrigee,
): Promise<number> {
  await verifierDimensions(db, preuve.mission_id, c.dimensions, preuve.dimensions);
  if (
    c.auteur_id !== undefined &&
    c.auteur_id !== auth.utilisateurId &&
    c.auteur_id !== preuve.auteur_id
  ) {
    await exigerAuteurMembre(db, preuve.mission_id, c.auteur_id);
  }
  const version = preuve.version + 1;
  const { motif, ...contenu } = c;
  await insererVersionPreuve(
    db,
    auth,
    preuve.id,
    version,
    { ...contenu, auteur_id: contenu.auteur_id ?? preuve.auteur_id },
    motif,
  );
  return version;
}

async function insererVersionAssertion(
  db: Db,
  auth: Auth,
  assertionId: string,
  version: number,
  c: CorpsAssertion,
  motif: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO assertion_versions (cabinet_id, assertion_id, version, enonce, rattachement_type,
       rattachement_code, livrable, classe_risque, statut, avis_expert, avis_expert_motif,
       signe_par, signe_le, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid,
       CASE WHEN $12::uuid IS NULL THEN NULL ELSE now() END, $13, $14)`,
    [
      auth.cabinetId,
      assertionId,
      version,
      c.enonce,
      c.rattachement_type ?? null,
      c.rattachement_code ?? null,
      c.livrable ?? null,
      c.classe_risque,
      c.statut,
      c.avis_expert,
      c.avis_expert ? (c.avis_expert_motif ?? null) : null,
      // La signature est toujours celle de l'utilisateur qui écrit la version.
      c.avis_expert && c.signer_avis ? auth.utilisateurId : null,
      motif,
      auth.utilisateurId,
    ],
  );
}

/** Signer un avis d'expert : habilitation d'expert (403 sinon ; doublé en base, MPV04). */
function exigerSignatureAutorisee(auth: Auth, c: { avis_expert: boolean; signer_avis: boolean }) {
  if (c.avis_expert && c.signer_avis && !aHabilitationExpert(auth)) throw interdit();
}

export async function creerAssertion(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  c: CorpsAssertion,
): Promise<string> {
  exigerSignatureAutorisee(auth, c);
  await exigerPlafond(db, "assertions", mission.id, ASSERTIONS_MISSION_MAX);
  if (c.rattachement_type === "dimension") {
    await verifierDimensions(db, mission.id, [c.rattachement_code ?? ""]);
  }
  const r = await db.query(
    `INSERT INTO assertions (cabinet_id, mission_id, cree_par) VALUES ($1, $2, $3) RETURNING id`,
    [auth.cabinetId, mission.id, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  await insererVersionAssertion(db, auth, id, 1, c, null);
  return id;
}

export async function corrigerAssertion(
  db: Db,
  auth: Auth,
  assertion: {
    id: string;
    mission_id: string;
    version: number;
    rattachement_type: string | null;
    rattachement_code: string | null;
    classe_risque: string;
  },
  c: CorpsAssertionCorrigee,
): Promise<number> {
  exigerSignatureAutorisee(auth, c);
  // Abaisser la classe de risque allège le contrôle PRV-03 : réservé à l'expert (doublé, MPV06).
  if (
    rangClasseRisque(c.classe_risque as ClasseRisque) <
      rangClasseRisque(assertion.classe_risque as ClasseRisque) &&
    !aHabilitationExpert(auth)
  ) {
    throw new AppError(
      409,
      "CLASSE_RISQUE_ABAISSEE",
      "Seul un expert métier ou un associé abaisse la classe de risque d'une assertion.",
    );
  }
  const inchange =
    c.rattachement_type === assertion.rattachement_type &&
    (c.rattachement_code ?? null) === assertion.rattachement_code;
  if (c.rattachement_type === "dimension" && !inchange) {
    await verifierDimensions(db, assertion.mission_id, [c.rattachement_code ?? ""]);
  }
  const version = assertion.version + 1;
  const { motif, ...contenu } = c;
  await insererVersionAssertion(db, auth, assertion.id, version, contenu, motif);
  return version;
}

export async function ajouterLien(
  db: Db,
  auth: Auth,
  missionId: string,
  assertionId: string,
  preuveId: string,
  action: "lier" | "delier",
  sens: "pour" | "contre" | null,
): Promise<void> {
  await db.query(
    `INSERT INTO assertion_preuve_liens (cabinet_id, mission_id, assertion_id, preuve_id, action,
       sens, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [auth.cabinetId, missionId, assertionId, preuveId, action, sens, auth.utilisateurId],
  );
}

/**
 * Séparation des tâches (PRV-04) : lever une contradiction écarte la preuve contraire ; ni l'auteur
 * de l'assertion (identité ou version courante) ni l'auteur ou le saisisseur de la version arbitrée
 * de la preuve ne le décident seuls, sauf associé (409 ; doublé en base, MPV07). Maintenir la
 * contradiction reste ouvert à tous ceux qui écrivent.
 */
async function exigerArbitreIndependant(
  db: Db,
  auth: Auth,
  assertion: { id: string; cree_par: string },
  preuve: { cree_par: string; auteur_id: string },
): Promise<void> {
  if (auth.roles.includes("associe")) return;
  const identite = await db.query("SELECT cree_par FROM assertions WHERE id = $1", [assertion.id]);
  const auteurs = [
    identite.rows[0]?.cree_par as string | undefined,
    assertion.cree_par,
    preuve.cree_par,
    preuve.auteur_id,
  ];
  if (auteurs.includes(auth.utilisateurId)) {
    throw new AppError(
      409,
      "ARBITRAGE_PAR_AUTEUR",
      "L'auteur de l'assertion ou de la preuve contraire ne lève pas lui-même la contradiction : un autre membre de l'équipe ou un associé arbitre.",
    );
  }
}

export async function ajouterArbitrage(
  db: Db,
  auth: Auth,
  missionId: string,
  assertion: { id: string; cree_par: string },
  preuve: { id: string; version: number; cree_par: string; auteur_id: string },
  sensLien: "pour" | "contre",
  decision: string,
  motif: string,
): Promise<void> {
  // Un lien « pour » est refusé par la base (MPV05) avant toute question de séparation des tâches.
  if (decision === "contradiction_levee" && sensLien === "contre") {
    await exigerArbitreIndependant(db, auth, assertion, preuve);
  }
  const assertionId = assertion.id;
  const preuveId = preuve.id;
  const preuveVersion = preuve.version;
  await db.query(
    `INSERT INTO preuve_arbitrages (cabinet_id, mission_id, assertion_id, preuve_id,
       preuve_version, decision, motif, arbitre_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      auth.cabinetId,
      missionId,
      assertionId,
      preuveId,
      preuveVersion,
      decision,
      motif,
      auth.utilisateurId,
    ],
  );
}
