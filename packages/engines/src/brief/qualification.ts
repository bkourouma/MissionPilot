import { ecartJours } from "../planning/dates";
import {
  ErreurBrief,
  FAMILLE_DU_TYPE,
  type CandidatBrief,
  type ElementBrief,
  type GraviteBrief,
  type TypeElementBrief,
} from "./types";

/*
 * Qualification d'un fait du brief : l'élément existe-t-il, avec quelle gravité et quelle
 * ancienneté, et quel libellé. Toutes les valeurs ci-dessous sont PROVISOIRES (« à valider » par
 * le métier, DECISIONS.md) : elles se changent ici, jamais dans l'API ni dans l'interface.
 */

/** Éléments servis par famille. */
export const LIMITE_PAR_FAMILLE_BRIEF = 10;
/** Plafond accepté pour `limite_par_famille`. */
export const LIMITE_PAR_FAMILLE_BRIEF_MAX = 50;

/** Ce qui attend (décision, envoi) : jours d'attente à partir desquels la gravité monte. */
export const SEUILS_ATTENTE_BRIEF = { moyenne: 3, haute: 7 } as const;
/** Échéance dépassée (jalon, tâche, feuille, questionnaire) : jours de retard. */
export const SEUILS_RETARD_BRIEF = { moyenne: 3, haute: 14 } as const;
/**
 * Facture échue : relances à J+15 et J+30, alerte à l'associé à J+45 (PRD complémentaire §8.2).
 */
export const SEUILS_RETARD_FACTURE_BRIEF = { moyenne: 15, haute: 45 } as const;
/** Atterrissage au-delà du budget de 5 % : alerte (PRD complémentaire §8.2) ; au-delà de 15 % : haute. */
export const SEUIL_ATTERRISSAGE_BRIEF_PCT = 5;
export const SEUIL_ATTERRISSAGE_ELEVE_BRIEF_PCT = 15;

/** Gravité plancher d'un type : une décision qui bloque autre chose n'est jamais « basse ». */
export const GRAVITE_PLANCHER_BRIEF: Readonly<Partial<Record<TypeElementBrief, GraviteBrief>>> = {
  facture_a_approuver: "moyenne",
  derogation_a_accorder: "moyenne",
  cloture_en_attente: "moyenne",
  relance_prete: "moyenne",
};

/** Motifs d'un voyant rouge repris dans l'élément (les plus graves d'abord). */
export const MOTIFS_VOYANT_BRIEF_MAX = 5;

export const LIBELLES_TYPE_BRIEF: Readonly<Record<TypeElementBrief, string>> = {
  facture_a_approuver: "Facture à approuver",
  debours_a_valider: "Débours à valider",
  feuille_a_valider: "Feuille de temps à valider",
  conge_a_valider: "Demande de congé à valider",
  proposition_a_valider: "Proposition à valider",
  notation_a_publier: "Notation à publier",
  livrable_a_relire: "Livrable à relire",
  livrable_a_signer: "Livrable à signer",
  derogation_a_accorder: "Dérogation à accorder",
  piece_a_examiner: "Pièce du client à examiner",
  brouillon_automatisation: "Brouillon d'automatisation à décider",
  retour_a_valider: "Retour d'expérience à valider",
  cloture_en_attente: "Clôture de mission en attente",
  offre_technique_a_valider: "Offre technique à valider",
  plan_a_valider: "Plan stratégique à valider",
  revision_budget_a_valider: "Révision de budget à valider",
  kpi_rouge: "KPI au rouge",
  kpi_orange_consecutif: "KPI à l'orange deux périodes de suite",
  atterrissage_depasse: "Atterrissage au-delà du budget",
  facture_echue: "Facture échue",
  jalon_en_retard: "Jalon en retard",
  tache_en_retard: "Tâche en retard",
  feuille_non_soumise: "Feuille de temps non soumise",
  questionnaire_sans_reponse: "Questionnaire sans réponse",
  voyant_rouge: "Voyant de redressement au rouge",
  proposition_a_envoyer: "Proposition validée à envoyer",
  facture_a_emettre: "Facture approuvée à émettre",
  facture_a_envoyer: "Facture émise à envoyer",
  relance_prete: "Relance de facture prête",
  demande_salle_a_envoyer: "Demande de pièces prête à envoyer",
  livrable_signe: "Livrable signé à transmettre",
};

