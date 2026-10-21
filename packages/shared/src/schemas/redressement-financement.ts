import { z } from "zod";
import { dateIsoBorneeSchema, texteOptionnel } from "./commun";
import { RED_MONTANT_MAX, type RedPersonne } from "./redressement";

/*
 * Service #5 « Redressement », lot 2 (RED-06, suite) : vue mensuelle de la trésorerie, covenants
 * bancaires financiers et plan de financement. Contrat des routes
 * /api/redressement/dossiers/:id/{tresorerie/mensuelle,covenants,financement}.
 *
 * - Tous les chiffres (flux mensuels, soldes, marges de covenant, totaux et couvertures du plan)
 *   sortent de `packages/engines/src/redressement/{tresorerie-mensuelle,covenants,financement}.ts` ;
 *   ces schémas ne portent que des saisies et des libellés. Les listes d'énumérations sont
 *   DUPLIQUÉES (`packages/shared` n'importe pas les moteurs) ; `redressement-financement.test.ts`
 *   et un test d'API en vérifient la parité.
 * - Un covenant « en défaut » est un CONSTAT ARITHMÉTIQUE (valeur d'un ratio comparée à un seuil
 *   saisi), jamais une qualification juridique ni la constatation d'un manquement contractuel.
 * - Les montants sont ceux du client (devise du dossier, unités mineures) ; les ratios et seuils
 *   sont en points de base (10 000 = 1).
 */

/* ----- Covenants ----- */

export const RED_COVENANT_RATIOS = [
  "liquidite_generale",
  "liquidite_reduite",
  "liquidite_immediate",
  "autonomie_financiere",
  "solvabilite_generale",
  "endettement",
  "couverture_charges_financieres",
] as const;
export type RedCovenantRatio = (typeof RED_COVENANT_RATIOS)[number];
export const RED_COVENANT_RATIO_LIBELLES: Record<RedCovenantRatio, string> = {
  liquidite_generale: "Liquidité générale",
  liquidite_reduite: "Liquidité réduite",
  liquidite_immediate: "Liquidité immédiate",
  autonomie_financiere: "Autonomie financière",
  solvabilite_generale: "Solvabilité générale",
  endettement: "Endettement (dettes financières / capitaux propres)",
  couverture_charges_financieres: "Couverture des charges financières",
};

export const RED_COVENANT_OPERATEURS = ["min", "max"] as const;
export type RedCovenantOperateur = (typeof RED_COVENANT_OPERATEURS)[number];
export const RED_COVENANT_OPERATEUR_LIBELLES: Record<RedCovenantOperateur, string> = {
  min: "Au moins (plancher)",
  max: "Au plus (plafond)",
};

export const RED_COVENANT_FREQUENCES = ["trimestrielle", "semestrielle", "annuelle"] as const;
export type RedCovenantFrequence = (typeof RED_COVENANT_FREQUENCES)[number];
export const RED_COVENANT_FREQUENCE_LIBELLES: Record<RedCovenantFrequence, string> = {
  trimestrielle: "Trimestrielle",
  semestrielle: "Semestrielle",
  annuelle: "Annuelle",
};

export const RED_COVENANT_STATUTS = ["respecte", "en_defaut", "non_calculable"] as const;
export type RedCovenantStatut = (typeof RED_COVENANT_STATUTS)[number];
export const RED_COVENANT_STATUT_LIBELLES: Record<RedCovenantStatut, string> = {
  respecte: "Seuil respecté",
  en_defaut: "Seuil non atteint (constat arithmétique)",
  non_calculable: "Non calculable",
};

export const RED_COVENANT_RAISONS = [
  "aucun_etat_accepte",
  "ratio_non_calculable",
  "ratio_sans_objet",
  "ratio_non_significatif",
] as const;
export type RedCovenantRaison = (typeof RED_COVENANT_RAISONS)[number];
export const RED_COVENANT_RAISON_LIBELLES: Record<RedCovenantRaison, string> = {
  aucun_etat_accepte: "Aucun état financier accepté pour ce client.",
  ratio_non_calculable: "Le ratio n'est pas calculable : des postes sont à renseigner.",
  ratio_sans_objet: "Le ratio est sans objet pour cet exercice.",
  ratio_non_significatif: "Le ratio n'est pas significatif pour cet exercice.",
};

