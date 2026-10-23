import { z } from "zod";
import { DEVISES, texteOptionnel } from "./commun";
import { FORMATS_RAPPORT_SERVICE } from "./rapports";
import { RED_CLES_RATIO, RED_NIVEAUX_ALERTE, RED_VOYANTS, type RedPersonne } from "./redressement";

/*
 * RED-08 : bilan de clôture du redressement et rapport de clôture (lot 2). Contrat des routes
 * /api/redressement/dossiers/:id/clotures, /api/redressement/clotures/:id et des types de réponse.
 *
 * - Le CONTENU du bilan est construit par le serveur (moteur `construireBilanCloture`) depuis les
 *   autres moteurs du service : aucun client n'en fournit. Les valeurs sont des entiers (points de
 *   base, jours, unités mineures, dixièmes de point) et des variations signées.
 * - Un bilan naît en brouillon ; il est VALIDÉ par le directeur de la mission, et seulement si ses
 *   contrôles de complétude bloquants sont satisfaits. Un bilan validé est figé.
 * - Les listes de contrôles DUPLIQUENT celles de `packages/engines/src/redressement/cloture.ts`
 *   (parité vérifiée par le test d'API `redressement-cloture.test.ts`).
 * - Aucune qualification juridique dans les libellés : une évolution est un constat sur un écart.
 */

export const RED_CLOTURES_MAX = 30;
export const RED_CLOTURE_MOTIF_MAX = 2000;

export const RED_STATUTS_CLOTURE = ["brouillon", "valide"] as const;
export type RedStatutCloture = (typeof RED_STATUTS_CLOTURE)[number];
export const RED_STATUT_CLOTURE_LIBELLES: Record<RedStatutCloture, string> = {
  brouillon: "Brouillon",
  valide: "Validé",
};

/** Statut du bilan d'un dossier, pour le tableau de bord : « absent » si aucun bilan n'existe. */
export const RED_STATUTS_CLOTURE_DOSSIER = ["absent", "brouillon", "valide"] as const;
export type RedStatutClotureDossier = (typeof RED_STATUTS_CLOTURE_DOSSIER)[number];
export const RED_STATUT_CLOTURE_DOSSIER_LIBELLES: Record<RedStatutClotureDossier, string> = {
  absent: "Aucun bilan",
  brouillon: "Bilan en brouillon",
  valide: "Bilan validé",
};

export const RED_EVOLUTIONS_CLOTURE = [
  "amelioration",
  "degradation",
  "stable",
  "non_comparable",
] as const;
export type RedEvolutionCloture = (typeof RED_EVOLUTIONS_CLOTURE)[number];
export const RED_EVOLUTION_CLOTURE_LIBELLES: Record<RedEvolutionCloture, string> = {
  amelioration: "Amélioration",
  degradation: "Dégradation",
  stable: "Stable",
  non_comparable: "Non comparable",
};

export const RED_STATUTS_RENOTATION = [
  "compare",
  "une_seule_version",
  "aucune_version_publiee",
] as const;
export type RedStatutReNotation = (typeof RED_STATUTS_RENOTATION)[number];
export const RED_STATUT_RENOTATION_LIBELLES: Record<RedStatutReNotation, string> = {
  compare: "Deux versions publiées comparées",
  une_seule_version: "Une seule version publiée : pas de comparaison",
  aucune_version_publiee: "Aucune version publiée de la notation",
};

export const RED_CHANGEMENTS_CLASSE = [
  "amelioration",
  "degradation",
  "inchangee",
  "non_comparable",
] as const;
export type RedChangementClasse = (typeof RED_CHANGEMENTS_CLASSE)[number];
export const RED_CHANGEMENT_CLASSE_LIBELLES: Record<RedChangementClasse, string> = {
  amelioration: "Classe améliorée",
  degradation: "Classe dégradée",
  inchangee: "Classe inchangée",
  non_comparable: "Non comparable",
};

