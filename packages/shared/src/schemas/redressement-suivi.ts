import { z } from "zod";
import { dateIsoBorneeSchema, texteOptionnel } from "./commun";
import type { RedPersonne } from "./redressement";

/*
 * Service #5 « Redressement », lot 2 (RED-09) : suivi post-mission. Contrat des routes
 * /api/redressement/dossiers/:id/suivi[/...]. Le suivi est INTERNE au cabinet : aucune route du
 * portail, aucun envoi externe. Il n'existe qu'après la clôture du dossier.
 *
 * - Les dates d'échéance, l'état des jalons, la comparaison des relevés à la référence de
 *   clôture et les alertes sortent de `packages/engines/src/redressement/suivi.ts` à chaque
 *   lecture ; ces schémas ne portent que des saisies et des libellés. Les listes d'énumérations
 *   sont DUPLIQUÉES (`packages/shared` n'importe pas les moteurs) ; `redressement-suivi.test.ts`
 *   et un test d'API en vérifient la parité.
 * - Une alerte de dégradation est un CONSTAT ARITHMÉTIQUE (écart d'un ratio entre la clôture et un
 *   relevé), jamais une qualification juridique de la situation du client.
 * - Ratios en points de base (10 000 = 1).
 */

export const RED_SUIVI_RATIOS = [
  "liquidite_generale",
  "liquidite_reduite",
  "liquidite_immediate",
  "autonomie_financiere",
  "solvabilite_generale",
  "endettement",
  "marge_brute",
  "marge_nette",
  "couverture_charges_financieres",
] as const;
export type RedSuiviRatio = (typeof RED_SUIVI_RATIOS)[number];
export const RED_SUIVI_RATIO_LIBELLES: Record<RedSuiviRatio, string> = {
  liquidite_generale: "Liquidité générale",
  liquidite_reduite: "Liquidité réduite",
  liquidite_immediate: "Liquidité immédiate",
  autonomie_financiere: "Autonomie financière",
  solvabilite_generale: "Solvabilité générale",
  endettement: "Endettement",
  marge_brute: "Marge brute",
  marge_nette: "Marge nette",
  couverture_charges_financieres: "Couverture des charges financières",
};

export const RED_SUIVI_STATUTS_JALON = ["a_venir", "echu", "realise"] as const;
export type RedSuiviStatutJalon = (typeof RED_SUIVI_STATUTS_JALON)[number];
export const RED_SUIVI_STATUT_JALON_LIBELLES: Record<RedSuiviStatutJalon, string> = {
  a_venir: "À venir",
  echu: "Échu",
  realise: "Réalisé",
};

export const RED_SUIVI_TYPES_EVENEMENT = ["realise", "reporte"] as const;
export type RedSuiviTypeEvenement = (typeof RED_SUIVI_TYPES_EVENEMENT)[number];
export const RED_SUIVI_TYPE_EVENEMENT_LIBELLES: Record<RedSuiviTypeEvenement, string> = {
  realise: "Jalon réalisé",
  reporte: "Jalon reporté",
};

export const RED_SUIVI_SOURCES_RELEVE = ["saisie", "instantane"] as const;
export type RedSuiviSourceReleve = (typeof RED_SUIVI_SOURCES_RELEVE)[number];
export const RED_SUIVI_SOURCE_RELEVE_LIBELLES: Record<RedSuiviSourceReleve, string> = {
  saisie: "Indicateurs saisis",
  instantane: "Instantané des ratios du dernier état accepté",
};

export const RED_SUIVI_TYPES_ALERTE = [
  "jalon_echu",
  "degradation_ratio",
  "jalon_sans_releve",
  "jalon_proche",
] as const;
export type RedSuiviTypeAlerte = (typeof RED_SUIVI_TYPES_ALERTE)[number];
export const RED_SUIVI_TYPE_ALERTE_LIBELLES: Record<RedSuiviTypeAlerte, string> = {
  jalon_echu: "Jalon échu",
  degradation_ratio: "Écart défavorable d'un ratio",
  jalon_sans_releve: "Jalon sans relevé",
  jalon_proche: "Jalon proche",
};

