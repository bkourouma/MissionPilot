import {
  ANALYSES_DD,
  CATEGORIE_ANALYSE_DD_LIBELLES,
  CATEGORIES_ANALYSE_DD,
  estCategorieAnalyseDd,
  PLAFONDS_DD,
  type AnalyseDd,
} from "@missionpilot/shared";
import type { Resultat } from "./saisie";

/*
 * Modèles d'analyse par secteur (DD-07) : types de l'API, chemins, saisie et validation. Un modèle
 * est une liste ordonnée de « points à examiner » (catégorie de l'analyse + libellé court) : des
 * rappels pour l'expert, jamais des affirmations ni des chiffres. La bibliothèque est vide au
 * départ : aucun modèle n'est fourni.
 */

export const LIBELLE_POINT_MAX = 300;
export const MOTIF_MODELE_MAX = 500;
export const MESSAGE_AUCUN_MODELE = "Aucun modèle : le cabinet les rédige selon son expertise.";

export interface PointModele {
  categorie: string;
  libelle: string;
}

export interface ModeleSecteur {
  id: string;
  secteur_code: string;
  analyse: AnalyseDd;
  version: number;
  points: PointModele[];
  actif: boolean;
}

export interface VersionModele {
  version: number;
  points: PointModele[];
  actif: boolean;
  motif: string | null;
  cree_par_nom: string | null;
  cree_le: string;
}

/** Réponse de `GET /api/dd/dossiers/:id/modeles-secteur`. */
export interface ModelesDuDossier {
  secteur_code: string;
  elements: ModeleSecteur[];
}

const seg = (v: string) => encodeURIComponent(v);

export const hrefModelesSecteur = "/parametres/due-diligence/modeles";
export const cheminModelesSecteur = (requete = "") =>
  `/api/dd/modeles-secteur${requete ? `?${requete}` : ""}`;
export const cheminVersionsModele = (id: string) => `/api/dd/modeles-secteur/${seg(id)}/versions`;
export const cheminModelesDuDossier = (dossierId: string, analyse?: AnalyseDd | null) =>
  `/api/dd/dossiers/${seg(dossierId)}/modeles-secteur${analyse ? `?analyse=${analyse}` : ""}`;

export const ANALYSES_MODELE_LIBELLES: Record<AnalyseDd, string> = {
  pestel: "PESTEL",
  cinq_forces: "Cinq forces de Porter",
  swot: "SWOT",
  operationnelle: "Analyse opérationnelle",
};

export const OPTIONS_ANALYSE_MODELE = ANALYSES_DD.map((a) => ({
  valeur: a,
  libelle: ANALYSES_MODELE_LIBELLES[a],
}));

/** Catégories proposées pour une analyse (liste vide si l'analyse n'est pas encore choisie). */
export function optionsCategories(analyse: string): { valeur: string; libelle: string }[] {
  if (!(ANALYSES_DD as readonly string[]).includes(analyse)) return [];
  return CATEGORIES_ANALYSE_DD[analyse as AnalyseDd].map((c) => ({
    valeur: c,
    libelle: (CATEGORIE_ANALYSE_DD_LIBELLES as Record<string, string>)[c] ?? c,
  }));
}

/** Points regroupés par catégorie, dans l'ordre des catégories de l'analyse puis de saisie. */
export function pointsParCategorie(
  analyse: AnalyseDd,
  points: readonly PointModele[],
): { categorie: string; libelle: string; points: string[] }[] {
  return CATEGORIES_ANALYSE_DD[analyse]
    .map((categorie) => ({
      categorie,
      libelle: (CATEGORIE_ANALYSE_DD_LIBELLES as Record<string, string>)[categorie] ?? categorie,
      points: points.filter((p) => p.categorie === categorie).map((p) => p.libelle),
    }))
    .filter((g) => g.points.length > 0);
}

// --- Saisie ----------------------------------------------------------------------------------

export interface SaisiePointModele {
  categorie: string;
  libelle: string;
}

export interface SaisieModele {
  secteur_code: string;
  analyse: string;
  points: SaisiePointModele[];
  actif: boolean;
  motif: string;
}

export type ChampModele = "secteur_code" | "analyse" | "points" | "motif";

export const saisiePointVide = (): SaisiePointModele => ({ categorie: "", libelle: "" });

export const saisieModeleVide = (): SaisieModele => ({
  secteur_code: "",
  analyse: "",
  points: [saisiePointVide()],
  actif: true,
  motif: "",
});

export const saisieDepuisModele = (m: ModeleSecteur): SaisieModele => ({
  secteur_code: m.secteur_code,
  analyse: m.analyse,
  points: m.points.map((p) => ({ ...p })),
  actif: m.actif,
  motif: "",
});

/** Déplace le point `i` de `delta` rangs (sans effet hors limites) ; ne modifie pas l'entrée. */
export function deplacerPoint<T>(points: readonly T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta;
  if (i < 0 || i >= points.length || j < 0 || j >= points.length) return [...points];
  const copie = [...points];
  [copie[i], copie[j]] = [copie[j]!, copie[i]!];
  return copie;
}

export interface ChargeModele {
  secteur_code?: string;
  analyse?: AnalyseDd;
  points: PointModele[];
  actif: boolean;
  motif?: string;
}

/**
 * Création (secteur et analyse choisis) ou nouvelle version (motif obligatoire ; secteur et analyse
 * ne changent pas). Les points vides sont ignorés ; au moins un point est exigé.
 */
export function validerModele(
  s: SaisieModele,
  correction: boolean,
): Resultat<ChargeModele, ChampModele> {
  const e: Partial<Record<ChampModele, string>> = {};
  if (!correction) {
    if (s.secteur_code.trim() === "") e.secteur_code = "Choisissez le secteur.";
    if (!(ANALYSES_DD as readonly string[]).includes(s.analyse)) {
      e.analyse = "Choisissez l'analyse.";
    }
  }
  const points: PointModele[] = [];
  for (const p of s.points) {
    const libelle = p.libelle.trim();
    if (libelle === "" && p.categorie === "") continue;
    if (libelle === "" || p.categorie === "") {
      e.points = "Chaque point précise sa catégorie et son libellé.";
    } else if (libelle.length > LIBELLE_POINT_MAX) {
      e.points = `Un libellé de point compte ${LIBELLE_POINT_MAX} caractères au plus.`;
    } else if (
      (ANALYSES_DD as readonly string[]).includes(s.analyse) &&
      !estCategorieAnalyseDd(s.analyse as AnalyseDd, p.categorie)
    ) {
      e.points = "Une catégorie ne correspond pas à l'analyse choisie.";
    } else {
      points.push({ categorie: p.categorie, libelle });
    }
  }
  if (!e.points && points.length === 0) e.points = "Ajoutez au moins un point à examiner.";
  if (!e.points && points.length > PLAFONDS_DD.points_par_modele) {
    e.points = `Un modèle compte ${PLAFONDS_DD.points_par_modele} points au plus.`;
  }
  const motif = s.motif.trim();
  if (correction) {
    if (motif === "") e.motif = "Expliquez la correction.";
    else if (motif.length > MOTIF_MODELE_MAX) {
      e.motif = `${MOTIF_MODELE_MAX} caractères au plus.`;
    }
  }
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: correction
      ? { points, actif: s.actif, motif }
      : {
          secteur_code: s.secteur_code,
          analyse: s.analyse as AnalyseDd,
          points,
          actif: true,
        },
  };
}
