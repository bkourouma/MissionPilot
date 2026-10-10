import { anneesExperience, controlerCv, type ResultatControleCv } from "@missionpilot/engines";
import type {
  CvContenu,
  CvExigences,
  cvCreationSchema,
  cvListeQuerySchema,
  cvVersionSchema,
  gabaritCvCreationSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { decoderCurseur, motifContient, paginer } from "../http/outils.js";
import { journal, moisCourant, verrouEntite } from "./commun.js";

/*
 * Banque de CV (AO-04) : profils et versions datées en ajout seul (0380), années d'expérience et
 * contrôle des exigences par le moteur pur `banque-cv`, gabarits par bailleur en données.
 * Toutes les lectures passent par RLS : un CV d'un autre cabinet répond 404 comme un inexistant.
 */

export interface VersionCv {
  id: string;
  version: number;
  contenu: CvContenu;
  motif: string | null;
  cree_par: string;
  cree_le: Date;
}

const COLONNES_VERSION = "v.id, v.version, v.contenu, v.motif, v.cree_par, v.cree_le";

/** Années complètes d'expérience d'un contenu, au mois de référence (moteur). */
export function anneesDuCv(contenu: CvContenu, reference = moisCourant()): number {
  return anneesExperience(contenu.experiences, reference);
}

/** Contrôle d'un contenu contre des exigences (moteur pur, sans base). */
export function controlerContenuCv(
  contenu: CvContenu,
  exigences: CvExigences,
  reference = moisCourant(),
): ResultatControleCv {
  return controlerCv(
    contenu,
    {
      anneesMin: exigences.annees_min,
      anneesParSecteur: exigences.annees_par_secteur,
      niveauDiplomeMin: exigences.niveau_diplome_min,
      domainesDiplome: exigences.domaines_diplome,
      langues: exigences.langues.map((l) => ({ langue: l.langue, niveauMin: l.niveau_min })),
      experiencesBailleur: exigences.experiences_bailleur.map((b) => ({
        bailleur: b.bailleur,
        nombreMin: b.nombre_min,
      })),
    },
    exigences.reference ?? reference,
  );
}

const languesDe = (c: CvContenu) => [...new Set(c.langues.map((l) => l.langue.toLowerCase()))];

async function insererVersion(
  db: Db,
  auth: Auth,
  cvId: string,
  version: number,
  contenu: CvContenu,
  motif: string | null,
): Promise<string> {
  const r = await db.query(
    `INSERT INTO ao_cv_versions (cabinet_id, cv_id, version, contenu, titre, secteurs, langues,
       motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      auth.cabinetId,
      cvId,
      version,
      JSON.stringify(contenu),
      contenu.titre,
      contenu.secteurs,
      languesDe(contenu),
      motif,
      auth.utilisateurId,
    ],
  );
  return r.rows[0].id as string;
}

export async function creerCv(
  db: Db,
  auth: Auth,
  corps: z.infer<typeof cvCreationSchema>,
): Promise<string> {
  const r = await db.query(
    `INSERT INTO ao_cv (cabinet_id, collaborateur_id, nom, cree_par) VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [auth.cabinetId, corps.collaborateur_id ?? null, corps.nom, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  await insererVersion(db, auth, id, 1, corps.contenu, null);
  // Jamais le contenu (données personnelles) : identifiants seulement.
  await journal(db, auth, "creation_cv", "ao_cv", id, {
    collaborateur_id: corps.collaborateur_id ?? null,
  });
  return id;
}

/** Profil visible (RLS), ou 404. */
export async function exigerCv(db: Db, id: string) {
  const r = await db.query(
    `SELECT c.id, c.numero, c.nom, c.collaborateur_id, co.nom AS collaborateur_nom, c.cree_par,
       c.cree_le, c.anonymise_le
     FROM ao_cv c LEFT JOIN collaborateurs co ON co.id = c.collaborateur_id WHERE c.id = $1`,
    [id],
  );
  const l = r.rows[0];
  if (!l) throw introuvable("CV");
  return {
    id: l.id as string,
    numero: Number(l.numero),
    nom: l.nom as string,
    collaborateur_id: (l.collaborateur_id as string | null) ?? null,
    collaborateur_nom: (l.collaborateur_nom as string | null) ?? null,
    cree_par: l.cree_par as string,
    cree_le: l.cree_le as Date,
    anonymise: l.anonymise_le !== null,
  };
}

const cvAnonyme = () =>
  new AppError(409, "CV_ANONYME", "Ce CV est anonymisé : il n'est plus utilisable.");

/** CV visible et NON anonymisé (export, nouvelle version, offre) : 404 puis 409. */
export async function exigerCvUtilisable(db: Db, id: string) {
  const profil = await exigerCv(db, id);
  if (profil.anonymise) throw cvAnonyme();
  return profil;
}

export async function versionsDuCv(db: Db, id: string): Promise<VersionCv[]> {
  const r = await db.query(
    `SELECT ${COLONNES_VERSION} FROM ao_cv_versions v WHERE v.cv_id = $1 ORDER BY v.version DESC`,
    [id],
  );
  return r.rows as VersionCv[];
}

export async function detailCv(db: Db, id: string, reference = moisCourant()) {
  const profil = await exigerCv(db, id);
  const versions = await versionsDuCv(db, id);
  const courante = versions[0] as VersionCv;
  return {
    ...profil,
    reference,
    annees_experience: anneesDuCv(courante.contenu, reference),
    courante,
    versions: versions.map(({ contenu: _c, ...v }) => v),
  };
}

/** Contenu de la version courante (export, contrôle). */
export async function contenuCourant(db: Db, id: string): Promise<VersionCv> {
  await exigerCv(db, id);
  return (await versionsDuCv(db, id))[0] as VersionCv;
}

export async function nouvelleVersionCv(
  db: Db,
  auth: Auth,
  id: string,
  corps: z.infer<typeof cvVersionSchema>,
): Promise<void> {
  await verrouEntite(db, "cv", id);
  await exigerCvUtilisable(db, id);
  const courante = await contenuCourant(db, id);
  await insererVersion(db, auth, id, courante.version + 1, corps.contenu, corps.motif);
  await journal(db, auth, "version_cv", "ao_cv", id, { version: courante.version + 1 });
}

/**
 * Anonymise un CV et toutes ses versions (départ d'une personne, droit à l'effacement) par la
 * fonction SECURITY DEFINER `anonymiser_cv_ao` (0386), bornée au cabinet du contexte. Le journal
 * ne porte ni nom ni contenu : le motif, le nombre de versions et le facteur de reconfirmation.
 */
export async function anonymiserCv(
  db: Db,
  auth: Auth,
  id: string,
  motif: string,
  facteur: string,
): Promise<number> {
  await verrouEntite(db, "cv", id);
  await exigerCvUtilisable(db, id);
  const r = await db.query("SELECT anonymiser_cv_ao($1::uuid) AS n", [id]);
  const versions = r.rows[0].n as number;
  await journal(db, auth, "anonymisation_cv", "ao_cv", id, { motif, versions, facteur });
  return versions;
}

export async function listerCv(
  db: Db,
  q: z.infer<typeof cvListeQuerySchema>,
  reference = moisCourant(),
) {
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT c.id, c.numero, c.nom, c.collaborateur_id, c.anonymise_le, lower(c.nom) AS cle_tri,
       v.version, v.titre, v.secteurs, v.contenu
     FROM ao_cv c
     JOIN LATERAL (SELECT * FROM ao_cv_versions x WHERE x.cv_id = c.id
                   ORDER BY x.version DESC LIMIT 1) v ON true
     WHERE ($1::text IS NULL OR c.nom ILIKE $1 OR v.titre ILIKE $1)
       AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM unnest(v.secteurs) s WHERE s ILIKE $2))
       AND ($3::text IS NULL OR lower($3) = ANY (v.langues))
       AND ($4::text IS NULL OR (lower(c.nom), c.id) > ($4, $5::uuid))
     ORDER BY lower(c.nom), c.id
     LIMIT $6`,
    [
      motifContient(q.q),
      motifContient(q.secteur),
      q.langue ?? null,
      apres?.[0] ?? null,
      apres?.[1] ?? null,
      q.limite + 1,
    ],
  );
  const lignes = r.rows.map((l) => ({
    id: l.id as string,
    cle_tri: l.cle_tri as string,
    numero: Number(l.numero),
    nom: l.nom as string,
    collaborateur_id: (l.collaborateur_id as string | null) ?? null,
    anonymise: l.anonymise_le !== null,
    version: l.version as number,
    titre: l.titre as string,
    secteurs: l.secteurs as string[],
    annees_experience: anneesDuCv(l.contenu as CvContenu, reference),
  }));
  return paginer(lignes, q.limite);
}

// --- Gabarits par bailleur (données) ---

export interface GabaritCv {
  id: string;
  code: string;
  libelle: string;
  bailleur: string;
  sections: { section: string; titre: string }[];
  ordre_experiences: "antechronologique" | "chronologique";
  experiences_annees_max: number | null;
  standard: boolean;
}

const COLONNES_GABARIT = `g.id, g.code, g.libelle, g.bailleur, g.sections, g.ordre_experiences,
  g.experiences_annees_max, (g.cabinet_id IS NULL) AS standard`;

/** Gabarits du cabinet au plus (tables en ajout seul : plafond de volume, 409 au-delà). */
export const GABARITS_CABINET_MAX = 100;
/** Plafond de la liste servie : gabarits du cabinet et standard. */
const GABARITS_LISTE_MAX = GABARITS_CABINET_MAX + 100;

/** Gabarits visibles : standard et du cabinet ; un gabarit du cabinet masque le standard de même code. */
export async function listerGabarits(db: Db): Promise<GabaritCv[]> {
  const r = await db.query(
    `SELECT DISTINCT ON (g.code) ${COLONNES_GABARIT} FROM ao_cv_gabarits g
     ORDER BY g.code, (g.cabinet_id IS NULL), g.cree_le DESC
     LIMIT $1`,
    [GABARITS_LISTE_MAX],
  );
  return r.rows as GabaritCv[];
}

export async function exigerGabarit(db: Db, code: string): Promise<GabaritCv> {
  const r = await db.query(
    `SELECT ${COLONNES_GABARIT} FROM ao_cv_gabarits g WHERE g.code = $1
     ORDER BY (g.cabinet_id IS NULL) LIMIT 1`,
    [code],
  );
  if (!r.rows[0]) throw introuvable("Gabarit de CV");
  return r.rows[0] as GabaritCv;
}

export async function creerGabarit(
  db: Db,
  auth: Auth,
  corps: z.infer<typeof gabaritCvCreationSchema>,
): Promise<GabaritCv> {
  await verrouEntite(db, "gabarits_cv", auth.cabinetId);
  const n = await db.query("SELECT count(*)::int AS n FROM ao_cv_gabarits WHERE cabinet_id = $1", [
    auth.cabinetId,
  ]);
  if ((n.rows[0].n as number) >= GABARITS_CABINET_MAX) {
    throw conflit(`Le cabinet compte ${GABARITS_CABINET_MAX} gabarits de CV au plus.`);
  }
  const r = await db.query(
    `INSERT INTO ao_cv_gabarits (cabinet_id, code, libelle, bailleur, sections, ordre_experiences,
       experiences_annees_max, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      auth.cabinetId,
      corps.code,
      corps.libelle,
      corps.bailleur,
      JSON.stringify(corps.sections),
      corps.ordre_experiences,
      corps.experiences_annees_max,
      auth.utilisateurId,
    ],
  );
  await journal(db, auth, "creation_gabarit_cv", "ao_cv_gabarit", r.rows[0].id as string, {
    code: corps.code,
  });
  return exigerGabarit(db, corps.code);
}
