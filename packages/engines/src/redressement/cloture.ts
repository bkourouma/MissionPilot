/**
 * Bilan de clôture du redressement (RED-08, lot 2) : compare l'état du dossier à l'OUVERTURE et à
 * la FIN, à partir de résultats DÉJÀ CALCULÉS par les autres moteurs du service (ratios, score
 * d'alerte, urgence, trésorerie, plan, créanciers, covenants, check-lists, notation publiée). Ce
 * moteur n'y recalcule rien : il ne fait que des écarts, des totaux, des comptes et des
 * proportions, en entiers (points de base : 10 000 = 1 ; notes en dixièmes de point).
 *
 * Trois sorties pures :
 * - `construireBilanCloture` : le contenu du bilan (sections, valeurs, variations signées) et la
 *   liste des CONTRÔLES DE COMPLÉTUDE qui décide si la validation est possible ;
 * - `comparerReNotation` : écart de score et changement de classe entre la première et la
 *   dernière version PUBLIÉE de la notation de la mission (relues telles que stockées) ;
 * - les listes fermées (contrôles, sens des ratios) que l'API et le web recopient.
 *
 * Les clés du contenu sont en snake_case : le contenu est stocké tel quel (jsonb) et relu par le
 * schéma partagé. Une « évolution » est un constat arithmétique sur un écart, jamais une
 * qualification juridique de la situation du client. Aucune horloge : la date de référence est un
 * paramètre. Aucun nombre à virgule flottante dans un résultat.
 */
import type { DateISO } from "../commun/dates";
import { diviserArrondi } from "../finance/calcul-exact";
import type { Devise } from "../finance/monnaie";
import type { Classe } from "../notation/classes";
import type { NiveauAlerte } from "./alerte";
import { exigerEntier, jourDe, PB, rapportPb, versNombreSur } from "./commun";
import type { StatutAccord } from "./creanciers";
import { ErreurRedressement } from "./erreurs";
import { evaluerPlanRedressement, type ActionPlan } from "./plan";
import { CLES_RATIO_REDRESSEMENT, type CleRatioRedressement, type RatiosExercice } from "./ratios";
import type { VoyantUrgence } from "./urgence";

/** Version du contenu du bilan (un changement de forme ou de règle l'incrémente). */
export const VERSION_BILAN_CLOTURE = 1;

/** Plafonds des listes d'entrée (le bilan reste borné). */
export const CLOTURE_CREANCIERS_MAX = 200;
export const CLOTURE_CHECKLISTS_MAX = 30;
export const CLOTURE_ACTIONS_MAX = 1000;

const MONTANT_MAX = Number.MAX_SAFE_INTEGER;

export type EvolutionCloture = "amelioration" | "degradation" | "stable" | "non_comparable";

/** Sens d'amélioration d'un ratio : « haut » = plus c'est haut, mieux c'est. */
export const SENS_RATIO_CLOTURE: Readonly<Record<CleRatioRedressement, "haut" | "bas">> = {
  liquidite_generale: "haut",
  liquidite_reduite: "haut",
  liquidite_immediate: "haut",
  autonomie_financiere: "haut",
  solvabilite_generale: "haut",
  endettement: "bas",
  marge_brute: "haut",
  marge_nette: "haut",
  couverture_charges_financieres: "haut",
  bfr_jours: "bas",
};

/* ----- Contrôles de complétude ----- */

export interface DefinitionControleCloture {
  readonly code: string;
  readonly libelle: string;
  /** Bloquant : tant qu'il n'est pas satisfait, le bilan ne se valide pas. */
  readonly bloquant: boolean;
}

export const CONTROLES_CLOTURE: readonly DefinitionControleCloture[] = [
  {
    code: "ratios_fin",
    libelle: "Au moins un exercice financier accepté (état de fin)",
    bloquant: true,
  },
  { code: "alerte_fin", libelle: "Un score d'alerte calculé (état de fin)", bloquant: true },
  {
    code: "urgence_fin",
    libelle: "Une évaluation d'urgence enregistrée (état de fin)",
    bloquant: true,
  },
  {
    code: "tresorerie_fin",
    libelle: "Une prévision de trésorerie à 13 semaines (état de fin)",
    bloquant: true,
  },
  { code: "plan_present", libelle: "Un plan avec au moins une action", bloquant: true },
  {
    code: "causes_validees",
    libelle: "Une cartographie des causes racines validée par un consultant",
    bloquant: true,
  },
  {
    code: "ouverture_comparable",
    libelle: "Un état d'ouverture distinct de l'état de fin (ratios, alerte, urgence)",
    bloquant: false,
  },
  { code: "creanciers_saisis", libelle: "Des créanciers renseignés", bloquant: false },
  { code: "checklists_saisies", libelle: "Des check-lists renseignées", bloquant: false },
  { code: "covenants_definis", libelle: "Des covenants définis", bloquant: false },
  {
    code: "notation_comparable",
    libelle: "Deux versions publiées de la notation de la mission",
    bloquant: false,
  },
];

