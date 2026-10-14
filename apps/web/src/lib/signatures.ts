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

const libelleDe = (table: Record<string, string>, cle: string | null | undefined): string =>
  (cle ? table[cle] : undefined) ?? "—";

export const libelleObjetSignature = (o: string | null | undefined) =>
  libelleDe(LIBELLES_OBJET_SIGNATURE, o);
export const libelleOrdreSignature = (o: string | null | undefined) =>
  libelleDe(LIBELLES_ORDRE_SIGNATURE, o);
export const libellePartie = (p: string | null | undefined) =>
  libelleDe(LIBELLES_PARTIE_SIGNATAIRE, p);
export const libelleStatutDemande = (s: string | null | undefined) =>
  libelleDe(LIBELLES_STATUT_DEMANDE_SIGNATURE, s);
export const libelleStatutSignataire = (s: string | null | undefined) =>
  libelleDe(LIBELLES_STATUT_SIGNATAIRE, s);
export const libelleTypePreuve = (t: string | null | undefined) =>
  libelleDe(LIBELLES_TYPE_PREUVE_SIGNATURE, t);

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
export function avancement(d: { signataires_signes: number; signataires_total: number }): string {
  return `${d.signataires_signes} sur ${d.signataires_total}`;
}

/** Avancement en toutes lettres pour lecteur d'écran : « 1 signature sur 2 ». */
export function avancementAccessible(d: {
  signataires_signes: number;
  signataires_total: number;
}): string {
  const n = d.signataires_signes;
  return `${n} signature${n > 1 ? "s" : ""} sur ${d.signataires_total}`;
}

