import { z } from "zod";
import { dateIsoBorneeSchema, MESSAGE_CORPS_VIDE, texte } from "./commun";
import { codeSecoursSchema, codeTotpSchema } from "./double-authentification";

/*
 * Lot 3c (vague 4, ADR-008, ADR-010, ADR-013) : canaux externes en mode SIMULÉ. WhatsApp et SMS de
 * repli (CLI-02, CLI-07, KPI-14), consentement, journal d'envois sans contenu, synthèse
 * hebdomadaire du dirigeant. Aucun envoi réel, aucune clé, aucune donnée réelle de personne :
 * chaque réponse qui décrit un compte ou un envoi porte `mode_fournisseur`, et l'interface affiche
 * « Simulé : aucun envoi réel ».
 *
 * Les corps et paramètres des routes de la SPEC-3c §10.2 sont validés ici, tous `.strict()`.
 * Les listes reprennent celles des moteurs de `@missionpilot/engines` (`canaux/`), dont ce paquet
 * ne dépend pas : un test de l'API vérifie qu'elles sont identiques.
 *
 * Les types `…Api` en fin de fichier décrivent la forme des réponses proposée pour les écrans ;
 * jamais un numéro de téléphone (masque seulement), jamais un texte de message, jamais un coût sans
 * `finance.lire` (FIN-02 : champ ABSENT).
 */

/* ----- Listes fermées ----- */

export const CANAUX_MESSAGERIE = ["whatsapp", "sms"] as const;
export type CanalMessagerie = (typeof CANAUX_MESSAGERIE)[number];
export const canalMessagerieSchema = z.enum(CANAUX_MESSAGERIE);

/** « reel » est réservé : aucun adaptateur réel n'existe dans ce lot. */
export const MODES_FOURNISSEUR_CANAL = ["simule", "reel"] as const;
export type ModeFournisseurCanal = (typeof MODES_FOURNISSEUR_CANAL)[number];

export const STATUTS_ENVOI_CANAL = [
  "reserve",
  "en_cours",
  "accepte",
  "livre",
  "lu",
  "echec",
  "bloque",
  "incertain",
] as const;
export type StatutEnvoiCanal = (typeof STATUTS_ENVOI_CANAL)[number];

export const CATEGORIES_ENVOI_CANAL = [
  "verification",
  "relance",
  "synthese",
  "alerte",
  "signature",
  "reponse_service",
] as const;
export type CategorieEnvoiCanal = (typeof CATEGORIES_ENVOI_CANAL)[number];

export const OBJETS_ENVOI_CANAL = [
  "questionnaire_envoi",
  "signature_demande",
  "kpi_saisie",
  "synthese",
  "verification",
  "kpi_alerte",
] as const;
export type ObjetEnvoiCanal = (typeof OBJETS_ENVOI_CANAL)[number];

export const MOTIFS_BLOCAGE_CANAL = [
  "consentement_absent",
  "consentement_retire",
  "numero_non_verifie",
  "canal_inactif",
  "destinataire_inactif",
  "coupe_circuit",
  "plafond_destinataire",
  "plafond_cabinet",
  "plafond_reponses",
  "fenetre_fermee",
] as const;
export type MotifBlocageCanal = (typeof MOTIFS_BLOCAGE_CANAL)[number];

export const CODES_REFUS_ENVOI_CANAL = [
  "NUMERO_NON_JOIGNABLE",
  "GABARIT_REFUSE",
  "QUOTA_ATTEINT",
  "FENETRE_FERMEE",
  "INDISPONIBLE",
] as const;
export type CodeRefusEnvoiCanal = (typeof CODES_REFUS_ENVOI_CANAL)[number];

export const CODES_GABARIT_CANAL = [
  "verification_numero",
  "relance_questionnaire_j10",
  "synthese_hebdo",
  "signature_a_effectuer",
  "alerte_kpi",
  "reponse_stop",
  "reponse_saisie_a_confirmer",
  "reponse_saisie_a_verifier",
  "reponse_saisie_enregistree",
  "reponse_saisie_refusee",
  "reponse_non_comprise",
] as const;
export type CodeGabaritCanal = (typeof CODES_GABARIT_CANAL)[number];