export interface ControleCloture extends DefinitionControleCloture {
  readonly satisfait: boolean;
}

/* ----- Entrées ----- */

export interface ScoreAlerteCloture {
  /** Entier 0..100 ; null si le niveau est « insuffisant ». */
  readonly score: number | null;
  readonly niveau: NiveauAlerte;
  readonly dateReference: DateISO;
}

export interface UrgenceCloture {
  readonly voyant: VoyantUrgence;
  readonly domainesRouges: number;
}

export interface TresorerieCloture {
  /** Nombre de semaines de tension de la projection. */
  readonly semainesTension: number;
  readonly premiereSemaineTension: number | null;
  readonly besoinFinancement: number;
  readonly soldeMinimum: number;
}

export interface CreancierCloture {
  readonly encoursInitial: number;
  readonly encoursRestant: number;
  readonly echu: number;
  /** Remise convenue par l'accord ; 0 sans accord. */
  readonly remise: number;
  readonly totalPaye: number;
  readonly statutAccord: StatutAccord | null;
}

export interface ChecklistCloture {
  readonly completudePb: number | null;
  readonly conformitePb: number | null;
}

export interface NotationPublieeCloture {
  readonly numero: number;
  /** Note sur 100 telle que stockée (une décimale) ; null si la version n'est pas notable. */
  readonly score: number | null;
  readonly classe: Classe | null;
}

export interface EntreesBilanCloture {
  readonly dateReference: DateISO;
  readonly devise: Devise;
  readonly ratios: { ouverture: RatiosExercice | null; fin: RatiosExercice | null };
  readonly alerte: { ouverture: ScoreAlerteCloture | null; fin: ScoreAlerteCloture | null };
  readonly urgence: { ouverture: UrgenceCloture | null; fin: UrgenceCloture | null };
  readonly tresorerie: { ouverture: TresorerieCloture | null; fin: TresorerieCloture | null };
  /** Actions du plan (toutes, abandonnées comprises) et nombre d'actions de la version validée. */
  readonly plan: { actions: readonly ActionPlan[]; actionsAuPlanValide: number | null };
  readonly creanciers: readonly CreancierCloture[];
  /** Covenants en défaut de la version courante ; null si aucun covenant n'est défini. */
  readonly covenantsEnDefaut: number | null;
  readonly checklists: readonly ChecklistCloture[];
  readonly notation: {
    premiere: NotationPublieeCloture | null;
    derniere: NotationPublieeCloture | null;
  };
  /** Cartographie des causes racines validée (nombre de causes ; 0 : aucune validée). */
  readonly causes: { validee: boolean; nombre: number };
}

/* ----- Sorties ----- */

export interface LigneRatioCloture {
  readonly cle: CleRatioRedressement;
  /** Points de base, sauf le besoin en fonds de roulement (jours). */
  readonly unite: "pb" | "jours";
  readonly ouverture: number | null;
  readonly fin: number | null;
  /** fin − ouverture, signée ; null si l'un des deux n'est pas calculé. */
  readonly variation: number | null;
  readonly evolution: EvolutionCloture;
}

export interface InstantAlerteCloture {
  readonly score: number | null;
  readonly niveau: NiveauAlerte;
  readonly date_reference: string;
}

export interface SectionAlerteCloture {
  readonly ouverture: InstantAlerteCloture | null;
  readonly fin: InstantAlerteCloture | null;
  /** fin − ouverture, en points (négatif : le score a baissé) ; null si l'un manque. */
  readonly variation_points: number | null;
  readonly evolution: EvolutionCloture;
}

export interface InstantUrgenceCloture {
  readonly voyant: VoyantUrgence;
  readonly domaines_rouges: number;
}

