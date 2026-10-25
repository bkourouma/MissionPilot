/*
 * Données de paramétrage du redressement pour le cabinet « Tenant démo » : seuils d'alerte par
 * secteur (RED-10) et modèle de check-list du cabinet (RED-03). Ces valeurs sont des choix
 * d'experts fictifs (le moteur ne les calcule pas) ; les scores qui en découlent sont, eux,
 * calculés par le moteur à partir des états financiers du client et des incidents saisis.
 *
 * Seuils : douze critères (la somme des poids vaut 100), niveaux d'alerte et part minimale évaluée.
 * - « industrie » : version 1 (mars 2025) volontairement stricte sur la liquidité et le BFR, puis
 *   version 2 (juillet 2025) recalibrée après la revue des premiers dossiers ;
 * - « services » : version 1 (mars 2025), version 2 (juin 2026) plus exigeante sur la liquidité.
 */

export interface SeuilCritere {
  orange: number;
  rouge: number;
  poids: number;
}

export interface SeuilsAlerte {
  criteres: Record<string, SeuilCritere>;
  niveaux: { modere: number; eleve: number; critique: number };
  part_minimale_evaluee_pct: number;
}

const c = (orange: number, rouge: number, poids: number): SeuilCritere => ({
  orange,
  rouge,
  poids,
});

export const SEUILS_INDUSTRIE_V1: SeuilsAlerte = {
  criteres: {
    liquidite_generale: c(25_000, 18_000, 15),
    liquidite_immediate: c(6_000, 3_000, 10),
    autonomie_financiere: c(5_500, 3_000, 10),
    endettement: c(3_500, 8_000, 10),
    couverture_charges_financieres: c(40_000, 20_000, 10),
    marge_nette: c(400, 100, 10),
    bfr_jours: c(45, 80, 5),
    croissance_ca: c(200, -500, 10),
    variation_marge_brute: c(0, -300, 5),
    rejets_bancaires_12m: c(0, 2, 5),
    retards_fournisseurs_90j: c(0, 3, 5),
    arrieres_fiscaux_sociaux: c(0, 0, 5),
  },
  niveaux: { modere: 20, eleve: 45, critique: 70 },
  part_minimale_evaluee_pct: 50,
};

/** Recalibrage de juillet 2025 : liquidité immédiate, autonomie et endettement moins stricts. */
export const SEUILS_INDUSTRIE_V2: SeuilsAlerte = {
  criteres: {
    ...SEUILS_INDUSTRIE_V1.criteres,
    liquidite_immediate: c(4_500, 2_500, 10),
    autonomie_financiere: c(5_000, 3_000, 10),
    endettement: c(4_500, 8_000, 10),
  },
  niveaux: { modere: 20, eleve: 45, critique: 70 },
  part_minimale_evaluee_pct: 50,
};

export const SEUILS_SERVICES_V1: SeuilsAlerte = {
  criteres: {
    liquidite_generale: c(12_000, 10_000, 15),
    liquidite_immediate: c(2_000, 1_000, 10),
    autonomie_financiere: c(2_500, 1_000, 10),
    endettement: c(10_000, 20_000, 10),
    couverture_charges_financieres: c(30_000, 15_000, 10),
    marge_nette: c(200, 0, 10),
    bfr_jours: c(60, 90, 5),
    croissance_ca: c(0, -1_000, 10),
    variation_marge_brute: c(0, -500, 5),
    rejets_bancaires_12m: c(0, 2, 5),
    retards_fournisseurs_90j: c(0, 4, 5),
    arrieres_fiscaux_sociaux: c(0, 0, 5),
  },
  niveaux: { modere: 25, eleve: 50, critique: 75 },
  part_minimale_evaluee_pct: 50,
};

/** Juin 2026 : les services à forte intensité de sous-traitance sont suivis de plus près. */
export const SEUILS_SERVICES_V2: SeuilsAlerte = {
  criteres: {
    ...SEUILS_SERVICES_V1.criteres,
    liquidite_generale: c(13_000, 10_500, 15),
    liquidite_immediate: c(2_500, 1_200, 10),
    bfr_jours: c(50, 80, 5),
  },
  niveaux: { modere: 25, eleve: 50, critique: 75 },
  part_minimale_evaluee_pct: 50,
};

/* ----- Modèle de check-list du cabinet ----- */

export interface ItemModele {
  id: string;
  domaine: "tresorerie" | "activite" | "exploitation" | "social" | "financement";
  libelle: string;
  aide?: string;
}

export const CODE_MODELE_BRASSERIE = "revue-brasserie";
export const INTITULE_MODELE_BRASSERIE = "Revue d'exploitation brassicole (modèle du cabinet)";

export const ITEMS_MODELE_V1: readonly ItemModele[] = [
  {
    id: "bra_tre_01",
    domaine: "tresorerie",
    libelle: "Le prévisionnel de trésorerie à 13 semaines est-il actualisé chaque semaine ?",
    aide: "Comparer le dernier prévisionnel remis par la direction financière au réalisé bancaire.",
  },
  {
    id: "bra_tre_02",
    domaine: "tresorerie",
    libelle: "Les encaissements des distributeurs sont-ils rapprochés des factures émises ?",
  },
  {
    id: "bra_act_01",
    domaine: "activite",
    libelle: "Les remises de volume accordées aux distributeurs sont-elles encadrées par contrat ?",
  },
  {
    id: "bra_exp_01",
    domaine: "exploitation",
    libelle: "Le plan de maintenance des lignes de production est-il à jour ?",
  },
  {
    id: "bra_exp_02",
    domaine: "exploitation",
    libelle:
      "Les emballages consignés (casiers, bouteilles) font-ils l'objet d'un inventaire régulier ?",
  },
  {
    id: "bra_soc_01",
    domaine: "social",
    libelle: "Les équipes de production sont-elles informées des étapes du plan de redressement ?",
  },
  {
    id: "bra_fin_01",
    domaine: "financement",
    libelle: "Les échéanciers convenus avec les créanciers sont-ils suivis chaque mois ?",
  },
  {
    id: "bra_fin_02",
    domaine: "financement",
    libelle:
      "Les engagements de la banque sont-ils consignés dans un document signé par les deux parties ?",
  },
];

/** Version 2 (février 2026) : ajoute la maîtrise des pertes matières, retour d'expérience. */
export const ITEMS_MODELE_V2: readonly ItemModele[] = [
  ...ITEMS_MODELE_V1,
  {
    id: "bra_exp_03",
    domaine: "exploitation",
    libelle:
      "Les pertes de matières et de bière en cours de fabrication sont-elles suivies par lot ?",
    aide: "Retour d'expérience des dossiers 2025 : premier poste d'économie rapide.",
  },
];
