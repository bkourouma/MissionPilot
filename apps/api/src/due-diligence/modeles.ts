import {
  estCategorieAnalyseDd,
  PLAFONDS_DD,
  type AnalyseDd,
  type modeleSecteurCreationSchema,
  type modeleSecteurVersionSchema,
  type modelesSecteurQuerySchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { exigerVersionCourante, exigerVersionsRestantes, verrouillerCabinet } from "./acces.js";
import { cadrageCourant } from "./dossiers.js";
import { lireEntree, taxonomieInconnue } from "./taxonomie.js";

/*
 * Modèles d'analyse par secteur (DD-07, migration 0511). Seul le véhicule existe : la bibliothèque
 * est propre au cabinet et VIDE au départ (aucun modèle fourni, travail d'experts métier). Un modèle
 * = un secteur + une analyse + une liste ordonnée de « points à examiner » : des rappels pour
 * l'expert, jamais des affirmations ni des chiffres. Versions en ajout seul ; `actif` = false retire
 * le modèle. Le modèle applicable à un dossier est celui du secteur de son cadrage courant.
 */

export type CorpsModeleCreation = z.infer<typeof modeleSecteurCreationSchema>;
export type CorpsModeleVersion = z.infer<typeof modeleSecteurVersionSchema>;
export type FiltresModeles = z.infer<typeof modelesSecteurQuerySchema>;

export interface PointModele {
  categorie: string;
  libelle: string;
}

export interface ModeleCourant {
  id: string;
  cle_tri: string;
  secteur_code: string;
  analyse: AnalyseDd;
  version: number;
  points: PointModele[];
  actif: boolean;
}

const COLONNES = `m.id, m.numero::text AS cle_tri, m.secteur_code, m.analyse, v.version, v.points,
  v.actif`;
const DEPUIS = `FROM dd_modeles_secteur m
  JOIN LATERAL (SELECT * FROM dd_modele_secteur_versions mv WHERE mv.modele_id = m.id
                ORDER BY mv.version DESC LIMIT 1) v ON true`;

export function vueModele(m: Omit<ModeleCourant, "cle_tri">) {
  return {
    id: m.id,
    secteur_code: m.secteur_code,
    analyse: m.analyse,
    version: m.version,
    points: m.points,
    actif: m.actif,
  };
}

/** Page de modèles courants, du plus récent au plus ancien (curseur sur le numéro). */
export async function listerModeles(
  db: Db,
  q: FiltresModeles,
  apres: string | null,
): Promise<ModeleCourant[]> {
  const r = await db.query(
    `SELECT ${COLONNES} ${DEPUIS}
     WHERE ($1::bigint IS NULL OR m.numero < $1::bigint)
       AND ($2::text IS NULL OR m.secteur_code = $2)
       AND ($3::text IS NULL OR m.analyse = $3)
       AND ($4::boolean IS NULL OR v.actif = $4)
     ORDER BY m.numero DESC LIMIT $5`,
    [apres, q.secteur_code ?? null, q.analyse ?? null, q.actif ?? null, q.limite + 1],
  );
  return r.rows as ModeleCourant[];
}

export async function lireModele(db: Db, id: string): Promise<ModeleCourant> {
  const r = await db.query(`SELECT ${COLONNES} ${DEPUIS} WHERE m.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Modèle");
  return r.rows[0] as ModeleCourant;
}

/** Les catégories des points existent pour l'analyse (doublé par le déclencheur MQD11). */
function verifierPoints(analyse: AnalyseDd, points: PointModele[]): void {
  for (const p of points) {
    if (!estCategorieAnalyseDd(analyse, p.categorie)) {
      throw new AppError(400, "POINT_MODELE_INVALIDE", "Catégorie inconnue pour cette analyse.");
    }
  }
}

async function insererVersion(
  db: Db,
  auth: Auth,
  modeleId: string,
  version: number,
  points: PointModele[],
  actif: boolean,
  motif: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO dd_modele_secteur_versions (cabinet_id, modele_id, version, points, actif, motif,
       cree_par)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [auth.cabinetId, modeleId, version, JSON.stringify(points), actif, motif, auth.utilisateurId],
  );
}

/** Crée un modèle (un par secteur et analyse ; plafond sous le verrou du cabinet). */
export async function creerModele(
  db: Db,
  auth: Auth,
  c: CorpsModeleCreation,
): Promise<{ id: string; version: 1 }> {
  await verrouillerCabinet(db, auth.cabinetId, "modeles-secteur");
  const n = await db.query("SELECT count(*)::int AS n FROM dd_modeles_secteur");
  if ((n.rows[0].n as number) >= PLAFONDS_DD.modeles_secteur_par_cabinet) {
    throw new AppError(409, "PLAFOND_ATTEINT", "Trop de modèles sectoriels dans le cabinet.");
  }
  if (!(await lireEntree(db, "secteur", c.secteur_code))) {
    throw taxonomieInconnue("Secteur inconnu du référentiel.");
  }
  verifierPoints(c.analyse, c.points);
  const r = await db.query(
    `INSERT INTO dd_modeles_secteur (cabinet_id, secteur_code, "analyse", cree_par)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [auth.cabinetId, c.secteur_code, c.analyse, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  await insererVersion(db, auth, id, 1, c.points, true, null);
  return { id, version: 1 };
}

/** Nouvelle version d'un modèle (la version lue est exigée, motif obligatoire). */
export async function corrigerModele(
  db: Db,
  auth: Auth,
  id: string,
  c: CorpsModeleVersion,
): Promise<number> {
  await verrouillerCabinet(db, auth.cabinetId, "modeles-secteur");
  const courant = await lireModele(db, id);
  exigerVersionCourante(c.version_courante, courant.version);
  exigerVersionsRestantes(courant.version + 1, PLAFONDS_DD.versions_par_objet);
  verifierPoints(courant.analyse, c.points);
  await insererVersion(db, auth, id, courant.version + 1, c.points, c.actif, c.motif);
  return courant.version + 1;
}

/** Versions d'un modèle, plus récente d'abord (au plus 200). */
export async function versionsDuModele(db: Db, id: string) {
  await lireModele(db, id);
  const r = await db.query(
    `SELECT v.version, v.points, v.actif, v.motif, v.cree_par, u.nom AS cree_par_nom, v.cree_le
     FROM dd_modele_secteur_versions v LEFT JOIN utilisateurs u ON u.id = v.cree_par
     WHERE v.modele_id = $1 ORDER BY v.version DESC`,
    [id],
  );
  return r.rows;
}

/**
 * Modèles actifs du secteur du cadrage courant du dossier (liste vide sans modèle). Rappels pour
 * l'expert : rien n'est créé dans le dossier.
 */
export async function modelesDuDossier(db: Db, dossierId: string, analyse: AnalyseDd | null) {
  const cadrage = await cadrageCourant(db, dossierId);
  const r = await db.query(
    `SELECT ${COLONNES} ${DEPUIS}
     WHERE m.secteur_code = $1 AND v.actif AND ($2::text IS NULL OR m.analyse = $2)
     ORDER BY m.numero ASC`,
    [cadrage.secteur_code, analyse],
  );
  return {
    secteur_code: cadrage.secteur_code as string,
    elements: (r.rows as ModeleCourant[]).map(vueModele),
  };
}
