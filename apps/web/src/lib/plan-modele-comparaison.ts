/** Modèle financier du plan : comparaison de versions et ROI. */
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

const SEGMENT = /^([A-Za-z]+)(?:\[(\d+)\])?$/;

function rang(index: string | undefined): number | null {
  return index === undefined ? null : Number(index) + 1;
}

/** Chemin d'hypothèse du moteur → libellé français (« effectifs[0].tauxChargesSociales »). */
export function libelleChemin(chemin: string): string {
  const segments = chemin.split(".").filter((s) => s !== "");
  if (segments[0] === "ecarts") segments.shift();
  const scenario = segments[0];
  if (scenario === "optimiste" || scenario === "pessimiste") {
    const champ = segments[1] ? (LIBELLES_SOUS_CHAMPS[segments[1]] ?? segments[1]) : null;
    return `Scénario ${scenario}${champ ? ` : écart de ${champ}` : ""}`;
  }
  const premier = SEGMENT.exec(segments[0] ?? "");
  if (!premier || !premier[1] || !LIBELLES_HYPOTHESES[premier[1]]) return chemin;
  const cle = premier[1];
  const n = rang(premier[2]);
  let texte = LIBELLES_HYPOTHESES[cle] as string;
  if (n !== null) {
    texte += ELEMENTS_LISTE[cle] ? `, ${ELEMENTS_LISTE[cle]} ${n}` : `, année ${n}`;
  }
  const second = SEGMENT.exec(segments[1] ?? "");
  if (second && second[1]) {
    texte += ` : ${LIBELLES_SOUS_CHAMPS[second[1]] ?? second[1]}`;
    const m = rang(second[2]);
    if (m !== null) texte += `, année ${m}`;
  }
  return texte;
}

const JETON_CHEMIN =
  /\b(?:ecarts\.)?(?:optimiste\.|pessimiste\.)?[a-z][A-Za-z]*(?:\[\d+\])?(?:\.[a-z][A-Za-z]*(?:\[\d+\])?)*/g;

/** Remplace les chemins d'hypothèses cités par le moteur par leur libellé français. */
export function traduireMessageMoteur(message: string): string {
  return message.replace(JETON_CHEMIN, (jeton) => {
    const technique = /[A-Z[.]/.test(jeton);
    const libelle = libelleChemin(jeton);
    return technique && libelle !== jeton ? `« ${libelle} »` : jeton;
  });
}

/** Rangées d'une série comparée : exercice (ou « 2027 / 2028 » si les exercices diffèrent). */
export function lignesSerieComparee(
  s: SerieComparee,
  devise: Devise,
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
      de: formaterMontantMineur(d?.valeur, devise),
      a: formaterMontantMineur(x?.valeur, devise),
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
    return { erreur: "Indiquez deux numéros de version (nombres entiers à partir de 1)." };
  }
  if (x === y) return { erreur: "Choisissez deux versions différentes à comparer." };
  return { de: x, a: y };
}

// --- ROI --------------------------------------------------------------------------------------

/** Note sur le taux d'actualisation retenu pour le ROI (version du modèle ou valeur de départ). */
export function noteTauxRoi(
  r: Pick<RoiPlan, "taux_actualisation" | "source_taux" | "modele_version">,
) {
  const taux = formaterPoints(r.taux_actualisation);
  return r.source_taux === "modele" && r.modele_version !== null
    ? `VAN au taux d'actualisation de la version ${r.modele_version} du modèle financier (${taux}) ; flux de l'année 0 (budget) non actualisé.`
    : `Aucun modèle financier : VAN au taux d'actualisation de départ du moteur (${taux}), à confirmer par un expert ; flux de l'année 0 (budget) non actualisé.`;
}