export interface RedControleClotureDefinition {
  code: string;
  libelle: string;
  bloquant: boolean;
}
/** Contrôles de complétude du bilan (miroir de `CONTROLES_CLOTURE` du moteur, même ordre). */
export const RED_CONTROLES_CLOTURE: readonly RedControleClotureDefinition[] = [
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

/* ----- Entrées ----- */

/** POST /api/redressement/dossiers/:id/clotures : aucun champ, l'état courant du dossier fait foi. */
export const redClotureCreationSchema = z.object({}).strict();
export type RedClotureCreation = z.infer<typeof redClotureCreationSchema>;

/** POST /api/redressement/clotures/:id/validation. */
export const redClotureValidationSchema = z
  .object({ motif: texteOptionnel(RED_CLOTURE_MOTIF_MAX) })
  .strict();
export type RedClotureValidation = z.infer<typeof redClotureValidationSchema>;

/** POST /api/redressement/clotures/:id/rapports?format=pdf|docx (formats des livrables de service). */
export const redClotureRapportQuerySchema = z
  .object({ format: z.enum(FORMATS_RAPPORT_SERVICE) })
  .strict();
export type RedClotureRapportQuery = z.infer<typeof redClotureRapportQuerySchema>;

/* ----- Contenu du bilan (relu par le serveur et le web : forme exacte du moteur) ----- */

const entier = z.number().int();
const entierNul = entier.nullable();
const positif = z.number().int().min(0);
const evolution = z.enum(RED_EVOLUTIONS_CLOTURE);
const classe = z.enum(["A", "B", "C", "D", "E"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ligneRatio = z
  .object({
    cle: z.enum(RED_CLES_RATIO),
    unite: z.enum(["pb", "jours"]),
    ouverture: entierNul,
    fin: entierNul,
    variation: entierNul,
    evolution,
  })
  .strict();

const instantAlerte = z
  .object({
    score: entierNul,
    niveau: z.enum(RED_NIVEAUX_ALERTE),
    date_reference: date,
  })
  .strict();

const instantUrgence = z.object({ voyant: z.enum(RED_VOYANTS), domaines_rouges: positif }).strict();

const syntheseTresorerie = z
  .object({
    semaines_tension: positif,
    premiere_semaine_tension: entierNul,
    besoin_financement: positif,
    solde_minimum: entier,
  })
  .strict();

const avancementVolet = z
  .object({
    total: positif,
    terminees: positif,
    abandonnees: positif,
    en_retard: positif,
    avancement_pb: entierNul,
  })
  .strict();

const versionReNotation = z
  .object({ numero: positif, score_dixiemes: entierNul, classe: classe.nullable() })
  .strict();

export const redClotureContenuSchema = z
  .object({
    version: z.number().int().min(1),
    date_reference: date,
    devise: z.enum(DEVISES),
    exercice_ouverture: entierNul,
    exercice_fin: entierNul,
    ratios: z.array(ligneRatio).max(RED_CLES_RATIO.length),
    alerte: z
      .object({
        ouverture: instantAlerte.nullable(),
        fin: instantAlerte.nullable(),
        variation_points: entierNul,
        evolution,
      })
      .strict(),
    urgence: z
      .object({
        ouverture: instantUrgence.nullable(),
        fin: instantUrgence.nullable(),
        variation_domaines_rouges: entierNul,
        evolution,
      })
      .strict(),
    tresorerie: z
      .object({
        ouverture: syntheseTresorerie.nullable(),
        fin: syntheseTresorerie.nullable(),
        variation_besoin_financement: entierNul,
        variation_semaines_tension: entierNul,
        evolution,
      })
      .strict(),
    plan: z
      .object({
        total: positif,
        terminees: positif,
        abandonnees: positif,
        en_retard: positif,
        avancement_pb: entierNul,
        par_volet: z
          .object({ quick_win: avancementVolet, restructuration: avancementVolet })
          .strict(),
        actions_au_plan_valide: entierNul,
        leviers: z
          .object({
            actions_avec_levier: positif,
            impact_tresorerie_unique_retenu: entier,
            impact_resultat_annuel_retenu: entier,
            impact_tresorerie_unique_realise: entier,
            impact_resultat_annuel_realise: entier,
          })
          .strict(),
      })
      .strict(),
    creanciers: z
      .object({
        nombre: positif,
        encours_initial: positif,
        encours_restant: positif,
        echu: positif,
        remises_obtenues: positif,
        total_paye: positif,
        apurement_pb: entierNul,
        accords: z
          .object({
            total: positif,
            respectes: positif,
            en_retard: positif,
            soldes: positif,
            rompus: positif,
            tenus: positif,
            tenus_pb: entierNul,
          })
          .strict(),
      })
      .strict(),
    covenants: z.object({ en_defaut: entierNul }).strict(),
    checklists: z
      .object({
        nombre: positif,
        completes: positif,
        completude_moyenne_pb: entierNul,
        conformite_moyenne_pb: entierNul,
        conformite_minimale_pb: entierNul,
      })
      .strict(),
    renotation: z
      .object({
        statut: z.enum(RED_STATUTS_RENOTATION),
        premiere: versionReNotation.nullable(),
        derniere: versionReNotation.nullable(),
        ecart_dixiemes: entierNul,
        changement_classe: z.enum(RED_CHANGEMENTS_CLASSE),
      })
      .strict(),
    causes: z.object({ validee: z.boolean(), nombre: positif }).strict(),
    synthese: z
      .object({
        ameliorations: positif,
        degradations: positif,
        stables: positif,
        non_comparables: positif,
      })
      .strict(),
    controles: z
      .array(
        z
          .object({
            code: z.string().min(1).max(60),
            libelle: z.string().min(1).max(200),
            bloquant: z.boolean(),
            satisfait: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    complet: z.boolean(),
  })
  .strict();
export type RedClotureContenu = z.infer<typeof redClotureContenuSchema>;
export type RedClotureLigneRatio = z.infer<typeof ligneRatio>;
export type RedClotureControle = RedClotureContenu["controles"][number];

/* ----- Réponses ----- */

export interface RedClotureResume {
  id: string;
  dossier_id: string;
  version: number;
  statut: RedStatutCloture;
  date_reference: string;
  /** Aucun contrôle bloquant non satisfait au moment de la construction. */
  complet: boolean;
  empreinte: string;
  cree_par: RedPersonne;
  cree_le: string;
  valide_par: RedPersonne | null;
  valide_le: string | null;
  motif: string | null;
  /** Confort d'affichage : même règle que la validation (l'API reste juge). */
  peut_valider: boolean;
}

export interface RedClotureVue extends RedClotureResume {
  contenu: RedClotureContenu;
}

/** GET /api/redressement/dossiers/:id/clotures : versions sans contenu, la plus récente d'abord. */
export interface RedCloturesListeVue {
  elements: RedClotureResume[];
}

/** Résumé du bilan pour le tableau de bord (`resumeCloture`). */
export interface RedClotureDossierResume {
  statut: RedStatutClotureDossier;
  version: number | null;
  valide_le: string | null;
}

/** Rapport de clôture (ligne `rapports_mission`, sans clé de stockage). */
export interface RedClotureRapportVue {
  id: string;
  mission_id: string;
  modele: "cloture_redressement";
  format: "pdf" | "docx";
  statut: "brouillon" | "valide";
  niveau: "red";
  red_cloture_id: string;
  version_source: number;
  genere_par: string;
  genere_le: string;
  fichier: {
    id: string;
    nom: string;
    type_mime: string;
    taille: number;
    sha256: string;
    envoye_par: string;
    cree_le: string;
  };
}

/** GET /api/redressement/clotures/:id/rapports. */
export interface RedClotureRapportsVue {
  elements: RedClotureRapportVue[];
  curseur_suivant: string | null;
}
