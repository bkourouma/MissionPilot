import { z } from "zod";
import { texte, texteOptionnel } from "./commun";
import {
  RED_DOMAINES,
  RED_SECTEURS,
  type RedDomaine,
  type RedPersonne,
  type RedSecteur,
} from "./redressement";

/*
 * Check-lists métier du redressement (RED-03, lot 2) : modèles configurables par le cabinet,
 * versionnés (brouillon puis publiée), activés dans un dossier sous forme d'instantané figé, puis
 * renseignés item par item. Contrat des routes /api/redressement/checklists/** et
 * /api/redressement/dossiers/:id/checklists.
 *
 * - Les taux (complétude, conformité) sortent de `packages/engines/src/redressement/checklists.ts` ;
 *   ces schémas ne portent que des saisies, des constantes et des libellés. Les constantes sont
 *   DUPLIQUÉES du moteur (`packages/shared` n'importe pas `packages/engines`) ; un test d'API vérifie
 *   la parité.
 * - Le contenu de départ est PROVISOIRE et marqué « à valider par un expert ».
 * - Aucune qualification juridique dans les libellés : une check-list est un constat de saisie,
 *   jamais une situation de droit.
 */

const uuid = z.string().uuid();

/* ----- Constantes, libellés et plafonds ----- */

export const RED_CHECKLIST_REPONSES = ["oui", "non", "partiel", "sans_objet"] as const;
export type RedChecklistReponse = (typeof RED_CHECKLIST_REPONSES)[number];
export const RED_CHECKLIST_REPONSE_LIBELLES: Record<RedChecklistReponse, string> = {
  oui: "Oui",
  non: "Non",
  partiel: "Partiellement",
  sans_objet: "Sans objet",
};

export const RED_CHECKLIST_ORIGINES = ["depart", "modele"] as const;
export type RedChecklistOrigine = (typeof RED_CHECKLIST_ORIGINES)[number];
export const RED_CHECKLIST_ORIGINE_LIBELLES: Record<RedChecklistOrigine, string> = {
  depart: "Contenu de départ",
  modele: "Modèle du cabinet",
};

export const RED_CHECKLIST_STATUTS_VERSION = ["brouillon", "publiee"] as const;
export type RedChecklistStatutVersion = (typeof RED_CHECKLIST_STATUTS_VERSION)[number];
export const RED_CHECKLIST_STATUT_VERSION_LIBELLES: Record<RedChecklistStatutVersion, string> = {
  brouillon: "Brouillon",
  publiee: "Publiée",
};

export const RED_CHECKLIST_STATUTS = ["active", "archivee"] as const;
export type RedChecklistStatut = (typeof RED_CHECKLIST_STATUTS)[number];
export const RED_CHECKLIST_STATUT_LIBELLES: Record<RedChecklistStatut, string> = {
  active: "Active",
  archivee: "Archivée",
};

/** Mention affichée avec tout contenu de départ (jamais un avis d'expert). */
export const RED_CHECKLIST_MENTION_A_VALIDER =
  "Contenu de départ provisoire, à valider par un expert avant tout usage de référence.";

/** Bornes d'un modèle (identiques à celles du moteur et de la base). */
export const RED_CHECKLIST_ITEMS_MAX = 40;
export const RED_CHECKLIST_ITEM_ID_MAX = 40;
export const RED_CHECKLIST_LIBELLE_MAX = 300;
export const RED_CHECKLIST_AIDE_MAX = 600;
export const RED_CHECKLIST_COMMENTAIRE_MAX = 500;

/** Plafonds de volume, imposés en base (MPZ10) et rappelés au client. */
export const RED_CHECKLIST_PLAFONDS = {
  modeles_par_cabinet: 100,
  versions_par_modele: 30,
  checklists_par_dossier: 30,
  reponses_par_checklist: 2000,
  reponses_par_lot: RED_CHECKLIST_ITEMS_MAX,
} as const;

/** Identifiant d'item : minuscules, chiffres, tiret bas ou tiret (stable d'une version à l'autre). */
export const RED_CHECKLIST_MOTIF_ITEM_ID = /^[a-z0-9][a-z0-9_-]*$/;
/** Code d'un modèle du cabinet : unique dans le cabinet, de 2 à 40 caractères. */
export const RED_CHECKLIST_MOTIF_CODE = /^[a-z0-9][a-z0-9_-]{1,39}$/;

