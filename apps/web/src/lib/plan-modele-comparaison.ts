/** Modèle financier du plan : comparaison de versions et ROI. */
import type { Langue } from "@missionpilot/shared";
import { formaterMontantMineur, type Devise } from "./format";
import { formaterPoints } from "./plan-modele-format";
import type { RoiPlan, SerieComparee } from "./plan-modele-types";

// --- Comparaison ------------------------------------------------------------------------------

const LIBELLES_HYPOTHESES: Record<string, string> = {
  premierExercice: "Premier exercice prévisionnel",
  chiffreAffairesReference: "Chiffre d'affaires de référence",
  croissanceChiffreAffaires: "Croissance du chiffre d'affaires",
  tauxMargeBrute: "Taux de marge brute",
  tauxChargesVariables: "Charges externes variables",
  chargesFixes: "Charges externes fixes",
  effectifs: "Effectifs",
  investissements: "Investissements",
  emprunts: "Emprunts",
  augmentationsCapital: "Augmentations de capital",
  delaiClientsJours: "Délai de paiement des clients",
  delaiFournisseursJours: "Délai de paiement des fournisseurs",
  stocksJours: "Rotation des stocks",
  tauxImpotSocietes: "Taux d'impôt sur les sociétés",
  tauxDistributionDividendes: "Taux de distribution des dividendes",
  tauxActualisation: "Taux d'actualisation",
  bilanOuverture: "Bilan d'ouverture",
  horizon: "Horizon",
  devise: "Devise",
  flux: "Flux",
};

const LIBELLES_SOUS_CHAMPS: Record<string, string> = {
  libelle: "libellé",
  effectifs: "effectifs (équivalents temps plein)",
  salaireAnnuelBrut: "salaire annuel brut",
  tauxChargesSociales: "taux de charges sociales",
  revalorisationAnnuelle: "revalorisation annuelle",
  annee: "année",
  montant: "montant",
  dureeAmortissement: "durée d'amortissement",
  anneeDeblocage: "année de déblocage",
  tauxAnnuel: "taux annuel",
  duree: "durée",
  differe: "différé",
  mode: "mode de remboursement",
  immobilisationsNettes: "immobilisations nettes",
  dureeResiduelleImmobilisations: "durée résiduelle des immobilisations",
  stocks: "stocks",
  creancesClients: "créances clients",
  tresorerie: "trésorerie",
  capital: "capital",
  reserves: "réserves",
  dettesFournisseurs: "dettes fournisseurs",
  deficitsReportables: "déficits reportables",
  croissanceChiffreAffaires: "croissance du chiffre d'affaires",
  tauxMargeBrute: "taux de marge brute",
  tauxChargesVariables: "charges variables",
  chargesFixes: "charges fixes",
  delaiClientsJours: "délai clients",
};

const ELEMENTS_LISTE: Record<string, string> = {
  effectifs: "catégorie",
  investissements: "investissement",
  emprunts: "emprunt",
  augmentationsCapital: "augmentation",
  flux: "année",
};

const LIBELLES_HYPOTHESES_EN: Record<string, string> = {
  premierExercice: "First forecast year",
  chiffreAffairesReference: "Reference revenue",
  croissanceChiffreAffaires: "Revenue growth",
  tauxMargeBrute: "Gross margin rate",
  tauxChargesVariables: "Variable external expenses",
  chargesFixes: "Fixed external expenses",
  effectifs: "Headcount",
  investissements: "Investments",
  emprunts: "Loans",
  augmentationsCapital: "Capital increases",
  delaiClientsJours: "Customer payment terms",
  delaiFournisseursJours: "Supplier payment terms",
  stocksJours: "Inventory turnover",
  tauxImpotSocietes: "Corporate tax rate",
  tauxDistributionDividendes: "Dividend payout rate",
  tauxActualisation: "Discount rate",
  bilanOuverture: "Opening balance sheet",
  horizon: "Horizon",
  devise: "Currency",
  flux: "Cash flows",
};