export const STATUTS_CONSENTEMENT = ["accorde", "retire"] as const;
export type StatutConsentement = (typeof STATUTS_CONSENTEMENT)[number];
/** État courant d'un consentement : la dernière ligne de l'historique, ou « absent ». */
export type ConsentementCourantCanal = StatutConsentement | "absent";

export const SOURCES_CONSENTEMENT = [
  "portail",
  "recueilli_cabinet",
  "retrait_portail",
  "retrait_cabinet",
  "message_stop",
  "changement_numero",
  "desactivation_utilisateur",
] as const;
export type SourceConsentement = (typeof SOURCES_CONSENTEMENT)[number];

export const ORIGINES_SAISIE_KPI = ["texte", "vocal"] as const;
export type OrigineSaisieKpi = (typeof ORIGINES_SAISIE_KPI)[number];

export const STATUTS_SAISIE_KPI = [
  "a_confirmer",
  "confirmee",
  "refusee",
  "expiree",
  "rejetee_vraisemblance",
  "reprise",
  "rejetee_cabinet",
] as const;
export type StatutSaisieKpi = (typeof STATUTS_SAISIE_KPI)[number];

export const VRAISEMBLANCES_SAISIE_KPI = ["ok", "a_verifier", "invraisemblable"] as const;
export type VraisemblanceSaisieKpi = (typeof VRAISEMBLANCES_SAISIE_KPI)[number];

export const GENRES_MESSAGE_ENTRANT = ["texte", "audio", "autre"] as const;
export const STATUTS_RECUS_CANAL = ["envoye", "livre", "lu", "echec"] as const;

/* ----- Plafonds et limites (valeurs PROVISOIRES : SPEC §13, §15 ; O-16) ----- */

export const PLAFONDS_CANAUX = {
  /** Messages à l'initiative du cabinet, par destinataire et par 24 h. */
  envoisDestinataire24h: 3,
  /** Messages à l'initiative du cabinet, par cabinet et par mois civil UTC. */
  envoisCabinetMois: 2000,
  /** Codes de vérification : par heure et destinataire, validité, essais. */
  codesParHeure: 3,
  codeValiditeMinutes: 10,
  codeEssaisMax: 5,
  /** Réponses de service par destinataire et par 24 h. */
  reponsesService24h: 10,
  /** Fenêtre de service d'une réponse libre (heures). */
  fenetreServiceHeures: 24,
  webhookParMinuteEtCompte: 600,
  webhookInvalidesParCinqMinutes: 30,
  webhookCorpsMaxOctets: 65_536,
  webhookEvenementsMax: 50,
  webhookFenetreSecondes: 300,
  /** Propositions de saisie de KPI : par destinataire et par 24 h, validité. */
  saisiesKpi24h: 20,
  saisieKpiValiditeMinutes: 15,
  apercuSynthesePar10Min: 30,
  simulateurEntrantsPar10Min: 60,
  listeLimiteMax: 100,
  listeLimiteDefaut: 30,
} as const;

/* ----- Mentions de consentement (texte PROVISOIRE, O-05) ----- */

/**
 * Le client n'envoie que la version ; le serveur calcule l'empreinte du texte exact affiché
 * (409 `MENTION_PERIMEE` pour une version périmée).
 */
export const MENTIONS_CONSENTEMENT = {
  "whatsapp-v1": {
    version: "whatsapp-v1",
    canal: "whatsapp",
    texte:
      "J'accepte de recevoir de mon cabinet de conseil, sur ce numéro, des rappels et des synthèses sans données confidentielles. Je peux me désinscrire à tout moment en répondant STOP ou depuis mon espace.",
  },
  "sms-v1": {
    version: "sms-v1",
    canal: "sms",
    texte:
      "J'accepte de recevoir de mon cabinet de conseil, par SMS sur ce numéro, des rappels et des synthèses sans données confidentielles. Je peux me désinscrire à tout moment en répondant STOP ou depuis mon espace.",
  },
} as const;
export const VERSIONS_MENTION_CONSENTEMENT = ["whatsapp-v1", "sms-v1"] as const;
export type VersionMentionConsentement = (typeof VERSIONS_MENTION_CONSENTEMENT)[number];
/** Version en vigueur pour chaque canal. */
export const MENTION_COURANTE: Record<CanalMessagerie, VersionMentionConsentement> = {
  whatsapp: "whatsapp-v1",
  sms: "sms-v1",
};