export const RED_SUIVI_GRAVITES = ["information", "attention"] as const;
export type RedSuiviGravite = (typeof RED_SUIVI_GRAVITES)[number];
export const RED_SUIVI_GRAVITE_LIBELLES: Record<RedSuiviGravite, string> = {
  information: "Information",
  attention: "Attention",
};

export const RED_SUIVI_SENS = ["amelioration", "stable", "degradation"] as const;
export type RedSuiviSens = (typeof RED_SUIVI_SENS)[number];
export const RED_SUIVI_SENS_LIBELLES: Record<RedSuiviSens, string> = {
  amelioration: "Amélioration",
  stable: "Stable",
  degradation: "Écart défavorable",
};

/** Mention fixe affichée avec le suivi. */
export const RED_SUIVI_MENTION =
  "Suivi interne au cabinet : les alertes sont des constats arithmétiques calculés à chaque lecture ; elles ne qualifient pas la situation du client.";

export const RED_SUIVI_MOIS_PAR_DEFAUT = [6, 12] as const;
export const RED_SUIVI_JALONS_MAX = 12;
export const RED_SUIVI_MOIS_MAX = 60;
export const RED_SUIVI_LIBELLE_MAX = 120;
export const RED_SUIVI_RELEVES_PAR_JALON_MAX = 10;
export const RED_SUIVI_EVENEMENTS_PAR_JALON_MAX = 8;
export const RED_SUIVI_RATIO_PB_MAX = 100_000_000;
export const RED_SUIVI_COMMENTAIRE_MAX = 1000;
export const RED_SUIVI_MOTIF_MAX = 500;

const uuid = z.string().uuid();
const ratioPb = z.number().int().min(-RED_SUIVI_RATIO_PB_MAX).max(RED_SUIVI_RATIO_PB_MAX);

const jalonCreationSchema = z
  .object({
    mois: z.number().int().min(1).max(RED_SUIVI_MOIS_MAX),
    libelle: texteOptionnel(RED_SUIVI_LIBELLE_MAX),
  })
  .strict();

/**
 * Corps de `POST /redressement/dossiers/:id/suivi` : jalons personnalisés (échéance en mois après
 * la clôture, strictement croissante). Sans corps ou sans `jalons` : jalons à 6 et 12 mois.
 */
export const redSuiviPlanCreationSchema = z
  .object({
    jalons: z.array(jalonCreationSchema).min(1).max(RED_SUIVI_JALONS_MAX).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    (v.jalons ?? []).forEach((j, index) => {
      const precedent = index > 0 ? (v.jalons?.[index - 1]?.mois ?? 0) : 0;
      if (j.mois <= precedent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["jalons", index, "mois"],
          message: "Les échéances des jalons sont strictement croissantes.",
        });
      }
    });
  });
export type RedSuiviPlanCreation = z.infer<typeof redSuiviPlanCreationSchema>;

const ratiosReleveSchema = z
  .object(
    Object.fromEntries(RED_SUIVI_RATIOS.map((r) => [r, ratioPb.optional()])) as Record<
      RedSuiviRatio,
      z.ZodOptional<typeof ratioPb>
    >,
  )
  .strict();

/**
 * Corps de `POST /redressement/dossiers/:id/suivi/releves`. `saisie` : au moins un ratio saisi ;
 * `instantane` : aucun ratio (le serveur prend ceux du dernier état accepté, par le moteur).
 */
export const redSuiviReleveCreationSchema = z
  .object({
    jalon_id: uuid,
    date_releve: dateIsoBorneeSchema,
    source: z.enum(RED_SUIVI_SOURCES_RELEVE),
    ratios: ratiosReleveSchema.optional(),
    commentaire: texteOptionnel(RED_SUIVI_COMMENTAIRE_MAX),
  })
  .strict()
  .superRefine((v, ctx) => {
    const saisis = Object.values(v.ratios ?? {}).filter((x) => x !== undefined).length;
    if (v.source === "saisie" && saisis === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ratios"],
        message: "Au moins un ratio est attendu pour des indicateurs saisis.",
      });
    }
    if (v.source === "instantane" && v.ratios !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ratios"],
        message: "Un instantané n'accepte aucun ratio saisi : il est calculé par le serveur.",
      });
    }
  });
