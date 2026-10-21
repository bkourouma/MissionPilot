/**
 * Cartographie des causes racines (RED-04) : types, validation, repli déterministe et liste
 * blanche de chiffres pour la proposition de l'IA.
 *
 * L'IA PROPOSE (statut « brouillon IA »), le consultant modifie et valide : ce moteur ne fait que
 * ce qui ne doit jamais dépendre d'un modèle de langage.
 * - Une cause est un texte qualitatif rattaché à un domaine de la grille d'urgence ; son niveau de
 *   confiance est un libellé fixe, JAMAIS un nombre.
 * - `normaliserCartographie` valide et borne toute cartographie (proposée, modifiée ou de repli).
 * - `cartographieDeRepli` fabrique par CODE, sans modèle, une cartographie d'hypothèses à confirmer
 *   à partir des voyants d'urgence, des indicateurs défavorables du score d'alerte et des semaines
 *   de tension de trésorerie.
 * - `contexteChiffresCauses` est le SEUL endroit d'où des nombres entrent dans un prompt : il
 *   reprend des sorties de moteurs (voyants, ratios, score, trésorerie), rien d'autre.
 * Fonctions pures, aucune horloge, aucune qualification juridique de la situation du client.
 */
import type { CritereAlerte, NiveauAlerte, StatutCritereAlerte } from "./alerte";
import { ErreurRedressement } from "./erreurs";
import { CLES_RATIO_REDRESSEMENT, type CleRatioRedressement, type RatiosExercice } from "./ratios";
import { DOMAINES_URGENCE, type DomaineUrgence, type VoyantUrgence } from "./urgence";

export const VERSION_CAUSES = 1;

/** Bornes d'une cartographie (provisoires : à calibrer avec les consultants). */
export const CAUSES_MAX = 12;
export const CAUSE_LIBELLE_MAX = 120;
export const CAUSE_DESCRIPTION_MAX = 1000;

/** Niveau de confiance qualitatif d'une cause : un libellé fixe, jamais un nombre. */
export const NIVEAUX_CONFIANCE_CAUSE = ["faible", "moyen", "eleve"] as const;
export type NiveauConfianceCause = (typeof NIVEAUX_CONFIANCE_CAUSE)[number];

export interface CauseRacine {
  /** Identifiant stable « c01 »…« c99 » dans la cartographie. */
  readonly id: string;
  readonly domaine: DomaineUrgence;
  readonly libelle: string;
  readonly description: string;
  readonly confiance?: NiveauConfianceCause;
}
export interface CartographieCauses {
  readonly version: number;
  readonly causes: readonly CauseRacine[];
}

const LIBELLES_DOMAINE: Readonly<Record<DomaineUrgence, string>> = {
  tresorerie: "Trésorerie",
  activite: "Activité",
  exploitation: "Exploitation",
  social: "Social",
  financement: "Financement",
};

const FORMAT_ID = /^c\d{2}$/;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000b-\u001f\u007f]/;

const invalide = (message: string): never => {
  throw new ErreurRedressement("ENTREE_INVALIDE", message);
};

const sansAccents = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function texteBorne(valeur: unknown, max: number, nom: string): string {
  if (typeof valeur !== "string") return invalide(`${nom} : texte attendu.`);
  if (CONTROLE.test(valeur)) return invalide(`${nom} : caractères de contrôle interdits.`);
  const t = valeur.trim();
  if (t.length < 1 || t.length > max) return invalide(`${nom} : de 1 à ${max} caractères.`);
  return t;
}

/** Libellé du domaine de la grille d'urgence. */
export function libelleDomaineCause(domaine: DomaineUrgence): string {
  return LIBELLES_DOMAINE[domaine];
}

const CLES_CAUSE = new Set(["id", "domaine", "libelle", "description", "confiance"]);

/**
 * Valide et normalise une cartographie : 1 à CAUSES_MAX causes, domaines connus, textes bornés,
 * confiance parmi les libellés fixes, aucun doublon (même domaine et même libellé, accents et
 * casse ignorés), identifiants uniques. Une cause sans identifiant en reçoit un, le plus petit
 * libre (« c01 », « c02 »…). Lève `ENTREE_INVALIDE` ; les messages ne recopient aucune valeur.
 */