/** Échéance affichée : « JJ/MM/AAAA » ; une demande en brouillon n'en a pas encore. */
export function libelleEcheance(expireLe: string | null | undefined): string {
  return expireLe ? dateCourte(expireLe) : "Fixée à l'envoi";
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

export function libelleDocumentSignable(d: Pick<VersionDocument, "nom" | "version">): string {
  return `${d.nom} (version ${d.version})`;
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
export function signatairesCabinetProposes(entree: EntreeCabinet): SignatairePropose[] {
  const propositions: SignatairePropose[] = [];
  if (entree.directeurId) {
    const nom =
      entree.directeurId === entree.moi.id
        ? entree.moi.nom
        : (entree.equipe.find((m) => m.utilisateur_id === entree.directeurId)?.nom ??
          "Directeur de la mission");
    propositions.push({
      utilisateur_id: entree.directeurId,
      nom,
      partie: "cabinet",
      detail: "Directeur de la mission",
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
      detail: "Associé",
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
): SignatairePropose[] {
  return utilisateurs
    .filter((u) => u.statut === "actif" && u.roles.includes("client_dirigeant"))
    .map((u) => ({
      utilisateur_id: u.id,
      nom: u.nom,
      partie: "client" as const,
      detail: "Dirigeant du client",
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
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
): Resultat<ChargeDemandeSignature, ChampDemandeSignature> {
  const erreurs: Partial<Record<ChampDemandeSignature, string>> = {};
  const objet = (OBJETS_SIGNATURE as readonly string[]).includes(s.objet)
    ? (s.objet as ObjetSignature)
    : null;
  if (!objet) erreurs.objet = "Choisissez ce que vous faites signer.";
  const ordre = (ORDRES_SIGNATURE as readonly string[]).includes(s.ordre)
    ? (s.ordre as OrdreSignatureDemande)
    : null;
  if (!ordre) erreurs.ordre = "Choisissez l'ordre des signatures.";
  if (s.document_id.trim() === "") erreurs.document_id = "Choisissez le document PDF à signer.";

  const brut = s.expire_jours.trim();
  const jours = /^\d{1,3}$/.test(brut) ? Number(brut) : Number.NaN;
  if (
    Number.isNaN(jours) ||
    jours < PLAFONDS_SIGNATURES.validiteJoursMin ||
    jours > PLAFONDS_SIGNATURES.validiteJoursMax
  ) {
    erreurs.expire_jours = `Saisissez une durée de validité de ${PLAFONDS_SIGNATURES.validiteJoursMin} à ${PLAFONDS_SIGNATURES.validiteJoursMax} jours.`;
  }

  const choisis = proposes.filter((p) => s.signataires.includes(p.utilisateur_id));
  if (choisis.length === 0) {
    erreurs.signataires = "Choisissez au moins un signataire.";
  } else if (choisis.length > PLAFONDS_SIGNATURES.signatairesMax) {
    erreurs.signataires = `Une demande compte ${PLAFONDS_SIGNATURES.signatairesMax} signataires au plus.`;
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
): Resultat<{ motif: string }, "motif"> {
  const t = motif.trim();
  if (t === "") {
    return {
      ok: false,
      erreurs: {
        motif:
          action === "annulation"
            ? "Indiquez le motif de l'annulation."
            : "Indiquez le motif de votre refus.",
      },
    };
  }
  if (t.length > 500) {
    return { ok: false, erreurs: { motif: "Le motif ne doit pas dépasser 500 caractères." } };
  }
  return { ok: true, charge: { motif: t } };
}

/**
 * Reconfirmation d'identité pour SIGNER : mot de passe ET code de la double authentification (le
 * second facteur est exigé pour signer : 409 `TFA_INACTIVE` sans 2FA active).
 */
export function validerSignature(
  s: SaisieConfirmation,
): Resultat<{ mot_de_passe: string } & ChargeFacteur, ChampConfirmation> {
  return validerConfirmation(s);
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
): EtapeFrise[] {
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
        libelle: "Signé",
        detail: [
          nom,
          "identité reconfirmée",
          auth ? (LIBELLES_AUTHENTIFICATION[auth] ?? null) : null,
        ]
          .filter(Boolean)
          .join(" · "),
        horodatage: suivante.horodatage,
        tonalite: "succes",
      });
      i++;
      continue;
    }
    const auth = p.authentification
      ? (LIBELLES_AUTHENTIFICATION[p.authentification] ?? null)
      : null;
    etapes.push({
      rang: p.rang,
      libelle: libelleTypePreuve(p.type_evenement),
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
export function libelleVerification(v: VerificationChaineApi): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  if (v.valide) {
    return {
      libelle: "Chaîne de preuves vérifiée : aucune preuve n'a été modifiée.",
      tonalite: "succes",
    };
  }
  const cause = LIBELLES_CAUSE_CHAINE_INVALIDE[v.cause] ?? "Chaîne incohérente";
  return {
    libelle: `Chaîne de preuves invalide à la preuve n° ${v.rang} : ${cause.charAt(0).toLowerCase()}${cause.slice(1)}.`,
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

export function messageErreurSignature(e: unknown, facteur: FacteurSaisi = "totp"): string {
  if (e instanceof ErreurApi) {
    switch (e.code) {
      case "TFA_INACTIVE":
        return "Signer exige une double authentification active : activez-la depuis « Sécurité du compte », puis réessayez.";
      case "DOCUMENT_NON_SIGNABLE":
        return "Ce document ne peut pas être signé : il doit s'agir d'un PDF de la mission, d'une mission non clôturée.";
      case "PORTAIL_NON_PARTAGE":
        return "La mission n'est pas partagée avec le client : partagez-la depuis la fiche du client (onglet « Portail client »), puis envoyez la demande.";
      case "SIGNATURE_EN_COURS":
        return "Une demande de signature est déjà ouverte pour ce document. Annulez-la avant d'en créer une autre.";
      case "TROP_DE_REQUETES":
        return "Trop de demandes en peu de temps. Patientez quelques instants avant de réessayer.";
      default:
        break;
    }
    const reconfirmation = messageReconfirmation(e, facteur);
    if (reconfirmation) return reconfirmation;
  }
  return messageErreur(e);
}
