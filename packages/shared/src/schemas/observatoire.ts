import { z } from "zod";

/*
 * Observatoire inter-cabinets (CAP-04, PRD complémentaire §12 et §21 décision n° 1) : adhésion
 * VOLONTAIRE du cabinet (désactivée par défaut), accès réservé aux cabinets adhérents
 * (contributeurs), agrégats anonymes seulement. Objets stricts ; le même schéma sert l'API et le web.
 *
 * CONTRAT HTTP (préfixe /api ; aucune route n'est ouverte au portail client : 403
 * PORTAIL_ROUTE_INTERDITE ; chaque écriture est journalisée) :
 *
 * | Méthode et route                              | Droit                                  | Corps                                 | Réponse                                  |
 * | --------------------------------------------- | -------------------------------------- | ------------------------------------- | ---------------------------------------- |
 * | GET    /observatoire/adhesion                 | observatoire.adherer OU .lire          | —                                     | 200 ObservatoireEtatAdhesion             |
 * | POST   /observatoire/adhesion                 | observatoire.adherer (associé)         | observatoireAdhesionSchema            | 201 ObservatoireEtatAdhesion             |
 * | POST   /observatoire/adhesion/retrait         | observatoire.adherer                   | observatoireRetraitAdhesionSchema     | 200 ObservatoireEtatAdhesion             |
 * | POST   /observatoire/contributions            | observatoire.adherer + adhésion active | observatoireVersementSchema           | 201 ObservatoireResultatVersement        |
 * | GET    /observatoire/contributions/resume     | observatoire.adherer                   | — (?indicateur=…)                     | 200 ObservatoireResumeContributions      |
 * | DELETE /observatoire/contributions            | observatoire.adherer                   | — (toutes les contributions)          | 200 ObservatoireResultatRetrait          |
 * | POST   /observatoire/contributions/retrait    | observatoire.adherer                   | {} (alias de DELETE)                  | 200 ObservatoireResultatRetrait          |
 * | GET    /observatoire/agregats?indicateur=…     | observatoire.lire + adhésion active    | —                                     | 200 ObservatoireAgregats                 |
 *
 * Erreurs propres (enveloppe `{ erreur: { code, message } }` d'app.ts) :
 * - 403 OBSERVATOIRE_RESERVE_ADHERENTS : lecture des agrégats sans adhésion active (le cabinet
 *   non adhérent ne voit RIEN de l'observatoire, pas même l'existence d'une case) ;
 * - 409 OBSERVATOIRE_ADHESION_INACTIVE : versement sans adhésion active ;
 * - 409 OBSERVATOIRE_DEJA_ADHERENT, 409 OBSERVATOIRE_NON_ADHERENT : transition d'adhésion ;
 * - 400 REQUETE_INVALIDE (corps ou indicateur invalide), 403 INTERDIT (droit manquant).
 *
 * Lecture des agrégats : grille COMPLÈTE secteur × taille ; une case publiée porte des valeurs
 * arrondies (moyenne, médiane, quartiles au point entier ; effectif arrondi à la tranche de 5
 * inférieure, « au moins » ; répartition en % arrondis à 5 par tranche de 10 points) ; une case
 * non publiée porte seulement `statut: "effectif_insuffisant"` (ni valeur, ni effectif : vide et
 * sous seuil sont indiscernables). Les marges ne portent que sur les cases publiées. Les agrégats
 * sont GELÉS par mois civil : un versement du mois n'apparaît qu'au mois suivant (les données
 * retenues sont toutes d'un mois antérieur à `periode_courante`) ; un retrait d'adhésion ou de
 * contributions agit aussitôt ; une ré-adhésion ne réactive pas les contributions versées avant
 * elle (il faut verser à nouveau).
 */

export const OBSERVATOIRE_INDICATEURS_CODES = ["notation_score_global"] as const;
export type ObservatoireIndicateurCode = (typeof OBSERVATOIRE_INDICATEURS_CODES)[number];
export const OBSERVATOIRE_INDICATEUR_LIBELLES: Record<ObservatoireIndicateurCode, string> = {
  notation_score_global: "Score global de la dernière notation publiée",
};

/** Codes identiques au moteur (`@missionpilot/engines`, `OBSERVATOIRE_SECTEURS`). */
export const OBSERVATOIRE_SECTEURS_CODES = [
  "agriculture",
  "industrie",
  "btp",
  "commerce",
  "services",
  "numerique",
  "finance",
  "autres",
] as const;
export type ObservatoireSecteurCode = (typeof OBSERVATOIRE_SECTEURS_CODES)[number];
export const OBSERVATOIRE_SECTEUR_LIBELLES: Record<ObservatoireSecteurCode, string> = {
  agriculture: "Agriculture et agro-industrie",
  industrie: "Industrie, mines et énergie",
  btp: "BTP et immobilier",
  commerce: "Commerce et distribution",
  services: "Services",
  numerique: "Numérique et télécommunications",
  finance: "Banque, assurance et microfinance",
  autres: "Autres secteurs",
};

export const OBSERVATOIRE_TAILLES_CODES = ["tpe", "pme", "eti", "grande_entreprise"] as const;
export type ObservatoireTailleCode = (typeof OBSERVATOIRE_TAILLES_CODES)[number];
export const OBSERVATOIRE_TAILLE_LIBELLES: Record<ObservatoireTailleCode, string> = {
  tpe: "TPE",
  pme: "PME",
  eti: "ETI",
  grande_entreprise: "Grande entreprise",
};

