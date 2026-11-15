/**
 * Bancabilité du plan (PLA-17) : types de la réponse de l'API, mise en forme des ratios (valeurs
 * entières du moteur), libellés, chemins et messages. Logique pure, testée dans
 * `plan-bancabilite.test.ts`.
 *
 * Ratios, plan de financement et appréciation sont calculés par le moteur côté API, UNIQUEMENT
 * depuis une version VALIDÉE du modèle financier ; ici, rien n'est calculé : une valeur en
 * points de base (10 000 = 1) est seulement affichée en multiple ou en années.
 */
import {
  LOCALES_INTL,
  STATUT_RATIO_LIBELLES,
  VERDICT_BANCABILITE_LIBELLES,
  creerTraduire,
  type Langue,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import type { Devise } from "./format";
import { cheminPlan, hrefPlan } from "./plan-strategique";

export type CleRatio =
  | "couverture_service_dette"
  | "endettement"
  | "dette_nette_sur_ebe"
  | "capacite_remboursement"
  | "bfr_jours";

export const CLES_RATIOS: readonly CleRatio[] = [
  "couverture_service_dette",
  "endettement",
  "dette_nette_sur_ebe",
  "capacite_remboursement",
  "bfr_jours",
];

export type StatutRatio = keyof typeof STATUT_RATIO_LIBELLES;
export type Verdict = keyof typeof VERDICT_BANCABILITE_LIBELLES;

export interface Ratio {
  valeur: number | null;
  statut: StatutRatio;
}

export interface PlanFinancementExercice {
  exercice: number;
  ressources: {
    capacite_autofinancement: number;
    augmentations_capital: number;
    emprunts_nouveaux: number;
    diminution_bfr: number;
    total: number;
  };
  emplois: {
    investissements: number;
    augmentation_bfr: number;
    remboursements_emprunts: number;
    dividendes: number;
    total: number;
  };
  solde: number;
  solde_cumule: number;
}

export interface Bancabilite {
  plan_id: string;
  devise: Devise;
  horizon: number;
  modele: {
    version: number;
    validation: { valide_par: string; valideur_nom: string; valide_le: string } | null;
    calcule_le: string;
  };
  seuils: {
    couverture_service_dette_min_pb: number;
    endettement_max_pb: number;
    dette_nette_sur_ebe_max_pb: number;
    capacite_remboursement_max_pb: number;
    bfr_jours_max: number;
  };
  exercices: { exercice: number; ratios: Record<CleRatio, Ratio> }[];
  plan_financement: PlanFinancementExercice[];
  totaux: { ressources: number; emplois: number; solde: number };
  hors_seuil: Record<CleRatio, number[]>;
  verdict: Verdict;
}

export const LIBELLES_RATIOS: Record<CleRatio, string> = {
  couverture_service_dette: "Couverture du service de la dette",
  endettement: "Dettes financières / capitaux propres",
  dette_nette_sur_ebe: "Dette nette / EBE",
  capacite_remboursement: "Capacité de remboursement",
  bfr_jours: "BFR en jours de chiffre d'affaires",
};
export const LIBELLES_RATIOS_EN: Record<CleRatio, string> = {
  couverture_service_dette: "Debt service coverage",
  endettement: "Financial debt / equity",
  dette_nette_sur_ebe: "Net debt / EBITDA",
  capacite_remboursement: "Repayment capacity",
  bfr_jours: "Working capital in days of revenue",
};
export const libelleRatio = (cle: CleRatio, langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_RATIOS_EN : LIBELLES_RATIOS)[cle];

const STATUT_RATIO_LIBELLES_EN: Record<StatutRatio, string> = {
  conforme: "Compliant",
  hors_seuil: "Out of threshold",
  sans_objet: "Not applicable",
  non_calculable: "Not computable",
};
export const libelleStatutRatio = (s: StatutRatio, langue: Langue = "fr") =>
  (langue === "en" ? STATUT_RATIO_LIBELLES_EN : STATUT_RATIO_LIBELLES)[s];

const DECIMAL = (langue: Langue) =>
  new Intl.NumberFormat(LOCALES_INTL[langue], { maximumFractionDigits: 2 });
const ENTIER = (langue: Langue) =>
  new Intl.NumberFormat(LOCALES_INTL[langue], { maximumFractionDigits: 0 });

/** Valeur entière du moteur affichée (points de base → « 1,25 x » ou « 3,5 an(s) » ; jours). */
export function afficherRatio(cle: CleRatio, valeur: number | null, langue: Langue = "fr"): string {
  if (valeur === null) return "—";
  if (cle === "bfr_jours") return `${ENTIER(langue).format(valeur)} ${langue === "en" ? "d" : "j"}`;
  const decimal = DECIMAL(langue).format(valeur / 10_000);
  if (cle === "capacite_remboursement") return `${decimal} ${langue === "en" ? "yr(s)" : "an(s)"}`;
  return `${decimal} x`;
}

/** Cellule d'un ratio : valeur, ou statut quand il n'y en a pas (jamais remplacé par zéro). */
export function celluleRatio(cle: CleRatio, r: Ratio, langue: Langue = "fr"): string {
  return r.valeur === null
    ? libelleStatutRatio(r.statut, langue)
    : afficherRatio(cle, r.valeur, langue);
}

export const TONALITE_RATIO: Record<StatutRatio, TonaliteStatut> = {
  conforme: "succes",
  hors_seuil: "danger",
  sans_objet: "neutre",
  non_calculable: "attention",
};

const VERDICT_BANCABILITE_LIBELLES_EN: Record<Verdict, string> = {
  favorable: "Favorable",
  a_renforcer: "Needs strengthening",
  defavorable: "Unfavorable",
};
export const libelleVerdict = (v: Verdict, langue: Langue = "fr") =>
  (langue === "en" ? VERDICT_BANCABILITE_LIBELLES_EN : VERDICT_BANCABILITE_LIBELLES)[v] ?? v;

export const TONALITE_VERDICT: Record<Verdict, TonaliteStatut> = {
  favorable: "succes",
  a_renforcer: "attention",
  defavorable: "danger",
};

/** Phrase des seuils indicatifs appliqués. */
export function phraseSeuils(s: Bancabilite["seuils"], langue: Langue = "fr"): string {
  if (langue === "en") {
    return (
      `Indicative thresholds (to be calibrated with the banks): debt service coverage of at least ` +
      `${afficherRatio("couverture_service_dette", s.couverture_service_dette_min_pb, langue)}, leverage of at most ` +
      `${afficherRatio("endettement", s.endettement_max_pb, langue)}, net debt of at most ` +
      `${afficherRatio("dette_nette_sur_ebe", s.dette_nette_sur_ebe_max_pb, langue)} EBITDA, repayment in at most ` +
      `${afficherRatio("capacite_remboursement", s.capacite_remboursement_max_pb, langue)}, working capital of at most ` +
      `${afficherRatio("bfr_jours", s.bfr_jours_max, langue)} of revenue.`
    );
  }
  return (
    `Seuils indicatifs (à calibrer avec les banques) : couverture du service de la dette d'au moins ` +
    `${afficherRatio("couverture_service_dette", s.couverture_service_dette_min_pb)}, endettement d'au plus ` +
    `${afficherRatio("endettement", s.endettement_max_pb)}, dette nette d'au plus ` +
    `${afficherRatio("dette_nette_sur_ebe", s.dette_nette_sur_ebe_max_pb)} l'EBE, remboursement en ` +
    `${afficherRatio("capacite_remboursement", s.capacite_remboursement_max_pb)} au plus, BFR d'au plus ` +
    `${afficherRatio("bfr_jours", s.bfr_jours_max)} de chiffre d'affaires.`
  );
}

/** Lignes du plan de financement (libellé, sélecteur), dans l'ordre d'affichage. */
export const LIGNES_PLAN_FINANCEMENT: readonly {
  libelle: string;
  libelleEn: string;
  valeur: (p: PlanFinancementExercice) => number;
  total?: boolean;
}[] = [
  {
    libelle: "Capacité d'autofinancement",
    libelleEn: "Cash flow from operations",
    valeur: (p) => p.ressources.capacite_autofinancement,
  },
  {
    libelle: "Apports en capital",
    libelleEn: "Capital contributions",
    valeur: (p) => p.ressources.augmentations_capital,
  },
  {
    libelle: "Emprunts nouveaux",
    libelleEn: "New borrowings",
    valeur: (p) => p.ressources.emprunts_nouveaux,
  },
  {
    libelle: "Diminution du BFR",
    libelleEn: "Decrease in working capital",
    valeur: (p) => p.ressources.diminution_bfr,
  },
  {
    libelle: "Total des ressources",
    libelleEn: "Total sources",
    valeur: (p) => p.ressources.total,
    total: true,
  },
  {
    libelle: "Investissements",
    libelleEn: "Capital expenditure",
    valeur: (p) => p.emplois.investissements,
  },
  {
    libelle: "Augmentation du BFR",
    libelleEn: "Increase in working capital",
    valeur: (p) => p.emplois.augmentation_bfr,
  },
  {
    libelle: "Remboursements d'emprunts",
    libelleEn: "Loan repayments",
    valeur: (p) => p.emplois.remboursements_emprunts,
  },
  { libelle: "Dividendes", libelleEn: "Dividends", valeur: (p) => p.emplois.dividendes },
  {
    libelle: "Total des emplois",
    libelleEn: "Total uses",
    valeur: (p) => p.emplois.total,
    total: true,
  },
  {
    libelle: "Solde de l'exercice",
    libelleEn: "Balance for the year",
    valeur: (p) => p.solde,
    total: true,
  },
  {
    libelle: "Solde cumulé",
    libelleEn: "Cumulative balance",
    valeur: (p) => p.solde_cumule,
    total: true,
  },
];

/** Message français d'un refus (lecture ou génération du dossier). */
export function messageBancabilite(e: unknown, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (e instanceof ErreurApi) {
    if (e.code === "MODELE_NON_VALIDE") {
      return t(
        "La bancabilité se calcule seulement sur une version VALIDÉE du modèle financier : faites valider la version voulue dans l'onglet « Modèle financier ».",
        'Bankability is only computed on an APPROVED version of the financial model: have the version you want approved in the "Financial model" tab.',
      );
    }
    if (e.code === "TROP_DE_RAPPORTS") return e.message;
    if (e.statut === 404)
      return t(
        "Ce plan ou cette version est introuvable ou ne vous est plus accessible.",
        "This plan or version cannot be found or is no longer accessible to you.",
      );
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}

export const hrefBancabilite = (missionId: string, planId: string) =>
  `${hrefPlan(missionId, planId)}/bancabilite`;

export function cheminBancabilite(planId: string, version?: number | null): string {
  const v = typeof version === "number" && Number.isInteger(version) && version >= 1;
  return `${cheminPlan(planId)}/bancabilite${v ? `?version=${version}` : ""}`;
}

export function cheminDossierBancaire(
  planId: string,
  format: "pdf" | "docx",
  version?: number | null,
): string {
  const q = new URLSearchParams({ format });
  if (typeof version === "number" && Number.isInteger(version) && version >= 1) {
    q.set("version", String(version));
  }
  return `${cheminPlan(planId)}/dossier-bancaire?${q.toString()}`;
}
