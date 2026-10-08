/**
 * Indicateurs de pilotage du cabinet (PRD, table « Indicateurs de pilotage du cabinet ») :
 * logique d'affichage pure, testée dans `indicateurs.test.ts`.
 *
 * AUCUN indicateur n'est calculé ici : chaque valeur vient de `GET /api/indicateurs/cabinet`
 * (moteurs de `@missionpilot/engines`). Ce module choisit le libellé, la mise en forme et le
 * statut d'affichage (comparaison de la valeur servie à des seuils de lecture). Les champs
 * financiers sont ABSENTS de la réponse sans le droit requis : ils restent absents ici.
 */
import {
  INDICATEURS_MAX_JOURS,
  NIVEAUX_INDICATEURS,
  type NiveauIndicateurs,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import {
  formaterJours,
  formaterMontantMineur,
  formaterNombre,
  formaterPourcentage,
  VALEUR_ABSENTE,
  type Devise,
} from "./format";
import { aujourdhui, debutDuMois, lirePeriode, type Periode } from "./periode";

// --- Contrat de l'API ----------------------------------------------------------------------

/** Ratio « réussis / attendus » des moteurs (taux `null` si rien d'attendu). */
export interface Ratio {
  reussis: number;
  attendus: number;
  taux: number | null;
}

export interface VueCharge {
  jours_disponibles: number;
  jours_affectes: number;
  taux_occupation: number | null;
  jours_facturables: number;
  taux_facturabilite: number | null;
  discipline_saisie: Ratio;
}

export interface VueMarge {
  honoraires: number;
  couts_internes: number;
  debours_non_refactures: number;
  sous_traitance: number;
  marge: number;
  taux_marge: number | null;
}

export interface VueMissions {
  nombre_missions: number;
  jours_budget: number;
  jours_realises: number;
  jours_atterrissage: number;
  consommation_budgetaire: number | null;
  ecart_terminaison: { jours: number; relatif_jours: number | null; couts_production?: number };
  respect_jalons: Ratio;
  /** Avec « finance.lire » seulement. */
  marge?: VueMarge;
  taux_realisation?: number | null;
  encours?: { encours_production: number; facture_d_avance: number };
  /** Avec « budget.lire_montants » ou « finance.lire ». */
  carnet_commandes?: number;
  /**
   * Avec « budget.lire_montants » : carnet fondé sur les honoraires facturés (signé − facturé),
   * servi à qui n'a pas « finance.lire » (la valeur produite repose sur des taux internes).
   */
  carnet_commandes_facture?: number;
}

export const LIBELLE_CARNET_PRODUIT =
  "Honoraires signés non encore produits (missions non clôturées)";
export const LIBELLE_CARNET_FACTURE =
  "Carnet fondé sur les honoraires facturés : signé moins déjà facturé";

/**
 * Carnet de commandes à afficher : celui fondé sur la production (finance.lire), sinon celui
 * fondé sur les honoraires facturés, avec un libellé qui dit lequel. `null` si aucun n'est servi.
 */
export function lireCarnet(
  v: Pick<VueMissions, "carnet_commandes" | "carnet_commandes_facture">,
): { valeur: number; libelle: string; base: "produit" | "facture" } | null {
  if (typeof v.carnet_commandes === "number")
    return { valeur: v.carnet_commandes, libelle: LIBELLE_CARNET_PRODUIT, base: "produit" };
  if (typeof v.carnet_commandes_facture === "number")
    return { valeur: v.carnet_commandes_facture, libelle: LIBELLE_CARNET_FACTURE, base: "facture" };
  return null;
}

export interface IndicateursCabinet extends VueCharge, VueMissions {
  delai_moyen_encaissement: number | null;
  factures_soldees: number;
}

export interface ElementMission extends VueMissions {
  mission_id: string;
  intitule: string;
  client_id: string;
  directeur_id: string | null;
  devise_mission: Devise;
}

export interface ElementAssocie extends VueMissions {
  directeur_id: string | null;
  nom: string;
}

export interface ElementCollaborateur extends VueCharge {
  collaborateur_id: string;
  nom: string;
  grade_code: string | null;
}

export interface ElementGrade extends VueCharge {
  grade_code: string | null;
  grade_libelle: string;
  nombre_collaborateurs: number;
}

export interface ElementClient {
  client_id: string;
  raison_sociale: string;
  nombre_missions: number;
  delai_moyen_encaissement: number | null;
  factures_soldees: number;
  marge?: VueMarge;
}

export interface ReponseIndicateurs {
  du: string;
  au: string;
  date_reference: string;
  niveau: NiveauIndicateurs;
  devise: Devise;
  droits: { finance: boolean; montants: boolean };
  cabinet: IndicateursCabinet;
  elements: unknown[];
  missions_exclues?: string[];
}

// --- Définitions (PRD) ---------------------------------------------------------------------

export type IdIndicateur =
  | "occupation"
  | "facturabilite"
  | "consommation"
  | "ecart"
  | "marge"
  | "realisation"
  | "encours"
  | "delai"
  | "carnet"
  | "jalons"
  | "discipline";

/** Droit qui conditionne la présence de l'indicateur dans la réponse. */
export type DroitIndicateur = "finance" | "montants" | null;

export interface DefinitionIndicateur {
  id: IdIndicateur;
  libelle: string;
  definition: string;
  niveaux: string;
  frequence: string;
  droit: DroitIndicateur;
}

export const DEFINITIONS: readonly DefinitionIndicateur[] = [
  {
    id: "occupation",
    libelle: "Taux d'occupation",
    definition: "Jours affectés / jours disponibles",
    niveaux: "Collaborateur, grade, cabinet",
    frequence: "Hebdomadaire",
    droit: null,
  },
  {
    id: "facturabilite",
    libelle: "Taux de facturabilité",
    definition: "Jours facturables réalisés / jours disponibles",
    niveaux: "Collaborateur, grade, cabinet",
    frequence: "Mensuelle",
    droit: null,
  },
  {
    id: "consommation",
    libelle: "Consommation budgétaire",
    definition: "Jours réalisés / jours budgétés",
    niveaux: "Tâche, phase, mission",
    frequence: "Hebdomadaire",
    droit: null,
  },
  {
    id: "ecart",
    libelle: "Écart à terminaison",
    definition: "Atterrissage − budget, en jours et en FCFA",
    niveaux: "Mission, portefeuille d'un directeur",
    frequence: "Hebdomadaire",
    droit: null,
  },
  {
    id: "marge",
    libelle: "Marge de mission",
    definition:
      "(Honoraires − coûts internes − débours non refacturés − sous-traitance) / honoraires",
    niveaux: "Mission, client, type, associé",
    frequence: "Mensuelle",
    droit: "finance",
  },
  {
    id: "realisation",
    libelle: "Taux de réalisation",
    definition: "Honoraires facturés / valeur des temps au taux standard",
    niveaux: "Mission, associé",
    frequence: "À la clôture",
    droit: "finance",
  },
  {
    id: "encours",
    libelle: "Encours de production",
    definition: "Valeur des temps réalisés non encore facturés",
    niveaux: "Mission, cabinet",
    frequence: "Mensuelle",
    droit: "finance",
  },
  {
    id: "delai",
    libelle: "Délai moyen d'encaissement",
    definition: "Jours entre émission et encaissement des factures",
    niveaux: "Client, cabinet",
    frequence: "Mensuelle",
    droit: null,
  },
  {
    id: "carnet",
    libelle: "Carnet de commandes",
    definition: "Honoraires signés restant à produire",
    niveaux: "Cabinet, associé",
    frequence: "Mensuelle",
    droit: "montants",
  },
  {
    id: "jalons",
    libelle: "Respect des jalons",
    definition: "Jalons tenus / jalons prévus",
    niveaux: "Mission",
    frequence: "Mensuelle",
    droit: null,
  },
  {
    id: "discipline",
    libelle: "Discipline de saisie",
    definition: "Feuilles de temps soumises dans les délais / feuilles attendues",
    niveaux: "Collaborateur, équipe",
    frequence: "Hebdomadaire",
    droit: null,
  },
];

export const MESSAGE_RESERVE = "Réservé aux associés et gestionnaires.";

// --- Seuils de lecture ---------------------------------------------------------------------

/**
 * Seuils d'AFFICHAGE (valeurs de départ, à valider par le cabinet) : ils classent une valeur
 * servie par l'API, ils ne la calculent pas. Occupation : seuils du plan de charge (moteur,
 * surcharge > 100 %, sous-occupation < 50 %) ; écart à terminaison : alerte du parcours C
 * (atterrissage au-delà du budget de 5 %).
 */
export const SEUILS = {
  occupation: { surcharge: 1, sousOccupation: 0.5 },
  facturabilite: { bon: 0.7, faible: 0.5 },
  consommation: { vigilance: 0.9, depasse: 1 },
  ecart: { alerte: 0.05 },
  marge: { bonne: 0.2 },
  realisation: { bon: 0.95, faible: 0.85 },
  delai: { bon: 45, long: 90 },
  ratio: { bon: 0.9, faible: 0.75 },
} as const;

export interface StatutAffiche {
  tonalite: TonaliteStatut;
  libelle: string;
}

const SANS_VALEUR: StatutAffiche = { tonalite: "neutre", libelle: "Pas de donnée sur la période" };
const INFORMATION: StatutAffiche = { tonalite: "neutre", libelle: "Pour information" };

const estNombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parPalier(
  v: number | null | undefined,
  bon: number,
  faible: number,
  libelles: [string, string, string],
): StatutAffiche {
  if (!estNombre(v)) return SANS_VALEUR;
  if (v >= bon) return { tonalite: "succes", libelle: libelles[0] };
  if (v >= faible) return { tonalite: "attention", libelle: libelles[1] };
  return { tonalite: "danger", libelle: libelles[2] };
}

export function statutOccupation(v: number | null | undefined): StatutAffiche {
  if (!estNombre(v)) return SANS_VALEUR;
  if (v > SEUILS.occupation.surcharge) return { tonalite: "danger", libelle: "Surcharge" };
  if (v < SEUILS.occupation.sousOccupation)
    return { tonalite: "attention", libelle: "Sous-occupation" };
  return { tonalite: "succes", libelle: "Charge normale" };
}

export function statutConsommation(v: number | null | undefined): StatutAffiche {
  if (!estNombre(v)) return SANS_VALEUR;
  if (v > SEUILS.consommation.depasse) return { tonalite: "danger", libelle: "Budget dépassé" };
  if (v >= SEUILS.consommation.vigilance)
    return { tonalite: "attention", libelle: "Proche du budget" };
  return { tonalite: "succes", libelle: "Dans le budget" };
}

/** Écart relatif (atterrissage − budget) / budget : positif = dépassement. */
export function statutEcart(relatif: number | null | undefined, jours?: number): StatutAffiche {
  if (!estNombre(relatif)) {
    if (estNombre(jours) && jours > 0) return { tonalite: "danger", libelle: "Dépassement" };
    return SANS_VALEUR;
  }
  if (relatif > SEUILS.ecart.alerte)
    return { tonalite: "danger", libelle: "Dérive au-delà de 5 %" };
  if (relatif > 0) return { tonalite: "attention", libelle: "Léger dépassement" };
  return { tonalite: "succes", libelle: "Dans le budget" };
}

/**
 * `marge` (montant servi par l'API) départage un taux absent : sans honoraires facturés, des
 * coûts engagés donnent une marge négative, pas une absence de donnée.
 */
export function statutMarge(taux: number | null | undefined, marge?: number): StatutAffiche {
  if (!estNombre(taux)) {
    if (estNombre(marge) && marge < 0)
      return { tonalite: "danger", libelle: "Coûts sans honoraires facturés" };
    return SANS_VALEUR;
  }
  if (taux < 0) return { tonalite: "danger", libelle: "Marge négative" };
  if (taux < SEUILS.marge.bonne) return { tonalite: "attention", libelle: "Marge faible" };
  return { tonalite: "succes", libelle: "Marge satisfaisante" };
}

export function statutDelai(jours: number | null | undefined): StatutAffiche {
  if (!estNombre(jours)) return SANS_VALEUR;
  if (jours <= SEUILS.delai.bon) return { tonalite: "succes", libelle: "Encaissement rapide" };
  if (jours <= SEUILS.delai.long) return { tonalite: "attention", libelle: "Encaissement lent" };
  return { tonalite: "danger", libelle: "Encaissement très lent" };
}

export const statutFacturabilite = (v: number | null | undefined) =>
  parPalier(v, SEUILS.facturabilite.bon, SEUILS.facturabilite.faible, [
    "Bonne facturabilité",
    "Facturabilité moyenne",
    "Facturabilité faible",
  ]);

export const statutRealisation = (v: number | null | undefined) =>
  parPalier(v, SEUILS.realisation.bon, SEUILS.realisation.faible, [
    "Bonne réalisation",
    "Réalisation à surveiller",
    "Réalisation faible",
  ]);

export const statutRatio = (r: Ratio | undefined) =>
  parPalier(r?.taux, SEUILS.ratio.bon, SEUILS.ratio.faible, [
    "Bon niveau",
    "À surveiller",
    "Insuffisant",
  ]);

// --- Valeurs affichées ---------------------------------------------------------------------

export interface IndicateurAffiche {
  definition: DefinitionIndicateur;
  /** `false` : champ absent de la réponse (droit manquant) ; rien n'est affiché. */
  present: boolean;
  valeur: string;
  detail: string | null;
  statut: StatutAffiche | null;
}

/** « 12 / 15 » d'un ratio des moteurs. */
export const detailRatio = (r: Ratio) =>
  r.attendus === 0 ? "Rien d'attendu sur la période" : `${r.reussis} sur ${r.attendus}`;

/** « +3 j (+12 %) » : signe affiché, valeurs de l'API. */
export function formaterEcartJours(jours: number, relatif: number | null): string {
  const signe = jours > 0 ? "+" : jours < 0 ? "−" : "";
  const j = `${signe}${formaterJours(Math.abs(jours))}`;
  if (relatif === null) return j;
  const sr = relatif > 0 ? "+" : relatif < 0 ? "−" : "";
  return `${j} (${sr}${formaterPourcentage(Math.abs(relatif))})`;
}

export function formaterDelai(jours: number | null | undefined): string {
  return estNombre(jours) ? formaterNombre(jours, 1) + " j" : VALEUR_ABSENTE;
}

const absent = (definition: DefinitionIndicateur): IndicateurAffiche => ({
  definition,
  present: false,
  valeur: "",
  detail: null,
  statut: null,
});

function valeur(
  id: IdIndicateur,
  c: IndicateursCabinet,
  devise: Devise,
): Omit<IndicateurAffiche, "definition" | "present"> | null {
  switch (id) {
    case "occupation":
      return {
        valeur: formaterPourcentage(c.taux_occupation),
        detail: `${formaterJours(c.jours_affectes)} affectés sur ${formaterJours(c.jours_disponibles)} disponibles`,
        statut: statutOccupation(c.taux_occupation),
      };
    case "facturabilite":
      return {
        valeur: formaterPourcentage(c.taux_facturabilite),
        detail: `${formaterJours(c.jours_facturables)} facturables sur ${formaterJours(c.jours_disponibles)} disponibles`,
        statut: statutFacturabilite(c.taux_facturabilite),
      };
    case "consommation":
      return {
        valeur: formaterPourcentage(c.consommation_budgetaire),
        detail: `${formaterJours(c.jours_realises)} réalisés sur ${formaterJours(c.jours_budget)} budgétés`,
        statut: statutConsommation(c.consommation_budgetaire),
      };
    case "ecart": {
      const e = c.ecart_terminaison;
      return {
        valeur: formaterEcartJours(e.jours, e.relatif_jours),
        detail:
          e.couts_production === undefined
            ? `Atterrissage ${formaterJours(c.jours_atterrissage)} pour ${formaterJours(c.jours_budget)} budgétés`
            : `En coûts de production : ${formaterMontantMineur(e.couts_production, devise)}`,
        statut: statutEcart(e.relatif_jours, e.jours),
      };
    }
    case "marge":
      if (!c.marge) return null;
      return {
        valeur: formaterPourcentage(c.marge.taux_marge),
        detail: `Marge ${formaterMontantMineur(c.marge.marge, devise)} sur ${formaterMontantMineur(c.marge.honoraires, devise)} d'honoraires`,
        statut: statutMarge(c.marge.taux_marge, c.marge.marge),
      };
    case "realisation":
      if (c.taux_realisation === undefined) return null;
      return {
        valeur: formaterPourcentage(c.taux_realisation),
        detail: "Cumul jusqu'à la fin de la période",
        statut: statutRealisation(c.taux_realisation),
      };
    case "encours":
      if (!c.encours) return null;
      return {
        valeur: formaterMontantMineur(c.encours.encours_production, devise),
        detail: `Facturé d'avance : ${formaterMontantMineur(c.encours.facture_d_avance, devise)}`,
        statut: INFORMATION,
      };
    case "delai":
      return {
        valeur: formaterDelai(c.delai_moyen_encaissement),
        detail:
          c.factures_soldees === 0
            ? "Aucune facture soldée sur la période"
            : `${c.factures_soldees} facture${c.factures_soldees > 1 ? "s" : ""} soldée${c.factures_soldees > 1 ? "s" : ""} sur la période`,
        statut: statutDelai(c.delai_moyen_encaissement),
      };
    case "carnet": {
      const carnet = lireCarnet(c);
      if (carnet === null) return null;
      return {
        valeur: formaterMontantMineur(carnet.valeur, devise),
        detail: carnet.libelle,
        statut: INFORMATION,
      };
    }
    case "jalons":
      return {
        valeur: formaterPourcentage(c.respect_jalons.taux),
        detail: detailRatio(c.respect_jalons),
        statut: statutRatio(c.respect_jalons),
      };
    case "discipline":
      return {
        valeur: formaterPourcentage(c.discipline_saisie.taux),
        detail: detailRatio(c.discipline_saisie),
        statut: statutRatio(c.discipline_saisie),
      };
  }
}

/** Les onze indicateurs du cabinet, dans l'ordre du PRD ; un champ absent reste absent. */
export function indicateursAffiches(r: ReponseIndicateurs): IndicateurAffiche[] {
  return DEFINITIONS.map((d) => {
    const v = valeur(d.id, r.cabinet, r.devise);
    return v === null ? absent(d) : { definition: d, present: true, ...v };
  });
}

// --- Alertes de dérive (parcours C) --------------------------------------------------------

export interface AlerteDerive {
  mission_id: string;
  intitule: string;
  ecart_jours: number;
  ecart_relatif: number | null;
  jours_budget: number;
  jours_atterrissage: number;
  statut: StatutAffiche;
}

/**
 * Missions dont l'atterrissage (servi par l'API) dépasse le budget, les plus fortes dérives
 * d'abord. Lecture d'une réponse de niveau « mission ».
 */
export function alertesDerive(elements: readonly ElementMission[]): AlerteDerive[] {
  return elements
    .filter((m) => m.ecart_terminaison.jours > 0)
    .map((m) => ({
      mission_id: m.mission_id,
      intitule: m.intitule,
      ecart_jours: m.ecart_terminaison.jours,
      ecart_relatif: m.ecart_terminaison.relatif_jours,
      jours_budget: m.jours_budget,
      jours_atterrissage: m.jours_atterrissage,
      statut: statutEcart(m.ecart_terminaison.relatif_jours, m.ecart_terminaison.jours),
    }))
    .sort(
      (a, b) =>
        (b.ecart_relatif ?? Number.POSITIVE_INFINITY) -
          (a.ecart_relatif ?? Number.POSITIVE_INFINITY) || b.ecart_jours - a.ecart_jours,
    );
}

// --- Filtres -------------------------------------------------------------------------------

/** Niveaux de lecture proposés à l'écran (PRD : cabinet, associé/directeur, grade, collaborateur). */
export const NIVEAU_LIBELLES: Record<NiveauIndicateurs, string> = {
  cabinet: "Cabinet",
  associe: "Associé ou directeur de mission",
  grade: "Grade",
  collaborateur: "Collaborateur",
  mission: "Mission",
  client: "Client",
};

export const OPTIONS_NIVEAUX = NIVEAUX_INDICATEURS.map((n) => ({
  valeur: n,
  libelle: NIVEAU_LIBELLES[n],
}));

export interface FiltresIndicateurs extends Periode {
  niveau: NiveauIndicateurs;
  corrigee: boolean;
}

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Période par défaut : du début du mois à aujourd'hui (revue de fin de mois du parcours C). */
export function periodeParDefaut(jour: string = aujourdhui()): Periode {
  return { du: debutDuMois(jour), au: jour };
}

export function lireFiltresIndicateurs(
  p: Record<string, string | string[] | undefined>,
  jour: string = aujourdhui(),
): FiltresIndicateurs {
  const n = un(p.niveau);
  const periode = lirePeriode(p, periodeParDefaut(jour), INDICATEURS_MAX_JOURS);
  return {
    ...periode,
    niveau: (NIVEAUX_INDICATEURS as readonly string[]).includes(n)
      ? (n as NiveauIndicateurs)
      : "cabinet",
  };
}

export function requeteIndicateurs(f: Periode & { niveau: NiveauIndicateurs }): string {
  return new URLSearchParams({ du: f.du, au: f.au, niveau: f.niveau }).toString();
}
