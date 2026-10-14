import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";

/*
 * Taxonomies du référentiel (`taxonomie_entrees`, 0200 et 0204) lues pour la due diligence : les
 * codes de secteur, de filière et de pays sont validés ICI (pas de clé étrangère : les lignes du
 * standard ont `cabinet_id` NULL). Lecture sous RLS : lignes du standard et du cabinet.
 */

export type Taxonomie = "secteur" | "filiere" | "pays" | "zone";

export interface EntreeTaxonomie {
  code: string;
  libelle: string;
  parent_code: string | null;
}

export function taxonomieInconnue(message: string): AppError {
  return new AppError(400, "TAXONOMIE_INCONNUE", message);
}

/** Entrée d'une taxonomie (la ligne du cabinet prime sur celle du standard), ou null. */
export async function lireEntree(
  db: Db,
  taxonomie: Taxonomie,
  code: string,
): Promise<EntreeTaxonomie | null> {
  const r = await db.query(
    `SELECT code, libelle, parent_code FROM taxonomie_entrees
     WHERE taxonomie = $1 AND code = $2 ORDER BY (cabinet_id IS NULL) ASC LIMIT 1`,
    [taxonomie, code],
  );
  return (r.rows[0] as EntreeTaxonomie | undefined) ?? null;
}

export interface CodesCadrage {
  secteur_code: string;
  filiere_code: string | null;
  pays_code: string;
}

export interface LibellesCadrage {
  secteur_libelle: string;
  filiere_libelle: string | null;
  pays_libelle: string;
  /** Zone du pays (parent dans la taxonomie), `null` sans parent. */
  zone_code: string | null;
}

/**
 * Le secteur et le pays existent pour leur taxonomie ; la filière, si elle est donnée, a pour parent
 * le secteur choisi (400 TAXONOMIE_INCONNUE). Renvoie les libellés (figés dans la note).
 */
export async function verifierCadrage(db: Db, c: CodesCadrage): Promise<LibellesCadrage> {
  const secteur = await lireEntree(db, "secteur", c.secteur_code);
  if (!secteur) throw taxonomieInconnue("Secteur inconnu du référentiel.");
  let filiereLibelle: string | null = null;
  if (c.filiere_code !== null) {
    const filiere = await lireEntree(db, "filiere", c.filiere_code);
    if (!filiere || filiere.parent_code !== c.secteur_code) {
      throw taxonomieInconnue("Filière inconnue ou étrangère au secteur choisi.");
    }
    filiereLibelle = filiere.libelle;
  }
  const pays = await lireEntree(db, "pays", c.pays_code);
  if (!pays) throw taxonomieInconnue("Pays inconnu du référentiel.");
  return {
    secteur_libelle: secteur.libelle,
    filiere_libelle: filiereLibelle,
    pays_libelle: pays.libelle,
    zone_code: pays.parent_code,
  };
}

/** Libellés d'un cadrage déjà enregistré (affichage), sans lever d'erreur si une entrée a disparu. */
export async function libellesDuCadrage(db: Db, c: CodesCadrage): Promise<LibellesCadrage> {
  const secteur = await lireEntree(db, "secteur", c.secteur_code);
  const filiere = c.filiere_code === null ? null : await lireEntree(db, "filiere", c.filiere_code);
  const pays = await lireEntree(db, "pays", c.pays_code);
  return {
    secteur_libelle: secteur?.libelle ?? c.secteur_code,
    filiere_libelle: filiere === null ? null : filiere.libelle,
    pays_libelle: pays?.libelle ?? c.pays_code,
    zone_code: pays?.parent_code ?? null,
  };
}

/** Codes d'un signal : secteur ou filière d'une part, pays ou zone d'autre part (400 sinon). */
export async function verifierCodesSignal(
  db: Db,
  c: { secteur_code: string | null; pays_code: string | null },
): Promise<void> {
  if (c.secteur_code !== null) {
    const trouve =
      (await lireEntree(db, "secteur", c.secteur_code)) ??
      (await lireEntree(db, "filiere", c.secteur_code));
    if (!trouve) throw taxonomieInconnue("Secteur ou filière inconnu du référentiel.");
  }
  if (c.pays_code !== null) {
    const trouve =
      (await lireEntree(db, "pays", c.pays_code)) ?? (await lireEntree(db, "zone", c.pays_code));
    if (!trouve) throw taxonomieInconnue("Pays ou zone inconnu du référentiel.");
  }
}

/** Contexte de sélection des signaux : filière puis secteur ; pays puis zone (`parent_code`). */
export async function contexteSignaux(
  db: Db,
  c: CodesCadrage,
): Promise<{ secteurCodes: string[]; paysCodes: string[] }> {
  const libelles = await libellesDuCadrage(db, c);
  const secteurCodes = [...(c.filiere_code === null ? [] : [c.filiere_code]), c.secteur_code];
  const paysCodes = [c.pays_code, ...(libelles.zone_code === null ? [] : [libelles.zone_code])];
  return { secteurCodes, paysCodes };
}
