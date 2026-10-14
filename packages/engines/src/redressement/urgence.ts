/**
 * Questionnaire d'urgence (RED-01) : grille fermée de 15 questions en 5 domaines, saisie par
 * le consultant (jamais envoyée au portail), voyants vert / orange / rouge par domaine.
 *
 * Chaque question est formulée comme un signal d'alerte : « oui » est plus grave que « non ».
 * Une réponse « inconnu » ou absente n'est jamais comptée comme « non » : elle sort du
 * dénominateur, et un domaine dont moins de la moitié du poids est répondu est « non évalué »
 * (même principe que NOT-03). Les voyants se décident sur valeurs EXACTES, pas sur le
 * pourcentage arrondi. Aucun terme juridique : le voyant est un constat de saisie.
 */
import { exigerEntier, quotientArrondi } from "./commun";
import { ErreurRedressement } from "./erreurs";

export const VERSION_GRILLE_URGENCE = 1;
export const DOMAINES_URGENCE = [
  "tresorerie",
  "activite",
  "exploitation",
  "social",
  "financement",
] as const;
export type DomaineUrgence = (typeof DOMAINES_URGENCE)[number];
export const REPONSES_URGENCE = ["non", "partiellement", "oui", "inconnu"] as const;
export type ReponseUrgence = (typeof REPONSES_URGENCE)[number];
export type VoyantUrgence = "vert" | "orange" | "rouge" | "non_evalue";

export interface QuestionUrgence {
  /** T1…T3, A1…A3, E1…E3, S1…S3, F1…F3. */
  readonly code: string;
  readonly domaine: DomaineUrgence;
  /** Français, formulée comme un signal d'alerte (« oui » = plus grave). */
  readonly libelle: string;
  /** Poids `poidsCritique` au lieu de 1. */
  readonly critique: boolean;
}

/** Grille de départ : formulations PROVISOIRES, à valider par les experts (SPEC-3a §13). */
export const GRILLE_URGENCE: readonly QuestionUrgence[] = [
  {
    code: "T1",
    domaine: "tresorerie",
    critique: true,
    libelle: "Des impôts ou des cotisations sociales sont-ils en retard de paiement ?",
  },
  {
    code: "T2",
    domaine: "tresorerie",
    critique: false,
    libelle:
      "Des chèques, prélèvements ou virements ont-ils été rejetés par la banque ces 12 derniers mois ?",
  },
  {
    code: "T3",
    domaine: "tresorerie",
    critique: false,
    libelle:
      "Des fournisseurs réclament-ils des paiements en retard, ou ont-ils durci leurs conditions (paiement comptant, livraison bloquée) ?",
  },
  {
    code: "A1",
    domaine: "activite",
    critique: true,
    libelle: "Le chiffre d'affaires a-t-il baissé de plus de 10 % par rapport à l'an dernier ?",
  },
  {
    code: "A2",
    domaine: "activite",
    critique: false,
    libelle:
      "Un client qui représente plus de 30 % du chiffre d'affaires a-t-il été perdu ou est-il menacé ?",
  },
  {
    code: "A3",
    domaine: "activite",
    critique: false,
    libelle:
      "Les marges se sont-elles nettement dégradées (prix de vente en baisse ou coûts d'achat en hausse) ?",
  },
  {
    code: "E1",
    domaine: "exploitation",
    critique: true,
    libelle:
      "L'activité est-elle ralentie ou arrêtée (rupture d'approvisionnement, panne majeure, arrêt de production) ?",
  },
  {
    code: "E2",
    domaine: "exploitation",
    critique: false,
    libelle:
      "Les stocks ou les créances clients ont-ils fortement augmenté sans hausse des ventes ?",
  },
  {
    code: "E3",
    domaine: "exploitation",
    critique: false,
    libelle:
      "Le suivi de gestion (comptabilité, tableau de bord, prix de revient) a-t-il plus de trois mois de retard ?",
  },
  {
    code: "S1",
    domaine: "social",
    critique: true,
    libelle: "Des salaires sont-ils payés en retard ou partiellement ?",
  },
  {
    code: "S2",
    domaine: "social",
    critique: false,
    libelle:
      "Des départs de cadres ou de salariés clés, ou des tensions sociales, ont-ils eu lieu ces six derniers mois ?",
  },
  {
    code: "S3",
    domaine: "social",
    critique: false,
    libelle:
      "L'entreprise dépend-elle d'une seule personne (le dirigeant ou un autre) pour ses décisions et ses relations clés ?",
  },
  {
    code: "F1",
    domaine: "financement",
    critique: true,
    libelle:
      "Un créancier a-t-il engagé une action (mise en demeure, saisie, poursuite), ou la banque a-t-elle réduit ou retiré ses lignes de crédit ?",
  },
  {
    code: "F2",
    domaine: "financement",
    critique: false,
    libelle:
      "Les capitaux propres ont-ils fondu au point d'être, ou de risquer d'être, inférieurs à la moitié du capital ?",
  },
  {
    code: "F3",
    domaine: "financement",
    critique: false,
    libelle:
      "Les associés ou dirigeants sont-ils en désaccord sur l'avenir de l'entreprise, ou les comptes ne sont-ils plus approuvés à temps ?",
  },
];

