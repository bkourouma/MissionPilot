import type { Db } from "../db/pool.js";
import { motifContient } from "../http/outils.js";

/*
 * Lectures du registre des preuves (migrations 0240 à 0242). L'état courant est dérivé de
 * l'historique en ajout seul : version la plus grande d'une preuve ou d'une assertion, dernier
 * événement d'un lien, dernier arbitrage d'un couple. Aucun calcul ici : l'indice de solidité
 * sort du moteur (`evaluation.ts`).
 */

export interface PreuveCourante {
  id: string;
  mission_id: string;
  client_id: string;
  cle_tri: string;
  cree_le: Date;
  version: number;
  type_source: string;
  source_precise: string;
  date_preuve: string;
  auteur_id: string;
  auteur_nom: string | null;
  fiabilite: string;
  extrait: string | null;
  fichier_id: string | null;
  reponse_id: string | null;
  document_id: string | null;
  dimensions: string[];
  nominatif: boolean;
  accord_nominatif: boolean;
  motif: string | null;
  cree_par: string;
  version_cree_le: Date;
}

export interface AssertionCourante {
  id: string;
  mission_id: string;
  cle_tri: string;
  cree_le: Date;
  version: number;
  enonce: string;
  rattachement_type: string | null;
  rattachement_code: string | null;
  livrable: string | null;
  classe_risque: string;
  statut: string;
  avis_expert: boolean;
  avis_expert_motif: string | null;
  signe_par: string | null;
  signe_par_nom: string | null;
  signe_le: Date | null;
  motif: string | null;
  cree_par: string;
  cree_par_nom: string | null;
  version_cree_le: Date;
}

export interface LienCourant {
  assertion_id: string;
  preuve_id: string;
  sens: "pour" | "contre";
  /** Horodatage du dernier événement de lien, à la microseconde (AAAAMMJJHHMMSSUS). */
  horodatage: string;
}

export interface ArbitrageLigne {
  id: string;
  assertion_id: string;
  preuve_id: string;
  preuve_version: number;
  decision: string;
  motif: string;
  arbitre_par: string;
  arbitre_nom: string | null;
  arbitre_le: Date;
  /** Horodatage de l'arbitrage, à la microseconde (comparable à celui des liens). */
  horodatage: string;
}

const COLONNES_PREUVE = `p.id, p.mission_id, p.client_id, p.numero::text AS cle_tri, p.cree_le,
  v.version, v.type_source, v.source_precise, v.date_preuve::text AS date_preuve, v.auteur_id,
  ua.nom AS auteur_nom, v.fiabilite, v.extrait, v.fichier_id, v.reponse_id, v.document_id,
  v.dimensions, v.nominatif, v.accord_nominatif, v.motif, v.cree_par, v.cree_le AS version_cree_le`;

const DEPUIS_PREUVE = `FROM preuves p
  JOIN LATERAL (SELECT * FROM preuve_versions pv WHERE pv.preuve_id = p.id
                ORDER BY pv.version DESC LIMIT 1) v ON true
  LEFT JOIN utilisateurs ua ON ua.id = v.auteur_id`;

const COLONNES_ASSERTION = `a.id, a.mission_id, a.numero::text AS cle_tri, a.cree_le,
  v.version, v.enonce, v.rattachement_type, v.rattachement_code, v.livrable, v.classe_risque,
  v.statut, v.avis_expert, v.avis_expert_motif, v.signe_par, us.nom AS signe_par_nom, v.signe_le,
  v.motif, v.cree_par, uc.nom AS cree_par_nom, v.cree_le AS version_cree_le`;

const DEPUIS_ASSERTION = `FROM assertions a
  JOIN LATERAL (SELECT * FROM assertion_versions av WHERE av.assertion_id = a.id
                ORDER BY av.version DESC LIMIT 1) v ON true
  LEFT JOIN utilisateurs us ON us.id = v.signe_par
  LEFT JOIN utilisateurs uc ON uc.id = v.cree_par`;

export interface FiltresPreuves {
  type_source?: string;
  fiabilite?: string;
  dimension?: string;
  q?: string;
}

export interface FiltresAssertions {
  statut?: string;
  classe_risque?: string;
  livrable?: string;
  q?: string;
}