/** Tous les libellés français de ce module (relus par les tests de vocabulaire). */
export function libellesChecklists(): string[] {
  return [
    ...Object.values(RED_CHECKLIST_REPONSE_LIBELLES),
    ...Object.values(RED_CHECKLIST_ORIGINE_LIBELLES),
    ...Object.values(RED_CHECKLIST_STATUT_VERSION_LIBELLES),
    ...Object.values(RED_CHECKLIST_STATUT_LIBELLES),
    RED_CHECKLIST_MENTION_A_VALIDER,
  ];
}

/* ----- Saisies (strictes) ----- */

const identifiantsUniques = (liste: { id: string }[]) =>
  new Set(liste.map((x) => x.id)).size === liste.length;

export const redChecklistItemSchema = z
  .object({
    id: z.string().min(1).max(RED_CHECKLIST_ITEM_ID_MAX).regex(RED_CHECKLIST_MOTIF_ITEM_ID),
    domaine: z.enum(RED_DOMAINES),
    libelle: texte(RED_CHECKLIST_LIBELLE_MAX),
    aide: texteOptionnel(RED_CHECKLIST_AIDE_MAX),
  })
  .strict();

const itemsSchema = z
  .array(redChecklistItemSchema)
  .min(1)
  .max(RED_CHECKLIST_ITEMS_MAX)
  .refine(identifiantsUniques, "Identifiants d'items en double.");

/** Nouveau modèle du cabinet : sa première version naît en brouillon. */
export const redChecklistModeleCreationSchema = z
  .object({
    code: z.string().regex(RED_CHECKLIST_MOTIF_CODE),
    intitule: texte(200),
    secteur: z.enum(RED_SECTEURS),
    items: itemsSchema,
    motif: texteOptionnel(500),
  })
  .strict();

/** Nouvelle version (brouillon) d'un modèle existant. */
export const redChecklistVersionCreationSchema = z
  .object({ items: itemsSchema, motif: texteOptionnel(500) })
  .strict();

export const redChecklistPublicationSchema = z.object({}).strict();

export const redChecklistModelesQuerySchema = z
  .object({ secteur: z.enum(RED_SECTEURS).optional() })
  .strict();

/** Activation dans un dossier : une check-list de départ (par code) ou la version publiée d'un modèle. */
export const redChecklistActivationSchema = z.discriminatedUnion("origine", [
  z
    .object({
      origine: z.literal("depart"),
      code: z.string().regex(RED_CHECKLIST_MOTIF_CODE),
    })
    .strict(),
  z.object({ origine: z.literal("modele"), modele_id: uuid }).strict(),
]);

export const redChecklistReponseSchema = z
  .object({
    item_id: z.string().min(1).max(RED_CHECKLIST_ITEM_ID_MAX),
    reponse: z.enum(RED_CHECKLIST_REPONSES),
    commentaire: texteOptionnel(RED_CHECKLIST_COMMENTAIRE_MAX),
  })
  .strict();

/** Un lot de réponses : un item au plus une fois par lot (la dernière réponse d'un item est la courante). */
export const redChecklistReponsesLotSchema = z
  .object({
    reponses: z
      .array(redChecklistReponseSchema)
      .min(1)
      .max(RED_CHECKLIST_PLAFONDS.reponses_par_lot)
      .refine(
        (l) => new Set(l.map((r) => r.item_id)).size === l.length,
        "Un item ne figure qu'une fois par lot.",
      ),
  })
  .strict();

export const redChecklistArchivageSchema = z.object({ motif: texteOptionnel(500) }).strict();

export const redChecklistsQuerySchema = z
  .object({ statut: z.enum(["active", "archivee", "toutes"]).default("active") })
  .strict();

export type RedChecklistItem = z.infer<typeof redChecklistItemSchema>;
export type RedChecklistModeleCreation = z.infer<typeof redChecklistModeleCreationSchema>;
export type RedChecklistVersionCreation = z.infer<typeof redChecklistVersionCreationSchema>;
export type RedChecklistActivation = z.infer<typeof redChecklistActivationSchema>;
export type RedChecklistReponseSaisie = z.infer<typeof redChecklistReponseSchema>;
export type RedChecklistReponsesLot = z.infer<typeof redChecklistReponsesLotSchema>;
export type RedChecklistsQuery = z.infer<typeof redChecklistsQuerySchema>;

