/**
 * Génération assistée de questionnaires par l'IA (SOC-11) côté cabinet : saisie du besoin,
 * statut du contenu (brouillon IA, modifié, validé) et historique. Logique pure, testée dans
 * `questionnaires-ia.test.ts`.
 *
 * Le contenu produit est un BROUILLON : la version 1 d'un nouveau modèle, à relire, modifier
 * puis valider par un consultant avant tout envoi (l'API et la base l'imposent). L'IA ne
 * produit aucun chiffre : seules des questions sont proposées.
 */
import {
  identifiantGrilleSchema,
  NOMBRE_QUESTIONS_IA_DEFAUT,
  NOMBRE_QUESTIONS_IA_MAX,
  NOMBRE_QUESTIONS_IA_MIN,
  type QuestionnaireGenerationIa,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { formaterDateHeure } from "./format";
import { decouperListe, type Resultat } from "./saisie";

// --- Réponses de l'API ------------------------------------------------------------------------

export type StatutContenuIa = "brouillon_ia" | "modifie" | "valide";

export interface RangHistoriqueIa {
  rang: number;
  statut_contenu: StatutContenuIa;
  auteur: { id: string; nom: string };
  chiffres_non_verifies: boolean;
  cree_le: string;
}

/** Champ `ia` de `GET /api/questionnaires/versions/:id` (`null` : version rédigée à la main). */
export interface OrigineIa {
  statut_contenu: StatutContenuIa;
  demande_id: string;
  brief: { service?: string; population?: string; theme?: string; nombre_questions?: number };
  /** Contenu fabriqué par le gabarit déterministe (IA indisponible ou sortie inexploitable). */
  gabarit: boolean;
  chiffres_non_verifies: boolean;
  nombres_non_verifies: string[];
  chiffres_acquittes: boolean;
  historique: RangHistoriqueIa[];
}

// --- Libellés ---------------------------------------------------------------------------------

interface Libelle {
  libelle: string;
  tonalite: TonaliteStatut;
}

export const STATUT_CONTENU_IA: Record<StatutContenuIa, Libelle> = {
  brouillon_ia: { libelle: "Brouillon IA, à relire", tonalite: "attention" },
  modifie: { libelle: "Modifié, à valider", tonalite: "attention" },
  valide: { libelle: "Validé par un consultant", tonalite: "succes" },
};

const INCONNU: Libelle = { libelle: "Statut inconnu", tonalite: "neutre" };

export function libelleContenuIa(statut: string): Libelle {
  return Object.prototype.hasOwnProperty.call(STATUT_CONTENU_IA, statut)
    ? STATUT_CONTENU_IA[statut as StatutContenuIa]
    : INCONNU;
}

/** Ligne d'historique : « Brouillon IA proposé par Awa Koné, le 8 oct. 2026 à 09:00 ». */
export function ligneHistoriqueIa(r: RangHistoriqueIa): string {
  const quand = formaterDateHeure(r.cree_le);
  switch (r.statut_contenu) {
    case "brouillon_ia":
      return `Brouillon IA demandé par ${r.auteur.nom}, le ${quand}`;
    case "modifie":
      return `Modifié par ${r.auteur.nom}, le ${quand}`;
    case "valide":
      return `Validé par ${r.auteur.nom}, le ${quand}`;
  }
}

/** Explication affichée selon le statut et l'origine du contenu. */
export function aideContenuIa(ia: Pick<OrigineIa, "statut_contenu" | "gabarit">): string {
  if (ia.statut_contenu === "valide") {
    return "Un consultant a relu et validé ce questionnaire : il est figé et peut être envoyé aux répondants du client.";
  }
  const origine = ia.gabarit
    ? "L'IA n'a pas pu proposer de questions (désactivée, indisponible ou réponse inexploitable) : ce questionnaire générique a été construit par un gabarit déterministe à partir de votre thème."
    : "Ce questionnaire a été proposé par l'IA.";
  return `${origine} Il n'est pas envoyable tant qu'un consultant autre que son auteur ne l'a pas relu et validé. L'IA propose, l'expert dispose.`;
}

// --- Saisie du besoin -------------------------------------------------------------------------

export interface SaisieGenerationIa {
  code: string;
  service: string;
  population: string;
  theme: string;
  nombre_questions: string;
  /** Noms propres, sigles… à masquer avant l'envoi au fournisseur (un par ligne ou séparés par « ; »). */
  termes_sensibles: string;
}

export const SAISIE_GENERATION_IA_VIDE: SaisieGenerationIa = {
  code: "",
  service: "",
  population: "",
  theme: "",
  nombre_questions: String(NOMBRE_QUESTIONS_IA_DEFAUT),
  termes_sensibles: "",
};

export type ChampGenerationIa = keyof SaisieGenerationIa;

export const LONGUEURS_GENERATION_IA = { service: 200, population: 200, theme: 300 } as const;

export function validerGenerationIa(
  s: SaisieGenerationIa,
): Resultat<QuestionnaireGenerationIa, ChampGenerationIa> {
  const erreurs: Partial<Record<ChampGenerationIa, string>> = {};
  const code = s.code.trim();
  if (code === "") erreurs.code = "Le code est obligatoire.";
  else if (!identifiantGrilleSchema.safeParse(code).success) {
    erreurs.code =
      "Code invalide : minuscules sans accent, chiffres, « _ », « . » ou « - » (80 caractères au plus).";
  }
  const obligatoires = {
    service: "Le service est obligatoire.",
    population: "La population interrogée est obligatoire.",
    theme: "Le thème est obligatoire.",
  } as const;
  const valeurs = {
    service: s.service.trim(),
    population: s.population.trim(),
    theme: s.theme.trim(),
  };
  for (const champ of ["service", "population", "theme"] as const) {
    const max = LONGUEURS_GENERATION_IA[champ];
    if (valeurs[champ] === "") erreurs[champ] = obligatoires[champ];
    else if (valeurs[champ].length > max) erreurs[champ] = `${max} caractères au plus.`;
  }
  const brut = s.nombre_questions.trim();
  const n = Number(brut);
  if (
    brut === "" ||
    !Number.isInteger(n) ||
    n < NOMBRE_QUESTIONS_IA_MIN ||
    n > NOMBRE_QUESTIONS_IA_MAX
  ) {
    erreurs.nombre_questions = `Choisissez un nombre entier entre ${NOMBRE_QUESTIONS_IA_MIN} et ${NOMBRE_QUESTIONS_IA_MAX}.`;
  }
  const termes = decouperListe(s.termes_sensibles.replace(/\r/g, ""));
  if (termes.length > 200) erreurs.termes_sensibles = "200 termes au plus.";
  else if (termes.some((t) => t.length > 200)) {
    erreurs.termes_sensibles = "Chaque terme comporte 200 caractères au plus.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      code,
      service: valeurs.service,
      population: valeurs.population,
      theme: valeurs.theme,
      nombre_questions: n,
      termes_sensibles: termes,
    },
  };
}