/* ----- Libellés français (jamais un identifiant technique à l'écran) ----- */

export const TEXTES_CANAUX = {
  bandeauSimule: "Simulé : aucun envoi réel",
  apercuAucunEnvoi: "Aperçu : rien n'est envoyé",
  rienASignaler: "Rien à signaler : aucun message ne serait envoyé",
} as const;

export const LIBELLES_CANAL: Record<CanalMessagerie, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
};

export const LIBELLES_STATUT_ENVOI_CANAL: Record<StatutEnvoiCanal, string> = {
  reserve: "Réservé",
  en_cours: "En cours d'envoi",
  accepte: "Accepté",
  livre: "Livré",
  lu: "Lu",
  echec: "Échec",
  bloque: "Bloqué",
  incertain: "Incertain (non renvoyé)",
};

export const LIBELLES_MOTIF_BLOCAGE_CANAL: Record<MotifBlocageCanal, string> = {
  consentement_absent: "Consentement absent",
  consentement_retire: "Consentement retiré",
  numero_non_verifie: "Numéro non vérifié",
  canal_inactif: "Canal inactif",
  destinataire_inactif: "Destinataire inactif",
  coupe_circuit: "Coupe-circuit actif",
  plafond_destinataire: "Plafond d'envois du destinataire atteint",
  plafond_cabinet: "Plafond d'envois du cabinet atteint",
  plafond_reponses: "Plafond de réponses atteint",
  fenetre_fermee: "Fenêtre de réponse fermée",
};

export const LIBELLES_CODE_REFUS_CANAL: Record<CodeRefusEnvoiCanal, string> = {
  NUMERO_NON_JOIGNABLE: "Numéro non joignable",
  GABARIT_REFUSE: "Gabarit refusé",
  QUOTA_ATTEINT: "Quota atteint",
  FENETRE_FERMEE: "Fenêtre de réponse fermée",
  INDISPONIBLE: "Service indisponible",
};

export const LIBELLES_CATEGORIE_ENVOI_CANAL: Record<CategorieEnvoiCanal, string> = {
  verification: "Vérification du numéro",
  relance: "Relance",
  synthese: "Synthèse",
  alerte: "Alerte",
  signature: "Signature",
  reponse_service: "Réponse de service",
};

export const LIBELLES_OBJET_ENVOI_CANAL: Record<ObjetEnvoiCanal, string> = {
  questionnaire_envoi: "Questionnaire",
  signature_demande: "Demande de signature",
  kpi_saisie: "Saisie d'indicateur",
  synthese: "Synthèse hebdomadaire",
  verification: "Vérification du numéro",
  kpi_alerte: "Alerte d'indicateur",
};

export const LIBELLES_CODE_GABARIT_CANAL: Record<CodeGabaritCanal, string> = {
  verification_numero: "Code de vérification",
  relance_questionnaire_j10: "Relance de questionnaire (J+10)",
  synthese_hebdo: "Synthèse hebdomadaire",
  signature_a_effectuer: "Signature à effectuer",
  alerte_kpi: "Alerte d'indicateur",
  reponse_stop: "Confirmation de désinscription",
  reponse_saisie_a_confirmer: "Saisie à confirmer",
  reponse_saisie_a_verifier: "Saisie à vérifier",
  reponse_saisie_enregistree: "Saisie enregistrée",
  reponse_saisie_refusee: "Saisie refusée",
  reponse_non_comprise: "Message non compris",
};

export const LIBELLES_CONSENTEMENT_COURANT: Record<ConsentementCourantCanal, string> = {
  accorde: "Accordé",
  retire: "Retiré",
  absent: "Absent",
};