export interface ParametresUrgence {
  /** 25. */
  readonly seuilOrangePct: number;
  /** 50. */
  readonly seuilRougePct: number;
  /** 2. */
  readonly poidsCritique: number;
  /** 50. */
  readonly partMinimaleReponduePct: number;
}

/** Valeurs PROVISOIRES (conventions, sans source) : SPEC-3a §13. */
export const PARAMETRES_URGENCE_DEFAUT: ParametresUrgence = {
  seuilOrangePct: 25,
  seuilRougePct: 50,
  poidsCritique: 2,
  partMinimaleReponduePct: 50,
};

export interface ResultatDomaineUrgence {
  readonly domaine: DomaineUrgence;
  readonly voyant: VoyantUrgence;
  /** Entier 0..100 ; null si non évalué. */
  readonly pourcentage: number | null;
  /** Σ poids × points (non 0, partiellement 1, oui 2). */
  readonly pointsPonderes: number;
  /** 2 × poidsRepondu. */
  readonly pointsMaximum: number;
  readonly poidsRepondu: number;
  readonly poidsTotal: number;
  /** Réponse « inconnu ». */
  readonly inconnues: readonly string[];
  /** Question non renseignée. */
  readonly absentes: readonly string[];
}
export interface ResultatUrgence {
  /** VERSION_GRILLE_URGENCE. */
  readonly version: number;
  /** Ordre de DOMAINES_URGENCE. */
  readonly domaines: readonly ResultatDomaineUrgence[];
  /** Pire voyant des domaines évalués ; non_evalue si aucun. */
  readonly voyant: VoyantUrgence;
  readonly domainesRouges: readonly DomaineUrgence[];
  readonly domainesOranges: readonly DomaineUrgence[];
  readonly domainesNonEvalues: readonly DomaineUrgence[];
  /** Aucun domaine non évalué. */
  readonly complet: boolean;
  /** Hors « inconnu ». */
  readonly questionsRepondues: number;
  /** 15. */
  readonly questionsTotal: number;
}

/** Entiers, 0 ≤ orange ≤ rouge ≤ 100, poids critique 1..10, part minimale 1..100. */
export function validerParametresUrgence(p: ParametresUrgence): void {
  const orange = exigerEntier(p.seuilOrangePct, 0, 100, "ENTREE_INVALIDE", "Seuil orange");
  const rouge = exigerEntier(p.seuilRougePct, 0, 100, "ENTREE_INVALIDE", "Seuil rouge");
  if (orange > rouge) {
    throw new ErreurRedressement(
      "ENTREE_INVALIDE",
      "Le seuil orange ne dépasse pas le seuil rouge.",
    );
  }
  exigerEntier(p.poidsCritique, 1, 10, "ENTREE_INVALIDE", "Poids d'une question critique");
  exigerEntier(p.partMinimaleReponduePct, 1, 100, "ENTREE_INVALIDE", "Part minimale répondue");
}