/* ----- Types de réponse (miroirs snake_case des sorties du moteur) ----- */

export interface RedChecklistItemVue {
  id: string;
  domaine: RedDomaine;
  libelle: string;
  aide: string | null;
}

export interface RedChecklistDepartVue {
  code: string;
  secteur: RedSecteur;
  intitule: string;
  a_valider_par_un_expert: true;
  items: RedChecklistItemVue[];
}

/** Route « référentiel » : contenu de départ, libellés et plafonds. Aucune lecture en base. */
export interface RedChecklistReferentielVue {
  version_moteur_checklists: number;
  version_depart: number;
  mention_a_valider: string;
  secteurs: RedSecteur[];
  reponses: RedChecklistReponse[];
  departs: RedChecklistDepartVue[];
  plafonds: typeof RED_CHECKLIST_PLAFONDS;
}

export interface RedChecklistVersionVue {
  id: string;
  modele_id: string;
  version: number;
  statut: RedChecklistStatutVersion;
  /** Vrai pour une version publiée qui n'est plus en vigueur (une version publiée plus récente existe). */
  remplacee: boolean;
  nombre_items: number;
  /** Présents sur la version en vigueur, le brouillon et les versions rendues seules ; absents de l'historique. */
  items?: RedChecklistItemVue[];
  motif: string | null;
  cree_par: RedPersonne;
  cree_le: string;
  publiee_par: RedPersonne | null;
  publiee_le: string | null;
  /** Confort d'affichage (brouillon, rôle, auteur) : l'API reste juge. */
  peut_publier: boolean;
}

export interface RedChecklistModeleVue {
  id: string;
  code: string;
  intitule: string;
  secteur: RedSecteur;
  cree_par: RedPersonne;
  cree_le: string;
  en_vigueur: RedChecklistVersionVue | null;
  brouillon: RedChecklistVersionVue | null;
  /** Toutes les versions, sans leurs items, de la plus récente à la plus ancienne. */
  historique: RedChecklistVersionVue[];
}

/** `GET /redressement/checklists/modeles`. */
export interface RedChecklistModelesVue {
  modeles: RedChecklistModeleVue[];
}

export interface RedChecklistBilanVue {
  total: number;
  oui: number;
  non: number;
  partiel: number;
  sans_objet: number;
  non_renseignes: number;
  applicables: number;
  completude_pb: number | null;
  conformite_pb: number | null;
}

export interface RedChecklistEvaluationVue {
  version: number;
  domaines: (RedChecklistBilanVue & { domaine: RedDomaine })[];
  global: RedChecklistBilanVue;
  non_conformes: string[];
  partiels: string[];
  non_renseignes: string[];
  complete: boolean;
}

/** Réponse COURANTE d'un item (la plus récente). */
export interface RedChecklistReponseVue {
  item_id: string;
  reponse: RedChecklistReponse;
  commentaire: string | null;
  auteur: RedPersonne;
  cree_le: string;
}

export interface RedChecklistResumeVue {
  id: string;
  intitule: string;
  secteur: RedSecteur;
  origine: RedChecklistOrigine;
  statut: RedChecklistStatut;
  a_valider_par_un_expert: boolean;
  nombre_items: number;
  completude_pb: number | null;
  conformite_pb: number | null;
  cree_par: RedPersonne;
  cree_le: string;
}

/** `GET /redressement/dossiers/:id/checklists`. */
export interface RedChecklistsVue {
  checklists: RedChecklistResumeVue[];
}

/** Une check-list activée : instantané figé, réponses courantes et évaluation du moteur. */
export interface RedChecklistVue {
  id: string;
  dossier_id: string;
  intitule: string;
  secteur: RedSecteur;
  origine: RedChecklistOrigine;
  code_depart: string | null;
  modele_id: string | null;
  modele_version: number | null;
  statut: RedChecklistStatut;
  a_valider_par_un_expert: boolean;
  items: RedChecklistItemVue[];
  reponses: RedChecklistReponseVue[];
  evaluation: RedChecklistEvaluationVue;
  cree_par: RedPersonne;
  cree_le: string;
  archivee_le: string | null;
  motif_archivage: string | null;
  /** Confort d'affichage : peut répondre (droit, dossier ouvert, check-list active). */
  peut_repondre: boolean;
}