export function normaliserCartographie(entree: unknown): CartographieCauses {
  if (typeof entree !== "object" || entree === null || Array.isArray(entree)) {
    return invalide("Cartographie : objet attendu.");
  }
  const liste = (entree as { causes?: unknown }).causes;
  if (!Array.isArray(liste)) return invalide("Cartographie : liste de causes attendue.");
  if (liste.length < 1 || liste.length > CAUSES_MAX) {
    return invalide(`Cartographie : de 1 à ${CAUSES_MAX} causes.`);
  }
  const brutes = liste.map((c): Record<string, unknown> => {
    if (typeof c !== "object" || c === null || Array.isArray(c)) {
      return invalide("Cause : objet attendu.");
    }
    if (Object.keys(c).some((k) => !CLES_CAUSE.has(k))) return invalide("Cause : champ inconnu.");
    return c as Record<string, unknown>;
  });
  const utilises = new Set<string>();
  for (const c of brutes) {
    if (c.id === undefined) continue;
    if (typeof c.id !== "string" || !FORMAT_ID.test(c.id)) {
      return invalide("Cause : identifiant « cNN » attendu.");
    }
    if (utilises.has(c.id)) return invalide("Cause : identifiant en double.");
    utilises.add(c.id);
  }
  let prochain = 1;
  const libre = (): string => {
    for (;;) {
      const id = `c${String(prochain).padStart(2, "0")}`;
      prochain += 1;
      if (!utilises.has(id)) {
        utilises.add(id);
        return id;
      }
    }
  };
  const vus = new Set<string>();
  const causes = brutes.map((c): CauseRacine => {
    const domaine = c.domaine;
    if (!(DOMAINES_URGENCE as readonly unknown[]).includes(domaine)) {
      return invalide("Cause : domaine inconnu.");
    }
    const libelle = texteBorne(c.libelle, CAUSE_LIBELLE_MAX, "Libellé de la cause");
    const description = texteBorne(c.description, CAUSE_DESCRIPTION_MAX, "Description de la cause");
    const cle = `${domaine as string}|${sansAccents(libelle)}`;
    if (vus.has(cle)) return invalide("Cause : doublon (même domaine et même libellé).");
    vus.add(cle);
    const base = {
      id: typeof c.id === "string" ? c.id : libre(),
      domaine: domaine as DomaineUrgence,
      libelle,
      description,
    };
    if (c.confiance === undefined || c.confiance === null) return base;
    if (!(NIVEAUX_CONFIANCE_CAUSE as readonly unknown[]).includes(c.confiance)) {
      return invalide("Cause : niveau de confiance inconnu.");
    }
    return { ...base, confiance: c.confiance as NiveauConfianceCause };
  });
  return { version: VERSION_CAUSES, causes };
}

/* ----- Données d'entrée (sorties des autres moteurs) ----- */

export interface EntreeCauses {
  /** Dernière évaluation d'urgence, ou null. */
  readonly urgence: {
    readonly domaines: readonly {
      readonly domaine: DomaineUrgence;
      readonly voyant: VoyantUrgence;
      readonly pourcentage: number | null;
    }[];
  } | null;
  /** Dernier score d'alerte précoce, ou null. */
  readonly alerte: {
    readonly score: number | null;
    readonly niveau: NiveauAlerte;
    readonly criteres: readonly {
      readonly critere: CritereAlerte;
      readonly statut: StatutCritereAlerte;
    }[];
  } | null;
  /** Ratios du dernier exercice accepté, ou null. */
  readonly ratios: RatiosExercice | null;
  /** Projection de trésorerie courante, ou null. */
  readonly tresorerie: {
    readonly semainesTension: readonly number[];
    readonly premiereSemaineTension: number | null;
    readonly besoinFinancement: number;
    readonly devise: string;
  } | null;
}

/** Domaine de la grille d'urgence auquel se rattache un critère d'alerte. */
export const DOMAINE_CRITERE_ALERTE: Readonly<Record<CritereAlerte, DomaineUrgence>> = {
  liquidite_generale: "tresorerie",
  liquidite_immediate: "tresorerie",
  autonomie_financiere: "financement",
  endettement: "financement",
  couverture_charges_financieres: "financement",
  marge_nette: "activite",
  bfr_jours: "exploitation",
  croissance_ca: "activite",
  variation_marge_brute: "activite",
  rejets_bancaires_12m: "tresorerie",
  retards_fournisseurs_90j: "tresorerie",
  arrieres_fiscaux_sociaux: "tresorerie",
};