/** Mention fixe affichée avec toute évaluation de covenant. */
export const RED_COVENANT_MENTION =
  "Constat arithmétique du ratio de l'exercice accepté contre le seuil saisi : il ne qualifie pas la situation au regard du contrat de financement.";

export const RED_COVENANTS_PAR_VERSION_MAX = 12;
export const RED_VERSIONS_COVENANTS_MAX = 100;
export const RED_COVENANT_SEUIL_PB_MAX = 100_000_000;
export const RED_COVENANT_PRETEUR_MAX = 120;

const covenantSchema = z
  .object({
    ratio: z.enum(RED_COVENANT_RATIOS),
    operateur: z.enum(RED_COVENANT_OPERATEURS),
    seuil_pb: z.number().int().min(-RED_COVENANT_SEUIL_PB_MAX).max(RED_COVENANT_SEUIL_PB_MAX),
    preteur: texteOptionnel(RED_COVENANT_PRETEUR_MAX),
    frequence: z.enum(RED_COVENANT_FREQUENCES),
  })
  .strict();

/** Corps de `POST /redressement/dossiers/:id/covenants/versions`. */
export const redCovenantsVersionCreationSchema = z
  .object({
    covenants: z.array(covenantSchema).max(RED_COVENANTS_PAR_VERSION_MAX),
    motif: texteOptionnel(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    const vus = new Map<string, number>();
    v.covenants.forEach((c, index) => {
      const cle = `${c.ratio}|${c.operateur}`;
      if (vus.has(cle)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["covenants", index, "operateur"],
          message: "Un même ratio ne porte pas deux fois le même opérateur.",
        });
      }
      vus.set(cle, c.seuil_pb);
    });
    v.covenants.forEach((c, index) => {
      if (c.operateur !== "min") return;
      const plafond = vus.get(`${c.ratio}|max`);
      if (plafond !== undefined && c.seuil_pb > plafond) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["covenants", index, "seuil_pb"],
          message: "Le plancher d'un ratio ne dépasse pas son plafond.",
        });
      }
    });
  });
export type RedCovenantsVersionCreation = z.infer<typeof redCovenantsVersionCreationSchema>;

/* ----- Plan de financement ----- */

export const RED_FINANCEMENT_TYPES_PERIODE = ["annee", "semestre"] as const;
export type RedFinancementTypePeriode = (typeof RED_FINANCEMENT_TYPES_PERIODE)[number];
export const RED_FINANCEMENT_TYPE_PERIODE_LIBELLES: Record<RedFinancementTypePeriode, string> = {
  annee: "Années",
  semestre: "Semestres",
};

export const RED_FINANCEMENT_SENS = ["emploi", "ressource"] as const;
export type RedFinancementSens = (typeof RED_FINANCEMENT_SENS)[number];
export const RED_FINANCEMENT_SENS_LIBELLES: Record<RedFinancementSens, string> = {
  emploi: "Emplois",
  ressource: "Ressources",
};

export const RED_FINANCEMENT_EMPLOIS = [
  "remboursement_dettes_accords",
  "besoin_fonds_roulement",
  "investissements",
  "charges_restructuration",
] as const;
export const RED_FINANCEMENT_RESSOURCES = [
  "apport_associes",
  "nouveaux_concours_bancaires",
  "cessions_actifs",
  "report_echeances_obtenu",
  "autofinancement",
] as const;
export type RedFinancementEmploi = (typeof RED_FINANCEMENT_EMPLOIS)[number];
export type RedFinancementRessource = (typeof RED_FINANCEMENT_RESSOURCES)[number];
export const RED_FINANCEMENT_NATURE_LIBELLES: Record<
  RedFinancementEmploi | RedFinancementRessource,
  string
> = {
  remboursement_dettes_accords: "Remboursement de dettes et d'accords",
  besoin_fonds_roulement: "Besoin en fonds de roulement",
  investissements: "Investissements",
  charges_restructuration: "Charges de restructuration",
  apport_associes: "Apport des associés",
  nouveaux_concours_bancaires: "Nouveaux concours bancaires",
  cessions_actifs: "Cessions d'actifs",
  report_echeances_obtenu: "Report d'échéances obtenu",
  autofinancement: "Autofinancement",
};