const POINTS: Readonly<Record<Exclude<ReponseUrgence, "inconnu">, number>> = {
  non: 0,
  partiellement: 1,
  oui: 2,
};
const GRAVITE: Readonly<Record<VoyantUrgence, number>> = {
  non_evalue: 0,
  vert: 1,
  orange: 2,
  rouge: 3,
};

/** Évalue les réponses du consultant : voyants par domaine et voyant global. */
export function evaluerUrgence(
  reponses: Readonly<Record<string, ReponseUrgence>>,
  parametres: ParametresUrgence = PARAMETRES_URGENCE_DEFAUT,
): ResultatUrgence {
  validerParametresUrgence(parametres);
  const codes = new Set(GRILLE_URGENCE.map((q) => q.code));
  for (const [code, reponse] of Object.entries(reponses)) {
    if (!codes.has(code)) {
      throw new ErreurRedressement("QUESTION_INCONNUE", "Question inconnue dans les réponses.", [
        code,
      ]);
    }
    if (!(REPONSES_URGENCE as readonly string[]).includes(reponse)) {
      throw new ErreurRedressement("REPONSE_INVALIDE", "Réponse invalide.", [code]);
    }
  }

  const domaines: ResultatDomaineUrgence[] = DOMAINES_URGENCE.map((domaine) => {
    let poidsTotal = 0;
    let poidsRepondu = 0;
    let pointsPonderes = 0;
    const inconnues: string[] = [];
    const absentes: string[] = [];
    for (const q of GRILLE_URGENCE.filter((x) => x.domaine === domaine)) {
      const poids = q.critique ? parametres.poidsCritique : 1;
      poidsTotal += poids;
      const reponse = Object.hasOwn(reponses, q.code) ? reponses[q.code] : undefined;
      if (reponse === undefined) absentes.push(q.code);
      else if (reponse === "inconnu") inconnues.push(q.code);
      else {
        poidsRepondu += poids;
        pointsPonderes += poids * POINTS[reponse];
      }
    }
    const pointsMaximum = 2 * poidsRepondu;
    const evalue = poidsRepondu * 100 >= parametres.partMinimaleReponduePct * poidsTotal;
    let voyant: VoyantUrgence = "non_evalue";
    if (evalue) {
      if (pointsPonderes * 100 >= parametres.seuilRougePct * pointsMaximum) voyant = "rouge";
      else if (pointsPonderes * 100 >= parametres.seuilOrangePct * pointsMaximum) voyant = "orange";
      else voyant = "vert";
    }
    return {
      domaine,
      voyant,
      pourcentage: evalue
        ? Number(quotientArrondi(BigInt(100 * pointsPonderes), BigInt(pointsMaximum)))
        : null,
      pointsPonderes,
      pointsMaximum,
      poidsRepondu,
      poidsTotal,
      inconnues,
      absentes,
    };
  });

  const voyant = domaines.reduce<VoyantUrgence>(
    (pire, d) => (GRAVITE[d.voyant] > GRAVITE[pire] ? d.voyant : pire),
    "non_evalue",
  );
  return {
    version: VERSION_GRILLE_URGENCE,
    domaines,
    voyant,
    domainesRouges: domaines.filter((d) => d.voyant === "rouge").map((d) => d.domaine),
    domainesOranges: domaines.filter((d) => d.voyant === "orange").map((d) => d.domaine),
    domainesNonEvalues: domaines.filter((d) => d.voyant === "non_evalue").map((d) => d.domaine),
    complet: domaines.every((d) => d.voyant !== "non_evalue"),
    questionsRepondues: Object.values(reponses).filter((r) => r !== "inconnu").length,
    questionsTotal: GRILLE_URGENCE.length,
  };
}