const LONGUEUR_MAX_LIBELLE = 200;

const RANG_GRAVITE: Readonly<Record<GraviteBrief, number>> = { haute: 3, moyenne: 2, basse: 1 };

/** Rang numérique d'une gravité (haute = 3) : sert au tri. */
export function rangGravite(gravite: GraviteBrief): number {
  return RANG_GRAVITE[gravite];
}

function plusGrave(a: GraviteBrief, b: GraviteBrief): GraviteBrief {
  return RANG_GRAVITE[a] >= RANG_GRAVITE[b] ? a : b;
}

/** Gravité d'une durée (jours d'attente ou de retard) selon des seuils croissants. */
export function graviteSelonSeuils(
  jours: number,
  seuils: { readonly moyenne: number; readonly haute: number },
): GraviteBrief {
  if (jours >= seuils.haute) return "haute";
  if (jours >= seuils.moyenne) return "moyenne";
  return "basse";
}

/** Entier de centièmes (les jours du suivi ont au plus deux décimales) : comparaisons exactes. */
function centiemes(jours: number): number {
  return Math.round(jours * 100);
}

function pluriel(n: number, mot: string): string {
  return `${n} ${mot}${n > 1 ? "s" : ""}`;
}

/** Pourcentage à une décimale, virgule française. */
function pourcentage(valeur: number): string {
  return String(valeur).replace(".", ",");
}

function tronquer(texte: string): string {
  return texte.length <= LONGUEUR_MAX_LIBELLE
    ? texte
    : `${texte.slice(0, LONGUEUR_MAX_LIBELLE - 1)}…`;
}

function libelleDe(type: TypeElementBrief, entite: string | null, suite = ""): string {
  const base = LIBELLES_TYPE_BRIEF[type];
  return tronquer(`${entite ? `${base} : ${entite}` : base}${suite}`);
}

interface Qualifie {
  type: TypeElementBrief;
  gravite: GraviteBrief;
  anciennete_jours: number;
  suite?: string;
  ecart_pct?: number;
  motifs?: readonly string[];
}

function qualifierAttente(c: CandidatBrief, depuis: string | null, ref: string): Qualifie {
  const anciennete = depuis === null ? 0 : Math.max(0, ecartJours(depuis, ref));
  return {
    type: c.type,
    gravite: graviteSelonSeuils(anciennete, SEUILS_ATTENTE_BRIEF),
    anciennete_jours: anciennete,
  };
}

function qualifierRetard(c: CandidatBrief, echeance: string, ref: string): Qualifie | null {
  const retard = ecartJours(echeance, ref);
  if (retard <= 0) return null;
  const seuils = c.type === "facture_echue" ? SEUILS_RETARD_FACTURE_BRIEF : SEUILS_RETARD_BRIEF;
  return {
    type: c.type,
    gravite: graviteSelonSeuils(retard, seuils),
    anciennete_jours: retard,
    suite: ` (${pluriel(retard, "jour")} de retard)`,
  };
}

/** KPI : rouge sur la dernière période close, ou orange sur les deux dernières. */
function qualifierKpi(
  statuts: readonly string[],
  depuis: string | null,
  ref: string,
): Qualifie | null {
  const anciennete = depuis === null ? 0 : Math.max(0, ecartJours(depuis, ref));
  if (statuts[0] === "rouge") {
    return { type: "kpi_rouge", gravite: "haute", anciennete_jours: anciennete };
  }
  if (statuts[0] === "orange" && statuts[1] === "orange") {
    return { type: "kpi_orange_consecutif", gravite: "moyenne", anciennete_jours: anciennete };
  }
  return null;
}

/** Atterrissage : au-delà de 5 % du budget en jours ; budget nul : non évaluable, pas d'élément. */
function qualifierAtterrissage(budget: number, atterrissage: number): Qualifie | null {
  const b = centiemes(budget);
  const a = centiemes(atterrissage);
  if (!(b > 0) || !(a >= 0)) return null;
  if (a * 100 <= b * (100 + SEUIL_ATTERRISSAGE_BRIEF_PCT)) return null;
  const ecart = Math.round(((a - b) / b) * 1000) / 10;
  return {
    type: "atterrissage_depasse",
    gravite: a * 100 > b * (100 + SEUIL_ATTERRISSAGE_ELEVE_BRIEF_PCT) ? "haute" : "moyenne",
    anciennete_jours: 0,
    suite: ` (+${pourcentage(ecart)} %)`,
    ecart_pct: ecart,
  };
}

