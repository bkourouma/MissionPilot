/**
 * Rubriques à ancrages (STD-09, STD-11) dans l'éditeur sans code : saisie des cinq niveaux et de
 * leurs exemples, corps de création et de modification validés par les schémas partagés. Testé
 * dans `methodes-rubriques.test.ts`.
 */
import {
  codeReferentielSchema,
  rubriqueCreationSchema,
  rubriqueModificationSchema,
} from "@missionpilot/shared";
import type { RubriqueVersion } from "./methodes";
import { aDesErreurs, MESSAGE_CODE, vide } from "./methodes-editeur";
import type { Resultat } from "./saisie";

type RubriqueCreationCorps = ReturnType<typeof rubriqueCreationSchema.parse>;
type RubriqueModificationCorps = ReturnType<typeof rubriqueModificationSchema.parse>;

// --- Rubrique à ancrages ---------------------------------------------------------------------

export const NIVEAUX_ANCRAGE = [1, 2, 3, 4, 5] as const;
export const EXEMPLES_ANCRAGE_MAX = 10;

export interface SaisieExemple {
  contexte: string;
  texte: string;
}
export interface SaisieAncrage {
  description: string;
  exemples: SaisieExemple[];
}
export interface SaisieRubrique {
  code: string;
  libelle: string;
  dimension: string;
  brique_id: string;
  ancrages: SaisieAncrage[];
}
export type ChampRubrique =
  | "code"
  | "libelle"
  | "dimension"
  | "ancrages"
  | "niveau1"
  | "niveau2"
  | "niveau3"
  | "niveau4"
  | "niveau5";

export const saisieRubriqueVide = (): SaisieRubrique => ({
  code: "",
  libelle: "",
  dimension: "",
  brique_id: "",
  ancrages: NIVEAUX_ANCRAGE.map(() => ({ description: "", exemples: [] })),
});

export function saisieDepuisRubrique(r: RubriqueVersion): SaisieRubrique {
  return {
    code: r.code,
    libelle: r.libelle,
    dimension: r.dimension ?? "",
    brique_id: r.brique_id ?? "",
    ancrages: NIVEAUX_ANCRAGE.map((n) => {
      const a = r.ancrages.find((x) => x.niveau === n);
      return {
        description: a?.description ?? "",
        exemples: (a?.exemples ?? []).map((x) => ({ contexte: x.contexte, texte: x.texte })),
      };
    }),
  };
}

/** Ancrages saisis → cinq niveaux de l'API ; erreurs indexées `niveau1` … `niveau5`. */
function construireAncrages(
  s: SaisieRubrique,
): { ancrages: CasAncrage[] } | { erreurs: Partial<Record<ChampRubrique, string>> } {
  const erreurs: Partial<Record<ChampRubrique, string>> = {};
  const ancrages = NIVEAUX_ANCRAGE.map((niveau, i) => {
    const a = s.ancrages[i] ?? { description: "", exemples: [] };
    const exemples: SaisieExemple[] = [];
    for (const x of a.exemples) {
      const contexte = x.contexte.trim();
      const texte = x.texte.trim();
      if (!contexte && !texte) continue;
      if (!contexte || !texte) {
        erreurs[`niveau${niveau}`] = "Un exemple se compose d'un contexte ET d'un texte.";
      }
      exemples.push({ contexte, texte });
    }
    if (!a.description.trim()) {
      erreurs[`niveau${niveau}`] ??= "Décrire le comportement observable de ce niveau.";
    }
    return { niveau, description: a.description.trim(), exemples };
  });
  return aDesErreurs(erreurs) ? { erreurs } : { ancrages };
}
type CasAncrage = { niveau: number; description: string; exemples: SaisieExemple[] };

function champsRubrique(s: SaisieRubrique) {
  return {
    libelle: s.libelle.trim(),
    dimension: vide(s.dimension),
    brique_id: s.brique_id || null,
  };
}

function erreursRubrique(s: SaisieRubrique, creation: boolean) {
  const erreurs: Partial<Record<ChampRubrique, string>> = {};
  if (!s.libelle.trim()) erreurs.libelle = "Libellé obligatoire.";
  if (creation && !codeReferentielSchema.safeParse(s.code.trim()).success) {
    erreurs.code = MESSAGE_CODE;
  }
  if (vide(s.dimension) !== null && !codeReferentielSchema.safeParse(s.dimension.trim()).success) {
    erreurs.dimension = MESSAGE_CODE;
  }
  const a = construireAncrages(s);
  if ("erreurs" in a) Object.assign(erreurs, a.erreurs);
  return { erreurs, ancrages: "ancrages" in a ? a.ancrages : [] };
}

/** Création : `POST …/rubriques`. */
export function validerRubriqueCreation(
  s: SaisieRubrique,
): Resultat<RubriqueCreationCorps, ChampRubrique> {
  const { erreurs, ancrages } = erreursRubrique(s, true);
  if (aDesErreurs(erreurs)) return { ok: false, erreurs };
  const p = rubriqueCreationSchema.safeParse({
    code: s.code.trim(),
    ...champsRubrique(s),
    ancrages,
  });
  return p.success
    ? { ok: true, charge: p.data }
    : {
        ok: false,
        erreurs: { ancrages: "Rubrique refusée : vérifier les cinq niveaux." },
      };
}

/** Modification : `PATCH …/rubriques/:id` (le code ne change pas). */
export function validerRubriqueModification(
  s: SaisieRubrique,
): Resultat<RubriqueModificationCorps, ChampRubrique> {
  const { erreurs, ancrages } = erreursRubrique(s, false);
  if (aDesErreurs(erreurs)) return { ok: false, erreurs };
  const p = rubriqueModificationSchema.safeParse({ ...champsRubrique(s), ancrages });
  return p.success
    ? { ok: true, charge: p.data }
    : {
        ok: false,
        erreurs: { ancrages: "Rubrique refusée : vérifier les cinq niveaux." },
      };
}