const LIBELLES_CRITERE: Readonly<Record<CritereAlerte, string>> = {
  liquidite_generale: "liquidité générale",
  liquidite_immediate: "liquidité immédiate",
  autonomie_financiere: "autonomie financière",
  endettement: "endettement",
  couverture_charges_financieres: "couverture des charges financières",
  marge_nette: "marge nette",
  bfr_jours: "besoin en fonds de roulement",
  croissance_ca: "croissance du chiffre d'affaires",
  variation_marge_brute: "évolution de la marge brute",
  rejets_bancaires_12m: "rejets bancaires",
  retards_fournisseurs_90j: "retards de paiement des fournisseurs",
  arrieres_fiscaux_sociaux: "arriérés d'impôts ou de cotisations",
};

const LIBELLES_RATIO: Readonly<Record<CleRatioRedressement, string>> = {
  liquidite_generale: "Liquidité générale",
  liquidite_reduite: "Liquidité réduite",
  liquidite_immediate: "Liquidité immédiate",
  autonomie_financiere: "Autonomie financière",
  solvabilite_generale: "Solvabilité générale",
  endettement: "Endettement",
  marge_brute: "Marge brute",
  marge_nette: "Marge nette",
  couverture_charges_financieres: "Couverture des charges financières",
  bfr_jours: "Besoin en fonds de roulement",
};

const LIBELLES_VOYANT: Readonly<Record<VoyantUrgence, string>> = {
  vert: "vert",
  orange: "orange",
  rouge: "rouge",
  non_evalue: "non évalué",
};

/* ----- Repli déterministe ----- */

const MENTION =
  "Hypothèse à confirmer par le consultant : cette piste se déduit des indicateurs du dossier, pas d'un entretien.";

function signauxDuDomaine(entree: EntreeCauses, domaine: DomaineUrgence): string[] {
  const signaux: string[] = [];
  const u = entree.urgence?.domaines.find((d) => d.domaine === domaine);
  if (u && (u.voyant === "rouge" || u.voyant === "orange")) {
    signaux.push(`le voyant d'urgence du domaine est ${LIBELLES_VOYANT[u.voyant]}`);
  }
  for (const c of entree.alerte?.criteres ?? []) {
    if (DOMAINE_CRITERE_ALERTE[c.critere] !== domaine) continue;
    if (c.statut === "rouge" || c.statut === "orange") {
      signaux.push(`indicateur ${LIBELLES_CRITERE[c.critere]} : ${LIBELLES_VOYANT[c.statut]}`);
    }
  }
  if (domaine === "tresorerie" && (entree.tresorerie?.semainesTension.length ?? 0) > 0) {
    signaux.push("des semaines de tension sont projetées dans le plan de trésorerie");
  }
  return signaux;
}

function confianceDuDomaine(entree: EntreeCauses, domaine: DomaineUrgence): NiveauConfianceCause {
  const rouge = entree.urgence?.domaines.some((d) => d.domaine === domaine && d.voyant === "rouge");
  return rouge ? "moyen" : "faible";
}

/**
 * Cartographie de REPLI, sans modèle : une cause par domaine qui porte au moins un signal (voyant
 * orange ou rouge, indicateur d'alerte défavorable, tension de trésorerie), dans l'ordre de la
 * grille. Même entrée, même résultat. Sans aucun signal : une cause unique « à identifier ».
 * Formulations génériques, hypothèses à confirmer ; aucun nombre.
 */
export function cartographieDeRepli(entree: EntreeCauses): CartographieCauses {
  const causes: CauseRacine[] = [];
  for (const domaine of DOMAINES_URGENCE) {
    const signaux = signauxDuDomaine(entree, domaine);
    if (signaux.length === 0) continue;
    causes.push({
      id: `c${String(causes.length + 1).padStart(2, "0")}`,
      domaine,
      libelle: `Fragilité du domaine ${LIBELLES_DOMAINE[domaine].toLowerCase()} à expliquer`,
      description: `Signaux relevés : ${signaux.join(" ; ")}. ${MENTION}`,
      confiance: confianceDuDomaine(entree, domaine),
    });
  }
  if (causes.length === 0) {
    causes.push({
      id: "c01",
      domaine: "exploitation",
      libelle: "Causes à identifier avec le client",
      description:
        "Aucun signal défavorable n'est disponible dans les données du dossier. " +
        "Hypothèse à confirmer par le consultant : à compléter à l'issue des entretiens.",
      confiance: "faible",
    });
  }
  return normaliserCartographie({ causes });
}

