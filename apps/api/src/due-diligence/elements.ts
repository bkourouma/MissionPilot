import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import type { TypeElement } from "./acces.js";

/*
 * Éléments typés d'un dossier de due diligence (migration 0502) : lecture de l'ÉTAT COURANT
 * (version la plus grande de chaque élément) et écritures en ajout seul (identité, puis versions).
 * Une version porte l'état COMPLET de l'élément : l'API recopie les colonnes inchangées
 * (`champsDe`, `fusionner`). Appelées dans la transaction de la route, mission verrouillée.
 */

/** Colonnes d'une version d'élément (hors identité, numéro, motif et auteur). */
export interface ChampsVersion {
  libelle: string | null;
  description: string | null;
  categorie: string | null;
  niveau: string | null;
  ordre: number | null;
  part_cout_bp: number | null;
  part_marge_bp: number | null;
  acteurs: string[];
  contraintes: string | null;
  critere: string | null;
  etape_id: string | null;
  signal_id: string | null;
  responsable_id: string | null;
  plan_element_id: string | null;
  kpi_id: string | null;
  jour_debut: number | null;
  jour_fin: number | null;
  statut_action: string | null;
  retire: boolean;
}

export interface ElementCourant extends ChampsVersion {
  id: string;
  type: TypeElement;
  dossier_id: string;
  analyse: string | null;
  parent_id: string | null;
  assertion_id: string | null;
  numero: string;
  cree_par: string;
  cree_le: Date;
  version: number;
  motif: string | null;
  auteur_id: string;
  version_cree_le: Date;
}

// « analyse » est un mot réservé de PostgreSQL : la colonne se cite entre guillemets.
const COLONNES = `e.id, e.type, e.dossier_id, e."analyse" AS analyse, e.parent_id, e.assertion_id,
  e.numero::text AS numero, e.cree_par, e.cree_le, v.version, v.libelle, v.description, v.categorie,
  v.niveau, v.ordre, v.part_cout_bp, v.part_marge_bp, v.acteurs, v.contraintes, v.critere,
  v.etape_id, v.signal_id, v.responsable_id, v.plan_element_id, v.kpi_id, v.jour_debut,
  v.jour_fin, v.statut_action, v.retire, v.motif, v.auteur_id, v.cree_le AS version_cree_le`;

const DEPUIS = `FROM dd_elements e
  JOIN LATERAL (SELECT * FROM dd_element_versions ev WHERE ev.element_id = e.id
                ORDER BY ev.version DESC LIMIT 1) v ON true`;

/** Éléments courants d'un type, dans l'ordre de création ; `plafond` borne la lecture. */
export async function elementsCourants(
  db: Db,
  dossierId: string,
  type: TypeElement,
  plafond: number,
  options: { retires?: boolean } = {},
): Promise<ElementCourant[]> {
  const r = await db.query(
    `SELECT ${COLONNES} ${DEPUIS}
     WHERE e.dossier_id = $1 AND e.type = $2 AND ($3::boolean OR NOT v.retire)
     ORDER BY e.numero ASC LIMIT $4`,
    [dossierId, type, options.retires === true, plafond + 1],
  );
  return r.rows as ElementCourant[];
}