export const LIBELLES_SOURCE_CONSENTEMENT: Record<SourceConsentement, string> = {
  portail: "Accordé par la personne (portail)",
  recueilli_cabinet: "Recueilli par le cabinet",
  retrait_portail: "Retiré par la personne (portail)",
  retrait_cabinet: "Retiré par le cabinet",
  message_stop: "Message STOP",
  changement_numero: "Changement de numéro",
  desactivation_utilisateur: "Utilisateur désactivé",
};

export const LIBELLES_STATUT_SAISIE_KPI: Record<StatutSaisieKpi, string> = {
  a_confirmer: "À confirmer par la personne",
  confirmee: "Confirmée, à reprendre",
  refusee: "Refusée par la personne",
  expiree: "Expirée",
  rejetee_vraisemblance: "Écartée (valeur invraisemblable)",
  reprise: "Reprise dans l'indicateur",
  rejetee_cabinet: "Rejetée par le cabinet",
};

export const LIBELLES_VRAISEMBLANCE_SAISIE_KPI: Record<VraisemblanceSaisieKpi, string> = {
  ok: "Vraisemblable",
  a_verifier: "À vérifier",
  invraisemblable: "Invraisemblable",
};

export const LIBELLES_ORIGINE_SAISIE_KPI: Record<OrigineSaisieKpi, string> = {
  texte: "Message écrit",
  vocal: "Message vocal",
};

/* ----- Schémas d'entrée ----- */

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u001f\u007f]/;
const uuid = z.string().uuid();
const curseurSchema = z.string().max(500).optional();
const limiteSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(PLAFONDS_CANAUX.listeLimiteMax)
  .default(PLAFONDS_CANAUX.listeLimiteDefaut);

export const canalParamSchema = z.object({ canal: canalMessagerieSchema }).strict();
export const canalUtilisateurParamSchema = z
  .object({ utilisateurId: uuid, canal: canalMessagerieSchema })
  .strict();
export const idCanauxParamSchema = z.object({ id: uuid }).strict();

/** Corps vide (retrait, envoi) : aucune clé admise. */
export const corpsVideCanauxSchema = z.object({}).strict();

/**
 * Numéro saisi, en clair, dans le corps seulement (jamais dans une URL ni une réponse). La
 * normalisation E.164 (`normaliserNumero` du moteur) et le refus d'un numéro réel en mode simulé
 * (400 `NUMERO_REEL_REFUSE_EN_SIMULE`) sont faits par l'API.
 */
export const numeroSaisiSchema = z
  .string()
  .trim()
  .min(5)
  .max(40)
  .refine((v) => !CONTROLES.test(v), "Caractère de contrôle refusé.");
export const numeroDestinataireSchema = z.object({ numero: numeroSaisiSchema }).strict();

/** Code de vérification à six chiffres (espaces tolérés). */
export const codeVerificationNumeroSchema = z
  .object({
    code: z
      .string()
      .max(20)
      .transform((v) => v.replace(/\s/g, ""))
      .pipe(z.string().regex(/^\d{6}$/, "Code à 6 chiffres attendu.")),
  })
  .strict();

/** Référence de la preuve d'un consentement recueilli hors ligne : 10 à 500 caractères. */
export const referencePreuveConsentementSchema = z.string().trim().min(10).max(500);

/**
 * Consentement enregistré par le cabinet (`canaux.gerer`) : `accorde` exige la référence de la
 * preuve ; un retrait n'est jamais refusé et n'en exige pas.
 */
export const consentementCabinetSchema = z
  .object({
    statut: z.enum(STATUTS_CONSENTEMENT),
    reference_preuve: referencePreuveConsentementSchema.optional(),
  })
  .strict()
  .refine((v) => v.statut === "retire" || v.reference_preuve !== undefined, {
    message: "La référence de la preuve est obligatoire pour enregistrer un consentement.",
    path: ["reference_preuve"],
  });