export const RED_FINANCEMENT_STATUTS = ["equilibre", "insuffisance"] as const;
export type RedFinancementStatut = (typeof RED_FINANCEMENT_STATUTS)[number];
export const RED_FINANCEMENT_STATUT_LIBELLES: Record<RedFinancementStatut, string> = {
  equilibre: "Équilibre (ressources au moins égales aux emplois)",
  insuffisance: "Insuffisance de financement",
};

export const RED_FINANCEMENT_ORIGINES = ["tresorerie", "accords"] as const;
export type RedFinancementOrigine = (typeof RED_FINANCEMENT_ORIGINES)[number];
export const RED_FINANCEMENT_ORIGINE_LIBELLES: Record<RedFinancementOrigine, string> = {
  tresorerie: "Besoin de financement de la trésorerie à 13 semaines",
  accords: "Échéances restantes des accords avec les créanciers",
};

export const RED_FINANCEMENT_PERIODES_MAX = 8;
export const RED_FINANCEMENT_LIGNES_MAX = 200;
export const RED_VERSIONS_FINANCEMENT_MAX = 100;

const premierDuMois = dateIsoBorneeSchema.refine(
  (d) => d.slice(8, 10) === "01",
  "Un premier jour de mois est attendu.",
);

const ligneFinancementSchema = z
  .object({
    periode: z.number().int().min(1).max(RED_FINANCEMENT_PERIODES_MAX),
    sens: z.enum(RED_FINANCEMENT_SENS),
    nature: z.string(),
    libelle: texteOptionnel(200),
    montant: z.number().int().min(1).max(RED_MONTANT_MAX),
  })
  .strict()
  .superRefine((v, ctx) => {
    const liste: readonly string[] =
      v.sens === "emploi" ? RED_FINANCEMENT_EMPLOIS : RED_FINANCEMENT_RESSOURCES;
    if (!liste.includes(v.nature)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nature"],
        message: "Nature hors de la liste de ce sens.",
      });
    }
  });

const cadreFinancement = {
  date_debut: premierDuMois,
  type_periode: z.enum(RED_FINANCEMENT_TYPES_PERIODE),
  nombre_periodes: z.number().int().min(1).max(RED_FINANCEMENT_PERIODES_MAX),
};

/** Corps de `POST /redressement/dossiers/:id/financement/versions`. */
export const redFinancementVersionCreationSchema = z
  .object({
    ...cadreFinancement,
    lignes: z.array(ligneFinancementSchema).max(RED_FINANCEMENT_LIGNES_MAX),
    motif: texteOptionnel(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    v.lignes.forEach((l, index) => {
      if (l.periode > v.nombre_periodes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lignes", index, "periode"],
          message: "La période dépasse le nombre de périodes du plan.",
        });
      }
    });
  });
export type RedFinancementVersionCreation = z.infer<typeof redFinancementVersionCreationSchema>;

/** Paramètres de `GET /redressement/dossiers/:id/financement/proposition` (tous facultatifs). */
export const redFinancementPropositionQuerySchema = z
  .object({
    date_debut: premierDuMois.optional(),
    type_periode: z.enum(RED_FINANCEMENT_TYPES_PERIODE).optional(),
    nombre_periodes: z.coerce.number().int().min(1).max(RED_FINANCEMENT_PERIODES_MAX).optional(),
  })
  .strict();
export type RedFinancementPropositionQuery = z.infer<typeof redFinancementPropositionQuerySchema>;

/* ----- Vues (↔ résultats des moteurs, en snake_case) ----- */

/* Vue mensuelle de la trésorerie (↔ ResultatTresorerieMensuelle). */
export interface RedMoisTresorerieVue {
  mois: string;
  semaines: number[];
  debut: string;
  fin: string;
  partiel: boolean;
  semaines_realisees: number;
  encaissements: number;
  decaissements: number;
  flux_net: number;
  solde_ouverture: number;
  solde_fin: number;
  solde_minimum: { semaine: number; montant: number };
  tension: boolean;
  semaines_tension: number[];
}
export interface RedTresorerieMensuelleVue {
  /** Version de trésorerie qui sert de base ; null sans version (rien n'est calculé). */
  version: { id: string; version: number; date_debut: string; seuil_tension: number } | null;
  mensuel: {
    mois: RedMoisTresorerieVue[];
    mois_tension: string[];
    premier_mois_tension: string | null;
    solde_minimum: { mois: string; semaine: number; montant: number };
    totaux: { encaissements: number; decaissements: number; flux_net: number };
  } | null;
}

