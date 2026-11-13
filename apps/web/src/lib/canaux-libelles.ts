/** Sous-module de `canaux.ts` : dates, libellés et tonalités. */
import {
  LIBELLES_CANAL,
  LIBELLES_CATEGORIE_ENVOI_CANAL,
  LIBELLES_CODE_GABARIT_CANAL,
  LIBELLES_CODE_REFUS_CANAL,
  LIBELLES_CONSENTEMENT_COURANT,
  LIBELLES_MOTIF_BLOCAGE_CANAL,
  LIBELLES_OBJET_ENVOI_CANAL,
  LIBELLES_ORIGINE_SAISIE_KPI,
  LIBELLES_SOURCE_CONSENTEMENT,
  LIBELLES_STATUT_ENVOI_CANAL,
  LIBELLES_STATUT_SAISIE_KPI,
  LIBELLES_VRAISEMBLANCE_SAISIE_KPI,
  ROLE_LIBELLES,
  ROLE_LIBELLES_EN,
  LOCALES_INTL,
  TEXTES_CANAUX,
  type Langue,
  type ConsentementCourantCanal,
  type ModeFournisseurCanal,
  type StatutEnvoiCanal,
  type StatutSaisieKpi,
  type VraisemblanceSaisieKpi,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";

// --- Dates -----------------------------------------------------------------------------------

/** « JJ/MM/AAAA » (heure d'Abidjan) ; « — » si la date manque ou est illisible. */
export function dateCourte(valeur: string | null | undefined, langue: Langue = "fr"): string {
  if (!valeur) return "—";
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALES_INTL[langue], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Africa/Abidjan",
  }).format(d);
}

/** « JJ/MM/AAAA à HH:MM » (heure d'Abidjan). */
export function dateHeureCourte(valeur: string | null | undefined, langue: Langue = "fr"): string {
  if (!valeur) return "—";
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return "—";
  const heure = new Intl.DateTimeFormat(LOCALES_INTL[langue], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Abidjan",
  }).format(d);
  return `${dateCourte(valeur, langue)} ${langue === "en" ? "at" : "à"} ${heure}`;
}