const LIBELLES_SOUS_CHAMPS_EN: Record<string, string> = {
  libelle: "label",
  effectifs: "headcount (full-time equivalents)",
  salaireAnnuelBrut: "gross annual salary",
  tauxChargesSociales: "payroll tax rate",
  revalorisationAnnuelle: "annual raise",
  annee: "year",
  montant: "amount",
  dureeAmortissement: "depreciation period",
  anneeDeblocage: "disbursement year",
  tauxAnnuel: "annual rate",
  duree: "term",
  differe: "deferral",
  mode: "repayment mode",
  immobilisationsNettes: "net fixed assets",
  dureeResiduelleImmobilisations: "remaining life of fixed assets",
  stocks: "inventory",
  creancesClients: "trade receivables",
  tresorerie: "cash",
  capital: "capital",
  reserves: "reserves",
  dettesFournisseurs: "trade payables",
  deficitsReportables: "tax loss carryforwards",
  croissanceChiffreAffaires: "revenue growth",
  tauxMargeBrute: "gross margin rate",
  tauxChargesVariables: "variable expenses",
  chargesFixes: "fixed expenses",
  delaiClientsJours: "customer payment terms",
};

const ELEMENTS_LISTE_EN: Record<string, string> = {
  effectifs: "category",
  investissements: "investment",
  emprunts: "loan",
  augmentationsCapital: "increase",
  flux: "year",
};

const SEGMENT = /^([A-Za-z]+)(?:\[(\d+)\])?$/;

function rang(index: string | undefined): number | null {
  return index === undefined ? null : Number(index) + 1;
}

/** Chemin d'hypothèse du moteur → libellé français (« effectifs[0].tauxChargesSociales »). */
export function libelleChemin(chemin: string, langue: Langue = "fr"): string {
  const en = langue === "en";
  const LIB_HYP = en ? LIBELLES_HYPOTHESES_EN : LIBELLES_HYPOTHESES;
  const LIB_SOUS = en ? LIBELLES_SOUS_CHAMPS_EN : LIBELLES_SOUS_CHAMPS;
  const ELEM = en ? ELEMENTS_LISTE_EN : ELEMENTS_LISTE;
  const motAnnee = en ? "year" : "année";
  const segments = chemin.split(".").filter((s) => s !== "");
  if (segments[0] === "ecarts") segments.shift();
  const scenario = segments[0];
  if (scenario === "optimiste" || scenario === "pessimiste") {
    const champ = segments[1] ? (LIB_SOUS[segments[1]] ?? segments[1]) : null;
    if (en) {
      return `${scenario === "optimiste" ? "Optimistic" : "Pessimistic"} scenario${champ ? `: ${champ} deviation` : ""}`;
    }
    return `Scénario ${scenario}${champ ? ` : écart de ${champ}` : ""}`;
  }
  const premier = SEGMENT.exec(segments[0] ?? "");
  if (!premier || !premier[1] || !LIB_HYP[premier[1]]) return chemin;
  const cle = premier[1];
  const n = rang(premier[2]);
  let texte = LIB_HYP[cle] as string;
  if (n !== null) {
    texte += ELEM[cle] ? `, ${ELEM[cle]} ${n}` : `, ${motAnnee} ${n}`;
  }
  const second = SEGMENT.exec(segments[1] ?? "");
  if (second && second[1]) {
    texte += `${en ? ":" : " :"} ${LIB_SOUS[second[1]] ?? second[1]}`;
    const m = rang(second[2]);
    if (m !== null) texte += `, ${motAnnee} ${m}`;
  }
  return texte;
}

const JETON_CHEMIN =
  /\b(?:ecarts\.)?(?:optimiste\.|pessimiste\.)?[a-z][A-Za-z]*(?:\[\d+\])?(?:\.[a-z][A-Za-z]*(?:\[\d+\])?)*/g;