export const OBSERVATOIRE_STATUTS_CASE = ["publiee", "effectif_insuffisant"] as const;
export type ObservatoireStatutCase = (typeof OBSERVATOIRE_STATUTS_CASE)[number];
export const OBSERVATOIRE_STATUT_CASE_LIBELLES: Record<ObservatoireStatutCase, string> = {
  publiee: "Publiée",
  effectif_insuffisant: "Effectif insuffisant",
};

export const observatoireIndicateurSchema = z.enum(OBSERVATOIRE_INDICATEURS_CODES);

/** Adhésion VOLONTAIRE : consentement explicite exigé. */
export const observatoireAdhesionSchema = z
  .object({
    consentement: z.literal(true),
    motif: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type ObservatoireAdhesion = z.infer<typeof observatoireAdhesionSchema>;

export const observatoireRetraitAdhesionSchema = z
  .object({ motif: z.string().trim().min(1).max(500).optional() })
  .strict();
export type ObservatoireRetraitAdhesion = z.infer<typeof observatoireRetraitAdhesionSchema>;

export const observatoireVersementSchema = z
  .object({ indicateur: observatoireIndicateurSchema.default("notation_score_global") })
  .strict();
export type ObservatoireVersement = z.infer<typeof observatoireVersementSchema>;

export const observatoireRetraitContributionsSchema = z.object({}).strict();

export const observatoireIndicateurQuerySchema = z
  .object({ indicateur: observatoireIndicateurSchema.default("notation_score_global") })
  .strict();
export type ObservatoireIndicateurQuery = z.infer<typeof observatoireIndicateurQuerySchema>;

/* ----- Formes de réponse (types seuls) ----- */

export interface ObservatoireEvenementAdhesion {
  rang: number;
  action: "adhesion" | "retrait";
  motif: string | null;
  /** Nom de l'utilisateur du cabinet (donnée interne au cabinet). */
  par_nom: string;
  le: string;
}

export interface ObservatoireEtatAdhesion {
  active: boolean;
  /** Date de la dernière adhésion si active, sinon null. */
  depuis: string | null;
  historique: ObservatoireEvenementAdhesion[];
}

export interface ObservatoireVolumeCase {
  secteur: ObservatoireSecteurCode;
  taille: ObservatoireTailleCode;
  nombre: number;
}

/** Volumes du SEUL cabinet appelant : jamais de valeur ni de volume d'un autre cabinet. */
export interface ObservatoireResumeContributions {
  indicateur: ObservatoireIndicateurCode;
  adhesion_active: boolean;
  /** Mois civil courant (AAAA-MM-01) : un versement de ce mois sera retenu au mois suivant. */
  periode_courante: string;
  /** Versement du mois courant, en attente de publication. */
  en_attente: { periode: string; nombre: number; verse_le: string } | null;
  /**
   * Dernier versement d'un mois antérieur ET postérieur à la dernière adhésion, celui que retiennent
   * les agrégats (si adhésion active) ; null après une ré-adhésion tant qu'aucun nouveau versement
   * n'a été retenu.
   */
  retenu: { periode: string; nombre: number; verse_le: string } | null;
  /** Répartition par case du versement le plus récent (en attente, sinon retenu). */
  par_case: ObservatoireVolumeCase[];
}

export interface ObservatoireResultatVersement extends ObservatoireResumeContributions {
  versees: number;
  /** Clients écartés : taille non renseignée (case inclassable). */
  ecartees_sans_taille: number;
  /** Clients écartés : score de la dernière notation publiée non notable. */
  ecartees_sans_valeur: number;
}

export interface ObservatoireResultatRetrait {
  retirees: number;
}

export interface ObservatoireStatistiquesPubliees {
  /** Effectif arrondi à la tranche de 5 inférieure (« au moins N entreprises »). */
  effectif_minimum: number;
  moyenne: number;
  mediane: number;
  /** Null sous 10 entreprises. */
  q1: number | null;
  q3: number | null;
  /** 10 pourcentages (tranches 0-10… 90-100), arrondis à 5 ; null sous 10 entreprises. */
  repartition: number[] | null;
}

export type ObservatoireCasePubliee =
  | ({
      secteur: ObservatoireSecteurCode;
      taille: ObservatoireTailleCode;
      statut: "publiee";
    } & ObservatoireStatistiquesPubliees)
  | {
      secteur: ObservatoireSecteurCode;
      taille: ObservatoireTailleCode;
      statut: "effectif_insuffisant";
    };

export type ObservatoireMargePubliee = ObservatoireStatistiquesPubliees & {
  cases_publiees: number;
};

export interface ObservatoireAgregats {
  indicateur: ObservatoireIndicateurCode;
  /** Mois civil courant ; les données retenues sont toutes d'un mois antérieur. */
  periode_courante: string;
  seuils: { entreprises_min: number; cabinets_min: number; effectif_detaille: number };
  secteurs: ObservatoireSecteurCode[];
  tailles: ObservatoireTailleCode[];
  cases: ObservatoireCasePubliee[];
  marges: {
    par_secteur: ({ secteur: ObservatoireSecteurCode } & ObservatoireMargePubliee)[];
    par_taille: ({ taille: ObservatoireTailleCode } & ObservatoireMargePubliee)[];
    ensemble: ObservatoireMargePubliee | null;
  };
}
