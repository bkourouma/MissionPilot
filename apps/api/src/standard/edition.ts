import {
  BORNES_VERSION_METHODE,
  CODES_MOTEURS_STANDARD,
  type briqueCreationSchema,
  type briqueModificationSchema,
  type casTypeCreationSchema,
  type elementMethodeCreationSchema,
  type etapeCreationSchema,
  type etapeModificationSchema,
  type RegleModulationApi,
  type rubriqueCreationSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { clauseSet, traduireErreursPg } from "../db/outils.js";
import { AppError, introuvable, requeteInvalide } from "../errors.js";
import { exigerBrouillonDuCabinet } from "./contenu.js";
import { plafondAtteint } from "./erreurs.js";

/*
 * Éditeur sans code (STD-11) : étapes, briques, éléments, rubriques, règles
 * et cas types d'un BROUILLON du cabinet (version verrouillée pour la
 * transaction ; une version publiée ou du standard est refusée). Chaque
 * ajout respecte les bornes de `BORNES_VERSION_METHODE` ; chaque écriture
 * est journalisée. La cohérence d'ensemble se contrôle avant publication.
 */

/** Tables du contenu : constantes (jamais une valeur reçue) interpolées dans les requêtes. */
const TABLES = {
  etapes: "methode_etapes",
  briques: "methode_briques",
  elements: "methode_elements",
  rubriques: "methode_rubriques",
  regles: "methode_regles",
  casTypes: "methode_cas_types",
} as const;
type Partie = keyof typeof TABLES;

const LIBELLES: Record<Partie, string> = {
  etapes: "Étapes",
  briques: "Briques",
  elements: "Éléments",
  rubriques: "Rubriques",
  regles: "Règles de modulation",
  casTypes: "Cas types",
};

const UNIQUE_CODE = { "*": "Ce code existe déjà dans cette version." };

async function exigerPlace(db: Db, partie: Partie, versionId: string): Promise<void> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM ${TABLES[partie]} WHERE version_id = $1`,
    [versionId],
  );
  if (r.rows[0].n >= BORNES_VERSION_METHODE[partie]) {
    throw plafondAtteint(LIBELLES[partie], BORNES_VERSION_METHODE[partie]);
  }
}

async function tracer(db: Db, auth: Auth, versionId: string, quoi: string, code: string | null) {
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "standard.brouillon.modifier",
    entite: "methode_version",
    entiteId: versionId,
    details: { quoi, code },
  });
}

function exigerMoteurConnu(moteur: string | null | undefined): void {
  if (moteur && !(CODES_MOTEURS_STANDARD as readonly string[]).includes(moteur)) {
    throw new AppError(400, "MOTEUR_INCONNU", "Moteur de calcul inconnu.");
  }
}

/** Ligne d'une partie du brouillon, ou 404 ; renvoie son code. */
async function exigerLigne(db: Db, partie: Partie, versionId: string, id: string): Promise<string> {
  const r = await db.query(`SELECT code FROM ${TABLES[partie]} WHERE id = $1 AND version_id = $2`, [
    id,
    versionId,
  ]);
  if (!r.rows[0]) throw introuvable("Élément de méthode");
  return r.rows[0].code as string;
}

async function supprimerLigne(db: Db, auth: Auth, partie: Partie, versionId: string, id: string) {
  await exigerBrouillonDuCabinet(db, versionId);
  const code = await exigerLigne(db, partie, versionId, id);
  await db.query(`DELETE FROM ${TABLES[partie]} WHERE id = $1 AND version_id = $2`, [
    id,
    versionId,
  ]);
  await tracer(db, auth, versionId, `${partie}.supprimer`, code);
}

// ----- Étapes -----

export async function ajouterEtape(
  db: Db,
  auth: Auth,
  versionId: string,
  corps: z.infer<typeof etapeCreationSchema>,
) {
  const v = await exigerBrouillonDuCabinet(db, versionId);
  await exigerPlace(db, "etapes", versionId);
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO methode_etapes (cabinet_id, version_id, code, libelle, description, ordre)
       VALUES ($1, $2, $3, $4, $5,
               coalesce($6, (SELECT coalesce(max(ordre), 0) + 1 FROM methode_etapes WHERE version_id = $2)))
       RETURNING id, code, libelle, description, ordre`,
      [
        v.cabinet_id,
        versionId,
        corps.code,
        corps.libelle,
        corps.description ?? null,
        corps.ordre ?? null,
      ],
    ),
    UNIQUE_CODE,
  );
  await tracer(db, auth, versionId, "etapes.ajouter", corps.code);
  return r.rows[0];
}

