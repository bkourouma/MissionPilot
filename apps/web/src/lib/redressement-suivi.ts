/**
 * Redressement, onglet « Suivi » (RED-09, suivi post-mission) : chemins d'API, libellés, textes
 * fixes, droits d'affichage et messages d'erreur. Logique pure, testée dans
 * `redressement-suivi.test.ts`.
 *
 * Aucun calcul métier : échéances, états des jalons, comparaisons à la clôture et alertes sortent du
 * moteur à chaque lecture. Une alerte est un constat arithmétique sur un écart de ratio, jamais une
 * qualification de la situation du client.
 */
import {
  aPermission,
  creerTraduire,
  type Langue,
  RED_SUIVI_GRAVITE_LIBELLES,
  RED_SUIVI_MENTION,
  RED_SUIVI_RATIO_LIBELLES,
  RED_SUIVI_SENS_LIBELLES,
  RED_SUIVI_SOURCE_RELEVE_LIBELLES,
  RED_SUIVI_STATUT_JALON_LIBELLES,
  RED_SUIVI_TYPE_EVENEMENT_LIBELLES,
  RED_SUIVI_TYPE_ALERTE_LIBELLES,
  type RedSuiviGravite,
  type RedSuiviJalonVue,
  type RedSuiviRatio,
  type RedSuiviSens,
  type RedSuiviSourceReleve,
  type RedSuiviStatutJalon,
  type RedSuiviTypeAlerte,
  type RedSuiviVue,
  type Role,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { formaterNombre } from "./format";
import type { MissionDetaillee } from "./missions";
import { FORME_RATIO, formaterPointsDeBase, messageRedressement } from "./redressement";

const enc = encodeURIComponent;

// --- Chemins d'API ----------------------------------------------------------------------------------

export const cheminSuivi = (dossierId: string) =>
  `/api/redressement/dossiers/${enc(dossierId)}/suivi`;
export const cheminRelevesSuivi = (dossierId: string) => `${cheminSuivi(dossierId)}/releves`;
export const cheminEvenementsJalon = (dossierId: string, jalonId: string) =>
  `${cheminSuivi(dossierId)}/jalons/${enc(jalonId)}/evenements`;

// --- Textes fixes -----------------------------------------------------------------------------------

export const MENTION_SUIVI = RED_SUIVI_MENTION;
export const TEXTE_SUIVI_NON_CLOS =
  "Le suivi post-mission commence à la clôture du dossier. Tant que le dossier n'est pas clos, il n'y a ni jalon ni relevé : clôturez d'abord le dossier depuis sa synthèse, après avoir validé le bilan de clôture.";
export const TEXTE_SUIVI_A_CREER =
  "Le dossier est clos et aucun suivi n'est encore défini. Les jalons se calculent à partir de la date de clôture ; par défaut, un point à 6 mois et un point à 12 mois.";
export const TEXTE_SUIVI_LECTURE_SEULE =
  "Lecture seule : les relevés et les jalons sont gérés par le directeur, le chef de mission et l'équipe, avec le droit d'écriture sur le redressement.";
export const TEXTE_SUIVI_RELEVE_SAISIE =
  "Saisissez au moins un ratio. Les rapports s'écrivent en nombre (1,36) ; les parts en pourcentage (18,75).";
export const TEXTE_SUIVI_RELEVE_INSTANTANE =
  "Le serveur prend les ratios du dernier état financier accepté du client : rien à saisir.";

/** Textes fixes du suivi, dans la langue demandée. */
export function textesSuivi(langue: Langue = "fr") {
  const t = creerTraduire(langue);
  return {
    nonClos: t(
      TEXTE_SUIVI_NON_CLOS,
      "Post-engagement follow-up starts when the file is closed. As long as the file is not closed, there are no milestones or readings: first close the file from its summary, after approving the close-out review.",
    ),
    aCreer: t(
      TEXTE_SUIVI_A_CREER,
      "The file is closed and no follow-up is defined yet. Milestones are computed from the close date; by default, a checkpoint at 6 months and one at 12 months.",
    ),
    lectureSeule: t(
      TEXTE_SUIVI_LECTURE_SEULE,
      "Read-only: readings and milestones are managed by the director, the engagement manager and the team, with write access to the turnaround.",
    ),
    releveSaisie: t(
      TEXTE_SUIVI_RELEVE_SAISIE,
      "Enter at least one ratio. Ratios are written as numbers (1.36); shares as percentages (18.75).",
    ),
    releveInstantane: t(
      TEXTE_SUIVI_RELEVE_INSTANTANE,
      "The server takes the ratios from the client's last accepted financial statement: nothing to enter.",
    ),
  };
}

const STATUT_JALON_EN: Record<string, string> = {
  a_venir: "Upcoming",
  echu: "Due",
  realise: "Completed",
};
const TYPE_ALERTE_EN: Record<string, string> = {
  jalon_echu: "Milestone due",
  degradation_ratio: "Unfavorable ratio gap",
  jalon_sans_releve: "Milestone without reading",
  jalon_proche: "Milestone approaching",
};
const GRAVITE_EN: Record<string, string> = { information: "Information", attention: "Attention" };
const SENS_EN: Record<string, string> = {
  amelioration: "Improvement",
  stable: "Stable",
  degradation: "Unfavorable gap",
};
const SOURCE_RELEVE_EN: Record<string, string> = {
  saisie: "Entered indicators",
  instantane: "Snapshot of the last accepted statement's ratios",
};
const RATIO_SUIVI_EN: Record<string, string> = {
  liquidite_generale: "Current ratio",
  liquidite_reduite: "Quick ratio",
  liquidite_immediate: "Cash ratio",
  autonomie_financiere: "Financial autonomy",
  solvabilite_generale: "General solvency",
  endettement: "Debt ratio",
  marge_brute: "Gross margin",
  marge_nette: "Net margin",
  couverture_charges_financieres: "Financial charges coverage",
};

export const libelleStatutJalon = (s: RedSuiviStatutJalon, langue: Langue = "fr") =>
  langue === "en" ? (STATUT_JALON_EN[s] ?? s) : (RED_SUIVI_STATUT_JALON_LIBELLES[s] ?? s);
export const libelleTypeAlerteSuivi = (t: RedSuiviTypeAlerte, langue: Langue = "fr") =>
  langue === "en" ? (TYPE_ALERTE_EN[t] ?? t) : (RED_SUIVI_TYPE_ALERTE_LIBELLES[t] ?? t);
export const libelleGraviteSuivi = (g: RedSuiviGravite, langue: Langue = "fr") =>
  langue === "en" ? (GRAVITE_EN[g] ?? g) : (RED_SUIVI_GRAVITE_LIBELLES[g] ?? g);
export const libelleSensSuivi = (s: RedSuiviSens, langue: Langue = "fr") =>
  langue === "en" ? (SENS_EN[s] ?? s) : (RED_SUIVI_SENS_LIBELLES[s] ?? s);
export const libelleSourceReleve = (s: RedSuiviSourceReleve, langue: Langue = "fr") =>
  langue === "en" ? (SOURCE_RELEVE_EN[s] ?? s) : (RED_SUIVI_SOURCE_RELEVE_LIBELLES[s] ?? s);
export const libelleRatioSuivi = (r: RedSuiviRatio, langue: Langue = "fr") =>
  langue === "en" ? (RATIO_SUIVI_EN[r] ?? r) : (RED_SUIVI_RATIO_LIBELLES[r] ?? r);

export const libelleTypeEvenementSuivi = (t: string, langue: Langue = "fr") =>
  langue === "en"
    ? ((
        { realise: "Milestone completed", reporte: "Milestone postponed" } as Record<string, string>
      )[t] ?? t)
    : ((RED_SUIVI_TYPE_EVENEMENT_LIBELLES as Record<string, string>)[t] ?? t);

/** Mention fixe du suivi. */
export const mentionSuivi = (langue: Langue = "fr") =>
  langue === "en"
    ? "Firm-internal follow-up: alerts are arithmetic observations computed at each reading; they do not characterize the client's situation."
    : MENTION_SUIVI;

export function tonaliteStatutJalon(s: RedSuiviStatutJalon): TonaliteStatut {
  if (s === "realise") return "succes";
  if (s === "echu") return "attention";
  return "neutre";
}

export const tonaliteGraviteSuivi = (g: RedSuiviGravite): TonaliteStatut =>
  g === "attention" ? "attention" : "neutre";

export function tonaliteSensSuivi(s: RedSuiviSens): TonaliteStatut {
  if (s === "amelioration") return "succes";
  if (s === "degradation") return "attention";
  return "neutre";
}

// --- Mise en forme ----------------------------------------------------------------------------------

/** Valeur d'un ratio du suivi (points de base) : « 1,36 » ou « 18,75 % ». */
export function formaterRatioSuivi(
  ratio: RedSuiviRatio,
  pb: number | null | undefined,
  langue: Langue = "fr",
): string {
  const forme = FORME_RATIO[ratio] === "pourcentage" ? "pourcentage" : "ratio";
  return formaterPointsDeBase(pb, forme, langue);
}

/** Échéance d'un jalon : « dans 45 jours », « 12 jours de retard », « réalisé ». */
export function libelleEcheanceJalon(
  j: Pick<RedSuiviJalonVue, "statut" | "jours_restants" | "retard_jours">,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const jours = (n: number) =>
    `${formaterNombre(n, 0, langue)} ${t(n > 1 ? "jours" : "jour", n > 1 ? "days" : "day")}`;
  if (j.statut === "realise") return t("Jalon réalisé", "Milestone completed");
  if (j.statut === "echu") {
    return j.retard_jours > 0
      ? t(`${jours(j.retard_jours)} de retard`, `${jours(j.retard_jours)} overdue`)
      : t("Échéance atteinte", "Due date reached");
  }
  return j.jours_restants > 0
    ? t(`Dans ${jours(j.jours_restants)}`, `In ${jours(j.jours_restants)}`)
    : t("Échéance atteinte", "Due date reached");
}

export const libelleReports = (n: number, langue: Langue = "fr") =>
  n === 0
    ? null
    : n === 1
      ? langue === "en"
        ? "Postponed once"
        : "Reporté 1 fois"
      : langue === "en"
        ? `Postponed ${formaterNombre(n, 0, langue)} times`
        : `Reporté ${formaterNombre(n, 0)} fois`;

/** Rang et libellé d'un jalon, pour les listes déroulantes. */
export const libelleJalon = (
  j: Pick<RedSuiviJalonVue, "rang" | "libelle">,
  langue: Langue = "fr",
) =>
  `${langue === "en" ? "Milestone" : "Jalon"} ${j.rang}${langue === "en" ? ":" : " :"} ${j.libelle}`;

export type EtatSuivi = "non_clos" | "a_creer" | "actif";

export function etatSuivi(v: Pick<RedSuiviVue, "dossier_clos" | "plan">): EtatSuivi {
  if (!v.dossier_clos) return "non_clos";
  return v.plan === null ? "a_creer" : "actif";
}

// --- Droits d'affichage -----------------------------------------------------------------------------

/**
 * Miroir de l'accès en écriture au suivi (confort : l'API reste juge) : droit d'écriture sur le
 * redressement et directeur, chef, équipe ou « modifier toutes les missions ». Contrairement au
 * reste du dossier, le suivi s'écrit APRÈS la clôture du dossier, même mission clôturée.
 */
export function peutEcrireSuivi(
  roles: readonly Role[],
  utilisateurId: string,
  mission: Pick<MissionDetaillee, "directeur_id" | "chef_id" | "equipe">,
): boolean {
  if (!aPermission(roles, "redressement.ecrire")) return false;
  return (
    aPermission(roles, "mission.modifier_toutes") ||
    mission.directeur_id === utilisateurId ||
    mission.chef_id === utilisateurId ||
    mission.equipe.some((e) => e.utilisateur_id === utilisateurId)
  );
}

// --- Messages d'erreur ------------------------------------------------------------------------------

/**
 * Message affichable (français) d'une action du suivi : les refus de l'API (409 dossier non clos,
 * suivi existant, plafonds ; 429) sont déjà en français et s'affichent tels quels.
 */
export const messageSuivi = (e: unknown, langue: Langue = "fr") => messageRedressement(e, langue);
