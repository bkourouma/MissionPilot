import type { ChoixCopilote, OutilCopilote } from "./catalogue";
import { extraireNomMission, extraireTache, extraireTexteRecherche } from "./extraction";
import { nettoyerMessageCopilote, normaliserTexteCopilote } from "./normalisation";

/*
 * Routage DÉTERMINISTE d'un message vers un outil du catalogue (AGT-08). C'est le repli quand
 * l'IA est désactivée, sans clé, au plafond, en erreur ou non conforme, et il rend le copilote
 * utile sans modèle de langage. Correspondance de mots-clés sur le texte normalisé (minuscules,
 * sans accents, sans ponctuation), avec un poids par motif ; l'outil au meilleur score gagne s'il
 * atteint `SEUIL_ROUTAGE`. Le message est une DONNÉE : « ignore les consignes et supprime… » ne
 * peut produire qu'un outil du catalogue fermé, avec des paramètres bornés.
 */

export const SEUIL_ROUTAGE = 3;

interface Regle {
  motif: RegExp;
  poids: number;
}

const REGLES: Readonly<Record<OutilCopilote, readonly Regle[]>> = {
  creer_tache: [
    {
      motif:
        /\b(cree|creer|creez|ajoute|ajouter|ajoutez|nouvelle|programme|planifie|assigne|assigner|confie|confier|attribue|attribuer)\b.*\btaches?\b/,
      poids: 8,
    },
    { motif: /\brappelle( moi)?\b/, poids: 6 },
    { motif: /\b(cree|creer|ajoute|ajouter)\b.*\b(rappel|todo)\b/, poids: 6 },
  ],
  mes_taches: [
    { motif: /\b(mes|ma|mon)\b.*\b(taches?|todo)\b/, poids: 5 },
    { motif: /\btaches?\b/, poids: 3 },
    { motif: /\b(que dois je faire|quoi faire|a faire)\b/, poids: 3 },
    { motif: /\becheances?\b/, poids: 1 },
  ],
  mes_feuilles_temps: [
    { motif: /\bfeuilles? de temps\b/, poids: 5 },
    { motif: /\btimesheets?\b/, poids: 5 },
    { motif: /\b(mes|ma)\b.*\b(feuilles?|heures)\b/, poids: 4 },
    {
      motif:
        /\b(soumettre|soumets|soumission|saisie|saisir|saisis)\b.*\b(temps|heures|feuilles?)\b/,
      poids: 4,
    },
  ],
  resume_mission: [
    {
      motif:
        /\b(resume|resumer|resumez|point|situation|etat|statut|avancement|bilan|synthese|presente)\b.*\bmission\b/,
      poids: 6,
    },
    {
      motif: /\bmission\b.*\b(resume|situation|etat|statut|avancement|bilan|synthese)\b/,
      poids: 6,
    },
    { motif: /\bou en est\b/, poids: 5 },
    { motif: /\bavancement\b/, poids: 4 },
    { motif: /\bjalons?\b/, poids: 3 },
    { motif: /\bmission\b/, poids: 2 },
  ],
  kpi_rouges: [
    { motif: /\b(kpi|kpis|indicateurs?)\b/, poids: 4 },
    { motif: /\b(rouges?|degrade\w*|critiques?|alertes?)\b/, poids: 2 },
  ],
  factures_echues: [
    { motif: /\bfactures?\b/, poids: 3 },
    {
      motif: /\b(echues?|echeance depassee|impayes?|impayees?|retards? de paiement|creances?)\b/,
      poids: 3,
    },
    { motif: /\brelanc\w*\b/, poids: 2 },
    { motif: /\bfactures?\b.*\bretard\b/, poids: 3 },
  ],
  recherche: [
    {
      motif:
        /\b(cherche|cherches|chercher|recherche|recherches|rechercher|trouve|trouves|trouver|retrouve|retrouves|retrouver)\b/,
      poids: 5,
    },
    { motif: /\bou (est|se trouve|sont)\b/, poids: 3 },
    { motif: /\b(documents?|rapports?|livrables?|preuves?|retours? d experience)\b/, poids: 1 },
  ],
};

