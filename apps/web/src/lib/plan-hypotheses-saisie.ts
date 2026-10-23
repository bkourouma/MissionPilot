/** Saisie des hypothèses : constantes et état du formulaire (textes saisis). */
import { montantVersSaisie } from "./saisie";
import type { Devise } from "./format";
import type {
  EcartsScenario,
  EcartsScenarios,
  HypothesesEnregistrees,
  ParAnnee,
} from "./plan-modele";

/** Valeurs de départ du moteur (DECISIONS.md), à confirmer par un expert-comptable. */
export const TAUX_IS_DEFAUT = 25;
export const TAUX_ACTUALISATION_DEFAUT = 12;

/** Écarts de départ des scénarios (moteur, `ECARTS_SCENARIOS_DEFAUT`). */
export const ECARTS_DEFAUT: EcartsScenarios = {
  optimiste: { croissanceChiffreAffaires: 5, tauxMargeBrute: 2, chargesFixes: -5 },
  pessimiste: {
    croissanceChiffreAffaires: -5,
    tauxMargeBrute: -2,
    chargesFixes: 5,
    delaiClientsJours: 15,
  },
};

export const LIBELLE_LIBRE_MAX = 120;
export const COMMENTAIRE_MAX = 1000;
export const EFFECTIFS_MAX = 50;
export const INVESTISSEMENTS_MAX = 100;
export const EMPRUNTS_MAX = 30;
export const APPORTS_MAX = 20;

// --- État du formulaire -----------------------------------------------------------------------

export interface SaisieParAnnee {
  mode: "unique" | "annuel";
  unique: string;
  /** Exactement « horizon » cases. */
  annees: string[];
}

export interface SaisieEffectif {
  libelle: string;
  effectifs: SaisieParAnnee;
  salaire: string;
  chargesSociales: string;
  revalorisation: string;
}

export interface SaisieInvestissement {
  libelle: string;
  annee: string;
  montant: string;
  duree: string;
}

export type ModeEmprunt = "annuites_constantes" | "amortissement_constant";

export interface SaisieEmprunt {
  libelle: string;
  annee: string;
  montant: string;
  taux: string;
  duree: string;
  differe: string;
  mode: ModeEmprunt;
}

export interface SaisieApport {
  annee: string;
  montant: string;
}

export interface SaisieEcarts {
  croissance: string;
  marge: string;
  variables: string;
  fixes: string;
  delaiClients: string;
}

export const CLES_OUVERTURE = [
  "immobilisationsNettes",
  "dureeResiduelleImmobilisations",
  "stocks",
  "creancesClients",
  "tresorerie",
  "capital",
  "reserves",
  "dettesFournisseurs",
  "deficitsReportables",
] as const;
export type CleOuverture = (typeof CLES_OUVERTURE)[number];

/** Libellés et nature des champs du bilan d'ouverture (année 0). */
export const CHAMPS_OUVERTURE: Record<
  CleOuverture,
  { libelle: string; nature: "montant" | "montant_signe" | "duree" }
> = {
  immobilisationsNettes: { libelle: "Immobilisations nettes", nature: "montant" },
  dureeResiduelleImmobilisations: {
    libelle: "Durée d'amortissement restante (années)",
    nature: "duree",
  },
  stocks: { libelle: "Stocks", nature: "montant" },
  creancesClients: { libelle: "Créances clients", nature: "montant" },
  tresorerie: { libelle: "Trésorerie nette (négative : découvert)", nature: "montant_signe" },
  capital: { libelle: "Capital social", nature: "montant" },
  reserves: { libelle: "Réserves et report à nouveau", nature: "montant_signe" },
  dettesFournisseurs: { libelle: "Dettes fournisseurs", nature: "montant" },
  deficitsReportables: { libelle: "Déficits fiscaux reportables", nature: "montant" },
};

export interface SaisieHypotheses {
  premierExercice: string;
  caReference: string;
  croissance: SaisieParAnnee;
  marge: SaisieParAnnee;
  variables: SaisieParAnnee;
  fixes: SaisieParAnnee;
  effectifs: SaisieEffectif[];
  investissements: SaisieInvestissement[];
  emprunts: SaisieEmprunt[];
  apports: SaisieApport[];
  delaiClients: SaisieParAnnee;
  delaiFournisseurs: SaisieParAnnee;
  stocks: SaisieParAnnee;
  tauxIS: string;
  tauxDividendes: string;
  tauxActualisation: string;
  ouverture: Record<CleOuverture, string>;
  optimiste: SaisieEcarts;
  pessimiste: SaisieEcarts;
}

/** Nombre → texte modifiable à la française (12.5 → « 12,5 »). */
export function nombreVersSaisie(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(n).replace(".", ",") : "";
}

export function parAnneeVide(horizon: number): SaisieParAnnee {
  return { mode: "unique", unique: "", annees: Array.from({ length: horizon }, () => "") };
}

function parAnneeDepuis(
  v: ParAnnee | undefined,
  horizon: number,
  versTexte: (n: number) => string,
): SaisieParAnnee {
  if (typeof v === "number") return { ...parAnneeVide(horizon), unique: versTexte(v) };
  if (Array.isArray(v)) {
    return {
      mode: "annuel",
      unique: "",
      annees: Array.from({ length: horizon }, (_, i) =>
        typeof v[i] === "number" ? versTexte(v[i] as number) : "",
      ),
    };
  }
  return parAnneeVide(horizon);
}