/* Covenants (↔ ResultatCovenants). */
export interface RedCovenantEvaluationVue {
  statut: RedCovenantStatut;
  valeur_pb: number | null;
  marge_pb: number | null;
  raison: RedCovenantRaison | null;
  manquants: string[];
}
export interface RedCovenantVue {
  id: string;
  rang: number;
  ratio: RedCovenantRatio;
  operateur: RedCovenantOperateur;
  seuil_pb: number;
  preteur: string | null;
  frequence: RedCovenantFrequence;
  evaluation: RedCovenantEvaluationVue;
}
export interface RedCovenantsVersionVue {
  id: string;
  version: number;
  motif: string | null;
  cree_par: RedPersonne;
  cree_le: string;
  covenants: RedCovenantVue[];
}
export interface RedCovenantsVue {
  version: RedCovenantsVersionVue | null;
  /** Dernier exercice accepté du dossier client, base de l'évaluation ; null sans état accepté. */
  exercice: {
    etat_id: string;
    exercice: number;
    date_cloture: string;
    devise: string;
    accepte_sous_reserve: boolean;
  } | null;
  synthese: {
    nombre: number;
    respectes: number;
    en_defaut: number;
    non_calculables: number;
  } | null;
  historique: {
    id: string;
    version: number;
    motif: string | null;
    cree_par: RedPersonne;
    cree_le: string;
    nombre_covenants: number;
  }[];
  mention: string;
}

/* Plan de financement (↔ ResultatFinancement, PropositionFinancement). */
export interface RedLigneFinancementVue {
  id: string;
  rang: number;
  periode: number;
  sens: RedFinancementSens;
  nature: string;
  libelle: string | null;
  montant: number;
}
export interface RedFinancementVersionVue {
  id: string;
  version: number;
  date_debut: string;
  type_periode: RedFinancementTypePeriode;
  nombre_periodes: number;
  motif: string | null;
  cree_par: RedPersonne;
  cree_le: string;
  lignes: RedLigneFinancementVue[];
}
export interface RedPeriodeFinancementVue {
  periode: number;
  debut: string;
  fin: string;
  emplois: number;
  ressources: number;
  solde: number;
  statut: RedFinancementStatut;
  couverture_pb: number | null;
  cumul_emplois: number;
  cumul_ressources: number;
  solde_cumule: number;
  couverture_cumulee_pb: number | null;
  statut_cumule: RedFinancementStatut;
  par_nature: { sens: RedFinancementSens; nature: string; montant: number }[];
}
export interface RedPlanFinancementVue {
  periodes: RedPeriodeFinancementVue[];
  totaux: { emplois: number; ressources: number; solde: number };
  couverture_totale_pb: number | null;
  periodes_insuffisance: number[];
  premiere_periode_insuffisance: number | null;
  insuffisance_maximale_cumulee: number;
  equilibre: boolean;
}
export interface RedFinancementVue {
  /** Devise du dossier (celle de tous les montants). */
  devise: string;
  version: RedFinancementVersionVue | null;
  plan: RedPlanFinancementVue | null;
  historique: {
    id: string;
    version: number;
    date_debut: string;
    type_periode: RedFinancementTypePeriode;
    nombre_periodes: number;
    motif: string | null;
    cree_par: RedPersonne;
    cree_le: string;
    nombre_lignes: number;
  }[];
}
export interface RedLigneProposeeFinancementVue {
  periode: number;
  sens: "emploi";
  nature: RedFinancementEmploi;
  montant: number;
  origine: RedFinancementOrigine;
  nombre_echeances: number;
}
/** `GET .../financement/proposition` : ne modifie rien, le consultant retient ce qu'il veut. */
export interface RedFinancementPropositionVue {
  devise: string;
  cadre: { date_debut: string; type_periode: RedFinancementTypePeriode; nombre_periodes: number };
  lignes: RedLigneProposeeFinancementVue[];
  anterieures: number;
  ulterieures: number;
  besoin_hors_plan: boolean;
  /** Besoin de financement de la trésorerie à 13 semaines et date de son point bas ; null sinon. */
  besoin_tresorerie: { montant: number; date: string } | null;
}