export interface SectionUrgenceCloture {
  readonly ouverture: InstantUrgenceCloture | null;
  readonly fin: InstantUrgenceCloture | null;
  readonly variation_domaines_rouges: number | null;
  readonly evolution: EvolutionCloture;
}

export interface SyntheseTresorerieCloture {
  readonly semaines_tension: number;
  readonly premiere_semaine_tension: number | null;
  readonly besoin_financement: number;
  readonly solde_minimum: number;
}

export interface SectionTresorerieCloture {
  readonly ouverture: SyntheseTresorerieCloture | null;
  readonly fin: SyntheseTresorerieCloture | null;
  readonly variation_besoin_financement: number | null;
  readonly variation_semaines_tension: number | null;
  readonly evolution: EvolutionCloture;
}

export interface AvancementVoletCloture {
  readonly total: number;
  readonly terminees: number;
  readonly abandonnees: number;
  readonly en_retard: number;
  readonly avancement_pb: number | null;
}

export interface SectionPlanCloture {
  readonly total: number;
  readonly terminees: number;
  readonly abandonnees: number;
  readonly en_retard: number;
  /** Terminées / (total − abandonnées), points de base ; null si dénominateur nul. */
  readonly avancement_pb: number | null;
  readonly par_volet: {
    readonly quick_win: AvancementVoletCloture;
    readonly restructuration: AvancementVoletCloture;
  };
  readonly actions_au_plan_valide: number | null;
  readonly leviers: {
    readonly actions_avec_levier: number;
    /** Impacts des actions avec levier non abandonnées (retenues). */
    readonly impact_tresorerie_unique_retenu: number;
    readonly impact_resultat_annuel_retenu: number;
    /** Impacts des actions avec levier terminées (réalisées). */
    readonly impact_tresorerie_unique_realise: number;
    readonly impact_resultat_annuel_realise: number;
  };
}

export interface SectionCreanciersCloture {
  readonly nombre: number;
  readonly encours_initial: number;
  readonly encours_restant: number;
  readonly echu: number;
  readonly remises_obtenues: number;
  readonly total_paye: number;
  /** (initial − restant) / initial, signé, points de base ; null si l'encours initial est nul. */
  readonly apurement_pb: number | null;
  readonly accords: {
    readonly total: number;
    readonly respectes: number;
    readonly en_retard: number;
    readonly soldes: number;
    readonly rompus: number;
    /** Accords respectés ou soldés. */
    readonly tenus: number;
    readonly tenus_pb: number | null;
  };
}

export interface SectionChecklistsCloture {
  readonly nombre: number;
  /** Check-lists entièrement renseignées. */
  readonly completes: number;
  readonly completude_moyenne_pb: number | null;
  readonly conformite_moyenne_pb: number | null;
  readonly conformite_minimale_pb: number | null;
}

export type StatutReNotation = "compare" | "une_seule_version" | "aucune_version_publiee";
export type ChangementClasse = "amelioration" | "degradation" | "inchangee" | "non_comparable";

export interface VersionReNotation {
  readonly numero: number;
  readonly score_dixiemes: number | null;
  readonly classe: Classe | null;
}

export interface ReNotation {
  readonly statut: StatutReNotation;
  readonly premiere: VersionReNotation | null;
  readonly derniere: VersionReNotation | null;
  /** Dernière − première, en dixièmes de point, signé ; null si l'une n'a pas de note. */
  readonly ecart_dixiemes: number | null;
  readonly changement_classe: ChangementClasse;
}

export interface SyntheseBilanCloture {
  readonly ameliorations: number;
  readonly degradations: number;
  readonly stables: number;
  readonly non_comparables: number;
}

export interface BilanCloture {
  readonly version: number;
  readonly date_reference: string;
  readonly devise: Devise;
  readonly exercice_ouverture: number | null;
  readonly exercice_fin: number | null;
  readonly ratios: readonly LigneRatioCloture[];
  readonly alerte: SectionAlerteCloture;
  readonly urgence: SectionUrgenceCloture;
  readonly tresorerie: SectionTresorerieCloture;
  readonly plan: SectionPlanCloture;
  readonly creanciers: SectionCreanciersCloture;
  readonly covenants: { readonly en_defaut: number | null };
  readonly checklists: SectionChecklistsCloture;
  readonly renotation: ReNotation;
  readonly causes: { readonly validee: boolean; readonly nombre: number };
  readonly synthese: SyntheseBilanCloture;
  readonly controles: readonly ControleCloture[];
  /** Tous les contrôles bloquants sont satisfaits : le bilan peut être validé. */
  readonly complet: boolean;
}

