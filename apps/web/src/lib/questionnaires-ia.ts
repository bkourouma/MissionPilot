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
  type Langue,
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
  brouillon_ia: {
    libelle: "Brouillon IA, à relire",
    tonalite: "attention",
  },
  modifie: { libelle: "Modifié, à valider", tonalite: "attention" },
  valide: {
    libelle: "Validé par un consultant",
    tonalite: "succes",
  },
};

const STATUT_CONTENU_IA_EN: Record<StatutContenuIa, string> = {
  brouillon_ia: "AI draft, to be reviewed",
  modifie: "Edited, pending approval",
  valide: "Approved by a consultant",
};

const INCONNU: Libelle = { libelle: "Statut inconnu", tonalite: "neutre" };

export function libelleContenuIa(statut: string, langue: Langue = "fr"): Libelle {
  if (!Object.prototype.hasOwnProperty.call(STATUT_CONTENU_IA, statut)) {
    return langue === "en" ? { libelle: "Unknown status", tonalite: "neutre" } : INCONNU;
  }
  const l = STATUT_CONTENU_IA[statut as StatutContenuIa];
  return langue === "en"
    ? { libelle: STATUT_CONTENU_IA_EN[statut as StatutContenuIa], tonalite: l.tonalite }
    : l;
}

/** Ligne d'historique : « Brouillon IA proposé par Awa Koné, le 8 oct. 2026 à 09:00 ». */
export function ligneHistoriqueIa(r: RangHistoriqueIa, langue: Langue = "fr"): string {
  const quand = formaterDateHeure(r.cree_le, undefined, langue);
  if (langue === "en") {
    switch (r.statut_contenu) {
      case "brouillon_ia":
        return `AI draft requested by ${r.auteur.nom}, on ${quand}`;
      case "modifie":
        return `Edited by ${r.auteur.nom}, on ${quand}`;
      case "valide":
        return `Approved by ${r.auteur.nom}, on ${quand}`;
    }
  }
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
export function aideContenuIa(
  ia: Pick<OrigineIa, "statut_contenu" | "gabarit">,
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    if (ia.statut_contenu === "valide") {
      return "A consultant has reviewed and approved this questionnaire: it is locked and can be sent to the client's respondents.";
    }
    const origineEn = ia.gabarit
      ? "The AI could not propose questions (disabled, unavailable or unusable response): this generic questionnaire was built by a deterministic template from your topic."
      : "This questionnaire was proposed by the AI.";
    return `${origineEn} It cannot be sent until a consultant other than its author has reviewed and approved it. AI proposes, the expert decides.`;
  }
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
  langue: Langue = "fr",
): Resultat<QuestionnaireGenerationIa, ChampGenerationIa> {
  const en = langue === "en";
  const erreurs: Partial<Record<ChampGenerationIa, string>> = {};
  const code = s.code.trim();
  if (code === "") erreurs.code = en ? "The code is required." : "Le code est obligatoire.";
  else if (!identifiantGrilleSchema.safeParse(code).success) {
    erreurs.code = en
      ? 'Invalid code: lowercase letters without accents, digits, "_", "." or "-" (80 characters at most).'
      : "Code invalide : minuscules sans accent, chiffres, « _ », « . » ou « - » (80 caractères au plus).";
  }
  const obligatoires = en
    ? ({
        service: "The service is required.",
        population: "The surveyed population is required.",
        theme: "The topic is required.",
      } as const)
    : ({
        service: "Le service est obligatoire.",
        population: "La population interrogée est obligatoire.",
        theme: "Le thème est obligatoire.",
      } as const);
  const valeurs = {
    service: s.service.trim(),
    population: s.population.trim(),
    theme: s.theme.trim(),
  };
  for (const champ of ["service", "population", "theme"] as const) {
    const max = LONGUEURS_GENERATION_IA[champ];
    if (valeurs[champ] === "") erreurs[champ] = obligatoires[champ];
    else if (valeurs[champ].length > max) {
      erreurs[champ] = en ? `${max} characters at most.` : `${max} caractères au plus.`;
    }
  }
  const brut = s.nombre_questions.trim();
  const n = Number(brut);
  if (
    brut === "" ||
    !Number.isInteger(n) ||
    n < NOMBRE_QUESTIONS_IA_MIN ||
    n > NOMBRE_QUESTIONS_IA_MAX
  ) {
    erreurs.nombre_questions = en
      ? `Choose a whole number between ${NOMBRE_QUESTIONS_IA_MIN} and ${NOMBRE_QUESTIONS_IA_MAX}.`
      : `Choisissez un nombre entier entre ${NOMBRE_QUESTIONS_IA_MIN} et ${NOMBRE_QUESTIONS_IA_MAX}.`;
  }
  const termes = decouperListe(s.termes_sensibles.replace(/\r/g, ""));
  if (termes.length > 200)
    erreurs.termes_sensibles = en ? "200 terms at most." : "200 termes au plus.";
  else if (termes.some((t) => t.length > 200)) {
    erreurs.termes_sensibles = en
      ? "Each term has 200 characters at most."
      : "Chaque terme comporte 200 caractères au plus.";
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