/* ----- Contexte transmis au modèle ----- */

/** Forme de `ChiffreContexte` (@missionpilot/shared) : le paquet des moteurs n'en dépend pas. */
export interface ChiffreCauses {
  readonly libelle: string;
  readonly valeur: number;
  readonly unite?: string;
}

/**
 * Liste blanche des chiffres que la proposition peut citer, bâtie UNIQUEMENT sur des sorties de
 * moteurs : part de signaux d'alerte par domaine (%), score d'alerte, ratios calculés (en % ; le
 * besoin en fonds de roulement en jours), semaines de tension et besoin de financement de la
 * trésorerie. Un ratio non calculable n'y figure pas (jamais zéro).
 */
export function contexteChiffresCauses(entree: EntreeCauses): ChiffreCauses[] {
  const chiffres: ChiffreCauses[] = [];
  for (const d of entree.urgence?.domaines ?? []) {
    if (d.pourcentage === null) continue;
    chiffres.push({
      libelle: `Urgence, domaine ${LIBELLES_DOMAINE[d.domaine].toLowerCase()} : part des signaux d'alerte`,
      valeur: d.pourcentage,
      unite: "%",
    });
  }
  if (entree.alerte && entree.alerte.score !== null) {
    chiffres.push({
      libelle: "Score d'alerte précoce",
      valeur: entree.alerte.score,
      unite: "sur 100",
    });
  }
  if (entree.ratios) {
    for (const cle of CLES_RATIO_REDRESSEMENT) {
      const r = entree.ratios.ratios[cle];
      if (r.statut !== "calcule" || r.valeur === null) continue;
      chiffres.push(
        cle === "bfr_jours"
          ? { libelle: LIBELLES_RATIO[cle], valeur: r.valeur, unite: "jours" }
          : // Points de base → pour cent (10 000 pb = 100 %) : division exacte par 100.
            { libelle: LIBELLES_RATIO[cle], valeur: r.valeur / 100, unite: "%" },
      );
    }
  }
  if (entree.tresorerie) {
    chiffres.push({
      libelle: "Semaines de tension de trésorerie projetées",
      valeur: entree.tresorerie.semainesTension.length,
    });
    if (entree.tresorerie.premiereSemaineTension !== null) {
      chiffres.push({
        libelle: "Première semaine de tension de trésorerie",
        valeur: entree.tresorerie.premiereSemaineTension,
      });
    }
    chiffres.push({
      libelle: "Besoin de financement de la trésorerie",
      valeur: entree.tresorerie.besoinFinancement,
      unite: entree.tresorerie.devise,
    });
  }
  return chiffres;
}

/** Vrai si l'entrée porte au moins une donnée de diagnostic (sinon rien à expliquer). */
export function entreeCausesExploitable(entree: EntreeCauses): boolean {
  return (
    entree.urgence !== null ||
    entree.alerte !== null ||
    entree.ratios !== null ||
    entree.tresorerie !== null
  );
}

/**
 * Synthèse QUALITATIVE du diagnostic (voyants, indicateurs défavorables, tension de trésorerie)
 * pour le prompt : aucun nombre, les chiffres entrent par `contexteChiffresCauses`.
 */
export function syntheseContexteCauses(entree: EntreeCauses): string {
  const lignes: string[] = [];
  for (const d of entree.urgence?.domaines ?? []) {
    lignes.push(
      `- Urgence, domaine ${LIBELLES_DOMAINE[d.domaine].toLowerCase()} : voyant ${LIBELLES_VOYANT[d.voyant]}`,
    );
  }
  for (const c of entree.alerte?.criteres ?? []) {
    if (c.statut === "rouge" || c.statut === "orange") {
      lignes.push(`- Indicateur ${LIBELLES_CRITERE[c.critere]} : ${LIBELLES_VOYANT[c.statut]}`);
    }
  }
  if (entree.alerte) lignes.push(`- Niveau d'alerte précoce : ${entree.alerte.niveau}`);
  if (entree.tresorerie) {
    lignes.push(
      entree.tresorerie.semainesTension.length > 0
        ? "- Trésorerie : des semaines de tension sont projetées"
        : "- Trésorerie : aucune semaine de tension projetée",
    );
  }
  return lignes.length > 0 ? lignes.join("\n") : "(aucune donnée de diagnostic)";
}