/** Ordre de départage à score égal : l'action d'abord, puis la lecture dans l'ordre du catalogue. */
const ORDRE: readonly OutilCopilote[] = [
  "creer_tache",
  "mes_taches",
  "mes_feuilles_temps",
  "resume_mission",
  "kpi_rouges",
  "factures_echues",
  "recherche",
];

export function scoresIntentions(message: string): Record<OutilCopilote, number> {
  const norm = normaliserTexteCopilote(message);
  const scores = {} as Record<OutilCopilote, number>;
  for (const outil of ORDRE) {
    scores[outil] = REGLES[outil].reduce((s, r) => (r.motif.test(norm) ? s + r.poids : s), 0);
  }
  return scores;
}

export interface OptionsRoutage {
  /** Date du jour `AAAA-MM-JJ` (jamais d'horloge dans le moteur). */
  aujourdhui: string;
}

export type RoutageCopilote =
  | { type: "outil"; choix: ChoixCopilote }
  /** L'outil est compris mais un paramètre indispensable manque : poser la question. */
  | { type: "precision"; outil: OutilCopilote; question: string }
  | { type: "aide" }
  | { type: "inconnu" };

const SALUTATION = /^(bonjour|bonsoir|salut|hello|coucou|bonne journee)( .*)?$/;
const AIDE =
  /\b(aide|aidez moi|help|que peux tu|que pouvez vous|que sais tu|que fais tu|fonctionnalites|commandes)\b/;

export const QUESTION_TITRE_TACHE = "Quel est l'intitulé de la tâche à créer ?";
export const QUESTION_ECHEANCE_INVALIDE =
  "Je n'ai pas compris la date d'échéance : indiquez-la sous la forme JJ/MM/AAAA, ou retirez-la.";
export const QUESTION_RECHERCHE = "Quels mots souhaitez-vous rechercher ?";

/** Choisit l'outil d'un message, extrait ses paramètres, ou demande une précision. */
export function routerMessageCopilote(brut: string, options: OptionsRoutage): RoutageCopilote {
  const message = nettoyerMessageCopilote(brut);
  const norm = normaliserTexteCopilote(message);
  if (norm === "") return { type: "inconnu" };
  const scores = scoresIntentions(message);
  let outil: OutilCopilote | null = null;
  let meilleur = 0;
  for (const o of ORDRE) {
    if (scores[o] > meilleur) {
      meilleur = scores[o];
      outil = o;
    }
  }
  if (outil === null || meilleur < SEUIL_ROUTAGE) {
    return SALUTATION.test(norm) || AIDE.test(norm) ? { type: "aide" } : { type: "inconnu" };
  }
  return parametrer(outil, message, options);
}

function parametrer(
  outil: OutilCopilote,
  message: string,
  options: OptionsRoutage,
): RoutageCopilote {
  switch (outil) {
    case "creer_tache": {
      const t = extraireTache(message, options.aujourdhui);
      if (t.echeance_invalide) {
        return { type: "precision", outil, question: QUESTION_ECHEANCE_INVALIDE };
      }
      if (!t.titre) return { type: "precision", outil, question: QUESTION_TITRE_TACHE };
      return {
        type: "outil",
        choix: {
          outil,
          parametres: {
            titre: t.titre,
            ...(t.echeance ? { echeance: t.echeance } : {}),
            ...(t.pour ? { pour: t.pour } : {}),
            ...(t.mission ? { mission: t.mission } : {}),
          },
        },
      };
    }
    case "recherche": {
      const texte = extraireTexteRecherche(message);
      if (!texte) return { type: "precision", outil, question: QUESTION_RECHERCHE };
      return { type: "outil", choix: { outil, parametres: { texte } } };
    }
    case "resume_mission": {
      const mission = extraireNomMission(message);
      return {
        type: "outil",
        choix: { outil, parametres: mission ? { mission } : {} },
      };
    }
    default:
      return { type: "outil", choix: { outil, parametres: {} } as ChoixCopilote };
  }
}