export async function modifierEtape(
  db: Db,
  auth: Auth,
  versionId: string,
  id: string,
  corps: z.infer<typeof etapeModificationSchema>,
) {
  await exigerBrouillonDuCabinet(db, versionId);
  const code = await exigerLigne(db, "etapes", versionId, id);
  const set = clauseSet(corps, 3);
  if (set.sql) {
    await db.query(`UPDATE methode_etapes SET ${set.sql} WHERE id = $1 AND version_id = $2`, [
      id,
      versionId,
      ...set.valeurs,
    ]);
  }
  await tracer(db, auth, versionId, "etapes.modifier", code);
  return (
    await db.query(
      `SELECT id, code, libelle, description, ordre FROM methode_etapes WHERE id = $1`,
      [id],
    )
  ).rows[0];
}

export const supprimerEtape = (db: Db, auth: Auth, versionId: string, id: string) =>
  supprimerLigne(db, auth, "etapes", versionId, id);

// ----- Briques -----

export async function ajouterBrique(
  db: Db,
  auth: Auth,
  versionId: string,
  corps: z.infer<typeof briqueCreationSchema>,
) {
  const v = await exigerBrouillonDuCabinet(db, versionId);
  exigerMoteurConnu(corps.moteur);
  await exigerPlace(db, "briques", versionId);
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO methode_briques (cabinet_id, version_id, etape_id, code, libelle, objet, entrees,
         moteur, agent, classe_risque, garde, sortie, definition_termine, temps_type_jours,
         profil_temps, niveau_autonomie_max, active_par_defaut, ordre)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
         coalesce($18, (SELECT coalesce(max(ordre), 0) + 1 FROM methode_briques
                        WHERE version_id = $2 AND etape_id = $3)))
       RETURNING id`,
      [
        v.cabinet_id,
        versionId,
        corps.etape_id,
        corps.code,
        corps.libelle,
        corps.objet,
        corps.entrees ?? null,
        corps.moteur ?? null,
        corps.agent ?? null,
        corps.classe_risque,
        corps.garde ?? null,
        corps.sortie ?? null,
        corps.definition_termine ?? null,
        corps.temps_type_jours ?? null,
        corps.profil_temps ?? null,
        corps.niveau_autonomie_max,
        corps.active_par_defaut,
        corps.ordre ?? null,
      ],
    ),
    UNIQUE_CODE,
    "Étape inconnue dans cette version.",
  );
  await tracer(db, auth, versionId, "briques.ajouter", corps.code);
  return { id: r.rows[0].id as string, code: corps.code };
}

export async function modifierBrique(
  db: Db,
  auth: Auth,
  versionId: string,
  id: string,
  corps: z.infer<typeof briqueModificationSchema>,
) {
  await exigerBrouillonDuCabinet(db, versionId);
  exigerMoteurConnu(corps.moteur);
  const code = await exigerLigne(db, "briques", versionId, id);
  const set = clauseSet(corps, 3);
  if (set.sql) {
    await traduireErreursPg(
      db.query(`UPDATE methode_briques SET ${set.sql} WHERE id = $1 AND version_id = $2`, [
        id,
        versionId,
        ...set.valeurs,
      ]),
      UNIQUE_CODE,
      "Étape inconnue dans cette version.",
    );
  }
  await tracer(db, auth, versionId, "briques.modifier", code);
  return { id, code };
}

export const supprimerBrique = (db: Db, auth: Auth, versionId: string, id: string) =>
  supprimerLigne(db, auth, "briques", versionId, id);

// ----- Éléments et rubriques -----

export async function ajouterElement(
  db: Db,
  auth: Auth,
  versionId: string,
  corps: z.infer<typeof elementMethodeCreationSchema>,
) {
  const v = await exigerBrouillonDuCabinet(db, versionId);
  await exigerPlace(db, "elements", versionId);
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO methode_elements (cabinet_id, version_id, brique_id, type, code, libelle,
         description, essentiel, actif_par_defaut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        v.cabinet_id,
        versionId,
        corps.brique_id ?? null,
        corps.type,
        corps.code,
        corps.libelle,
        corps.description ?? null,
        corps.essentiel,
        corps.actif_par_defaut,
      ],
    ),
    UNIQUE_CODE,
    "Brique inconnue dans cette version.",
  );
  await tracer(db, auth, versionId, "elements.ajouter", corps.code);
  return { id: r.rows[0].id as string, code: corps.code };
}

export const supprimerElement = (db: Db, auth: Auth, versionId: string, id: string) =>
  supprimerLigne(db, auth, "elements", versionId, id);

export async function ajouterRubrique(
  db: Db,
  auth: Auth,
  versionId: string,
  corps: z.infer<typeof rubriqueCreationSchema>,
) {
  const v = await exigerBrouillonDuCabinet(db, versionId);
  await exigerPlace(db, "rubriques", versionId);
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO methode_rubriques (cabinet_id, version_id, brique_id, code, libelle, dimension, ancrages)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        v.cabinet_id,
        versionId,
        corps.brique_id ?? null,
        corps.code,
        corps.libelle,
        corps.dimension ?? null,
        JSON.stringify(corps.ancrages),
      ],
    ),
    UNIQUE_CODE,
    "Brique inconnue dans cette version.",
  );
  await tracer(db, auth, versionId, "rubriques.ajouter", corps.code);
  return { id: r.rows[0].id as string, code: corps.code };
}

export const supprimerRubrique = (db: Db, auth: Auth, versionId: string, id: string) =>
  supprimerLigne(db, auth, "rubriques", versionId, id);

// ----- Règles et cas types -----

export async function ajouterRegle(
  db: Db,
  auth: Auth,
  versionId: string,
  regle: RegleModulationApi,
) {
  const v = await exigerBrouillonDuCabinet(db, versionId);
  await exigerPlace(db, "regles", versionId);
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO methode_regles (cabinet_id, version_id, code, regle) VALUES ($1, $2, $3, $4) RETURNING id`,
      [v.cabinet_id, versionId, regle.code, JSON.stringify(regle)],
    ),
    UNIQUE_CODE,
  );
  await tracer(db, auth, versionId, "regles.ajouter", regle.code);
  return { id: r.rows[0].id as string, code: regle.code };
}

