import {
  briqueCreationSchema,
  elementMethodeCreationSchema,
  etapeCreationSchema,
  rubriqueCreationSchema,
  type ContenuProposition,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { lireVersion } from "../standard/contenu.js";
import {
  ajouterBrique,
  ajouterElement,
  ajouterEtape,
  ajouterRubrique,
} from "../standard/edition.js";

/*
 * Application d'une proposition de standard validée (STD-13, ADR-009 décision 10) au BROUILLON de méthode
 * cible, UNIQUEMENT par les fonctions de l'éditeur (STD-11 : bornes `BORNES_VERSION_METHODE`, unicité des
 * codes, journal). Appelée dans la transaction de la validation : toute erreur (borne dépassée, version
 * publiée entre-temps) annule tout, rien n'est appliqué. La publication n'est JAMAIS appelée ici.
 *
 * Ordre : étapes, briques (étape retrouvée par son code dans la version), éléments (brique retrouvée par
 * `brique_code` si présent), rubriques. Un code déjà présent dans la version est IGNORÉ (jamais écrasé) et
 * listé ; une brique dont l'étape est introuvable est IGNORÉE et listée.
 *
 * VALEURS PAR DÉFAUT PRUDENTES (HYPOTHÈSE MÉTIER, à valider par l'expert du cabinet) : une proposition issue
 * de l'IA ne doit rien activer ni autoriser par elle-même. Brique : classe de risque R3, autonomie maximale
 * N1, inactive par défaut, sans moteur ni agent, sans temps type. Élément : non essentiel et inactif par
 * défaut. L'expert relève ces valeurs dans l'éditeur, brique par brique.
 */

export type FamilleApplication = "etape" | "brique" | "element" | "rubrique";
export type MotifIgnore = "code_existant" | "etape_introuvable" | "invalide";

export interface ResultatApplication extends Record<string, unknown> {
  crees: { etapes: number; briques: number; elements: number; rubriques: number };
  ignores: { famille: FamilleApplication; code: string; motif: MotifIgnore }[];
}

async function codesDe(db: Db, table: string, versionId: string): Promise<Map<string, string>> {
  // `table` est une constante interne (jamais une valeur reçue).
  const r = await db.query(`SELECT id, code FROM ${table} WHERE version_id = $1`, [versionId]);
  return new Map((r.rows as { id: string; code: string }[]).map((l) => [l.code, l.id]));
}

export async function appliquerProposition(
  db: Db,
  auth: Auth,
  versionId: string,
  proposition: ContenuProposition,
): Promise<ResultatApplication> {
  // Version cible encore un brouillon du cabinet (verrouillée pour la transaction), sinon 409.
  const version = await lireVersion(db, versionId, true);
  if (version.cabinet_id === null || version.statut !== "brouillon") {
    throw new AppError(
      409,
      "VERSION_CIBLE_FIGEE",
      "La méthode cible n'est plus un brouillon du cabinet : rien n'a été appliqué.",
    );
  }
  const etapes = await codesDe(db, "methode_etapes", versionId);
  const briques = await codesDe(db, "methode_briques", versionId);
  const elements = await codesDe(db, "methode_elements", versionId);
  const rubriques = await codesDe(db, "methode_rubriques", versionId);
  const resultat: ResultatApplication = {
    crees: { etapes: 0, briques: 0, elements: 0, rubriques: 0 },
    ignores: [],
  };
  const ignorer = (famille: FamilleApplication, code: string, motif: MotifIgnore) =>
    resultat.ignores.push({ famille, code, motif });

  for (const e of proposition.etapes) {
    if (etapes.has(e.code)) {
      ignorer("etape", e.code, "code_existant");
      continue;
    }
    const corps = etapeCreationSchema.safeParse({ code: e.code, libelle: e.libelle });
    if (!corps.success) {
      ignorer("etape", e.code, "invalide");
      continue;
    }
    const cree = await ajouterEtape(db, auth, versionId, corps.data);
    etapes.set(e.code, cree.id as string);
    resultat.crees.etapes++;
  }

  for (const b of proposition.briques) {
    if (briques.has(b.code)) {
      ignorer("brique", b.code, "code_existant");
      continue;
    }
    const etapeId = etapes.get(b.etape_code);
    if (etapeId === undefined) {
      ignorer("brique", b.code, "etape_introuvable");
      continue;
    }
    const corps = briqueCreationSchema.safeParse({
      etape_id: etapeId,
      code: b.code,
      libelle: b.libelle,
      objet: b.objet,
      moteur: null,
      agent: null,
      temps_type_jours: null,
      classe_risque: "R3",
      niveau_autonomie_max: "N1",
      active_par_defaut: false,
    });
    if (!corps.success) {
      ignorer("brique", b.code, "invalide");
      continue;
    }
    const cree = await ajouterBrique(db, auth, versionId, corps.data);
    briques.set(b.code, cree.id);
    resultat.crees.briques++;
  }

  for (const el of proposition.elements) {
    if (elements.has(el.code)) {
      ignorer("element", el.code, "code_existant");
      continue;
    }
    // Brique non retrouvée : l'élément reste utile, il est créé sans brique (l'expert le rattachera).
    const briqueId = el.brique_code ? (briques.get(el.brique_code) ?? null) : null;
    const corps = elementMethodeCreationSchema.safeParse({
      type: el.type,
      code: el.code,
      libelle: el.libelle,
      description: el.description ?? null,
      brique_id: briqueId,
      essentiel: false,
      actif_par_defaut: false,
    });
    if (!corps.success) {
      ignorer("element", el.code, "invalide");
      continue;
    }
    const cree = await ajouterElement(db, auth, versionId, corps.data);
    elements.set(el.code, cree.id);
    resultat.crees.elements++;
  }

  for (const r of proposition.rubriques) {
    if (rubriques.has(r.code)) {
      ignorer("rubrique", r.code, "code_existant");
      continue;
    }
    const corps = rubriqueCreationSchema.safeParse({
      code: r.code,
      libelle: r.libelle,
      ancrages: r.niveaux.map((description, i) => ({ niveau: i + 1, description, exemples: [] })),
    });
    if (!corps.success) {
      ignorer("rubrique", r.code, "invalide");
      continue;
    }
    const cree = await ajouterRubrique(db, auth, versionId, corps.data);
    rubriques.set(r.code, cree.id);
    resultat.crees.rubriques++;
  }
  return resultat;
}