/** Remplace les chemins d'hypothèses cités par le moteur par leur libellé français. */
export function traduireMessageMoteur(message: string, langue: Langue = "fr"): string {
  return message.replace(JETON_CHEMIN, (jeton) => {
    const technique = /[A-Z[.]/.test(jeton);
    const libelle = libelleChemin(jeton, langue);
    if (!technique || libelle === jeton) return jeton;
    return langue === "en" ? `“${libelle}”` : `« ${libelle} »`;
  });
}

/** Rangées d'une série comparée : exercice (ou « 2027 / 2028 » si les exercices diffèrent). */
export function lignesSerieComparee(
  s: SerieComparee,
  devise: Devise,
  langue: Langue = "fr",
): { exercice: string; de: string; a: string }[] {
  const n = Math.max(s.de.length, s.a.length);
  return Array.from({ length: n }, (_, i) => {
    const d = s.de[i];
    const x = s.a[i];
    const exercice =
      d && x && d.exercice !== x.exercice
        ? `${d.exercice} / ${x.exercice}`
        : String(d?.exercice ?? x?.exercice ?? "");
    return {
      exercice,
      de: formaterMontantMineur(d?.valeur, devise, langue),
      a: formaterMontantMineur(x?.valeur, devise, langue),
    };
  });
}

/** Numéro de version lu dans l'URL (`?version=3`) ; null si absent ou invalide. */
export function lireNumeroVersionModele(v: string | string[] | undefined): number | null {
  const brut = Array.isArray(v) ? v[0] : v;
  if (typeof brut !== "string" || !/^[1-9]\d{0,5}$/.test(brut)) return null;
  const n = Number(brut);
  return n <= 100000 ? n : null;
}

/** Paramètres « ?de=&a= » d'une comparaison : null si absents, erreur si invalides. */
export function lireComparaison(
  de: string | string[] | undefined,
  a: string | string[] | undefined,
  langue: Langue = "fr",
): { de: number; a: number } | { erreur: string } | null {
  const lire = (v: string | string[] | undefined) => {
    const brut = Array.isArray(v) ? v[0] : v;
    return typeof brut === "string" && /^[1-9]\d{0,5}$/.test(brut) && Number(brut) <= 100000
      ? Number(brut)
      : null;
  };
  const brutDe = Array.isArray(de) ? de[0] : de;
  const brutA = Array.isArray(a) ? a[0] : a;
  if ((brutDe === undefined || brutDe === "") && (brutA === undefined || brutA === "")) return null;
  const x = lire(de);
  const y = lire(a);
  if (x === null || y === null) {
    return {
      erreur:
        langue === "en"
          ? "Enter two version numbers (whole numbers starting at 1)."
          : "Indiquez deux numéros de version (nombres entiers à partir de 1).",
    };
  }
  if (x === y) {
    return {
      erreur:
        langue === "en"
          ? "Choose two different versions to compare."
          : "Choisissez deux versions différentes à comparer.",
    };
  }
  return { de: x, a: y };
}

// --- ROI --------------------------------------------------------------------------------------

/** Note sur le taux d'actualisation retenu pour le ROI (version du modèle ou valeur de départ). */
export function noteTauxRoi(
  r: Pick<RoiPlan, "taux_actualisation" | "source_taux" | "modele_version">,
  langue: Langue = "fr",
) {
  const taux = formaterPoints(r.taux_actualisation, langue);
  if (langue === "en") {
    return r.source_taux === "modele" && r.modele_version !== null
      ? `NPV at the discount rate of financial model version ${r.modele_version} (${taux}); year-0 cash flow (budget) is not discounted.`
      : `No financial model: NPV at the engine's starting discount rate (${taux}), to be confirmed by an expert; year-0 cash flow (budget) is not discounted.`;
  }
  return r.source_taux === "modele" && r.modele_version !== null
    ? `VAN au taux d'actualisation de la version ${r.modele_version} du modèle financier (${taux}) ; flux de l'année 0 (budget) non actualisé.`
    : `Aucun modèle financier : VAN au taux d'actualisation de départ du moteur (${taux}), à confirmer par un expert ; flux de l'année 0 (budget) non actualisé.`;
}
