import { diviserArrondi, libellesProches, motsSignificatifs, normaliserTerme } from "./commun";

/**
 * Rapprochement d'un appel d'offres avec le profil du cabinet (AO-01) : score DÉTERMINISTE de
 * 0 à 100, sans connecteur externe ni modèle de langage.
 *
 * Composantes (entiers de 0 à 100), pondérées par `POIDS_RAPPROCHEMENT` (somme 100) :
 * - secteur : 100 si le secteur de la fiche est l'un des secteurs du cabinet ou de ses
 *   références (égalité normalisée ou mot significatif commun) ;
 * - compétences : part des `COMPETENCES_POUR_SCORE_PLEIN` premières compétences du cabinet
 *   retrouvées dans le titre, l'objet ou les mots-clés de la fiche ;
 * - références : références du cabinet dans le même secteur, `REFERENCES_POUR_SCORE_PLEIN`
 *   donnant la note pleine ;
 * - pays : 100 si une référence porte sur le même pays ;
 * - bailleur : 100 si une référence a été financée par le même bailleur.
 *
 * Score = Σ poids × composante / 100, arrondi à l'entier (moitié vers le haut). Poids et seuils
 * sont des valeurs de départ, à calibrer au pilote.
 */

export const POIDS_RAPPROCHEMENT = {
  secteur: 30,
  competences: 30,
  references: 25,
  pays: 10,
  bailleur: 5,
} as const;

export const COMPETENCES_POUR_SCORE_PLEIN = 3;
export const REFERENCES_POUR_SCORE_PLEIN = 3;

/** Plafonds d'entrée (le profil d'un cabinet est borné par l'appelant). */
export const PROFIL_COMPETENCES_MAX = 2_000;
export const PROFIL_REFERENCES_MAX = 5_000;

export interface ReferenceCabinet {
  secteur: string | null;
  pays: string | null;
  bailleur: string | null;
}

export interface ProfilCabinet {
  competences: readonly string[];
  secteurs: readonly string[];
  references: readonly ReferenceCabinet[];
}

export interface FicheRapprochement {
  titre: string;
  objet?: string | null;
  secteur: string | null;
  pays: string | null;
  bailleur: string | null;
  motsCles: readonly string[];
}

export type ComposanteRapprochement = keyof typeof POIDS_RAPPROCHEMENT;

export interface Rapprochement {
  score: number;
  composantes: Record<ComposanteRapprochement, number>;
  /** Compétences du cabinet retrouvées dans la fiche (libellés d'origine, triés). */
  competencesTrouvees: string[];
  referencesSecteur: number;
  referencesPays: number;
  referencesBailleur: number;
}

/** Même pays : comparaison normalisée (casse, accents, ponctuation), comme `memeBailleur`. */
const memePays = (a: string | null, b: string | null) =>
  a !== null &&
  b !== null &&
  normaliserTerme(a) !== "" &&
  normaliserTerme(a) === normaliserTerme(b);

const memeBailleur = (a: string | null, b: string | null) =>
  a !== null &&
  b !== null &&
  normaliserTerme(a) !== "" &&
  normaliserTerme(a) === normaliserTerme(b);

/** Score de rapprochement d'une fiche avec le profil du cabinet. */
export function rapprocherAppelOffres(
  fiche: FicheRapprochement,
  profil: ProfilCabinet,
): Rapprochement {
  const termes = new Set(
    motsSignificatifs([fiche.titre, fiche.objet ?? "", ...fiche.motsCles].join(" ")),
  );
  const trouvees = [
    ...new Set(
      profil.competences
        .slice(0, PROFIL_COMPETENCES_MAX)
        .filter((c) => motsSignificatifs(c).some((m) => termes.has(m)))
        .map((c) => c.trim()),
    ),
  ].sort((a, b) => a.localeCompare(b, "fr"));

  const references = profil.references.slice(0, PROFIL_REFERENCES_MAX);
  const referencesSecteur = references.filter((r) => libellesProches(r.secteur, fiche.secteur));
  const referencesPays = references.filter((r) => memePays(r.pays, fiche.pays)).length;
  const referencesBailleur = references.filter((r) =>
    memeBailleur(r.bailleur, fiche.bailleur),
  ).length;
  const secteurConnu =
    profil.secteurs.some((s) => libellesProches(s, fiche.secteur)) || referencesSecteur.length > 0;

  const composantes: Record<ComposanteRapprochement, number> = {
    secteur: secteurConnu ? 100 : 0,
    competences: Math.min(100, Math.floor((trouvees.length * 100) / COMPETENCES_POUR_SCORE_PLEIN)),
    references: Math.min(
      100,
      Math.floor((referencesSecteur.length * 100) / REFERENCES_POUR_SCORE_PLEIN),
    ),
    pays: referencesPays > 0 ? 100 : 0,
    bailleur: referencesBailleur > 0 ? 100 : 0,
  };
  const somme = (Object.keys(POIDS_RAPPROCHEMENT) as ComposanteRapprochement[]).reduce(
    (n, k) => n + POIDS_RAPPROCHEMENT[k] * composantes[k],
    0,
  );
  return {
    score: diviserArrondi(somme, 100),
    composantes,
    competencesTrouvees: trouvees,
    referencesSecteur: referencesSecteur.length,
    referencesPays,
    referencesBailleur,
  };
}