/** Voyant de redressement : seul le rouge fait un élément, toujours de gravité haute. */
function qualifierVoyant(
  voyant: string,
  motifs: readonly string[],
  depuis: string | null,
  ref: string,
): Qualifie | null {
  if (voyant !== "rouge") return null;
  const retenus = motifs
    .map((m) => tronquer(m.trim()))
    .filter((m) => m.length > 0)
    .slice(0, MOTIFS_VOYANT_BRIEF_MAX);
  return {
    type: "voyant_rouge",
    gravite: "haute",
    anciennete_jours: depuis === null ? 0 : Math.max(0, ecartJours(depuis, ref)),
    motifs: retenus,
  };
}

function qualifier(c: CandidatBrief, ref: string): Qualifie | null {
  const f = c.faits;
  switch (f.nature) {
    case "attente":
      return qualifierAttente(c, f.depuis, ref);
    case "retard":
      return qualifierRetard(c, f.echeance, ref);
    case "kpi":
      return qualifierKpi(f.statuts, f.depuis, ref);
    case "atterrissage":
      return qualifierAtterrissage(f.jours_budget, f.jours_atterrissage);
    case "voyant":
      return qualifierVoyant(f.voyant, f.motifs, f.depuis, ref);
  }
}

/** Nature de faits attendue pour chaque type (contrôle de cohérence de l'entrée). */
const NATURES_PAR_TYPE: Readonly<Record<string, string>> = {
  kpi_rouge: "kpi",
  kpi_orange_consecutif: "kpi",
  atterrissage_depasse: "atterrissage",
  facture_echue: "retard",
  jalon_en_retard: "retard",
  tache_en_retard: "retard",
  feuille_non_soumise: "retard",
  questionnaire_sans_reponse: "retard",
  voyant_rouge: "voyant",
};

/** Contrôle la cohérence d'un candidat ; lève `ErreurBrief` sinon. */
export function controlerCandidat(c: CandidatBrief): void {
  if (!(c.type in FAMILLE_DU_TYPE)) {
    throw new ErreurBrief("ENTREE_INVALIDE", `Type d'élément inconnu : ${String(c.type)}.`);
  }
  const attendue = NATURES_PAR_TYPE[c.type] ?? "attente";
  if (c.faits.nature !== attendue) {
    throw new ErreurBrief(
      "ENTREE_INVALIDE",
      `Un élément « ${c.type} » porte des faits de nature « ${attendue} », pas « ${c.faits.nature} ».`,
    );
  }
  if (c.entite_id.length === 0 || c.lien.length === 0) {
    throw new ErreurBrief("ENTREE_INVALIDE", "Un élément porte un identifiant et un lien.");
  }
}

/**
 * Qualifie un candidat à la date de référence : null si le fait ne mérite pas d'élément (échéance
 * non dépassée, KPI qui ne dérive pas, atterrissage dans le budget à 5 % près).
 */
export function qualifierCandidat(c: CandidatBrief, dateReference: string): ElementBrief | null {
  controlerCandidat(c);
  const q = qualifier(c, dateReference);
  if (!q) return null;
  const plancher = GRAVITE_PLANCHER_BRIEF[q.type];
  return {
    type: q.type,
    famille: FAMILLE_DU_TYPE[q.type],
    libelle: libelleDe(q.type, c.entite_libelle, q.suite),
    entite_id: c.entite_id,
    mission_id: c.mission_id,
    mission_libelle: c.mission_libelle,
    lien: c.lien,
    gravite: plancher ? plusGrave(q.gravite, plancher) : q.gravite,
    anciennete_jours: q.anciennete_jours,
    ...(q.ecart_pct === undefined ? {} : { ecart_pct: q.ecart_pct }),
    ...(q.motifs === undefined ? {} : { motifs: q.motifs }),
    ...(c.montant === undefined ? {} : { montant: c.montant }),
    ...(c.devise === undefined ? {} : { devise: c.devise }),
  };
}
