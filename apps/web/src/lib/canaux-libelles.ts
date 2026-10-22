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
  TEXTES_CANAUX,
  type ConsentementCourantCanal,
  type ModeFournisseurCanal,
  type StatutEnvoiCanal,
  type StatutSaisieKpi,
  type VraisemblanceSaisieKpi,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";

// --- Dates -----------------------------------------------------------------------------------

/** « JJ/MM/AAAA » (heure d'Abidjan) ; « — » si la date manque ou est illisible. */
export function dateCourte(valeur: string | null | undefined): string {
  if (!valeur) return "—";
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Africa/Abidjan",
  }).format(d);
}

/** « JJ/MM/AAAA à HH:MM » (heure d'Abidjan). */
export function dateHeureCourte(valeur: string | null | undefined): string {
  if (!valeur) return "—";
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return "—";
  const heure = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Abidjan",
  }).format(d);
  return `${dateCourte(valeur)} à ${heure}`;
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

const libelleDe = (table: Record<string, string>, cle: string | null | undefined): string =>
  (cle ? table[cle] : undefined) ?? "—";

export const libelleCanal = (c: string | null | undefined) => libelleDe(LIBELLES_CANAL, c);
export const libelleStatutEnvoi = (s: string | null | undefined) =>
  libelleDe(LIBELLES_STATUT_ENVOI_CANAL, s);
export const libelleMotifBlocage = (m: string | null | undefined) =>
  libelleDe(LIBELLES_MOTIF_BLOCAGE_CANAL, m);
export const libelleCodeRefus = (c: string | null | undefined) =>
  libelleDe(LIBELLES_CODE_REFUS_CANAL, c);
/** Réponses de service du simulateur (hors des onze gabarits métier) : jamais « — » à l'écran. */
const LIBELLES_GABARIT_SERVICE: Record<string, string> = { reponse_session: "Réponse de service" };
export const libelleGabarit = (g: string | null | undefined) =>
  libelleDe({ ...LIBELLES_CODE_GABARIT_CANAL, ...LIBELLES_GABARIT_SERVICE }, g);

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
export const libelleMotifVraisemblance = (m: string | null | undefined): string =>
  (m ? LIBELLES_MOTIF_VRAISEMBLANCE[m] : undefined) ?? m ?? "—";
export const libelleCategorieEnvoi = (c: string | null | undefined) =>
  libelleDe(LIBELLES_CATEGORIE_ENVOI_CANAL, c);
export const libelleObjetEnvoi = (o: string | null | undefined) =>
  libelleDe(LIBELLES_OBJET_ENVOI_CANAL, o);
export const libelleConsentement = (c: string | null | undefined) =>
  libelleDe(LIBELLES_CONSENTEMENT_COURANT, c);
export const libelleSourceConsentement = (s: string | null | undefined) =>
  libelleDe(LIBELLES_SOURCE_CONSENTEMENT, s);
export const libelleStatutSaisie = (s: string | null | undefined) =>
  libelleDe(LIBELLES_STATUT_SAISIE_KPI, s);
export const libelleVraisemblance = (v: string | null | undefined) =>
  libelleDe(LIBELLES_VRAISEMBLANCE_SAISIE_KPI, v);
export const libelleOrigineSaisie = (o: string | null | undefined) =>
  libelleDe(LIBELLES_ORIGINE_SAISIE_KPI, o);

/** Rôle d'un destinataire en français ; un rôle inconnu de cette version reste lisible. */
export function libelleRole(role: string): string {
  return (ROLE_LIBELLES as Record<string, string>)[role] ?? "Utilisateur";
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