export const effectifVide = (horizon: number): SaisieEffectif => ({
  libelle: "",
  effectifs: parAnneeVide(horizon),
  salaire: "",
  chargesSociales: "",
  revalorisation: "",
});

export const investissementVide = (): SaisieInvestissement => ({
  libelle: "",
  annee: "1",
  montant: "",
  duree: "",
});

export const empruntVide = (): SaisieEmprunt => ({
  libelle: "",
  annee: "1",
  montant: "",
  taux: "",
  duree: "",
  differe: "",
  mode: "annuites_constantes",
});

export const apportVide = (): SaisieApport => ({ annee: "1", montant: "" });

function ecartsVersSaisie(e: EcartsScenario | undefined): SaisieEcarts {
  return {
    croissance: nombreVersSaisie(e?.croissanceChiffreAffaires),
    marge: nombreVersSaisie(e?.tauxMargeBrute),
    variables: nombreVersSaisie(e?.tauxChargesVariables),
    fixes: nombreVersSaisie(e?.chargesFixes),
    delaiClients: nombreVersSaisie(e?.delaiClientsJours),
  };
}

const ouvertureVide = (): Record<CleOuverture, string> =>
  Object.fromEntries(CLES_OUVERTURE.map((k) => [k, ""])) as Record<CleOuverture, string>;

/** Formulaire vierge : IS 25 % et actualisation 12 % (valeurs de départ), écarts du moteur. */
export function saisieHypothesesInitiale(
  horizon: number,
  premierExercice: number,
): SaisieHypotheses {
  return {
    premierExercice: String(premierExercice),
    caReference: "",
    croissance: parAnneeVide(horizon),
    marge: parAnneeVide(horizon),
    variables: parAnneeVide(horizon),
    fixes: parAnneeVide(horizon),
    effectifs: [],
    investissements: [],
    emprunts: [],
    apports: [],
    delaiClients: parAnneeVide(horizon),
    delaiFournisseurs: parAnneeVide(horizon),
    stocks: parAnneeVide(horizon),
    tauxIS: String(TAUX_IS_DEFAUT),
    tauxDividendes: "",
    tauxActualisation: String(TAUX_ACTUALISATION_DEFAUT),
    ouverture: ouvertureVide(),
    optimiste: ecartsVersSaisie(ECARTS_DEFAUT.optimiste),
    pessimiste: ecartsVersSaisie(ECARTS_DEFAUT.pessimiste),
  };
}

/** Formulaire prérempli depuis une version enregistrée (pour en dériver une nouvelle). */
export function saisieDepuisHypotheses(
  h: HypothesesEnregistrees,
  ecarts: EcartsScenarios | undefined,
  devise: Devise,
  horizon: number,
): SaisieHypotheses {
  const m = (n: number) => montantVersSaisie(n, devise);
  const ouverture = ouvertureVide();
  for (const k of CLES_OUVERTURE) {
    const v = h.bilanOuverture?.[k];
    if (typeof v === "number") {
      ouverture[k] = CHAMPS_OUVERTURE[k].nature === "duree" ? String(v) : m(v);
    }
  }
  return {
    premierExercice: String(h.premierExercice),
    caReference: m(h.chiffreAffairesReference),
    croissance: parAnneeDepuis(h.croissanceChiffreAffaires, horizon, nombreVersSaisie),
    marge: parAnneeDepuis(h.tauxMargeBrute, horizon, nombreVersSaisie),
    variables: parAnneeDepuis(h.tauxChargesVariables, horizon, nombreVersSaisie),
    fixes: parAnneeDepuis(h.chargesFixes, horizon, m),
    effectifs: (h.effectifs ?? []).map((c) => ({
      libelle: c.libelle,
      effectifs: parAnneeDepuis(c.effectifs, horizon, nombreVersSaisie),
      salaire: m(c.salaireAnnuelBrut),
      chargesSociales: nombreVersSaisie(c.tauxChargesSociales),
      revalorisation: nombreVersSaisie(c.revalorisationAnnuelle),
    })),
    investissements: (h.investissements ?? []).map((i) => ({
      libelle: i.libelle,
      annee: String(i.annee),
      montant: m(i.montant),
      duree: String(i.dureeAmortissement),
    })),
    emprunts: (h.emprunts ?? []).map((e) => ({
      libelle: e.libelle,
      annee: String(e.anneeDeblocage),
      montant: m(e.montant),
      taux: nombreVersSaisie(e.tauxAnnuel),
      duree: String(e.duree),
      differe: e.differe === undefined ? "" : String(e.differe),
      mode: e.mode ?? "annuites_constantes",
    })),
    apports: (h.augmentationsCapital ?? []).map((a) => ({
      annee: String(a.annee),
      montant: m(a.montant),
    })),
    delaiClients: parAnneeDepuis(h.delaiClientsJours, horizon, nombreVersSaisie),
    delaiFournisseurs: parAnneeDepuis(h.delaiFournisseursJours, horizon, nombreVersSaisie),
    stocks: parAnneeDepuis(h.stocksJours, horizon, nombreVersSaisie),
    tauxIS: nombreVersSaisie(h.tauxImpotSocietes ?? TAUX_IS_DEFAUT),
    tauxDividendes: nombreVersSaisie(h.tauxDistributionDividendes),
    tauxActualisation: nombreVersSaisie(h.tauxActualisation ?? TAUX_ACTUALISATION_DEFAUT),
    ouverture,
    optimiste: ecartsVersSaisie(ecarts?.optimiste),
    pessimiste: ecartsVersSaisie(ecarts?.pessimiste),
  };
}
