/**
 * Saisie des hypothèses du modèle financier (PLA-06) : état du formulaire (textes saisis),
 * lecture à la française, contrôles de forme en français et construction du corps attendu par
 * `POST /api/plans/:id/modeles` (et `/simulation`). Logique pure, testée dans
 * `plan-hypotheses.test.ts`.
 *
 * Ces fonctions CONVERTISSENT une saisie (unités usuelles → unités mineures de la devise du
 * plan, « 12,5 » → 12.5) ; elles ne calculent aucun chiffre. Le moteur reste seul juge des
 * bornes : il refuse toute hypothèse hors limites (400 avec un code), jamais corrigée en
 * silence. Conventions du moteur : taux en points (25 pour 25 %), délais en jours d'une année
 * de 360 jours, une hypothèse annuelle vaut une seule valeur ou exactement « horizon » valeurs.
 *
 * L'horizon et la devise ne se saisissent pas : ceux du plan, fixés à sa création, s'imposent.
 */
import { aideMontant, lireMontant, lireNombre, montantVersSaisie, type Resultat } from "./saisie";
import type { Devise } from "./format";
import type {
  EcartsScenario,
  EcartsScenarios,
  HypothesesEnregistrees,
  HypothesesSaisies,
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

// --- Lecture et contrôles de forme ------------------------------------------------------------

type Erreurs = Record<string, string>;

export const MESSAGE_REQUIS = "Champ obligatoire.";
export const MESSAGE_NOMBRE = "Nombre attendu (ex. 12,5).";
export const MESSAGE_ENTIER = "Nombre entier attendu.";

interface BornesTaux {
  requis?: boolean;
  min?: number;
  max?: number;
  /** La borne basse est exclue (croissance > −100 %). */
  minExclu?: boolean;
}

function messageBornes(b: BornesTaux): string {
  const n = (v: number) => v.toLocaleString("fr-FR");
  if (b.min !== undefined && b.max !== undefined && !b.minExclu) {
    return `Nombre attendu entre ${n(b.min)} et ${n(b.max)}.`;
  }
  const parties: string[] = [];
  if (b.min !== undefined)
    parties.push(b.minExclu ? `supérieur à ${n(b.min)}` : `d'au moins ${n(b.min)}`);
  if (b.max !== undefined) parties.push(`d'au plus ${n(b.max)}`);
  return `Nombre attendu ${parties.join(" et ")}.`;
}

/** Nombre décimal (taux en points, ETP, jours) ; `undefined` si vide et facultatif. */
function lireTaux(v: string, cle: string, err: Erreurs, b: BornesTaux = {}): number | undefined {
  const n = lireNombre(v);
  if (n === null) {
    if (b.requis) err[cle] = MESSAGE_REQUIS;
    return undefined;
  }
  if (Number.isNaN(n)) {
    err[cle] = MESSAGE_NOMBRE;
    return undefined;
  }
  const tropBas = b.min !== undefined && (b.minExclu ? n <= b.min : n < b.min);
  const tropHaut = b.max !== undefined && n > b.max;
  if (tropBas || tropHaut) {
    err[cle] = messageBornes(b);
    return undefined;
  }
  return n;
}

function lireEntier(
  v: string,
  cle: string,
  err: Erreurs,
  b: { requis?: boolean; min: number; max: number },
): number | undefined {
  const n = lireNombre(v);
  if (n === null) {
    if (b.requis) err[cle] = MESSAGE_REQUIS;
    return undefined;
  }
  if (Number.isNaN(n) || !Number.isInteger(n)) {
    err[cle] = MESSAGE_ENTIER;
    return undefined;
  }
  if (n < b.min || n > b.max) {
    err[cle] = `Nombre entier de ${b.min} à ${b.max} attendu.`;
    return undefined;
  }
  return n;
}

/** Montant saisi, signé si besoin (« -1 500 ») → unités mineures ; NaN si illisible. */
export function lireMontantSigne(v: string, devise: Devise): number | null {
  const t = v.trim();
  const negatif = /^[-−]/.test(t);
  const n = lireMontant(negatif ? t.slice(1) : t, devise);
  if (n === null) return negatif ? Number.NaN : null;
  if (Number.isNaN(n)) return n;
  return negatif && n !== 0 ? -n : n;
}

function lireMontantChamp(
  v: string,
  cle: string,
  err: Erreurs,
  devise: Devise,
  o: { requis?: boolean; signe?: boolean; strict?: boolean } = {},
): number | undefined {
  const n = o.signe ? lireMontantSigne(v, devise) : lireMontant(v, devise);
  if (n === null) {
    if (o.requis) err[cle] = MESSAGE_REQUIS;
    return undefined;
  }
  if (Number.isNaN(n)) {
    err[cle] = `Montant invalide${o.signe ? "" : " ou négatif"}. ${aideMontant(devise)}`;
    return undefined;
  }
  if (o.strict && n <= 0) {
    err[cle] = "Montant strictement positif attendu.";
    return undefined;
  }
  return n;
}

/** Hypothèse annuelle : une valeur, ou une valeur par année (toutes renseignées). */
function lireParAnnee(
  p: SaisieParAnnee,
  cle: string,
  err: Erreurs,
  horizon: number,
  lire: (v: string, cle: string, requis: boolean) => number | undefined,
  requis: boolean,
): ParAnnee | undefined {
  if (p.mode === "unique") return lire(p.unique, cle, requis);
  const cases = Array.from({ length: horizon }, (_, i) => p.annees[i] ?? "");
  if (cases.every((c) => c.trim() === "")) {
    if (requis) err[cle] = MESSAGE_REQUIS;
    return undefined;
  }
  const valeurs = cases.map((c, i) => {
    if (c.trim() === "") {
      err[`${cle}.${i}`] = "Renseignez chaque année, ou choisissez une valeur unique.";
      return undefined;
    }
    return lire(c, `${cle}.${i}`, true);
  });
  return valeurs.every((v): v is number => v !== undefined) ? valeurs : undefined;
}

function lireLibelle(v: string, cle: string, err: Erreurs): string {
  const t = v.trim();
  if (t === "") err[cle] = MESSAGE_REQUIS;
  else if (t.length > LIBELLE_LIBRE_MAX) err[cle] = `${LIBELLE_LIBRE_MAX} caractères au plus.`;
  return t;
}

// --- Construction du corps --------------------------------------------------------------------

interface ContexteSaisie {
  horizon: number;
  devise: Devise;
}

function lireActivite(s: SaisieHypotheses, err: Erreurs, c: ContexteSaisie) {
  const taux = (b: BornesTaux) => (v: string, cle: string, requis: boolean) =>
    lireTaux(v, cle, err, { ...b, requis });
  const montant = (v: string, cle: string, requis: boolean) =>
    lireMontantChamp(v, cle, err, c.devise, { requis });
  return {
    premierExercice: lireEntier(s.premierExercice, "premierExercice", err, {
      requis: true,
      min: 1900,
      max: 2200,
    }),
    chiffreAffairesReference: lireMontantChamp(s.caReference, "caReference", err, c.devise, {
      requis: true,
    }),
    croissanceChiffreAffaires: lireParAnnee(
      s.croissance,
      "croissance",
      err,
      c.horizon,
      taux({ min: -100, minExclu: true, max: 1000 }),
      true,
    ),
    tauxMargeBrute: lireParAnnee(
      s.marge,
      "marge",
      err,
      c.horizon,
      taux({ min: 0, max: 100 }),
      true,
    ),
    tauxChargesVariables: lireParAnnee(
      s.variables,
      "variables",
      err,
      c.horizon,
      taux({ min: 0, max: 100 }),
      false,
    ),
    chargesFixes: lireParAnnee(s.fixes, "fixes", err, c.horizon, montant, false),
  };
}

function lireEffectifs(s: SaisieHypotheses, err: Erreurs, c: ContexteSaisie) {
  if (s.effectifs.length > EFFECTIFS_MAX) err.effectifs = `${EFFECTIFS_MAX} catégories au plus.`;
  return s.effectifs.map((e, i) => {
    const k = `effectifs.${i}`;
    const revalorisation = lireTaux(e.revalorisation, `${k}.revalorisation`, err, {
      min: -100,
      minExclu: true,
      max: 100,
    });
    return {
      libelle: lireLibelle(e.libelle, `${k}.libelle`, err),
      effectifs: lireParAnnee(
        e.effectifs,
        `${k}.effectifs`,
        err,
        c.horizon,
        (v, cle, requis) => lireTaux(v, cle, err, { requis, min: 0, max: 1_000_000 }),
        true,
      ),
      salaireAnnuelBrut: lireMontantChamp(e.salaire, `${k}.salaire`, err, c.devise, {
        requis: true,
      }),
      // Obligatoire : un coût du personnel sans charges sociales serait sous-estimé.
      tauxChargesSociales: lireTaux(e.chargesSociales, `${k}.chargesSociales`, err, {
        requis: true,
        min: 0,
        max: 100,
      }),
      ...(revalorisation === undefined ? {} : { revalorisationAnnuelle: revalorisation }),
    };
  });
}

function lireInvestissements(s: SaisieHypotheses, err: Erreurs, c: ContexteSaisie) {
  if (s.investissements.length > INVESTISSEMENTS_MAX) {
    err.investissements = `${INVESTISSEMENTS_MAX} investissements au plus.`;
  }
  return s.investissements.map((x, i) => {
    const k = `investissements.${i}`;
    return {
      libelle: lireLibelle(x.libelle, `${k}.libelle`, err),
      annee: lireEntier(x.annee, `${k}.annee`, err, { requis: true, min: 1, max: c.horizon }),
      montant: lireMontantChamp(x.montant, `${k}.montant`, err, c.devise, {
        requis: true,
        strict: true,
      }),
      dureeAmortissement: lireEntier(x.duree, `${k}.duree`, err, {
        requis: true,
        min: 1,
        max: 100,
      }),
    };
  });
}

function lireEmprunts(s: SaisieHypotheses, err: Erreurs, c: ContexteSaisie) {
  if (s.emprunts.length > EMPRUNTS_MAX) err.emprunts = `${EMPRUNTS_MAX} emprunts au plus.`;
  return s.emprunts.map((x, i) => {
    const k = `emprunts.${i}`;
    const duree = lireEntier(x.duree, `${k}.duree`, err, { requis: true, min: 1, max: 50 });
    const differe = lireEntier(x.differe, `${k}.differe`, err, { min: 0, max: 49 });
    if (differe !== undefined && duree !== undefined && differe >= duree) {
      err[`${k}.differe`] = "Le différé doit rester inférieur à la durée de l'emprunt.";
    }
    return {
      libelle: lireLibelle(x.libelle, `${k}.libelle`, err),
      anneeDeblocage: lireEntier(x.annee, `${k}.annee`, err, {
        requis: true,
        min: 0,
        max: c.horizon,
      }),
      montant: lireMontantChamp(x.montant, `${k}.montant`, err, c.devise, {
        requis: true,
        strict: true,
      }),
      tauxAnnuel: lireTaux(x.taux, `${k}.taux`, err, { requis: true, min: 0, max: 100 }),
      duree,
      ...(differe === undefined ? {} : { differe }),
      mode: x.mode,
    };
  });
}

function lireApports(s: SaisieHypotheses, err: Erreurs, c: ContexteSaisie) {
  if (s.apports.length > APPORTS_MAX) err.apports = `${APPORTS_MAX} augmentations au plus.`;
  return s.apports.map((x, i) => ({
    annee: lireEntier(x.annee, `apports.${i}.annee`, err, { requis: true, min: 1, max: c.horizon }),
    montant: lireMontantChamp(x.montant, `apports.${i}.montant`, err, c.devise, {
      requis: true,
      strict: true,
    }),
  }));
}

function lireOuverture(s: SaisieHypotheses, err: Erreurs, c: ContexteSaisie) {
  const o: Partial<Record<CleOuverture, number>> = {};
  for (const k of CLES_OUVERTURE) {
    const cle = `ouverture.${k}`;
    const nature = CHAMPS_OUVERTURE[k].nature;
    const v =
      nature === "duree"
        ? lireEntier(s.ouverture[k], cle, err, { min: 1, max: 100 })
        : lireMontantChamp(s.ouverture[k], cle, err, c.devise, { signe: nature !== "montant" });
    if (v !== undefined) o[k] = v;
  }
  return o;
}

function lireEcarts(e: SaisieEcarts, prefixe: string, err: Erreurs): EcartsScenario {
  const lire = (v: string, cle: string, b: BornesTaux = {}) =>
    lireTaux(v, `${prefixe}.${cle}`, err, b);
  const r: EcartsScenario = {
    croissanceChiffreAffaires: lire(e.croissance, "croissance"),
    tauxMargeBrute: lire(e.marge, "marge"),
    tauxChargesVariables: lire(e.variables, "variables"),
    chargesFixes: lire(e.fixes, "fixes", { min: -100, minExclu: true }),
    delaiClientsJours: lire(e.delaiClients, "delaiClients"),
  };
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as EcartsScenario;
}

/** Retire les clés indéfinies (facultatives non saisies) d'un objet. */
function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export interface ChargeHypotheses {
  hypotheses: HypothesesSaisies;
  ecarts: EcartsScenarios;
}

/**
 * Contrôle la forme de la saisie et construit `{ hypotheses, ecarts }`. Clés d'erreur :
 * « caReference », « croissance.2 », « effectifs.0.chargesSociales », « ouverture.capital »…
 */
export function validerHypotheses(
  s: SaisieHypotheses,
  c: ContexteSaisie,
): Resultat<ChargeHypotheses> {
  const err: Erreurs = {};
  const activite = lireActivite(s, err, c);
  const effectifs = lireEffectifs(s, err, c);
  const investissements = lireInvestissements(s, err, c);
  const emprunts = lireEmprunts(s, err, c);
  const apports = lireApports(s, err, c);
  const bornes = { min: 0, max: 720 };
  const jours = (p: SaisieParAnnee, cle: string) =>
    lireParAnnee(
      p,
      cle,
      err,
      c.horizon,
      (v, k, r) => lireTaux(v, k, err, { ...bornes, requis: r }),
      false,
    );
  const reste = {
    delaiClientsJours: jours(s.delaiClients, "delaiClients"),
    delaiFournisseursJours: jours(s.delaiFournisseurs, "delaiFournisseurs"),
    stocksJours: jours(s.stocks, "stocks"),
    tauxImpotSocietes: lireTaux(s.tauxIS, "tauxIS", err, { requis: true, min: 0, max: 100 }),
    tauxDistributionDividendes: lireTaux(s.tauxDividendes, "tauxDividendes", err, {
      min: 0,
      max: 100,
    }),
    tauxActualisation: lireTaux(s.tauxActualisation, "tauxActualisation", err, {
      requis: true,
      min: -100,
      minExclu: true,
      max: 1000,
    }),
  };
  const ouverture = lireOuverture(s, err, c);
  const ecarts = {
    optimiste: lireEcarts(s.optimiste, "optimiste", err),
    pessimiste: lireEcarts(s.pessimiste, "pessimiste", err),
  };
  if (Object.keys(err).length > 0) return { ok: false, erreurs: err };
  const hypotheses = compact({
    ...activite,
    ...(effectifs.length ? { effectifs } : {}),
    ...(investissements.length ? { investissements } : {}),
    ...(emprunts.length ? { emprunts } : {}),
    ...(apports.length ? { augmentationsCapital: apports } : {}),
    ...reste,
    ...(Object.keys(ouverture).length ? { bilanOuverture: ouverture } : {}),
  }) as unknown as HypothesesSaisies;
  return { ok: true, charge: { hypotheses, ecarts } };
}

/** Commentaire facultatif d'une version enregistrée. */
export function validerCommentaire(v: string): Resultat<{ commentaire?: string }, "commentaire"> {
  const t = v.trim();
  if (t.length > COMMENTAIRE_MAX) {
    return { ok: false, erreurs: { commentaire: `${COMMENTAIRE_MAX} caractères au plus.` } };
  }
  return { ok: true, charge: t === "" ? {} : { commentaire: t } };
}

/**
 * Millésimes des années de l'horizon d'après le premier exercice saisi (libellés « Année 1
 * (2027) ») ; null pour chaque année tant que la saisie n'est pas une année valide.
 */
export function exercicesSaisis(premierExercice: string, horizon: number): (number | null)[] {
  const n = lireNombre(premierExercice);
  const valide = n !== null && Number.isInteger(n) && n >= 1900 && n <= 2200;
  return Array.from({ length: horizon }, (_, i) => (valide ? (n as number) + i : null));
}

/** Options d'année du plan (investissement, apport : 1 à l'horizon ; emprunt : dès 0). */
export function optionsAnnees(
  horizon: number,
  exercices: readonly (number | null)[],
  avecOuverture = false,
): { valeur: string; libelle: string }[] {
  const annees = Array.from({ length: horizon }, (_, i) => ({
    valeur: String(i + 1),
    libelle: `Année ${i + 1}${exercices[i] ? ` (${exercices[i]})` : ""}`,
  }));
  return avecOuverture
    ? [{ valeur: "0", libelle: "Année 0 : déjà en cours à l'ouverture" }, ...annees]
    : annees;
}

/** Réunit deux validations : charges fusionnées, ou toutes les erreurs des deux. */
export function fusionnerResultats<A, B>(a: Resultat<A>, b: Resultat<B>): Resultat<A & B> {
  if (a.ok && b.ok) return { ok: true, charge: { ...a.charge, ...b.charge } };
  return { ok: false, erreurs: { ...(a.ok ? {} : a.erreurs), ...(b.ok ? {} : b.erreurs) } };
}

/** Nombre de champs en erreur (annoncé en tête du formulaire). */
export function nombreErreurs(erreurs: Partial<Record<string, string>>): number {
  return Object.values(erreurs).filter(Boolean).length;
}