/* ----- Outils ----- */

const invalide = (message: string): never => {
  throw new ErreurRedressement("ENTREE_INVALIDE", message);
};

const entier = (v: unknown, nom: string, min = 0, max = MONTANT_MAX): number =>
  exigerEntier(v, min, max, "ENTREE_INVALIDE", nom);

const entierOuNul = (v: number | null, nom: string, min = 0, max = MONTANT_MAX): number | null =>
  v === null ? null : entier(v, nom, min, max);

function evolutionDe(delta: number | null, sens: "haut" | "bas"): EvolutionCloture {
  if (delta === null) return "non_comparable";
  if (delta === 0) return "stable";
  return delta > 0 === (sens === "haut") ? "amelioration" : "degradation";
}

const ecart = (fin: number | null, ouverture: number | null): number | null =>
  fin === null || ouverture === null ? null : versNombreSur(BigInt(fin) - BigInt(ouverture));

const RANG_VOYANT: Readonly<Record<string, number>> = { vert: 0, orange: 1, rouge: 2 };
const RANG_NIVEAU: Readonly<Record<string, number>> = {
  faible: 0,
  modere: 1,
  eleve: 2,
  critique: 3,
};
const RANG_CLASSE: Readonly<Record<string, number>> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
const DEVISES: readonly string[] = ["XOF", "XAF", "EUR", "USD"];
const STATUTS_ACCORD: readonly string[] = ["respecte", "en_retard", "solde", "rompu"];

/** Moyenne entière arrondie (demi s'éloignant de zéro) d'une liste d'entiers ; null si vide. */
function moyenne(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  let total = 0n;
  for (const v of valeurs) total += BigInt(v);
  return versNombreSur(diviserArrondi(total, BigInt(valeurs.length)));
}

/* ----- Sections ----- */

function ligneRatio(
  cle: CleRatioRedressement,
  ouverture: RatiosExercice | null,
  fin: RatiosExercice | null,
): LigneRatioCloture {
  const valeur = (r: RatiosExercice | null): number | null => {
    const ratio = r?.ratios[cle];
    if (!ratio || ratio.statut !== "calcule" || ratio.valeur === null) return null;
    return entier(ratio.valeur, "Ratio", -MONTANT_MAX);
  };
  const o = valeur(ouverture);
  const f = valeur(fin);
  const variation = ecart(f, o);
  return {
    cle,
    unite: cle === "bfr_jours" ? "jours" : "pb",
    ouverture: o,
    fin: f,
    variation,
    evolution: evolutionDe(variation, SENS_RATIO_CLOTURE[cle]),
  };
}

function instantAlerte(s: ScoreAlerteCloture | null): InstantAlerteCloture | null {
  if (s === null) return null;
  jourDe(s.dateReference, "Date du score d'alerte");
  if (s.niveau !== "insuffisant" && !(s.niveau in RANG_NIVEAU))
    invalide("Niveau d'alerte inconnu.");
  return {
    score: entierOuNul(s.score, "Score d'alerte", 0, 100),
    niveau: s.niveau,
    date_reference: s.dateReference,
  };
}

function sectionAlerte(
  ouverture: ScoreAlerteCloture | null,
  fin: ScoreAlerteCloture | null,
): SectionAlerteCloture {
  const o = instantAlerte(ouverture);
  const f = instantAlerte(fin);
  const variation = ecart(f?.score ?? null, o?.score ?? null);
  let evolution = evolutionDe(variation, "bas");
  // Sans score des deux côtés, le niveau (faible à critique) sert de repli.
  if (variation === null && o && f && o.niveau !== "insuffisant" && f.niveau !== "insuffisant") {
    evolution = evolutionDe((RANG_NIVEAU[f.niveau] ?? 0) - (RANG_NIVEAU[o.niveau] ?? 0), "bas");
  }
  return { ouverture: o, fin: f, variation_points: variation, evolution };
}

function instantUrgence(u: UrgenceCloture | null): InstantUrgenceCloture | null {
  if (u === null) return null;
  if (u.voyant !== "non_evalue" && !(u.voyant in RANG_VOYANT)) invalide("Voyant inconnu.");
  return { voyant: u.voyant, domaines_rouges: entier(u.domainesRouges, "Domaines rouges", 0, 5) };
}

