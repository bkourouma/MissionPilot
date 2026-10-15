/**
 * Espace client (portail) pour les canaux SIMULÉS (lot 3c) : préférences de messagerie et
 * consentement, signatures à effectuer, synthèse hebdomadaire du dirigeant. Logique pure, testée
 * dans `portail-canaux.test.ts`.
 *
 * Règles : « Simulé : aucun envoi réel » partout où un message est évoqué ; le numéro n'est jamais
 * réaffiché en entier (masque de l'API) ; la personne seule donne ou retire son accord, et un
 * retrait est immédiat ; une signature affiche « Signature simulée : sans valeur juridique » et ne
 * montre jamais le nom d'un membre du cabinet (avancement par compteurs) ; la synthèse ne contient
 * aucun montant. Les droits testés ici ne servent qu'à n'afficher que ce qui sera accepté.
 */
import {
  MENTIONS_CONSENTEMENT,
  type AccuseSignatureApi,
  type CanalMessagerie,
  type DemandeSignaturePortailApi,
  type MoiCanalApi,
  type SyntheseDirigeantApi,
  type SyntheseDirigeantSectionApi,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi } from "./api";
import { messageErreurCanaux, listeDepuis } from "./canaux";
import { messageErreurPortail } from "./portail";
import { CHEMIN_PORTAIL } from "./portail-routes";
import {
  avancement,
  libelleObjetSignature,
  libelleStatutDemande,
  libelleStatutSignataire,
  messageErreurSignature,
  tonaliteStatutDemande,
  tonaliteStatutSignataire,
} from "./signatures";

export type { AccuseSignatureApi, DemandeSignaturePortailApi, MoiCanalApi, SyntheseDirigeantApi };

// --- Chemins ---------------------------------------------------------------------------------

const enc = encodeURIComponent;

export const CHEMIN_PREFERENCES_PORTAIL = `${CHEMIN_PORTAIL}/preferences`;
export const CHEMIN_SIGNATURES_PORTAIL = `${CHEMIN_PORTAIL}/signatures`;
export const CHEMIN_SYNTHESE_PORTAIL = `${CHEMIN_PORTAIL}/synthese`;

export const API_CANAUX_MOI_PORTAIL = "/api/portail/canaux/moi";
export const API_SIGNATURES_PORTAIL = "/api/portail/signatures";
export const API_SYNTHESE_PORTAIL = "/api/portail/synthese";

export const cheminPreferenceCanal = (canal: CanalMessagerie) =>
  `${API_CANAUX_MOI_PORTAIL}/${enc(canal)}`;
export const cheminVerificationCanalPortail = (canal: CanalMessagerie) =>
  `${API_CANAUX_MOI_PORTAIL}/${enc(canal)}/verification`;
export const cheminRetraitCanalPortail = (canal: CanalMessagerie) =>
  `${API_CANAUX_MOI_PORTAIL}/${enc(canal)}/retrait`;

export const cheminSignaturePortail = (id: string) => `${CHEMIN_SIGNATURES_PORTAIL}/${enc(id)}`;
export const cheminApiSignaturePortail = (id: string) => `${API_SIGNATURES_PORTAIL}/${enc(id)}`;
/** Document à lire (PDF servi par l'API ; la lecture est inscrite dans le journal de preuves). */
export const hrefDocumentSignaturePortail = (id: string) =>
  `${API_SIGNATURES_PORTAIL}/${enc(id)}/document`;
export const cheminApiActionSignaturePortail = (id: string, action: "signer" | "refuser") =>
  `${API_SIGNATURES_PORTAIL}/${enc(id)}/${action}`;

// --- Préférences de messagerie ---------------------------------------------------------------

/** Ses deux canaux, WhatsApp d'abord ; une réponse inattendue donne une liste vide. */
export function canauxMoi(corps: unknown): MoiCanalApi[] {
  const ordre: Record<string, number> = { whatsapp: 0, sms: 1 };
  return listeDepuis<MoiCanalApi>(corps)
    .filter((c) => c && (c.canal === "whatsapp" || c.canal === "sms"))
    .sort((a, b) => (ordre[a.canal] ?? 9) - (ordre[b.canal] ?? 9));
}

/** Étape du parcours d'un canal pour la personne (une seule action proposée à la fois). */
export type EtapePreference = "numero" | "code" | "consentement" | "actif";

export function etapePreference(
  moi: Pick<MoiCanalApi, "numero_masque" | "verifie" | "consentement">,
): EtapePreference {
  if (moi.numero_masque === null) return "numero";
  if (!moi.verifie) return "code";
  return moi.consentement === "accorde" ? "actif" : "consentement";
}

/** Texte de la mention en vigueur, tel que le serveur l'a servi (repli : la mention du lot). */
export function texteMention(moi: Pick<MoiCanalApi, "canal" | "mention">): string {
  return (
    moi.mention?.texte ??
    MENTIONS_CONSENTEMENT[moi.canal === "sms" ? "sms-v1" : "whatsapp-v1"].texte
  );
}

export interface SaisiePreference {
  numero: string;
  mentionCochee: boolean;
  /** Le numéro est (re)saisi : sinon seule la mention est envoyée (numéro déjà vérifié). */
  avecNumero: boolean;
}

export type ChampPreference = "numero" | "mention";

export interface ChargePreference {
  numero?: string;
  mention_version: string;
  consentement: true;
}

/**
 * Corps de `PUT /api/portail/canaux/moi/:canal` : la case de la mention COMPLÈTE est obligatoire,
 * la version envoyée est celle de la mention affichée (409 `MENTION_PERIMEE` si elle a changé).
 */