export type RedSuiviReleveCreation = z.infer<typeof redSuiviReleveCreationSchema>;

/**
 * Corps de `POST /redressement/dossiers/:id/suivi/jalons/:jalonId/evenements` : marquer un jalon
 * réalisé (date de réalisation) ou le reporter (nouvelle date prévue et motif obligatoire).
 */
export const redSuiviEvenementCreationSchema = z
  .object({
    type: z.enum(RED_SUIVI_TYPES_EVENEMENT),
    date_effet: dateIsoBorneeSchema,
    motif: texteOptionnel(RED_SUIVI_MOTIF_MAX),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === "reporte" && (v.motif === undefined || v.motif === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["motif"],
        message: "Un report s'accompagne d'un motif.",
      });
    }
  });
export type RedSuiviEvenementCreation = z.infer<typeof redSuiviEvenementCreationSchema>;

/** Paramètres de chemin d'un jalon. */
export const redSuiviJalonParamsSchema = z.object({ id: uuid, jalonId: uuid }).strict();

/* ----- Vues (↔ résultats du moteur, en snake_case) ----- */

export type RedSuiviRatiosVue = Partial<Record<RedSuiviRatio, number>>;

export interface RedSuiviReleveVue {
  id: string;
  jalon_id: string;
  date_releve: string;
  source: RedSuiviSourceReleve;
  ratios: RedSuiviRatiosVue;
  /** Instantané seulement : version de la correspondance de postes et exercice de l'état utilisés. */
  correspondance_version: number | null;
  exercice: number | null;
  commentaire: string | null;
  cree_par: RedPersonne;
  cree_le: string;
}

export interface RedSuiviEvenementVue {
  id: string;
  type: RedSuiviTypeEvenement;
  date_effet: string;
  motif: string | null;
  cree_par: RedPersonne;
  cree_le: string;
}

export interface RedSuiviComparaisonVue {
  ratio: RedSuiviRatio;
  reference_pb: number;
  releve_pb: number;
  variation_pb: number;
  sens: RedSuiviSens;
  gravite: RedSuiviGravite | null;
}

export interface RedSuiviJalonVue {
  id: string;
  rang: number;
  libelle: string;
  /** Date prévue initiale. */
  date_prevue: string;
  /** Date prévue courante (après reports). */
  date_prevue_courante: string;
  statut: RedSuiviStatutJalon;
  realise_le: string | null;
  nombre_reports: number;
  retard_jours: number;
  jours_restants: number;
  evenements: RedSuiviEvenementVue[];
  releves: RedSuiviReleveVue[];
  /** Dernier relevé comparé à la référence de clôture. */
  comparaisons: RedSuiviComparaisonVue[];
}

export interface RedSuiviAlerteVue {
  type: RedSuiviTypeAlerte;
  gravite: RedSuiviGravite;
  jalon_id: string;
  jalon_rang: number;
  ratio: RedSuiviRatio | null;
  libelle: string;
}

export interface RedSuiviPlanVue {
  id: string;
  /** Date de clôture du dossier, base des échéances. */
  date_cloture: string;
  /** Ratios du dernier état accepté à la création du suivi (référence de clôture), éventuellement vides. */
  reference: {
    ratios: RedSuiviRatiosVue;
    exercice: number | null;
    correspondance_version: number | null;
  };
  cree_par: RedPersonne;
  cree_le: string;
}

/** Réponse de `GET`/`POST /redressement/dossiers/:id/suivi[/releves|/jalons/:jalonId/evenements]`. */
export interface RedSuiviVue {
  dossier_id: string;
  dossier_clos: boolean;
  /** Date de référence des échéances et des alertes (jour du serveur). */
  date_reference: string;
  /** Null tant que le suivi n'est pas créé. */
  plan: RedSuiviPlanVue | null;
  jalons: RedSuiviJalonVue[];
  alertes: RedSuiviAlerteVue[];
  synthese: { nombre: number; attention: number; information: number };
  mention: string;
}