/** Page de preuves courantes d'une mission, plus récentes d'abord (`apres` : numéro exclu). */
export async function listerPreuves(
  db: Db,
  missionId: string,
  filtres: FiltresPreuves,
  apres: string | null,
  limite: number,
  voirNominatif: { tous: boolean; utilisateurId: string },
): Promise<PreuveCourante[]> {
  // La recherche libre ne lit jamais un verbatim nominatif sans accord que l'on ne peut pas voir.
  const r = await db.query(
    `SELECT ${COLONNES_PREUVE} ${DEPUIS_PREUVE}
     WHERE p.mission_id = $1
       AND ($2::bigint IS NULL OR p.numero < $2::bigint)
       AND ($3::text IS NULL OR v.type_source = $3)
       AND ($4::text IS NULL OR v.fiabilite = $4)
       AND ($5::text IS NULL OR $5 = ANY (v.dimensions))
       AND ($6::text IS NULL OR (
         (v.source_precise ILIKE $6 OR v.extrait ILIKE $6)
         AND ($7::boolean OR NOT v.nominatif OR v.accord_nominatif
              OR v.auteur_id = $8 OR v.cree_par = $8)))
     ORDER BY p.numero DESC LIMIT $9`,
    [
      missionId,
      apres,
      filtres.type_source ?? null,
      filtres.fiabilite ?? null,
      filtres.dimension ?? null,
      motifContient(filtres.q),
      voirNominatif.tous,
      voirNominatif.utilisateurId,
      limite + 1,
    ],
  );
  return r.rows as PreuveCourante[];
}

/** Toutes les preuves courantes d'une mission (plafonnée par `PREUVES_MISSION_MAX`). */
export async function preuvesDeMission(
  db: Db,
  missionId: string,
  plafond: number,
): Promise<PreuveCourante[]> {
  const r = await db.query(
    `SELECT ${COLONNES_PREUVE} ${DEPUIS_PREUVE} WHERE p.mission_id = $1
     ORDER BY p.numero DESC LIMIT $2`,
    [missionId, plafond],
  );
  return r.rows as PreuveCourante[];
}

export async function preuvesParIds(db: Db, ids: readonly string[]): Promise<PreuveCourante[]> {
  if (ids.length === 0) return [];
  const r = await db.query(
    `SELECT ${COLONNES_PREUVE} ${DEPUIS_PREUVE} WHERE p.id = ANY ($1::uuid[])
     ORDER BY p.numero DESC`,
    [ids],
  );
  return r.rows as PreuveCourante[];
}

export async function lirePreuve(db: Db, id: string): Promise<PreuveCourante | null> {
  return (await preuvesParIds(db, [id]))[0] ?? null;
}

export async function versionsDePreuve(db: Db, preuveId: string): Promise<PreuveCourante[]> {
  const r = await db.query(
    `SELECT p.id, p.mission_id, p.client_id, p.numero::text AS cle_tri, p.cree_le,
       v.version, v.type_source, v.source_precise, v.date_preuve::text AS date_preuve, v.auteur_id,
       ua.nom AS auteur_nom, v.fiabilite, v.extrait, v.fichier_id, v.reponse_id, v.document_id,
       v.dimensions, v.nominatif, v.accord_nominatif, v.motif, v.cree_par,
       v.cree_le AS version_cree_le
     FROM preuves p JOIN preuve_versions v ON v.preuve_id = p.id
     LEFT JOIN utilisateurs ua ON ua.id = v.auteur_id
     WHERE p.id = $1 ORDER BY v.version DESC`,
    [preuveId],
  );
  return r.rows as PreuveCourante[];
}

export async function listerAssertions(
  db: Db,
  missionId: string,
  filtres: FiltresAssertions,
  apres: string | null,
  limite: number,
): Promise<AssertionCourante[]> {
  const r = await db.query(
    `SELECT ${COLONNES_ASSERTION} ${DEPUIS_ASSERTION}
     WHERE a.mission_id = $1
       AND ($2::bigint IS NULL OR a.numero < $2::bigint)
       AND ($3::text IS NULL OR v.statut = $3)
       AND ($4::text IS NULL OR v.classe_risque = $4)
       AND ($5::text IS NULL OR v.livrable = $5)
       AND ($6::text IS NULL OR v.enonce ILIKE $6)
     ORDER BY a.numero DESC LIMIT $7`,
    [
      missionId,
      apres,
      filtres.statut ?? null,
      filtres.classe_risque ?? null,
      filtres.livrable ?? null,
      motifContient(filtres.q),
      limite + 1,
    ],
  );
  return r.rows as AssertionCourante[];
}

/** Toutes les assertions courantes d'une mission (plafonnée par `ASSERTIONS_MISSION_MAX`). */
export async function assertionsDeMission(
  db: Db,
  missionId: string,
  plafond: number,
): Promise<AssertionCourante[]> {
  const r = await db.query(
    `SELECT ${COLONNES_ASSERTION} ${DEPUIS_ASSERTION} WHERE a.mission_id = $1
     ORDER BY a.numero ASC LIMIT $2`,
    [missionId, plafond],
  );
  return r.rows as AssertionCourante[];
}

export async function lireAssertion(db: Db, id: string): Promise<AssertionCourante | null> {
  const r = await db.query(`SELECT ${COLONNES_ASSERTION} ${DEPUIS_ASSERTION} WHERE a.id = $1`, [
    id,
  ]);
  return (r.rows[0] as AssertionCourante | undefined) ?? null;
}