/** Remplace une règle ; son code ne change pas (il désigne la règle dans les journaux). */
export async function remplacerRegle(
  db: Db,
  auth: Auth,
  versionId: string,
  id: string,
  regle: RegleModulationApi,
) {
  await exigerBrouillonDuCabinet(db, versionId);
  const code = await exigerLigne(db, "regles", versionId, id);
  if (code !== regle.code) {
    throw requeteInvalide("Le code d'une règle ne change pas : supprimer puis recréer la règle.");
  }
  await db.query(`UPDATE methode_regles SET regle = $3 WHERE id = $1 AND version_id = $2`, [
    id,
    versionId,
    JSON.stringify(regle),
  ]);
  await tracer(db, auth, versionId, "regles.modifier", code);
  return { id, code };
}

export const supprimerRegle = (db: Db, auth: Auth, versionId: string, id: string) =>
  supprimerLigne(db, auth, "regles", versionId, id);

export async function ajouterCasType(
  db: Db,
  auth: Auth,
  versionId: string,
  corps: z.infer<typeof casTypeCreationSchema>,
) {
  const v = await exigerBrouillonDuCabinet(db, versionId);
  await exigerPlace(db, "casTypes", versionId);
  const { code, libelle, ...cas } = corps;
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO methode_cas_types (cabinet_id, version_id, code, libelle, cas)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [v.cabinet_id, versionId, code, libelle ?? null, JSON.stringify(cas)],
    ),
    UNIQUE_CODE,
  );
  await tracer(db, auth, versionId, "cas_types.ajouter", code);
  return { id: r.rows[0].id as string, code };
}

export const supprimerCasType = (db: Db, auth: Auth, versionId: string, id: string) =>
  supprimerLigne(db, auth, "casTypes", versionId, id);
