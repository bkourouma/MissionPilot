import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import { standardLectureSeule, versionPubliee } from "./erreurs.js";
import type {
  CasStocke,
  ContenuMethode,
  ContenuVersion,
  MethodeLigne,
  VersionLigne,
} from "./types.js";

/*
 * Lecture et copie du contenu d'une version de méthode. Toute lecture passe
 * par RLS : le standard (cabinet_id NULL) et les lignes du cabinet sont
 * visibles, celles d'un autre cabinet jamais (404 comme une ligne
 * inexistante).
 */

const COLONNES_METHODE = `m.id, m.cabinet_id, m.service_id, s.code AS service_code,
  s.libelle AS service_libelle, m.code, m.libelle, m.description, m.parent_id, m.cree_le`;

const COLONNES_VERSION = `v.id, v.cabinet_id, v.methode_id, v.version, v.statut, v.notes_version,
  v.base_standard_id, v.cree_par, v.cree_le, v.publie_le`;

export async function lireMethode(db: Db, id: string): Promise<MethodeLigne> {
  const r = await db.query(
    `SELECT ${COLONNES_METHODE} FROM methodes m JOIN services_conseil s ON s.id = m.service_id
     WHERE m.id = $1`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Méthode");
  return r.rows[0] as MethodeLigne;
}

/** Version visible (standard ou du cabinet), ou 404. `verrouiller` : FOR UPDATE (écriture). */
export async function lireVersion(db: Db, id: string, verrouiller = false): Promise<VersionLigne> {
  const r = await db.query(
    `SELECT ${COLONNES_VERSION} FROM methode_versions v WHERE v.id = $1
     ${verrouiller ? "FOR UPDATE" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Version de méthode");
  return r.rows[0] as VersionLigne;
}

/** Brouillon du cabinet, verrouillé pour la transaction : seul contenu modifiable. */
export async function exigerBrouillonDuCabinet(db: Db, id: string): Promise<VersionLigne> {
  const v = await lireVersion(db, id, false);
  if (v.cabinet_id === null) throw standardLectureSeule();
  const verrouillee = await lireVersion(db, id, true);
  if (verrouillee.statut !== "brouillon") throw versionPubliee();
  return verrouillee;
}

/** Dernière version publiée d'une méthode (visible), ou null. */
export async function dernierePubliee(db: Db, methodeId: string): Promise<VersionLigne | null> {
  const r = await db.query(
    `SELECT ${COLONNES_VERSION} FROM methode_versions v
     WHERE v.methode_id = $1 AND v.statut = 'publiee' ORDER BY v.version DESC LIMIT 1`,
    [methodeId],
  );
  return (r.rows[0] as VersionLigne | undefined) ?? null;
}

function nombreOuNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Contenu complet d'une version visible, trié de façon stable (ordre, puis code). */
export async function lireContenu(db: Db, versionId: string): Promise<ContenuVersion> {
  const version = await lireVersion(db, versionId);
  const methode = await lireMethode(db, version.methode_id);
  // Requêtes successives : un client pg n'exécute qu'une requête à la fois.
  const lignes = async (sql: string) => (await db.query(sql, [versionId])).rows;
  const etapes = await lignes(
    `SELECT id, code, libelle, description, ordre FROM methode_etapes
       WHERE version_id = $1 ORDER BY ordre, code`,
  );
  const briques = await lignes(
    `SELECT b.id, b.etape_id, e.code AS etape_code, b.code, b.libelle, b.objet, b.entrees,
              b.moteur, b.agent, b.classe_risque, b.garde, b.sortie, b.definition_termine,
              b.temps_type_jours, b.profil_temps, b.niveau_autonomie_max, b.active_par_defaut, b.ordre
       FROM methode_briques b JOIN methode_etapes e ON e.id = b.etape_id
       WHERE b.version_id = $1 ORDER BY e.ordre, e.code, b.ordre, b.code`,
  );
  const elements = await lignes(
    `SELECT el.id, el.brique_id, b.code AS brique_code, el.type, el.code, el.libelle,
              el.description, el.essentiel, el.actif_par_defaut
       FROM methode_elements el LEFT JOIN methode_briques b ON b.id = el.brique_id
       WHERE el.version_id = $1 ORDER BY el.type, el.code`,
  );
  const rubriques = await lignes(
    `SELECT r.id, r.brique_id, b.code AS brique_code, r.code, r.libelle, r.dimension, r.ancrages
       FROM methode_rubriques r LEFT JOIN methode_briques b ON b.id = r.brique_id
       WHERE r.version_id = $1 ORDER BY r.code`,
  );
  const regles = await lignes(
    `SELECT id, code, regle FROM methode_regles WHERE version_id = $1 ORDER BY code`,
  );
  const cas = await lignes(
    `SELECT id, code, libelle, cas FROM methode_cas_types WHERE version_id = $1 ORDER BY code`,
  );
  return {
    methode,
    version,
    etapes,
    briques: briques.map((b) => ({ ...b, temps_type_jours: nombreOuNull(b.temps_type_jours) })),
    elements,
    rubriques,
    regles,
    cas_types: cas.map((c) => ({ ...c, cas: c.cas as CasStocke })),
  };
}

/** Contenu sans identifiants (copie, fusion, différences). */
export function sansIdentifiants(c: ContenuVersion): ContenuMethode {
  return {
    etapes: c.etapes.map(({ code, libelle, description, ordre }) => ({
      code,
      libelle,
      description,
      ordre,
    })),
    briques: c.briques.map(({ id: _i, etape_id: _e, ...b }) => b),
    elements: c.elements.map(({ id: _i, brique_id: _b, ...e }) => e),
    rubriques: c.rubriques.map(({ id: _i, brique_id: _b, ...r }) => r),
    regles: c.regles.map(({ code, regle }) => ({ code, regle })),
    cas_types: c.cas_types.map(({ code, libelle, cas }) => ({ code, libelle, cas })),
  };
}

/**
 * Copie un contenu dans un brouillon du cabinet (création de variante,
 * nouvelle version, rebasage), en six insertions groupées. Les liens se
 * résolvent par code dans la version cible (étape d'une brique, brique d'un
 * élément ou d'une rubrique).
 */
export async function copierContenu(
  db: Db,
  cabinetId: string,
  versionId: string,
  contenu: ContenuMethode,
): Promise<void> {
  const p = (lignes: unknown[]) => [cabinetId, versionId, JSON.stringify(lignes)];
  await db.query(
    `INSERT INTO methode_etapes (cabinet_id, version_id, code, libelle, description, ordre)
     SELECT $1, $2, x.code, x.libelle, x.description, x.ordre
     FROM jsonb_to_recordset($3::jsonb) AS x(code text, libelle text, description text, ordre integer)`,
    p(contenu.etapes),
  );
  await db.query(
    `INSERT INTO methode_briques (cabinet_id, version_id, etape_id, code, libelle, objet, entrees,
       moteur, agent, classe_risque, garde, sortie, definition_termine, temps_type_jours,
       profil_temps, niveau_autonomie_max, active_par_defaut, ordre)
     SELECT $1, $2, e.id, x.code, x.libelle, x.objet, x.entrees, x.moteur, x.agent, x.classe_risque,
       x.garde, x.sortie, x.definition_termine, x.temps_type_jours, x.profil_temps,
       x.niveau_autonomie_max, x.active_par_defaut, x.ordre
     FROM jsonb_to_recordset($3::jsonb) AS x(etape_code text, code text, libelle text, objet text,
       entrees text, moteur text, agent text, classe_risque text, garde text, sortie text,
       definition_termine text, temps_type_jours numeric, profil_temps text,
       niveau_autonomie_max text, active_par_defaut boolean, ordre integer)
     JOIN methode_etapes e ON e.version_id = $2 AND e.code = x.etape_code`,
    p(contenu.briques),
  );
  await db.query(
    `INSERT INTO methode_elements (cabinet_id, version_id, brique_id, type, code, libelle,
       description, essentiel, actif_par_defaut)
     SELECT $1, $2, b.id, x.type, x.code, x.libelle, x.description, x.essentiel, x.actif_par_defaut
     FROM jsonb_to_recordset($3::jsonb) AS x(brique_code text, type text, code text, libelle text,
       description text, essentiel boolean, actif_par_defaut boolean)
     LEFT JOIN methode_briques b ON b.version_id = $2 AND b.code = x.brique_code`,
    p(contenu.elements),
  );
  await db.query(
    `INSERT INTO methode_rubriques (cabinet_id, version_id, brique_id, code, libelle, dimension, ancrages)
     SELECT $1, $2, b.id, x.code, x.libelle, x.dimension, x.ancrages
     FROM jsonb_to_recordset($3::jsonb) AS x(brique_code text, code text, libelle text,
       dimension text, ancrages jsonb)
     LEFT JOIN methode_briques b ON b.version_id = $2 AND b.code = x.brique_code`,
    p(contenu.rubriques),
  );
  await db.query(
    `INSERT INTO methode_regles (cabinet_id, version_id, code, regle)
     SELECT $1, $2, x.code, x.regle FROM jsonb_to_recordset($3::jsonb) AS x(code text, regle jsonb)`,
    p(contenu.regles),
  );
  await db.query(
    `INSERT INTO methode_cas_types (cabinet_id, version_id, code, libelle, cas)
     SELECT $1, $2, x.code, x.libelle, x.cas
     FROM jsonb_to_recordset($3::jsonb) AS x(code text, libelle text, cas jsonb)`,
    p(contenu.cas_types),
  );
}