function sectionUrgence(
  ouverture: UrgenceCloture | null,
  fin: UrgenceCloture | null,
): SectionUrgenceCloture {
  const o = instantUrgence(ouverture);
  const f = instantUrgence(fin);
  const comparable =
    o !== null && f !== null && o.voyant !== "non_evalue" && f.voyant !== "non_evalue";
  return {
    ouverture: o,
    fin: f,
    variation_domaines_rouges: ecart(f?.domaines_rouges ?? null, o?.domaines_rouges ?? null),
    evolution: comparable
      ? evolutionDe((RANG_VOYANT[f.voyant] ?? 0) - (RANG_VOYANT[o.voyant] ?? 0), "bas")
      : "non_comparable",
  };
}

function syntheseTresorerie(t: TresorerieCloture | null): SyntheseTresorerieCloture | null {
  if (t === null) return null;
  return {
    semaines_tension: entier(t.semainesTension, "Semaines de tension", 0, 13),
    premiere_semaine_tension: entierOuNul(t.premiereSemaineTension, "Semaine de tension", 1, 13),
    besoin_financement: entier(t.besoinFinancement, "Besoin de financement"),
    solde_minimum: entier(t.soldeMinimum, "Solde minimum", -MONTANT_MAX),
  };
}

function sectionTresorerie(
  ouverture: TresorerieCloture | null,
  fin: TresorerieCloture | null,
): SectionTresorerieCloture {
  const o = syntheseTresorerie(ouverture);
  const f = syntheseTresorerie(fin);
  const besoin = ecart(f?.besoin_financement ?? null, o?.besoin_financement ?? null);
  const semaines = ecart(f?.semaines_tension ?? null, o?.semaines_tension ?? null);
  let evolution: EvolutionCloture = "non_comparable";
  if (besoin !== null && semaines !== null) {
    evolution = evolutionDe(besoin !== 0 ? besoin : semaines, "bas");
  }
  return {
    ouverture: o,
    fin: f,
    variation_besoin_financement: besoin,
    variation_semaines_tension: semaines,
    evolution,
  };
}

function sectionPlan(
  actions: readonly ActionPlan[],
  actionsAuPlanValide: number | null,
  dateReference: DateISO,
): SectionPlanCloture {
  if (!Array.isArray(actions) || actions.length > CLOTURE_ACTIONS_MAX) {
    invalide(`Au plus ${CLOTURE_ACTIONS_MAX} actions.`);
  }
  const evaluation = evaluerPlanRedressement(actions, dateReference);
  const volets = evaluation.parVolet;
  const total = volets.quick_win.total + volets.restructuration.total;
  const terminees = volets.quick_win.terminees + volets.restructuration.terminees;
  const abandonnees = volets.quick_win.abandonnees + volets.restructuration.abandonnees;
  const vue = (v: (typeof volets)["quick_win"]): AvancementVoletCloture => ({
    total: v.total,
    terminees: v.terminees,
    abandonnees: v.abandonnees,
    en_retard: v.enRetard,
    avancement_pb: v.avancementPb,
  });
  let retenuT = 0n;
  let retenuR = 0n;
  let realiseT = 0n;
  let realiseR = 0n;
  let avecLevier = 0;
  for (const a of actions) {
    if (a.levierCode === null || a.statut === "abandonnee") continue;
    avecLevier += 1;
    retenuT += BigInt(a.impactTresorerieUnique ?? 0);
    retenuR += BigInt(a.impactResultatAnnuel ?? 0);
    if (a.statut === "terminee") {
      realiseT += BigInt(a.impactTresorerieUnique ?? 0);
      realiseR += BigInt(a.impactResultatAnnuel ?? 0);
    }
  }
  return {
    total,
    terminees,
    abandonnees,
    en_retard: evaluation.enRetard.length,
    avancement_pb:
      total - abandonnees === 0 ? null : rapportPb(BigInt(terminees), BigInt(total - abandonnees)),
    par_volet: { quick_win: vue(volets.quick_win), restructuration: vue(volets.restructuration) },
    actions_au_plan_valide: entierOuNul(actionsAuPlanValide, "Actions du plan validé", 0, 1000),
    leviers: {
      actions_avec_levier: avecLevier,
      impact_tresorerie_unique_retenu: versNombreSur(retenuT),
      impact_resultat_annuel_retenu: versNombreSur(retenuR),
      impact_tresorerie_unique_realise: versNombreSur(realiseT),
      impact_resultat_annuel_realise: versNombreSur(realiseR),
    },
  };
}