/** Date de mesure « AAAA-MM-JJ » → « JJ/MM/AAAA » (jour calendaire, sans décalage de fuseau). */
export function dateJourCourte(valeur: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valeur ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

// --- Libellés et tonalités -------------------------------------------------------------------

/** Mode fournisseur : seul « simulé » existe dans ce lot ; tout le reste est signalé comme tel. */
export function estSimule(mode: ModeFournisseurCanal | string | null | undefined): boolean {
  return mode === "simule";
}

/** Texte du bandeau : toujours « Simulé : aucun envoi réel » (le mode « réel » n'existe pas ici). */
export const BANDEAU_SIMULE = TEXTES_CANAUX.bandeauSimule;
export const BANDEAU_SIMULE_EN = "Simulated: no real message sent";
export const APERCU_AUCUN_ENVOI_EN = "Preview: nothing is sent";
export const RIEN_A_SIGNALER_EN = "Nothing to report: no message would be sent";

/** Textes de `TEXTES_CANAUX` dans la langue demandée. */
export function textesCanaux(langue: Langue = "fr") {
  return langue === "en"
    ? {
        bandeauSimule: BANDEAU_SIMULE_EN,
        apercuAucunEnvoi: APERCU_AUCUN_ENVOI_EN,
        rienASignaler: RIEN_A_SIGNALER_EN,
      }
    : TEXTES_CANAUX;
}

const libelleDe = (table: Record<string, string>, cle: string | null | undefined): string =>
  (cle ? table[cle] : undefined) ?? "—";

const LIBELLES_CANAL_EN: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS" };
const LIBELLES_STATUT_ENVOI_EN: Record<string, string> = {
  reserve: "Reserved",
  en_cours: "Sending",
  accepte: "Accepted",
  livre: "Delivered",
  lu: "Read",
  echec: "Failed",
  bloque: "Blocked",
  incertain: "Uncertain (not resent)",
};
const LIBELLES_MOTIF_BLOCAGE_EN: Record<string, string> = {
  consentement_absent: "Consent missing",
  consentement_retire: "Consent withdrawn",
  numero_non_verifie: "Number not verified",
  canal_inactif: "Channel inactive",
  destinataire_inactif: "Recipient inactive",
  coupe_circuit: "Kill switch active",
  plafond_destinataire: "Recipient send limit reached",
  plafond_cabinet: "Firm send limit reached",
  plafond_reponses: "Reply limit reached",
  fenetre_fermee: "Reply window closed",
};
const LIBELLES_CODE_REFUS_EN: Record<string, string> = {
  NUMERO_NON_JOIGNABLE: "Number unreachable",
  GABARIT_REFUSE: "Template rejected",
  QUOTA_ATTEINT: "Quota reached",
  FENETRE_FERMEE: "Reply window closed",
  INDISPONIBLE: "Service unavailable",
};
const LIBELLES_CATEGORIE_ENVOI_EN: Record<string, string> = {
  verification: "Number verification",
  relance: "Reminder",
  synthese: "Summary",
  alerte: "Alert",
  signature: "Signature",
  reponse_service: "Service reply",
};
const LIBELLES_OBJET_ENVOI_EN: Record<string, string> = {
  questionnaire_envoi: "Questionnaire",
  signature_demande: "Signature request",
  kpi_saisie: "KPI entry",
  synthese: "Weekly summary",
  verification: "Number verification",
  kpi_alerte: "KPI alert",
};
const LIBELLES_CODE_GABARIT_EN: Record<string, string> = {
  verification_numero: "Verification code",
  relance_questionnaire_j10: "Questionnaire reminder (D+10)",
  synthese_hebdo: "Weekly summary",
  signature_a_effectuer: "Signature to complete",
  alerte_kpi: "KPI alert",
  reponse_stop: "Opt-out confirmation",
  reponse_saisie_a_confirmer: "Entry to confirm",
  reponse_saisie_a_verifier: "Entry to check",
  reponse_saisie_enregistree: "Entry recorded",
  reponse_saisie_refusee: "Entry rejected",
  reponse_non_comprise: "Message not understood",
  reponse_session: "Service reply",
};
const LIBELLES_CONSENTEMENT_EN: Record<string, string> = {
  accorde: "Granted",
  retire: "Withdrawn",
  absent: "Missing",
};
const LIBELLES_SOURCE_CONSENTEMENT_EN: Record<string, string> = {
  portail: "Granted by the person (portal)",
  recueilli_cabinet: "Collected by the firm",
  retrait_portail: "Withdrawn by the person (portal)",
  retrait_cabinet: "Withdrawn by the firm",
  message_stop: "STOP message",
  changement_numero: "Number change",
  desactivation_utilisateur: "User deactivated",
};
const LIBELLES_STATUT_SAISIE_EN: Record<string, string> = {
  a_confirmer: "Awaiting confirmation by the person",
  confirmee: "Confirmed, to be taken up",
  refusee: "Rejected by the person",
  expiree: "Expired",
  rejetee_vraisemblance: "Discarded (implausible value)",
  reprise: "Taken into the KPI",
  rejetee_cabinet: "Rejected by the firm",
};
const LIBELLES_VRAISEMBLANCE_EN: Record<string, string> = {
  ok: "Plausible",
  a_verifier: "To check",
  invraisemblable: "Implausible",
};
const LIBELLES_ORIGINE_SAISIE_EN: Record<string, string> = {
  texte: "Written message",
  vocal: "Voice message",
};

const choisir = (
  langue: Langue,
  fr: Record<string, string>,
  en: Record<string, string>,
): Record<string, string> => (langue === "en" ? en : fr);

export const libelleCanal = (c: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(choisir(langue, LIBELLES_CANAL, LIBELLES_CANAL_EN), c);
export const libelleStatutEnvoi = (s: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(choisir(langue, LIBELLES_STATUT_ENVOI_CANAL, LIBELLES_STATUT_ENVOI_EN), s);
export const libelleMotifBlocage = (m: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(choisir(langue, LIBELLES_MOTIF_BLOCAGE_CANAL, LIBELLES_MOTIF_BLOCAGE_EN), m);
export const libelleCodeRefus = (c: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(choisir(langue, LIBELLES_CODE_REFUS_CANAL, LIBELLES_CODE_REFUS_EN), c);
/** Réponses de service du simulateur (hors des onze gabarits métier) : jamais « — » à l'écran. */
const LIBELLES_GABARIT_SERVICE: Record<string, string> = { reponse_session: "Réponse de service" };
export const libelleGabarit = (g: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(
    langue === "en"
      ? LIBELLES_CODE_GABARIT_EN
      : { ...LIBELLES_CODE_GABARIT_CANAL, ...LIBELLES_GABARIT_SERVICE },
    g,
  );

/** Motif du contrôle de vraisemblance d'une saisie (codes du moteur), en français. */
export const LIBELLES_MOTIF_VRAISEMBLANCE: Record<string, string> = {
  negatif_inhabituel: "Valeur négative inhabituelle",
  historique_insuffisant: "Historique insuffisant pour juger la valeur",
  zero: "Valeur nulle à vérifier",
  ordre_de_grandeur: "Ordre de grandeur très éloigné de l'historique",
  ecart_median: "Écart important avec la valeur habituelle",
  dans_la_norme: "Dans la norme de l'historique",
  origine_vocale: "Message vocal : confirmation demandée",
};
export const LIBELLES_MOTIF_VRAISEMBLANCE_EN: Record<string, string> = {
  negatif_inhabituel: "Unusual negative value",
  historique_insuffisant: "Not enough history to judge the value",
  zero: "Zero value to check",
  ordre_de_grandeur: "Order of magnitude far from the history",
  ecart_median: "Large gap from the usual value",
  dans_la_norme: "Within the historical norm",
  origine_vocale: "Voice message: confirmation requested",
};
export const libelleMotifVraisemblance = (
  m: string | null | undefined,
  langue: Langue = "fr",
): string =>
  (m
    ? choisir(langue, LIBELLES_MOTIF_VRAISEMBLANCE, LIBELLES_MOTIF_VRAISEMBLANCE_EN)[m]
    : undefined) ??
  m ??
  "—";
export const libelleCategorieEnvoi = (c: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(choisir(langue, LIBELLES_CATEGORIE_ENVOI_CANAL, LIBELLES_CATEGORIE_ENVOI_EN), c);
export const libelleObjetEnvoi = (o: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(choisir(langue, LIBELLES_OBJET_ENVOI_CANAL, LIBELLES_OBJET_ENVOI_EN), o);
export const libelleConsentement = (c: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(choisir(langue, LIBELLES_CONSENTEMENT_COURANT, LIBELLES_CONSENTEMENT_EN), c);
export const libelleSourceConsentement = (s: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(choisir(langue, LIBELLES_SOURCE_CONSENTEMENT, LIBELLES_SOURCE_CONSENTEMENT_EN), s);
export const libelleStatutSaisie = (s: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(choisir(langue, LIBELLES_STATUT_SAISIE_KPI, LIBELLES_STATUT_SAISIE_EN), s);
export const libelleVraisemblance = (v: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(choisir(langue, LIBELLES_VRAISEMBLANCE_SAISIE_KPI, LIBELLES_VRAISEMBLANCE_EN), v);
export const libelleOrigineSaisie = (o: string | null | undefined, langue: Langue = "fr") =>
  libelleDe(choisir(langue, LIBELLES_ORIGINE_SAISIE_KPI, LIBELLES_ORIGINE_SAISIE_EN), o);

/** Rôle d'un destinataire en français ; un rôle inconnu de cette version reste lisible. */
export function libelleRole(role: string, langue: Langue = "fr"): string {
  const table = (langue === "en" ? ROLE_LIBELLES_EN : ROLE_LIBELLES) as Record<string, string>;
  return table[role] ?? (langue === "en" ? "User" : "Utilisateur");
}

export function tonaliteStatutEnvoi(s: StatutEnvoiCanal | string): TonaliteStatut {
  switch (s) {
    case "livre":
    case "lu":
    case "accepte":
      return "succes";
    case "echec":
      return "danger";
    case "bloque":
    case "incertain":
      return "attention";
    default:
      return "neutre";
  }
}

export function tonaliteConsentement(c: ConsentementCourantCanal | string): TonaliteStatut {
  if (c === "accorde") return "succes";
  if (c === "retire") return "danger";
  return "neutre";
}

export function tonaliteVraisemblance(v: VraisemblanceSaisieKpi | string): TonaliteStatut {
  if (v === "ok") return "succes";
  if (v === "a_verifier") return "attention";
  if (v === "invraisemblable") return "danger";
  return "neutre";
}

export function tonaliteStatutSaisie(s: StatutSaisieKpi | string): TonaliteStatut {
  if (s === "reprise") return "succes";
  if (s === "confirmee" || s === "a_confirmer") return "attention";
  if (s === "rejetee_vraisemblance" || s === "rejetee_cabinet" || s === "refusee") return "danger";
  return "neutre";
}
