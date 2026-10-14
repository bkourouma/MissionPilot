import { z } from "zod";
import { texte } from "./commun";
import { confirmationIdentiteSchema } from "./double-authentification";
import type { ModeFournisseurCanal } from "./canaux";

/*
 * CLI-05, lot 3c (ADR-010) : demande de signature d'un PDF de mission (lettre de mission, avenant,
 * procès-verbal), signataires cabinet et client, journal de preuves chaîné. Le fournisseur est
 * LOCAL : niveau « simple simulée », SANS VALEUR JURIDIQUE (O-06), aucun appel externe. Une
 * signature n'a aucun effet sur le budget ni sur le statut de la mission.
 *
 * Les listes reprennent celles du moteur `canaux/signature.ts` de `@missionpilot/engines` (un test
 * de l'API vérifie qu'elles sont identiques).
 */

export const OBJETS_SIGNATURE = ["lettre_mission", "avenant", "proces_verbal"] as const;
export type ObjetSignature = (typeof OBJETS_SIGNATURE)[number];

export const ORDRES_SIGNATURE = ["parallele", "sequentiel"] as const;
export type OrdreSignatureDemande = (typeof ORDRES_SIGNATURE)[number];

export const PARTIES_SIGNATAIRE = ["cabinet", "client"] as const;
export type PartieSignataire = (typeof PARTIES_SIGNATAIRE)[number];

export const STATUTS_DEMANDE_SIGNATURE = [
  "brouillon",
  "envoyee",
  "partielle",
  "signee",
  "refusee",
  "annulee",
  "expiree",
] as const;
export type StatutDemandeSignatureApi = (typeof STATUTS_DEMANDE_SIGNATURE)[number];

export const STATUTS_SIGNATAIRE_SIGNATURE = [
  "en_attente",
  "invite",
  "signe",
  "refuse",
  "expire",
] as const;
export type StatutSignataireApi = (typeof STATUTS_SIGNATAIRE_SIGNATURE)[number];

export const TYPES_PREUVE_SIGNATURE = [
  "demande_creee",
  "invitation_envoyee",
  "document_consulte",
  "reconfirmation_identite",
  "signature_apposee",
  "refus",
  "annulation",
  "expiration",
  "scellement",
] as const;
export type TypePreuveSignatureApi = (typeof TYPES_PREUVE_SIGNATURE)[number];

export const AUTHENTIFICATIONS_PREUVE = ["mot_de_passe", "mot_de_passe_et_2fa"] as const;

/** Niveau REVENDIQUÉ par le fournisseur local : sans valeur juridique. */
export const NIVEAU_SIGNATURE_SIMULEE = "simple_simulee" as const;

/** Limites (valeurs PROVISOIRES : SPEC §13). */
export const PLAFONDS_SIGNATURES = {
  creationsPar10Min: 30,
  ouvertesParMission: 20,
  signatairesMax: 10,
  validiteJoursDefaut: 30,
  validiteJoursMin: 1,
  validiteJoursMax: 90,
  listeLimiteMax: 100,
  listeLimiteDefaut: 30,
} as const;

/* ----- Libellés français ----- */

export const AVERTISSEMENT_SIGNATURE_SIMULEE = "Signature simulée : sans valeur juridique";

export const LIBELLES_OBJET_SIGNATURE: Record<ObjetSignature, string> = {
  lettre_mission: "Lettre de mission",
  avenant: "Avenant",
  proces_verbal: "Procès-verbal",
};

export const LIBELLES_ORDRE_SIGNATURE: Record<OrdreSignatureDemande, string> = {
  parallele: "Dans n'importe quel ordre",
  sequentiel: "Les uns après les autres",
};

export const LIBELLES_PARTIE_SIGNATAIRE: Record<PartieSignataire, string> = {
  cabinet: "Cabinet",
  client: "Client",
};

export const LIBELLES_STATUT_DEMANDE_SIGNATURE: Record<StatutDemandeSignatureApi, string> = {
  brouillon: "Brouillon",
  envoyee: "Envoyée",
  partielle: "Partiellement signée",
  signee: "Signée",
  refusee: "Refusée",
  annulee: "Annulée",
  expiree: "Expirée",
};

export const LIBELLES_STATUT_SIGNATAIRE: Record<StatutSignataireApi, string> = {
  en_attente: "En attente",
  invite: "Invité",
  signe: "A signé",
  refuse: "A refusé",
  expire: "Expiré",
};

export const LIBELLES_TYPE_PREUVE_SIGNATURE: Record<TypePreuveSignatureApi, string> = {
  demande_creee: "Demande créée",
  invitation_envoyee: "Invitation envoyée",
  document_consulte: "Document consulté",
  reconfirmation_identite: "Identité reconfirmée",
  signature_apposee: "Signé",
  refus: "Refus",
  annulation: "Annulation",
  expiration: "Expiration",
  scellement: "Dossier scellé",
};

export const LIBELLES_CAUSE_CHAINE_INVALIDE: Record<string, string> = {
  EMPREINTE_DIFFERENTE: "Une preuve a été modifiée",
  RANG_MANQUANT: "Une preuve manque dans la chaîne",
  PRECEDENTE_INCOHERENTE: "L'enchaînement des preuves est incohérent",
  DOCUMENT_DIFFERENT: "L'empreinte du document diffère",
};

/* ----- Schémas d'entrée ----- */

const uuid = z.string().uuid();
const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(PLAFONDS_SIGNATURES.listeLimiteMax)
  .default(PLAFONDS_SIGNATURES.listeLimiteDefaut);

export const signatureParamSchema = z.object({ id: uuid }).strict();
export const signatureMissionParamSchema = z.object({ id: uuid }).strict();