function sectionCreanciers(lignes: readonly CreancierCloture[]): SectionCreanciersCloture {
  if (!Array.isArray(lignes) || lignes.length > CLOTURE_CREANCIERS_MAX) {
    invalide(`Au plus ${CLOTURE_CREANCIERS_MAX} créanciers.`);
  }
  let initial = 0n;
  let restant = 0n;
  let echu = 0n;
  let remises = 0n;
  let paye = 0n;
  const comptes = { respecte: 0, en_retard: 0, solde: 0, rompu: 0 };
  let accords = 0;
  for (const c of lignes) {
    initial += BigInt(entier(c.encoursInitial, "Encours initial"));
    restant += BigInt(entier(c.encoursRestant, "Encours restant"));
    echu += BigInt(entier(c.echu, "Montant échu"));
    remises += BigInt(entier(c.remise, "Remise"));
    paye += BigInt(entier(c.totalPaye, "Total payé"));
    if (c.statutAccord !== null) {
      if (!STATUTS_ACCORD.includes(c.statutAccord)) invalide("Statut d'accord inconnu.");
      comptes[c.statutAccord] += 1;
      accords += 1;
    }
  }
  const tenus = comptes.respecte + comptes.solde;
  return {
    nombre: lignes.length,
    encours_initial: versNombreSur(initial),
    encours_restant: versNombreSur(restant),
    echu: versNombreSur(echu),
    remises_obtenues: versNombreSur(remises),
    total_paye: versNombreSur(paye),
    apurement_pb:
      initial === 0n ? null : versNombreSur(diviserArrondi((initial - restant) * PB, initial)),
    accords: {
      total: accords,
      respectes: comptes.respecte,
      en_retard: comptes.en_retard,
      soldes: comptes.solde,
      rompus: comptes.rompu,
      tenus,
      tenus_pb: accords === 0 ? null : rapportPb(BigInt(tenus), BigInt(accords)),
    },
  };
}

function sectionChecklists(listes: readonly ChecklistCloture[]): SectionChecklistsCloture {
  if (!Array.isArray(listes) || listes.length > CLOTURE_CHECKLISTS_MAX) {
    invalide(`Au plus ${CLOTURE_CHECKLISTS_MAX} check-lists.`);
  }
  const completudes: number[] = [];
  const conformites: number[] = [];
  let completes = 0;
  for (const c of listes) {
    const completude = entierOuNul(c.completudePb, "Complétude", 0, 10_000);
    const conformite = entierOuNul(c.conformitePb, "Conformité", 0, 10_000);
    if (completude !== null) completudes.push(completude);
    if (completude === 10_000) completes += 1;
    if (conformite !== null) conformites.push(conformite);
  }
  return {
    nombre: listes.length,
    completes,
    completude_moyenne_pb: moyenne(completudes),
    conformite_moyenne_pb: moyenne(conformites),
    conformite_minimale_pb: conformites.length === 0 ? null : Math.min(...conformites),
  };
}

/* ----- Re-notation ----- */

function lireNotation(n: NotationPublieeCloture | null): VersionReNotation | null {
  if (n === null) return null;
  entier(n.numero, "Numéro de version", 1, 100_000);
  if (n.classe !== null && !(n.classe in RANG_CLASSE)) invalide("Classe inconnue.");
  if (n.score !== null && !(Number.isFinite(n.score) && n.score >= 0 && n.score <= 100)) {
    invalide("Note entre 0 et 100 attendue.");
  }
  return {
    numero: n.numero,
    score_dixiemes: n.score === null ? null : Math.round(n.score * 10),
    classe: n.classe,
  };
}

/**
 * Compare deux résultats de notation LUS tels que stockés (première et dernière version publiée
 * de la notation de la mission) : seul l'écart est calculé, rien n'est recalculé. Une seule
 * version publiée (ou deux fois la même) : « une_seule_version », sans écart.
 */