export function validerPreference(
  s: SaisiePreference,
  mentionVersion: string,
):
  | { ok: true; charge: ChargePreference }
  | { ok: false; erreurs: Partial<Record<ChampPreference, string>> } {
  const erreurs: Partial<Record<ChampPreference, string>> = {};
  const numero = s.numero.trim();
  if (s.avecNumero) {
    if (numero === "") erreurs.numero = "Saisissez votre numéro de téléphone.";
    // eslint-disable-next-line no-control-regex
    else if (numero.length < 5 || numero.length > 40 || /[\u0000-\u001f\u007f]/.test(numero)) {
      erreurs.numero = "Numéro invalide : saisissez-le avec l'indicatif (ex. +225…).";
    }
  }
  if (!s.mentionCochee) {
    erreurs.mention = "Cochez la case pour accepter de recevoir des messages.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      ...(s.avecNumero ? { numero } : {}),
      mention_version: mentionVersion,
      consentement: true,
    },
  };
}

/** Message d'un refus de l'API sur les préférences (codes de ce lot, puis messages du portail). */
export function messageErreurPreferences(e: unknown): string {
  if (e instanceof ErreurApi) {
    const specifique = messageErreurCanaux(e);
    // `messageErreurCanaux` retombe sur un message cabinet pour un 403 : le portail a le sien.
    if (e.statut === 403 || e.statut === 404) return messageErreurPortail(e);
    return specifique;
  }
  return messageErreurPortail(e);
}

export const MESSAGE_RETRAIT_IMMEDIAT =
  "Vous ne recevrez plus de messages sur ce canal. Le retrait est immédiat ; vous pourrez redonner votre accord à tout moment.";

// --- Signatures ------------------------------------------------------------------------------

export function demandesPortail(corps: unknown): DemandeSignaturePortailApi[] {
  return listeDepuis<DemandeSignaturePortailApi>(corps);
}

/** Libellé de ce que la personne doit faire (ou a fait). */
export function libelleMonStatut(
  d: Pick<DemandeSignaturePortailApi, "mon_statut" | "peut_signer">,
): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  if (d.peut_signer) return { libelle: "À signer", tonalite: "attention" };
  return {
    libelle: libelleStatutSignataire(d.mon_statut),
    tonalite: tonaliteStatutSignataire(d.mon_statut),
  };
}

export const libelleStatutPortail = libelleStatutDemande;
export const tonaliteStatutPortail = tonaliteStatutDemande;
export const libelleObjetPortail = libelleObjetSignature;

/** « 1 sur 2 signatures » : l'avancement ne nomme jamais un membre du cabinet. */
export function avancementPortail(d: {
  signataires_signes: number;
  signataires_total: number;
}): string {
  return `${avancement(d)} signature${d.signataires_total > 1 ? "s" : ""}`;
}

export function messageErreurSignaturePortail(e: unknown): string {
  if (e instanceof ErreurApi && e.code === "TFA_INACTIVE") {
    return "Signer exige une double authentification active : activez-la dans la rubrique « Sécurité » de votre espace, puis réessayez.";
  }
  if (e instanceof ErreurApi && e.statut !== 403 && e.statut !== 404) {
    return messageErreurSignature(e);
  }
  return messageErreurPortail(e);
}

// --- Synthèse du dirigeant -------------------------------------------------------------------

export const LIBELLES_GROUPE_SYNTHESE: Record<SyntheseDirigeantSectionApi["groupe"], string> = {
  point_attention: "Points d'attention",
  decision: "Décisions attendues",
};

export interface GroupeSynthese {
  groupe: SyntheseDirigeantSectionApi["groupe"];
  titre: string;
  total: number;
  sections: SyntheseDirigeantSectionApi[];
}

/**
 * Sections regroupées : « Points d'attention » puis « Décisions attendues ». Le total d'un groupe
 * est le nombre rendu par l'API (jamais recalculé) quand il existe, sinon la somme des sections.
 */
export function grouperSynthese(
  s: Pick<SyntheseDirigeantApi, "points_attention" | "decisions_attendues" | "sections">,
): GroupeSynthese[] {
  const groupes: GroupeSynthese["groupe"][] = ["point_attention", "decision"];
  return groupes
    .map((groupe) => {
      const sections = s.sections.filter((x) => x.groupe === groupe && x.nombre > 0);
      return {
        groupe,
        titre: LIBELLES_GROUPE_SYNTHESE[groupe],
        total: groupe === "point_attention" ? s.points_attention : s.decisions_attendues,
        sections,
      };
    })
    .filter((g) => g.sections.length > 0 || g.total > 0);
}

/**
 * Lien d'une section : seulement un chemin interne du portail. Tout le reste (adresse complète,
 * autre rubrique, schéma inattendu) est écarté : la synthèse ne mène jamais hors de l'espace client.
 */
export function lienSynthese(lien: string): string | null {
  if (!lien.startsWith(`${CHEMIN_PORTAIL}/`) && lien !== CHEMIN_PORTAIL) return null;
  if (lien.includes("//") || lien.includes("\\") || lien.includes("..")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(lien)) return null;
  return lien;
}

/** « 3 points d'attention », « 1 décision attendue ». */
export function phraseCompteur(n: number, groupe: SyntheseDirigeantSectionApi["groupe"]): string {
  if (groupe === "point_attention") return `${n} point${n > 1 ? "s" : ""} d'attention`;
  return `${n} décision${n > 1 ? "s" : ""} attendue${n > 1 ? "s" : ""}`;
}
