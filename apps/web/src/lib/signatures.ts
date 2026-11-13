/**
 * Signature électronique SIMULÉE d'un PDF de mission (CLI-05, lot 3c, ADR-010) : demandes, signataires
 * cabinet et client, journal de preuves chaîné. Logique pure, testée dans `signatures.test.ts`.
 *
 * Le fournisseur est LOCAL : niveau « simple simulée », SANS VALEUR JURIDIQUE, aucun appel externe.
 * Chaque écran affiche l'avertissement fixe `AVERTISSEMENT_SIGNATURE_SIMULEE`. Une signature n'a
 * aucun effet sur le budget ni sur le statut de la mission. Aucun montant n'est affiché (FIN-02) :
 * un avenant ne montre que le numéro et le type de sa version de budget.
 *
 * Les droits testés ici ne servent qu'à n'afficher que ce qui sera accepté ; l'API reste seule juge.
 */
import {
  aPermission,
  AVERTISSEMENT_SIGNATURE_SIMULEE,
  creerTraduire,
  LOCALES_INTL,
  type Langue,
  LIBELLES_CAUSE_CHAINE_INVALIDE,
  LIBELLES_OBJET_SIGNATURE,
  LIBELLES_ORDRE_SIGNATURE,
  LIBELLES_PARTIE_SIGNATAIRE,
  LIBELLES_STATUT_DEMANDE_SIGNATURE,
  LIBELLES_STATUT_SIGNATAIRE,
  LIBELLES_TYPE_PREUVE_SIGNATURE,
  OBJETS_SIGNATURE,
  ORDRES_SIGNATURE,
  PLAFONDS_SIGNATURES,
  type DemandeSignatureApi,
  type DossierPreuveApi,
  type ObjetSignature,
  type OrdreSignatureDemande,
  type PartieSignataire,
  type PreuveSignatureApi,
  type Role,
  type SignataireSignatureApi,
  type StatutDemandeSignatureApi,
  type StatutSignataireApi,
  type TypeDocument,
  type VerificationChaineApi,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import { dateCourte } from "./canaux";
import {
  messageReconfirmation,
  validerConfirmation,
  type ChampConfirmation,
  type ChargeFacteur,
  type FacteurSaisi,
  type SaisieConfirmation,
} from "./double-authentification";
import type { VersionDocument } from "./documents";
import type { Resultat } from "./saisie";

export { AVERTISSEMENT_SIGNATURE_SIMULEE, PLAFONDS_SIGNATURES };
export type {
  DemandeSignatureApi,
  DossierPreuveApi,
  PreuveSignatureApi,
  SignataireSignatureApi,
  VerificationChaineApi,
};

// --- Chemins ---------------------------------------------------------------------------------

const enc = encodeURIComponent;

export const cheminApiSignatures = (missionId: string) =>
  `/api/missions/${enc(missionId)}/signatures`;
export const cheminApiSignature = (id: string) => `/api/signatures/${enc(id)}`;
/** Lecture du PDF par un signataire du cabinet : inscrit la preuve « document consulté ». */
export const hrefDocumentSignature = (id: string) => `/api/signatures/${enc(id)}/document`;
export const cheminApiPreuvesSignature = (id: string) => `/api/signatures/${enc(id)}/preuves`;
export const cheminApiActionSignature = (
  id: string,
  action: "envoyer" | "annuler" | "signer" | "refuser",
) => `/api/signatures/${enc(id)}/${action}`;

export const hrefSignatures = (missionId: string) => `/missions/${enc(missionId)}/signatures`;
export const hrefSignature = (missionId: string, id: string) =>
  `${hrefSignatures(missionId)}/${enc(id)}`;
export const hrefDocumentsMission = (missionId: string) => `/missions/${enc(missionId)}/documents`;

/** Plafond de `limite` des routes de signature (`PLAFONDS_SIGNATURES.listeLimiteMax`). */
export const LIMITE_LISTE_SIGNATURES = PLAFONDS_SIGNATURES.listeLimiteMax;

// --- Libellés et tonalités -------------------------------------------------------------------

/** Avertissement fixe de la signature simulée, dans la langue demandée. */
export const AVERTISSEMENT_SIGNATURE_SIMULEE_EN = "Simulated signature: no legal value";
export const avertissementSignatureSimulee = (langue: Langue = "fr") =>
  langue === "en" ? AVERTISSEMENT_SIGNATURE_SIMULEE_EN : AVERTISSEMENT_SIGNATURE_SIMULEE;

const LIBELLES_OBJET_SIGNATURE_EN: Record<ObjetSignature, string> = {
  lettre_mission: "Engagement letter",
  avenant: "Amendment",
  proces_verbal: "Minutes",
};
const LIBELLES_ORDRE_SIGNATURE_EN: Record<OrdreSignatureDemande, string> = {
  parallele: "In any order",
  sequentiel: "One after the other",
};
const LIBELLES_PARTIE_SIGNATAIRE_EN: Record<PartieSignataire, string> = {
  cabinet: "Firm",
  client: "Client",
};
const LIBELLES_STATUT_DEMANDE_SIGNATURE_EN: Record<StatutDemandeSignatureApi, string> = {
  brouillon: "Draft",
  envoyee: "Sent",
  partielle: "Partially signed",
  signee: "Signed",
  refusee: "Declined",
  annulee: "Canceled",
  expiree: "Expired",
};
const LIBELLES_STATUT_SIGNATAIRE_EN: Record<StatutSignataireApi, string> = {
  en_attente: "Pending",
  invite: "Invited",
  signe: "Signed",
  refuse: "Declined",
  expire: "Expired",
};
const LIBELLES_TYPE_PREUVE_SIGNATURE_EN: Record<string, string> = {
  demande_creee: "Request created",
  invitation_envoyee: "Invitation sent",
  document_consulte: "Document viewed",
  reconfirmation_identite: "Identity reconfirmed",
  signature_apposee: "Signed",
  refus: "Declined",
  annulation: "Canceled",
  expiration: "Expired",
  scellement: "File sealed",
};
const LIBELLES_CAUSE_CHAINE_INVALIDE_EN: Record<string, string> = {
  EMPREINTE_DIFFERENTE: "A piece of evidence was modified",
  RANG_MANQUANT: "A piece of evidence is missing from the chain",
  PRECEDENTE_INCOHERENTE: "The evidence chain is inconsistent",
  DOCUMENT_DIFFERENT: "The document fingerprint differs",
};

const libelleDe = (
  table: Record<string, string>,
  tableEn: Record<string, string>,
  cle: string | null | undefined,
  langue: Langue,
): string => (cle ? (langue === "en" ? tableEn : table)[cle] : undefined) ?? "—";

export const libelleObjetSignature = (o: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(LIBELLES_OBJET_SIGNATURE, LIBELLES_OBJET_SIGNATURE_EN, o, langue);
export const libelleOrdreSignature = (o: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(LIBELLES_ORDRE_SIGNATURE, LIBELLES_ORDRE_SIGNATURE_EN, o, langue);
export const libellePartie = (p: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(LIBELLES_PARTIE_SIGNATAIRE, LIBELLES_PARTIE_SIGNATAIRE_EN, p, langue);
export const libelleStatutDemande = (s: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(LIBELLES_STATUT_DEMANDE_SIGNATURE, LIBELLES_STATUT_DEMANDE_SIGNATURE_EN, s, langue);
export const libelleStatutSignataire = (s: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(LIBELLES_STATUT_SIGNATAIRE, LIBELLES_STATUT_SIGNATAIRE_EN, s, langue);
export const libelleTypePreuve = (t: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(LIBELLES_TYPE_PREUVE_SIGNATURE, LIBELLES_TYPE_PREUVE_SIGNATURE_EN, t, langue);

export function tonaliteStatutDemande(s: StatutDemandeSignatureApi | string): TonaliteStatut {
  switch (s) {
    case "signee":
      return "succes";
    case "envoyee":
    case "partielle":
    case "brouillon":
      return "attention";
    case "refusee":
      return "danger";
    default:
      return "neutre";
  }
}

export function tonaliteStatutSignataire(s: StatutSignataireApi | string): TonaliteStatut {
  if (s === "signe") return "succes";
  if (s === "invite") return "attention";
  if (s === "refuse") return "danger";
  return "neutre";
}

/** Une demande ouverte peut encore être signée (envoyée ou partiellement signée). */
export const demandeOuverte = (statut: StatutDemandeSignatureApi | string) =>
  statut === "envoyee" || statut === "partielle";

/** Statut final : plus aucune action possible. */
export const demandeTerminee = (statut: StatutDemandeSignatureApi | string) =>
  statut === "signee" || statut === "refusee" || statut === "annulee" || statut === "expiree";

/** Avancement : « 1 sur 2 » (compteurs de l'API, jamais recalculés à partir de noms). */
export function avancement(
  d: { signataires_signes: number; signataires_total: number },
  langue: Langue = "fr",
): string {
  return `${d.signataires_signes} ${langue === "en" ? "of" : "sur"} ${d.signataires_total}`;
}

/** Avancement en toutes lettres pour lecteur d'écran : « 1 signature sur 2 ». */
export function avancementAccessible(
  d: {
    signataires_signes: number;
    signataires_total: number;
  },
  langue: Langue = "fr",
): string {
  const n = d.signataires_signes;
  return langue === "en"
    ? `${n} signature${n > 1 ? "s" : ""} out of ${d.signataires_total}`
    : `${n} signature${n > 1 ? "s" : ""} sur ${d.signataires_total}`;
}

/** Échéance affichée : « JJ/MM/AAAA » ; une demande en brouillon n'en a pas encore. */
export function libelleEcheance(
  expireLe: string | null | undefined,
  langue: Langue = "fr",
): string {
  return expireLe
    ? dateCourte(expireLe, langue)
    : langue === "en"
      ? "Set when sent"
      : "Fixée à l'envoi";
}

// --- Documents et signataires proposés -------------------------------------------------------

/**
 * Type de document de mission attendu pour chaque objet (contrôle `MPH11` de l'API) : une lettre de
 * mission signe un document de type « lettre de mission », un avenant ou un procès-verbal un « autre ».
 */
export const TYPE_DOCUMENT_PAR_OBJET: Record<ObjetSignature, TypeDocument> = {
  lettre_mission: "lettre_de_mission",
  avenant: "autre",
  proces_verbal: "autre",
};

export const OPTIONS_OBJET_SIGNATURE = OBJETS_SIGNATURE.map((o) => ({
  valeur: o,
  libelle: LIBELLES_OBJET_SIGNATURE[o],
}));
export const OPTIONS_ORDRE_SIGNATURE = ORDRES_SIGNATURE.map((o) => ({
  valeur: o,
  libelle: LIBELLES_ORDRE_SIGNATURE[o],
}));
/** Options des listes déroulantes dans la langue demandée (les constantes ci-dessus restent en français). */
export const optionsObjetSignature = (langue: Langue = "fr") =>
  OBJETS_SIGNATURE.map((o) => ({ valeur: o, libelle: libelleObjetSignature(o, langue) }));
export const optionsOrdreSignature = (langue: Langue = "fr") =>
  ORDRES_SIGNATURE.map((o) => ({ valeur: o, libelle: libelleOrdreSignature(o, langue) }));

/**
 * Documents proposés à la signature : un fichier PDF de la mission, du type attendu pour l'objet
 * choisi. Les versions sans fichier (document de l'ancien format) et tout autre format sont écartés.
 */
export function documentsSignables(
  documents: readonly VersionDocument[],
  objet: ObjetSignature,
): VersionDocument[] {
  const type = TYPE_DOCUMENT_PAR_OBJET[objet];
  return documents.filter(
    (d) => d.type === type && d.fichier !== null && d.fichier.type_mime === "application/pdf",
  );
}

export function libelleDocumentSignable(
  d: Pick<VersionDocument, "nom" | "version">,
  langue: Langue = "fr",
): string {
  return `${d.nom} (${langue === "en" ? "version" : "version"} ${d.version})`;
}

/** Un signataire proposé dans le formulaire : une personne et sa partie. */
export interface SignatairePropose {
  utilisateur_id: string;
  nom: string;
  partie: PartieSignataire;
  /** Précision affichée sous le nom (ex. « Directeur de la mission »). */
  detail: string;
}

const estAssocie = (roles: readonly Role[]) => roles.includes("associe");

interface EntreeCabinet {
  directeurId: string | null;
  equipe: readonly { utilisateur_id: string; nom: string }[];
  moi: { id: string; nom: string; roles: readonly Role[] };
}

/**
 * Signataires du CABINET proposés : le directeur de la mission, et l'utilisateur lui-même s'il est
 * associé (un signataire cabinet est associé ou directeur de mission : `MPH09`). Le directeur
 * s'appelle par le nom de l'équipe de la mission ; sans lui, un libellé neutre.
 */
export function signatairesCabinetProposes(
  entree: EntreeCabinet,
  langue: Langue = "fr",
): SignatairePropose[] {
  const t = creerTraduire(langue);
  const propositions: SignatairePropose[] = [];
  if (entree.directeurId) {
    const nom =
      entree.directeurId === entree.moi.id
        ? entree.moi.nom
        : (entree.equipe.find((m) => m.utilisateur_id === entree.directeurId)?.nom ??
          t("Directeur de la mission", "Engagement director"));
    propositions.push({
      utilisateur_id: entree.directeurId,
      nom,
      partie: "cabinet",
      detail: t("Directeur de la mission", "Engagement director"),
    });
  }
  if (
    estAssocie(entree.moi.roles) &&
    !propositions.some((p) => p.utilisateur_id === entree.moi.id)
  ) {
    propositions.push({
      utilisateur_id: entree.moi.id,
      nom: entree.moi.nom,
      partie: "cabinet",
      detail: t("Associé", "Partner"),
    });
  }
  return propositions;
}

/** Utilisateur du portail d'un client, tel que rendu par `GET /api/portail/utilisateurs`. */
export interface UtilisateurPortailPropose {
  id: string;
  nom: string;
  roles: readonly string[];
  statut: string;
}

/** Signataires du CLIENT proposés : ses dirigeants actifs (seul rôle qui signe depuis le portail). */
export function signatairesClientProposes(
  utilisateurs: readonly UtilisateurPortailPropose[],
  langue: Langue = "fr",
): SignatairePropose[] {
  const t = creerTraduire(langue);
  return utilisateurs
    .filter((u) => u.statut === "actif" && u.roles.includes("client_dirigeant"))
    .map((u) => ({
      utilisateur_id: u.id,
      nom: u.nom,
      partie: "client" as const,
      detail: t("Dirigeant du client", "Client executive"),
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, LOCALES_INTL[langue]));
}

// --- Création d'une demande ------------------------------------------------------------------

export interface SaisieDemandeSignature {
  document_id: string;
  objet: string;
  ordre: string;
  expire_jours: string;
  /** Identifiants des signataires cochés (`utilisateur_id`). */
  signataires: readonly string[];
}

export type ChampDemandeSignature =
  "document_id" | "objet" | "ordre" | "expire_jours" | "signataires";

export interface ChargeDemandeSignature {
  document_id: string;
  objet: ObjetSignature;
  ordre: OrdreSignatureDemande;
  expire_jours: number;
  signataires: { utilisateur_id: string; partie: PartieSignataire }[];
}

/**
 * Corps de `POST /api/missions/:id/signatures`. Les signataires cochés sont retrouvés dans la liste
 * des personnes proposées (partie déduite de la proposition, jamais saisie).
 */
export function validerDemandeSignature(
  s: SaisieDemandeSignature,
  proposes: readonly SignatairePropose[],
  langue: Langue = "fr",
): Resultat<ChargeDemandeSignature, ChampDemandeSignature> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampDemandeSignature, string>> = {};
  const objet = (OBJETS_SIGNATURE as readonly string[]).includes(s.objet)
    ? (s.objet as ObjetSignature)
    : null;
  if (!objet)
    erreurs.objet = t(
      "Choisissez ce que vous faites signer.",
      "Choose what you are sending for signature.",
    );
  const ordre = (ORDRES_SIGNATURE as readonly string[]).includes(s.ordre)
    ? (s.ordre as OrdreSignatureDemande)
    : null;
  if (!ordre) erreurs.ordre = t("Choisissez l'ordre des signatures.", "Choose the signing order.");
  if (s.document_id.trim() === "")
    erreurs.document_id = t(
      "Choisissez le document PDF à signer.",
      "Choose the PDF document to sign.",
    );

  const brut = s.expire_jours.trim();
  const jours = /^\d{1,3}$/.test(brut) ? Number(brut) : Number.NaN;
  if (
    Number.isNaN(jours) ||
    jours < PLAFONDS_SIGNATURES.validiteJoursMin ||
    jours > PLAFONDS_SIGNATURES.validiteJoursMax
  ) {
    erreurs.expire_jours = t(
      `Saisissez une durée de validité de ${PLAFONDS_SIGNATURES.validiteJoursMin} à ${PLAFONDS_SIGNATURES.validiteJoursMax} jours.`,
      `Enter a validity period of ${PLAFONDS_SIGNATURES.validiteJoursMin} to ${PLAFONDS_SIGNATURES.validiteJoursMax} days.`,
    );
  }

  const choisis = proposes.filter((p) => s.signataires.includes(p.utilisateur_id));
  if (choisis.length === 0) {
    erreurs.signataires = t("Choisissez au moins un signataire.", "Choose at least one signatory.");
  } else if (choisis.length > PLAFONDS_SIGNATURES.signatairesMax) {
    erreurs.signataires = t(
      `Une demande compte ${PLAFONDS_SIGNATURES.signatairesMax} signataires au plus.`,
      `A request has ${PLAFONDS_SIGNATURES.signatairesMax} signatories at most.`,
    );
  }

  if (Object.keys(erreurs).length > 0 || !objet || !ordre) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      document_id: s.document_id,
      objet,
      ordre,
      expire_jours: jours,
      signataires: choisis.map((p) => ({ utilisateur_id: p.utilisateur_id, partie: p.partie })),
    },
  };
}

/** Motif obligatoire d'une annulation ou d'un refus. */
export function validerMotifSignature(
  motif: string,
  action: "annulation" | "refus",
  langue: Langue = "fr",
): Resultat<{ motif: string }, "motif"> {
  const t = creerTraduire(langue);
  const texte = motif.trim();
  if (texte === "") {
    return {
      ok: false,
      erreurs: {
        motif:
          action === "annulation"
            ? t("Indiquez le motif de l'annulation.", "Enter the reason for the cancellation.")
            : t("Indiquez le motif de votre refus.", "Enter the reason for your refusal."),
      },
    };
  }
  if (texte.length > 500) {
    return {
      ok: false,
      erreurs: {
        motif: t(
          "Le motif ne doit pas dépasser 500 caractères.",
          "The reason must not exceed 500 characters.",
        ),
      },
    };
  }
  return { ok: true, charge: { motif: texte } };
}

/**
 * Reconfirmation d'identité pour SIGNER : mot de passe ET code de la double authentification (le
 * second facteur est exigé pour signer : 409 `TFA_INACTIVE` sans 2FA active).
 */
export function validerSignature(
  s: SaisieConfirmation,
  langue: Langue = "fr",
): Resultat<{ mot_de_passe: string } & ChargeFacteur, ChampConfirmation> {
  return validerConfirmation(s, langue);
}

// --- Droits d'action (confort d'affichage) ---------------------------------------------------

export interface ActionsDemande {
  envoyer: boolean;
  annuler: boolean;
  signer: boolean;
  refuser: boolean;
  exporter: boolean;
}

export function actionsDemande(entree: {
  demande: Pick<DemandeSignatureApi, "statut" | "demandeur_id">;
  signataires: readonly SignataireSignatureApi[];
  roles: readonly Role[];
  utilisateurId: string;
}): ActionsDemande {
  const { demande, signataires, roles, utilisateurId } = entree;
  const demandeur = aPermission(roles, "signature.demander");
  const ouverte = demandeOuverte(demande.statut);
  const moi = signataires.find((s) => s.utilisateur_id === utilisateurId && s.partie === "cabinet");
  const peutSignerCommeCabinet =
    aPermission(roles, "mission.signer") && moi !== undefined && moi.statut === "invite" && ouverte;
  return {
    envoyer: demandeur && demande.statut === "brouillon",
    annuler:
      demandeur &&
      (demande.demandeur_id === utilisateurId || estAssocie(roles)) &&
      (demande.statut === "brouillon" || ouverte),
    signer: peutSignerCommeCabinet,
    refuser: peutSignerCommeCabinet,
    exporter: aPermission(roles, "signature.lire"),
  };
}

// --- Frise des preuves -----------------------------------------------------------------------

export interface EtapeFrise {
  /** Rang de la première preuve de l'étape (clé stable). */
  rang: number;
  libelle: string;
  /** Qui, et comment : « Marie Koné · mot de passe et double authentification ». */
  detail: string | null;
  horodatage: string;
  tonalite: TonaliteStatut;
}

const LIBELLES_AUTHENTIFICATION: Record<string, string> = {
  mot_de_passe: "mot de passe",
  mot_de_passe_et_2fa: "mot de passe et double authentification",
};
const LIBELLES_AUTHENTIFICATION_EN: Record<string, string> = {
  mot_de_passe: "password",
  mot_de_passe_et_2fa: "password and two-factor authentication",
};

function nomSignataire(
  id: string | null,
  signataires: readonly SignataireSignatureApi[],
): string | null {
  if (!id) return null;
  return signataires.find((s) => s.id === id)?.nom ?? null;
}

/**
 * Frise lisible du journal de preuves : une étape par preuve, sauf une reconfirmation d'identité
 * immédiatement suivie de la signature du même signataire, regroupées en « Signé par … ». L'ordre
 * est celui des rangs ; les preuves sont des faits horodatés (horloge de la base : PAS un
 * horodatage qualifié).
 */
export function grouperFrise(
  preuves: readonly PreuveSignatureApi[],
  signataires: readonly SignataireSignatureApi[],
  langue: Langue = "fr",
): EtapeFrise[] {
  const t = creerTraduire(langue);
  const authentifications =
    langue === "en" ? LIBELLES_AUTHENTIFICATION_EN : LIBELLES_AUTHENTIFICATION;
  const triees = [...preuves].sort((a, b) => a.rang - b.rang);
  const etapes: EtapeFrise[] = [];
  for (let i = 0; i < triees.length; i++) {
    const p = triees[i]!;
    const suivante = triees[i + 1];
    const nom = nomSignataire(p.signataire_id, signataires);
    const regroupe =
      p.type_evenement === "reconfirmation_identite" &&
      suivante?.type_evenement === "signature_apposee" &&
      suivante.signataire_id === p.signataire_id;
    if (regroupe && suivante) {
      const auth = suivante.authentification ?? p.authentification;
      etapes.push({
        rang: p.rang,
        libelle: t("Signé", "Signed"),
        detail: [
          nom,
          t("identité reconfirmée", "identity reconfirmed"),
          auth ? (authentifications[auth] ?? null) : null,
        ]
          .filter(Boolean)
          .join(" · "),
        horodatage: suivante.horodatage,
        tonalite: "succes",
      });
      i++;
      continue;
    }
    const auth = p.authentification ? (authentifications[p.authentification] ?? null) : null;
    etapes.push({
      rang: p.rang,
      libelle: libelleTypePreuve(p.type_evenement, langue),
      detail: [nom, auth].filter(Boolean).join(" · ") || null,
      horodatage: p.horodatage,
      tonalite: tonalitePreuve(p.type_evenement),
    });
  }
  return etapes;
}

function tonalitePreuve(type: string): TonaliteStatut {
  if (type === "signature_apposee" || type === "scellement") return "succes";
  if (type === "refus") return "danger";
  if (type === "annulation" || type === "expiration") return "neutre";
  return "neutre";
}

/** Résultat de la vérification de la chaîne, en français. */
export function libelleVerification(
  v: VerificationChaineApi,
  langue: Langue = "fr",
): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  const t = creerTraduire(langue);
  if (v.valide) {
    return {
      libelle: t(
        "Chaîne de preuves vérifiée : aucune preuve n'a été modifiée.",
        "Evidence chain verified: no evidence has been modified.",
      ),
      tonalite: "succes",
    };
  }
  const cause =
    (langue === "en" ? LIBELLES_CAUSE_CHAINE_INVALIDE_EN : LIBELLES_CAUSE_CHAINE_INVALIDE)[
      v.cause
    ] ?? t("Chaîne incohérente", "Inconsistent chain");
  const causeMin = `${cause.charAt(0).toLowerCase()}${cause.slice(1)}`;
  return {
    libelle: t(
      `Chaîne de preuves invalide à la preuve n° ${v.rang} : ${causeMin}.`,
      `Invalid evidence chain at evidence no. ${v.rang}: ${causeMin}.`,
    ),
    tonalite: "danger",
  };
}

/** Empreinte en blocs de 8 caractères (lisible, copiable) : « a1b2c3d4 e5f6… ». */
export function empreinteLisible(empreinte: string): string {
  return empreinte.replace(/(.{8})/g, "$1 ").trim();
}

/** Nom du fichier JSON du dossier de preuve : jamais le nom du document (donnée du client). */
export function nomFichierDossierPreuve(id: string): string {
  return `dossier-preuve-signature-${id.slice(0, 8)}.json`;
}

/** Contenu du dossier de preuve exporté : JSON seul, lisible, tel que reçu de l'API. */
export function contenuDossierPreuve(dossier: DossierPreuveApi): string {
  return JSON.stringify(dossier, null, 2);
}

// --- Erreurs ---------------------------------------------------------------------------------

export function messageErreurSignature(
  e: unknown,
  facteur: FacteurSaisi = "totp",
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (e instanceof ErreurApi) {
    switch (e.code) {
      case "TFA_INACTIVE":
        return t(
          "Signer exige une double authentification active : activez-la depuis « Sécurité du compte », puis réessayez.",
          'Signing requires active two-factor authentication: enable it from "Account security", then try again.',
        );
      case "DOCUMENT_NON_SIGNABLE":
        return t(
          "Ce document ne peut pas être signé : il doit s'agir d'un PDF de la mission, d'une mission non clôturée.",
          "This document cannot be signed: it must be a PDF of the engagement, and the engagement must not be closed.",
        );
      case "PORTAIL_NON_PARTAGE":
        return t(
          "La mission n'est pas partagée avec le client : partagez-la depuis la fiche du client (onglet « Portail client »), puis envoyez la demande.",
          'The engagement is not shared with the client: share it from the client record ("Client portal" tab), then send the request.',
        );
      case "SIGNATURE_EN_COURS":
        return t(
          "Une demande de signature est déjà ouverte pour ce document. Annulez-la avant d'en créer une autre.",
          "A signature request is already open for this document. Cancel it before creating another.",
        );
      case "TROP_DE_REQUETES":
        return t(
          "Trop de demandes en peu de temps. Patientez quelques instants avant de réessayer.",
          "Too many requests in a short time. Wait a moment before trying again.",
        );
      default:
        break;
    }
    const reconfirmation = messageReconfirmation(e, facteur, langue);
    if (reconfirmation) return reconfirmation;
  }
  return messageErreur(e, langue);
}