export function comparerReNotation(
  premiere: NotationPublieeCloture | null,
  derniere: NotationPublieeCloture | null,
): ReNotation {
  const p = lireNotation(premiere);
  const d = lireNotation(derniere);
  if (p === null || d === null || p.numero === d.numero) {
    const seule = p ?? d;
    return {
      statut: seule === null ? "aucune_version_publiee" : "une_seule_version",
      premiere: seule,
      derniere: seule,
      ecart_dixiemes: null,
      changement_classe: "non_comparable",
    };
  }
  let changement: ChangementClasse = "non_comparable";
  if (p.classe !== null && d.classe !== null) {
    // Rang A = 0 : une classe qui se rapproche de A s'améliore.
    const evolution = evolutionDe(
      (RANG_CLASSE[p.classe] ?? 0) - (RANG_CLASSE[d.classe] ?? 0),
      "haut",
    );
    changement = evolution === "stable" ? "inchangee" : (evolution as ChangementClasse);
  }
  return {
    statut: "compare",
    premiere: p,
    derniere: d,
    ecart_dixiemes: ecart(d.score_dixiemes, p.score_dixiemes),
    changement_classe: changement,
  };
}

/* ----- Bilan ----- */

function synthese(evolutions: readonly EvolutionCloture[]): SyntheseBilanCloture {
  const compte = (e: EvolutionCloture) => evolutions.filter((x) => x === e).length;
  return {
    ameliorations: compte("amelioration"),
    degradations: compte("degradation"),
    stables: compte("stable"),
    non_comparables: compte("non_comparable"),
  };
}

/**
 * Construit le bilan de clôture. Lève `ENTREE_INVALIDE` ou `DATE_INVALIDE` si une entrée est mal
 * formée (jamais un écart de données : un état manquant est un contrôle non satisfait, pas une
 * erreur).
 */
export function construireBilanCloture(e: EntreesBilanCloture): BilanCloture {
  jourDe(e.dateReference, "Date de référence");
  if (!DEVISES.includes(e.devise)) invalide("Devise inconnue.");
  const causesNombre = entier(e.causes.nombre, "Causes", 0, 12);
  const ratios = CLES_RATIO_REDRESSEMENT.map((cle) =>
    ligneRatio(cle, e.ratios.ouverture, e.ratios.fin),
  );
  const alerte = sectionAlerte(e.alerte.ouverture, e.alerte.fin);
  const urgence = sectionUrgence(e.urgence.ouverture, e.urgence.fin);
  const tresorerie = sectionTresorerie(e.tresorerie.ouverture, e.tresorerie.fin);
  const plan = sectionPlan(e.plan.actions, e.plan.actionsAuPlanValide, e.dateReference);
  const creanciers = sectionCreanciers(e.creanciers);
  const checklists = sectionChecklists(e.checklists);
  const covenants = { en_defaut: entierOuNul(e.covenantsEnDefaut, "Covenants en défaut", 0, 12) };
  const renotation = comparerReNotation(e.notation.premiere, e.notation.derniere);
  const causesValidees = e.causes.validee && causesNombre > 0;

  const satisfaits: Readonly<Record<string, boolean>> = {
    ratios_fin: e.ratios.fin !== null,
    alerte_fin: e.alerte.fin !== null,
    urgence_fin: e.urgence.fin !== null,
    tresorerie_fin: e.tresorerie.fin !== null,
    plan_present: plan.total - plan.abandonnees > 0,
    causes_validees: causesValidees,
    ouverture_comparable:
      e.ratios.ouverture !== null && e.alerte.ouverture !== null && e.urgence.ouverture !== null,
    creanciers_saisis: creanciers.nombre > 0,
    checklists_saisies: checklists.nombre > 0,
    covenants_definis: covenants.en_defaut !== null,
    notation_comparable: renotation.statut === "compare",
  };
  const controles: ControleCloture[] = CONTROLES_CLOTURE.map((c) => ({
    ...c,
    satisfait: satisfaits[c.code] === true,
  }));

  return {
    version: VERSION_BILAN_CLOTURE,
    date_reference: e.dateReference,
    devise: e.devise,
    exercice_ouverture: e.ratios.ouverture?.exercice ?? null,
    exercice_fin: e.ratios.fin?.exercice ?? null,
    ratios,
    alerte,
    urgence,
    tresorerie,
    plan,
    creanciers,
    covenants,
    checklists,
    renotation,
    causes: { validee: causesValidees, nombre: causesNombre },
    synthese: synthese([
      ...ratios.map((r) => r.evolution),
      alerte.evolution,
      urgence.evolution,
      tresorerie.evolution,
    ]),
    controles,
    complet: controles.every((c) => !c.bloquant || c.satisfait),
  };
}