export const signataireDemandeSchema = z
  .object({ utilisateur_id: uuid, partie: z.enum(PARTIES_SIGNATAIRE) })
  .strict();

/**
 * `POST /missions/:id/signatures` : un PDF de la mission (`document_id`), l'objet, l'ordre, la
 * validité (1 à 90 jours) et au plus 10 signataires distincts. Le lien d'un avenant à une version
 * de budget ne sert qu'à l'objet « avenant » et ne rend que son numéro et son type.
 */
export const signatureCreationSchema = z
  .object({
    document_id: uuid,
    objet: z.enum(OBJETS_SIGNATURE),
    ordre: z.enum(ORDRES_SIGNATURE).default("parallele"),
    expire_jours: z
      .number()
      .int()
      .min(PLAFONDS_SIGNATURES.validiteJoursMin)
      .max(PLAFONDS_SIGNATURES.validiteJoursMax)
      .default(PLAFONDS_SIGNATURES.validiteJoursDefaut),
    signataires: z.array(signataireDemandeSchema).min(1).max(PLAFONDS_SIGNATURES.signatairesMax),
    budget_version_id: uuid.optional(),
  })
  .strict()
  .refine(
    (v) => new Set(v.signataires.map((s) => s.utilisateur_id)).size === v.signataires.length,
    {
      message: "Un signataire ne figure qu'une fois.",
      path: ["signataires"],
    },
  )
  .refine((v) => v.budget_version_id === undefined || v.objet === "avenant", {
    message: "Une version de budget ne se lie qu'à un avenant.",
    path: ["budget_version_id"],
  });
export type SignatureCreation = z.infer<typeof signatureCreationSchema>;

/** Corps vide : envoi d'une demande. */
export const signatureEnvoiSchema = z.object({}).strict();

/** Annulation (demandeur ou associé) et refus : motif obligatoire. */
export const signatureAnnulationSchema = z.object({ motif: texte(500) }).strict();
export const signatureRefusSchema = z.object({ motif: texte(500) }).strict();

/**
 * Signature (`POST /signatures/:id/signer`, `POST /portail/signatures/:id/signer`) : reconfirmation
 * d'identité (mot de passe et, la 2FA étant exigée pour signer, code ou code de secours : 409
 * `TFA_INACTIVE` sans second facteur actif). Corps strict, aucun autre champ.
 */
export const signatureSignerSchema = confirmationIdentiteSchema;

export const signaturesQuerySchema = z
  .object({
    statut: z.enum(STATUTS_DEMANDE_SIGNATURE).optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

export const signaturesPortailQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema })
  .strict();

/* ----- Réponses proposées ----- */

export interface SignataireSignatureApi {
  readonly id: string;
  readonly utilisateur_id: string;
  readonly nom: string;
  readonly partie: PartieSignataire;
  readonly rang: number;
  readonly statut: StatutSignataireApi;
  readonly invite_le: string | null;
  readonly decide_le: string | null;
}

export interface DemandeSignatureApi {
  readonly id: string;
  readonly mission_id: string;
  readonly document_id: string;
  readonly document_nom: string;
  readonly objet: ObjetSignature;
  readonly ordre: OrdreSignatureDemande;
  readonly statut: StatutDemandeSignatureApi;
  readonly expire_le: string | null;
  readonly empreinte_document: string;
  readonly mode_fournisseur: ModeFournisseurCanal;
  readonly niveau: typeof NIVEAU_SIGNATURE_SIMULEE;
  readonly signataires_total: number;
  readonly signataires_signes: number;
  readonly demandeur_id: string;
  readonly cree_le: string;
  /** Un avenant ne rend que le numéro et le type de la version de budget, jamais un montant. */
  readonly budget_version?: { readonly numero: number; readonly type: string } | null;
}

export interface PreuveSignatureApi {
  readonly rang: number;
  readonly type_evenement: TypePreuveSignatureApi;
  readonly signataire_id: string | null;
  readonly horodatage: string;
  /** « base_locale » : l'horloge de la base, PAS un horodatage qualifié (O-06). */
  readonly horodatage_source: "base_locale";
  readonly authentification: (typeof AUTHENTIFICATIONS_PREUVE)[number] | null;
  readonly empreinte: string;
  readonly empreinte_precedente: string;
}

export type VerificationChaineApi =
  | { readonly valide: true }
  | {
      readonly valide: false;
      readonly rang: number;
      readonly cause:
        "EMPREINTE_DIFFERENTE" | "RANG_MANQUANT" | "PRECEDENTE_INCOHERENTE" | "DOCUMENT_DIFFERENT";
    };

/** `GET /signatures/:id/preuves` : JSON seul, chaîne revérifiée à chaque lecture. */
export interface DossierPreuveApi {
  readonly demande: DemandeSignatureApi;
  readonly signataires: readonly SignataireSignatureApi[];
  readonly preuves: readonly PreuveSignatureApi[];
  readonly verification: VerificationChaineApi;
}

/** Portail : avancement par compteurs, jamais un nom ni un e-mail d'un membre du cabinet. */
export interface DemandeSignaturePortailApi {
  readonly id: string;
  readonly objet: ObjetSignature;
  readonly statut: Exclude<StatutDemandeSignatureApi, "brouillon">;
  readonly expire_le: string | null;
  readonly signataires_total: number;
  readonly signataires_signes: number;
  readonly mon_statut: StatutSignataireApi;
  readonly peut_signer: boolean;
}

/** Accusé d'une signature depuis le portail : statut, date, empreinte du document. */
export interface AccuseSignatureApi {
  readonly statut: Exclude<StatutDemandeSignatureApi, "brouillon">;
  readonly signe_le: string;
  readonly empreinte_document: string;
}