/** Portail : `PUT /portail/canaux/moi/:canal` (case de la mention cochée, numéro facultatif). */
export const preferenceCanalPortailSchema = z
  .object({
    numero: numeroSaisiSchema.optional(),
    mention_version: z.enum(VERSIONS_MENTION_CONSENTEMENT),
    consentement: z.literal(true),
  })
  .strict();

/** Reconfirmation d'identité jointe à l'activation d'un compte (mot de passe seul admis sans 2FA). */
const champsConfirmation = {
  mot_de_passe: z.string().min(1).max(200).optional(),
  code: codeTotpSchema.optional(),
  code_secours: codeSecoursSchema.optional(),
};
const auPlusUnFacteur = (v: { code?: string; code_secours?: string }) =>
  v.code === undefined || v.code_secours === undefined;

const champsCompte = {
  actif: z.boolean().optional(),
  repli_sms: z.boolean().optional(),
  relance_questionnaire_j10: z.boolean().optional(),
  synthese_hebdo: z.boolean().optional(),
  saisie_kpi: z.boolean().optional(),
};
export const CHAMPS_COMPTE_CANAL = [
  "actif",
  "repli_sms",
  "relance_questionnaire_j10",
  "synthese_hebdo",
  "saisie_kpi",
] as const;

/**
 * `PUT /canaux/comptes/:canal` : `canaux.configurer` (associé) ; `canaux.gerer` suffit pour
 * `{ actif: false }` seul (coupe-circuit par canal, sans reconfirmation). Activer exige la
 * reconfirmation (`mot_de_passe`, et `code` ou `code_secours` si la 2FA est active).
 */
export const compteCanalModificationSchema = z
  .object({ ...champsCompte, ...champsConfirmation })
  .strict()
  .refine((v) => CHAMPS_COMPTE_CANAL.some((c) => v[c] !== undefined), MESSAGE_CORPS_VIDE)
  .refine(auPlusUnFacteur, "Fournir soit un code, soit un code de secours.");
export type CompteCanalModification = z.infer<typeof compteCanalModificationSchema>;

/** Désactivation seule : le seul cas admis à `canaux.gerer`. */
export function estDesactivationCanalSeule(corps: CompteCanalModification): boolean {
  return (
    corps.actif === false &&
    CHAMPS_COMPTE_CANAL.every((c) => c === "actif" || corps[c] === undefined)
  );
}

export const destinatairesQuerySchema = z
  .object({ client_id: uuid, limite: limiteSchema, curseur: curseurSchema })
  .strict();

