import {
  REPONDANTS_CIBLE_DEFAUT,
  SEUIL_CONFIANCE_DEFAUT,
  indiceConfiance,
  type IndiceConfiance,
  type ResultatNotation,
} from "@missionpilot/engines";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { chargerEtat } from "../preuves/synthese.js";

/*
 * Indice de confiance d'une note (NOT-11, migration 0401). RÈGLES (testées dans
 * test/notation-augmentee.test.ts) :
 *
 * 1. L'indice sort du moteur `indiceConfiance` : couverture des items (résultat CALCULÉ de la
 *    version), nombre de jeux de réponses utilisés, solidité des preuves (moteur `preuves`) des
 *    assertions non abandonnées de la mission rattachées à une dimension. Rien n'est calculé ici.
 * 2. Seuil et cible de répondants : paramètres du cabinet (`notation_parametres`), valeurs par
 *    défaut du moteur sans paramètre (0,5 et 3, à calibrer au pilote). Les modifier exige
 *    `cabinet.gerer` (associé) ET l'absence du rôle `expert_metier` (403 SEPARATION_DES_TACHES) :
 *    celui qui publie ne baisse pas le seuil qu'il doit franchir, même s'il cumule les deux rôles.
 *    Un plancher (schéma partagé et CHECK 0404) empêche en outre de vider le seuil de sa substance.
 * 3. Publication : l'indice est recalculé et ENREGISTRÉ (ajout seul) dans la transaction de la
 *    publication ; sous le seuil, 409 CONFIANCE_INSUFFISANTE. Doublé en base (MPN10) : sans
 *    indice publiable de la même transaction, l'événement « publication » est refusé.
 * L'indice est un agrégat : il ne cite ni preuve, ni verbatim, ni répondant.
 */

export interface ParametresNotation {
  seuil_confiance: number;
  repondants_cible: number;
  par_defaut: boolean;
  modifie_le: Date | null;
}

export async function lireParametres(db: Db): Promise<ParametresNotation> {
  const r = await db.query(
    `SELECT seuil_confiance::text AS seuil, repondants_cible, modifie_le FROM notation_parametres`,
  );
  const l = r.rows[0] as { seuil: string; repondants_cible: number; modifie_le: Date } | undefined;
  return l
    ? {
        seuil_confiance: Number(l.seuil),
        repondants_cible: l.repondants_cible,
        par_defaut: false,
        modifie_le: l.modifie_le,
      }
    : {
        seuil_confiance: SEUIL_CONFIANCE_DEFAUT,
        repondants_cible: REPONDANTS_CIBLE_DEFAUT,
        par_defaut: true,
        modifie_le: null,
      };
}

export async function modifierParametres(
  db: Db,
  auth: Auth,
  corps: { seuil_confiance?: number; repondants_cible?: number },
): Promise<ParametresNotation> {
  if (auth.roles.includes("expert_metier")) {
    throw new AppError(
      403,
      "SEPARATION_DES_TACHES",
      "Un expert métier qui publie les notations ne règle pas le seuil de confiance qu'il doit franchir : demandez à un associé qui n'est pas expert métier.",
    );
  }
  const avant = await lireParametres(db);
  const apres = {
    seuil_confiance: corps.seuil_confiance ?? avant.seuil_confiance,
    repondants_cible: corps.repondants_cible ?? avant.repondants_cible,
  };
  await db.query(
    `INSERT INTO notation_parametres (cabinet_id, seuil_confiance, repondants_cible, modifie_par)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cabinet_id) DO UPDATE SET seuil_confiance = EXCLUDED.seuil_confiance,
       repondants_cible = EXCLUDED.repondants_cible, modifie_par = EXCLUDED.modifie_par,
       modifie_le = now()`,
    [auth.cabinetId, apres.seuil_confiance, apres.repondants_cible, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "modification",
    entite: "notation_parametres",
    entiteId: auth.cabinetId,
    details: {
      avant: { seuil_confiance: avant.seuil_confiance, repondants_cible: avant.repondants_cible },
      apres,
    },
  });
  return lireParametres(db);
}

/**
 * Solidité (moteur `preuves`) des assertions RETENUES de la mission rattachées à une dimension :
 * ni brouillon (pas encore relu), ni abandonnée, ne relèvent l'indice.
 */
async function soliditesDimensions(db: Db, missionId: string) {
  const etat = await chargerEtat(db, missionId, null);
  return etat.assertions
    .filter(
      (a) => a.rattachement_type === "dimension" && a.rattachement_code && a.statut === "retenue",
    )
    .map((a) => ({
      dimension: a.rattachement_code as string,
      indice: etat.evaluations.get(a.id)?.solidite.indice ?? 0,
    }));
}

/** Indice de confiance d'une version (résultat calculé, nombre de jeux de réponses). */
export async function calculerConfiance(
  db: Db,
  missionId: string,
  version: { resultat: ResultatNotation; reponses_ids: readonly string[] },
): Promise<IndiceConfiance> {
  const parametres = await lireParametres(db);
  return indiceConfiance(
    {
      resultat: version.resultat,
      repondants: version.reponses_ids.length,
      solidites: await soliditesDimensions(db, missionId),
    },
    { seuil: parametres.seuil_confiance, repondantsCible: parametres.repondants_cible },
  );
}

/** Vue JSON (snake_case) d'un indice. */
export function vueConfiance(c: IndiceConfiance) {
  return {
    indice: c.indice,
    seuil: c.seuil,
    // `publiable` (comparaison de l'indice EXACT au seuil) fait foi ; `indice` est arrondi à 4
    // décimales pour l'affichage et peut égaler le seuil sans que l'indice exact l'atteigne.
    publiable: c.publiable,
    niveau: c.niveau,
    couverture: c.couverture,
    repondants: c.repondants,
    preuves: {
      valeur: c.preuves.valeur,
      poids: c.preuves.poids,
      dimensions_etayees: c.preuves.dimensionsEtayees,
      dimensions: c.preuves.dimensions,
      assertions: c.preuves.assertions,
    },
  };
}

/** Enregistre l'indice d'une version (ajout seul, rang suivant ; MPN10 en base). */
export async function enregistrerConfiance(
  db: Db,
  auth: Auth,
  versionId: string,
  c: IndiceConfiance,
): Promise<void> {
  await db.query(
    `INSERT INTO notation_confiances (cabinet_id, version_id, rang, indice, seuil, publiable,
       composantes, calcule_par)
     VALUES ($1, $2, coalesce((SELECT max(rang) FROM notation_confiances WHERE version_id = $2), 0) + 1,
       $3, $4, $5, $6, $7)`,
    [
      auth.cabinetId,
      versionId,
      c.indice,
      c.seuil,
      c.publiable,
      JSON.stringify(vueConfiance(c)),
      auth.utilisateurId,
    ],
  );
}