export async function versionsDAssertion(db: Db, assertionId: string) {
  const r = await db.query(
    `SELECT v.version, v.enonce, v.rattachement_type, v.rattachement_code, v.livrable,
       v.classe_risque, v.statut, v.avis_expert, v.avis_expert_motif, v.signe_par,
       us.nom AS signe_par_nom, v.signe_le, v.motif, v.cree_par, uc.nom AS cree_par_nom,
       v.cree_le
     FROM assertion_versions v
     LEFT JOIN utilisateurs us ON us.id = v.signe_par
     LEFT JOIN utilisateurs uc ON uc.id = v.cree_par
     WHERE v.assertion_id = $1 ORDER BY v.version DESC`,
    [assertionId],
  );
  return r.rows;
}

/** Liens courants (dernier événement = « lier ») de la mission, ou des assertions données. */
export async function liensCourants(
  db: Db,
  missionId: string,
  assertionIds: readonly string[] | null,
): Promise<LienCourant[]> {
  const r = await db.query(
    `SELECT d.assertion_id, d.preuve_id, d.sens,
       to_char(d.cree_le AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') AS horodatage FROM (
       SELECT DISTINCT ON (l.assertion_id, l.preuve_id) l.assertion_id, l.preuve_id, l.action,
         l.sens, l.numero, l.cree_le
       FROM assertion_preuve_liens l
       WHERE l.mission_id = $1 AND ($2::uuid[] IS NULL OR l.assertion_id = ANY ($2::uuid[]))
       ORDER BY l.assertion_id, l.preuve_id, l.numero DESC) d
     WHERE d.action = 'lier'`,
    [missionId, assertionIds],
  );
  return r.rows as LienCourant[];
}

const COLONNES_ARBITRAGE = `a.id, a.assertion_id, a.preuve_id, a.preuve_version, a.decision, a.motif,
  a.arbitre_par, u.nom AS arbitre_nom, a.arbitre_le,
  to_char(a.arbitre_le AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') AS horodatage`;

/** Dernier arbitrage de chaque couple (assertion, preuve) de la mission, ou des assertions données. */
export async function arbitragesCourants(
  db: Db,
  missionId: string,
  assertionIds: readonly string[] | null,
): Promise<ArbitrageLigne[]> {
  const r = await db.query(
    `SELECT DISTINCT ON (a.assertion_id, a.preuve_id) ${COLONNES_ARBITRAGE}
     FROM preuve_arbitrages a LEFT JOIN utilisateurs u ON u.id = a.arbitre_par
     WHERE a.mission_id = $1 AND ($2::uuid[] IS NULL OR a.assertion_id = ANY ($2::uuid[]))
     ORDER BY a.assertion_id, a.preuve_id, a.numero DESC`,
    [missionId, assertionIds],
  );
  return r.rows as ArbitrageLigne[];
}

/** Historique complet des arbitrages d'une assertion, plus récent d'abord. */
export async function historiqueArbitrages(db: Db, assertionId: string): Promise<ArbitrageLigne[]> {
  const r = await db.query(
    `SELECT ${COLONNES_ARBITRAGE} FROM preuve_arbitrages a
     LEFT JOIN utilisateurs u ON u.id = a.arbitre_par
     WHERE a.assertion_id = $1 ORDER BY a.numero DESC`,
    [assertionId],
  );
  return r.rows as ArbitrageLigne[];
}

export interface DimensionLigne {
  id: string;
  code: string;
  libelle: string;
  actif: boolean;
  cree_le: Date;
}

export async function dimensionsDeMission(
  db: Db,
  missionId: string,
  actifsSeulement: boolean,
): Promise<DimensionLigne[]> {
  const r = await db.query(
    `SELECT id, code, libelle, actif, cree_le FROM preuve_dimensions
     WHERE mission_id = $1 AND ($2::boolean = false OR actif)
     ORDER BY cree_le, code LIMIT $3`,
    [missionId, actifsSeulement, 200],
  );
  return r.rows as DimensionLigne[];
}

/** Assertions auxquelles une preuve est actuellement liée (dernier événement = « lier »). */
export async function assertionsDePreuve(db: Db, preuveId: string) {
  const r = await db.query(
    `SELECT d.assertion_id, d.sens, v.enonce, v.classe_risque, v.statut FROM (
       SELECT DISTINCT ON (l.assertion_id) l.assertion_id, l.action, l.sens
       FROM assertion_preuve_liens l WHERE l.preuve_id = $1
       ORDER BY l.assertion_id, l.numero DESC) d
     JOIN LATERAL (SELECT * FROM assertion_versions av WHERE av.assertion_id = d.assertion_id
                   ORDER BY av.version DESC LIMIT 1) v ON true
     WHERE d.action = 'lier' ORDER BY d.assertion_id`,
    [preuveId],
  );
  return r.rows as {
    assertion_id: string;
    sens: "pour" | "contre";
    enonce: string;
    classe_risque: string;
    statut: string;
  }[];
}