export async function elementCourant(db: Db, id: string): Promise<ElementCourant> {
  const r = await db.query(`SELECT ${COLONNES} ${DEPUIS} WHERE e.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Élément");
  return r.rows[0] as ElementCourant;
}

/** Versions d'un élément, plus récente d'abord (au plus 200). */
export async function versionsDElement(db: Db, id: string) {
  const r = await db.query(
    `SELECT v.version, v.libelle, v.description, v.categorie, v.niveau, v.ordre, v.part_cout_bp,
       v.part_marge_bp, v.acteurs, v.contraintes, v.critere, v.etape_id, v.signal_id,
       v.responsable_id, v.plan_element_id, v.kpi_id, v.jour_debut, v.jour_fin, v.statut_action,
       v.retire, v.motif, v.auteur_id, u.nom AS auteur_nom, v.cree_le
     FROM dd_element_versions v LEFT JOIN utilisateurs u ON u.id = v.auteur_id
     WHERE v.element_id = $1 ORDER BY v.version DESC`,
    [id],
  );
  return r.rows;
}

export const CHAMPS_VIDES: ChampsVersion = {
  libelle: null,
  description: null,
  categorie: null,
  niveau: null,
  ordre: null,
  part_cout_bp: null,
  part_marge_bp: null,
  acteurs: [],
  contraintes: null,
  critere: null,
  etape_id: null,
  signal_id: null,
  responsable_id: null,
  plan_element_id: null,
  kpi_id: null,
  jour_debut: null,
  jour_fin: null,
  statut_action: null,
  retire: false,
};

/** Colonnes de version d'un élément courant. */
export function champsDe(e: ElementCourant): ChampsVersion {
  return {
    libelle: e.libelle,
    description: e.description,
    categorie: e.categorie,
    niveau: e.niveau,
    ordre: e.ordre,
    part_cout_bp: e.part_cout_bp,
    part_marge_bp: e.part_marge_bp,
    acteurs: e.acteurs,
    contraintes: e.contraintes,
    critere: e.critere,
    etape_id: e.etape_id,
    signal_id: e.signal_id,
    responsable_id: e.responsable_id,
    plan_element_id: e.plan_element_id,
    kpi_id: e.kpi_id,
    jour_debut: e.jour_debut,
    jour_fin: e.jour_fin,
    statut_action: e.statut_action,
    retire: e.retire,
  };
}

/** État suivant : les colonnes renseignées (`undefined` = inchangé) remplacent celles de l'état courant. */
export function fusionner(
  courant: ChampsVersion,
  modifications: Partial<Record<keyof ChampsVersion, unknown>>,
): ChampsVersion {
  const fusion: Record<string, unknown> = { ...courant };
  for (const [cle, valeur] of Object.entries(modifications)) {
    if (valeur !== undefined && cle in courant) fusion[cle] = valeur;
  }
  return fusion as unknown as ChampsVersion;
}

export interface IdentiteElement {
  /** Identifiant tiré côté serveur avant l'assertion d'un risque (rattachement `risque`). */
  id?: string;
  dossierId: string;
  type: TypeElement;
  analyse?: string | null;
  parentId?: string | null;
  assertionId?: string | null;
}

export async function insererElement(db: Db, auth: Auth, e: IdentiteElement): Promise<string> {
  const r = await db.query(
    `INSERT INTO dd_elements (id, cabinet_id, dossier_id, type, "analyse", parent_id, assertion_id,
       cree_par)
     VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      e.id ?? null,
      auth.cabinetId,
      e.dossierId,
      e.type,
      e.analyse ?? null,
      e.parentId ?? null,
      e.assertionId ?? null,
      auth.utilisateurId,
    ],
  );
  return r.rows[0].id as string;
}

export async function insererVersionElement(
  db: Db,
  auth: Auth,
  element: { id: string; type: TypeElement },
  version: number,
  c: ChampsVersion,
  motif: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO dd_element_versions (cabinet_id, element_id, type, version, libelle, description,
       categorie, niveau, ordre, part_cout_bp, part_marge_bp, acteurs, contraintes, critere,
       etape_id, signal_id, responsable_id, plan_element_id, kpi_id, jour_debut, jour_fin,
       statut_action, retire, motif, auteur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13, $14, $15, $16, $17,
       $18, $19, $20, $21, $22, $23, $24, $25)`,
    [
      auth.cabinetId,
      element.id,
      element.type,
      version,
      c.libelle,
      c.description,
      c.categorie,
      c.niveau,
      c.ordre,
      c.part_cout_bp,
      c.part_marge_bp,
      c.acteurs,
      c.contraintes,
      c.critere,
      c.etape_id,
      c.signal_id,
      c.responsable_id,
      c.plan_element_id,
      c.kpi_id,
      c.jour_debut,
      c.jour_fin,
      c.statut_action,
      c.retire,
      motif,
      auth.utilisateurId,
    ],
  );
}