export const envoisCanauxQuerySchema = z
  .object({
    statut: z.enum(STATUTS_ENVOI_CANAL).optional(),
    objet_type: z.enum(OBJETS_ENVOI_CANAL).optional(),
    objet_id: uuid.optional(),
    destinataire_id: uuid.optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

export const consentementsQuerySchema = z
  .object({ limite: limiteSchema, curseur: curseurSchema })
  .strict();

/** `GET /canaux/synthese-dirigeant/apercu` : n'envoie rien, ne crée aucune ligne d'envoi. */
export const apercuSyntheseQuerySchema = z
  .object({ client_id: uuid, destinataire_id: uuid })
  .strict();

/** `GET /canaux/saisies-kpi` (`kpi.saisir`). */
export const saisiesKpiQuerySchema = z
  .object({
    statut: z.enum(STATUTS_SAISIE_KPI).optional(),
    limite: limiteSchema,
    curseur: curseurSchema,
  })
  .strict();

/** `POST /canaux/saisies-kpi/:id/reprendre` : la date de mesure est modifiable. */
export const saisieKpiRepriseSchema = z
  .object({
    date_mesure: dateIsoBorneeSchema.optional(),
    commentaire: texte(500).optional(),
  })
  .strict();

/** `POST /canaux/saisies-kpi/:id/rejeter` : motif obligatoire. */
export const saisieKpiRejetSchema = z.object({ motif: texte(500) }).strict();

/**
 * `POST /canaux/simulateur/entrant` (`canaux.configurer`, mode simulé local seulement) : un message
 * reçu d'un destinataire de test (texte ou voix de test) ou un statut d'un message « envoyé ».
 */
export const simulateurEntrantSchema = z.union([
  z
    .object({
      type: z.literal("message"),
      numero: numeroSaisiSchema,
      texte: z.string().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      type: z.literal("message"),
      numero: numeroSaisiSchema,
      /** Texte du conteneur audio de test que le simulateur fabrique (aucun vrai audio). */
      audio_texte: z.string().min(1).max(2000),
      duree_ms: z.number().int().min(1).max(1_800_000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("statut"),
      id_externe: z.string().trim().min(1).max(100),
      statut: z.enum(STATUTS_RECUS_CANAL),
    })
    .strict(),
]);
export type SimulateurEntrant = z.infer<typeof simulateurEntrantSchema>;

/* ----- Webhook entrant (SPEC §8.2, forme NÔTRE : le format réel de Meta n'est pas vérifié, O-13) ----- */

const identifiantCompteWebhook = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const identifiantEvenement = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const numeroE164 = z.string().regex(/^\+[1-9]\d{7,14}$/);

const webhookMessageSchema = z
  .object({
    compte: identifiantCompteWebhook,
    evenement: identifiantEvenement,
    type: z.literal("message"),
    numero: numeroE164,
    recu_le: z.string().datetime({ offset: true }),
    genre: z.enum(GENRES_MESSAGE_ENTRANT),
    texte: z.string().max(4096).optional(),
    ref_media: z
      .string()
      .regex(/^[A-Za-z0-9_.:-]{1,200}$/)
      .optional(),
    type_mime: z
      .string()
      .max(100)
      .regex(/^audio\/[a-z0-9.+-]+(;\s*[a-z]+=[a-z0-9.-]+)?$/i)
      .optional(),
    duree_ms: z.number().int().min(0).max(36_000_000).nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const erreur = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (v.genre === "texte") {
      if (v.texte === undefined) erreur("Texte attendu pour un message texte.");
      if (v.ref_media !== undefined || v.type_mime !== undefined) {
        erreur("Média non attendu pour un message texte.");
      }
    } else if (v.genre === "audio") {
      if (v.ref_media === undefined || v.type_mime === undefined) {
        erreur("Référence et type du média attendus pour un message audio.");
      }
      if (v.texte !== undefined) erreur("Texte non attendu pour un message audio.");
    } else if (
      v.texte !== undefined ||
      v.ref_media !== undefined ||
      v.type_mime !== undefined ||
      v.duree_ms !== undefined
    ) {
      erreur("Contenu non attendu pour un autre genre de message.");
    }
  });

const webhookStatutSchema = z
  .object({
    compte: identifiantCompteWebhook,
    evenement: identifiantEvenement,
    type: z.literal("statut"),
    id_externe_message: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    statut: z.enum(STATUTS_RECUS_CANAL),
    code_refus: z.enum(CODES_REFUS_ENVOI_CANAL).nullable().optional(),
  })
  .strict();

/** Charge du webhook WhatsApp : un événement, `message` ou `statut` (400 `REQUETE_INVALIDE` sinon). */
export const webhookCanalSchema = z.union([webhookMessageSchema, webhookStatutSchema]);
export type WebhookCanal = z.infer<typeof webhookCanalSchema>;
export type WebhookCanalMessage = z.infer<typeof webhookMessageSchema>;
export type WebhookCanalStatut = z.infer<typeof webhookStatutSchema>;

/* ----- Réponses proposées (aucun numéro, aucun texte de message) ----- */

export interface PageCanaux<T> {
  readonly elements: readonly T[];
  readonly curseur_suivant: string | null;
}

export interface CompteCanalApi {
  readonly canal: CanalMessagerie;
  readonly mode_fournisseur: ModeFournisseurCanal;
  /** Identifiant public du compte (généré par le serveur) ; nul si le compte n'existe pas encore. */
  readonly identifiant_compte: string | null;
  readonly actif: boolean;
  readonly repli_sms: boolean;
  readonly relance_questionnaire_j10: boolean;
  readonly synthese_hebdo: boolean;
  readonly saisie_kpi: boolean;
  readonly modifie_le: string | null;
}

export interface DestinataireCanalApi {
  /** Ligne `canaux_destinataires` ; nul tant qu'aucun numéro n'est enregistré pour ce canal. */
  readonly id: string | null;
  readonly utilisateur_id: string;
  readonly utilisateur_nom: string;
  readonly role: string;
  readonly canal: CanalMessagerie;
  /** Masque seulement (`+225…12`) : jamais le numéro. */
  readonly numero_masque: string | null;
  readonly verifie: boolean;
  readonly consentement: ConsentementCourantCanal;
  readonly consentement_source: SourceConsentement | null;
  readonly consentement_le: string | null;
}

export interface ConsentementHistoriqueApi {
  readonly id: string;
  readonly statut: StatutConsentement;
  readonly source: SourceConsentement;
  readonly mention_version: string | null;
  readonly reference_preuve: string | null;
  readonly cree_le: string;
}

export interface EnvoiCanalApi {
  readonly id: string;
  readonly canal: CanalMessagerie;
  readonly mode_fournisseur: ModeFournisseurCanal;
  readonly gabarit: CodeGabaritCanal;
  readonly categorie: CategorieEnvoiCanal;
  readonly destinataire_id: string;
  readonly destinataire_nom: string;
  readonly statut: StatutEnvoiCanal;
  readonly motif_blocage: MotifBlocageCanal | null;
  readonly code_refus: CodeRefusEnvoiCanal | null;
  readonly objet_type: ObjetEnvoiCanal;
  readonly objet_id: string | null;
  readonly cree_le: string;
  /** FIN-02 : ABSENT sans `finance.lire`, jamais masqué par un zéro. */
  readonly cout_estime_micro_usd?: number | null;
}

export interface SaisieKpiApi {
  readonly id: string;
  readonly kpi_id: string;
  readonly kpi_libelle: string;
  readonly destinataire_id: string;
  readonly origine: OrigineSaisieKpi;
  readonly date_mesure: string;
  /** Chaîne décimale exacte. */
  readonly valeur: string;
  readonly vraisemblance: VraisemblanceSaisieKpi;
  readonly motif_vraisemblance: string | null;
  readonly statut: StatutSaisieKpi;
  readonly expire_le: string;
  readonly cree_le: string;
}

/** `GET /canaux/moi` et `GET /portail/canaux/moi` : ses numéros (masqués) et consentements. */
export interface MoiCanalApi {
  readonly canal: CanalMessagerie;
  readonly mode_fournisseur: ModeFournisseurCanal;
  /** Le cabinet n'a pas activé ce canal : rien ne sera envoyé. */
  readonly canal_actif: boolean;
  readonly numero_masque: string | null;
  readonly verifie: boolean;
  readonly consentement: ConsentementCourantCanal;
  readonly mention: { readonly version: VersionMentionConsentement; readonly texte: string };
}

export interface SyntheseDirigeantSectionApi {
  readonly code: string;
  readonly groupe: "point_attention" | "decision";
  readonly libelle: string;
  readonly nombre: number;
  readonly lien: string;
}

/** Synthèse du dirigeant (`GET /portail/synthese`) : compteurs et liens, jamais un montant. */
export interface SyntheseDirigeantApi {
  readonly points_attention: number;
  readonly decisions_attendues: number;
  readonly vide: boolean;
  readonly sections: readonly SyntheseDirigeantSectionApi[];
}

/** Aperçu côté cabinet : n'envoie rien ; texte WhatsApp exact tel qu'il partirait. */
export interface ApercuSyntheseApi extends SyntheseDirigeantApi {
  readonly mode_fournisseur: ModeFournisseurCanal;
  /** Nul quand il n'y a rien à signaler (aucun message ne partirait). */
  readonly texte_message: string | null;
}

/** Boîte du simulateur : messages « envoyés » (mode simulé local seulement). */
export interface MessageSimulateurApi {
  readonly id_externe: string;
  readonly canal: CanalMessagerie;
  readonly gabarit: CodeGabaritCanal;
  readonly numero_masque: string;
  readonly texte: string;
  readonly instant: string;
}
