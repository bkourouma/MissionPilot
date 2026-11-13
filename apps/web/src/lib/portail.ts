/**
 * Espace client (portail, SOC-09) : contrats de l'API `/api/portail/*`, libellés et règles
 * d'affichage. Logique pure, testée dans `portail.test.ts`.
 *
 * Le client ne voit QUE ce que le cabinet a partagé : l'API filtre (partages explicites,
 * 404 identique pour inexistant / non partagé). Les droits testés ici ne servent qu'à
 * n'afficher que ce qui sera accepté ; l'API reste seule juge. Aucun montant n'est calculé :
 * totaux, encaissé, solde et jours de retard viennent de l'API (moteur de calcul).
 *
 * Aucune donnée de l'espace client n'est gardée dans le navigateur (ni stockage local, ni
 * cache : le service worker ne garde ni page ni réponse d'API).
 *
 * Sous-modules : `portail-contrats` (types de l'API), `portail-menus` (entrées et droits),
 * `portail-jalons`, `portail-liens` (liens, pagination, accueil) et `portail-erreurs`
 * (erreurs, invitation, mot de passe). Ce fichier garde les libellés et la mise en forme.
 */
import {
  creerTraduire,
  MOT_DE_PASSE_MIN,
  type Langue,
  type StatutMission,
  type StatutPaiement,
} from "@missionpilot/shared";
import {
  DEVISES,
  formaterDate,
  formaterMontantMineur,
  formaterNombre,
  type Devise,
} from "./format";
import type { FacturePortail, Libelle, MissionPortail } from "./portail-contrats";

export { MOT_DE_PASSE_MIN };
export * from "./portail-contrats";
export * from "./portail-erreurs";
export * from "./portail-jalons";
export * from "./portail-liens";
export * from "./portail-menus";

// --- Libellés ------------------------------------------------------------------------------

/** Statut d'une mission, en termes simples pour le client. */
export const STATUT_MISSION_PORTAIL: Record<StatutMission, Libelle> = {
  opportunite: { libelle: "En préparation", tonalite: "neutre" },
  proposition: { libelle: "En préparation", tonalite: "neutre" },
  signee: { libelle: "Signée, démarrage prochain", tonalite: "neutre" },
  en_cours: { libelle: "En cours", tonalite: "succes" },
  a_cloturer: { libelle: "En cours de finalisation", tonalite: "succes" },
  cloturee: { libelle: "Terminée", tonalite: "neutre" },
};

const STATUT_MISSION_PORTAIL_EN: Record<StatutMission, string> = {
  opportunite: "Being prepared",
  proposition: "Being prepared",
  signee: "Signed, starting soon",
  en_cours: "In progress",
  a_cloturer: "Being finalized",
  cloturee: "Completed",
};

export function statutMission(statut: string, langue: Langue = "fr"): Libelle {
  const base = STATUT_MISSION_PORTAIL[statut as StatutMission] ?? {
    libelle: "—",
    tonalite: "neutre",
  };
  return langue === "en"
    ? { ...base, libelle: STATUT_MISSION_PORTAIL_EN[statut as StatutMission] ?? base.libelle }
    : base;
}

/** Période d'une mission : « Du 12 janv. 2027 au 30 juin 2027 », ou ce qui est connu. */
export function periodeMission(
  debut: string | null,
  fin: string | null,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const d = debut ? formaterDate(debut, "UTC", langue) : "";
  const f = fin ? formaterDate(fin, "UTC", langue) : "";
  if (debut && fin) return t(`Du ${d} au ${f}`, `From ${d} to ${f}`);
  if (debut) return t(`Depuis le ${d}`, `Since ${d}`);
  if (fin) return t(`Jusqu'au ${f}`, `Until ${f}`);
  return t("Dates à préciser", "Dates to be confirmed");
}

/** Rubriques consultables d'une mission partagée : « À consulter : jalons, documents et factures. » */
export function rubriquesMission(
  partage: MissionPortail["partage"],
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const rubriques = [
    ...(partage.jalons ? [t("jalons", "milestones")] : []),
    "documents",
    ...(partage.factures ? [t("factures", "invoices")] : []),
  ];
  const liste =
    rubriques.length === 1
      ? rubriques[0]
      : `${rubriques.slice(0, -1).join(", ")}${t(" et ", " and ")}${rubriques[rubriques.length - 1]}`;
  return t(`À consulter : ${liste}.`, `To review: ${liste}.`);
}

/** Statut de paiement d'une facture, du point de vue du client. */
export const STATUT_PAIEMENT_PORTAIL: Record<StatutPaiement, Libelle> = {
  non_payee: { libelle: "À régler", tonalite: "neutre" },
  partiellement_payee: { libelle: "Partiellement réglée", tonalite: "attention" },
  soldee: { libelle: "Réglée", tonalite: "succes" },
  en_retard: { libelle: "Échéance dépassée", tonalite: "danger" },
  annulee: { libelle: "Annulée", tonalite: "neutre" },
};

/** Badge de paiement : « Échéance dépassée de 12 jours » ; un avoir n'a pas de paiement. */
const STATUT_PAIEMENT_PORTAIL_EN: Record<StatutPaiement, string> = {
  non_payee: "To be paid",
  partiellement_payee: "Partially paid",
  soldee: "Paid",
  en_retard: "Past due",
  annulee: "Cancelled",
};

export function etatPaiement(
  f: Pick<FacturePortail, "nature" | "statut" | "paiement">,
  langue: Langue = "fr",
): Libelle {
  const t = creerTraduire(langue);
  if (f.statut === "annulee")
    return { libelle: t("Annulée par un avoir", "Cancelled by a credit note"), tonalite: "neutre" };
  if (f.nature === "avoir" || !f.paiement)
    return { libelle: t("Sans objet", "Not applicable"), tonalite: "neutre" };
  const base = STATUT_PAIEMENT_PORTAIL[f.paiement.statut_paiement] ?? {
    libelle: "—",
    tonalite: "neutre",
  };
  const s =
    langue === "en"
      ? { ...base, libelle: STATUT_PAIEMENT_PORTAIL_EN[f.paiement.statut_paiement] ?? base.libelle }
      : base;
  const retard = f.paiement.jours_retard;
  if (f.paiement.statut_paiement === "en_retard" && retard > 0) {
    return {
      ...s,
      libelle: t(
        `${s.libelle} de ${retard} jour${retard > 1 ? "s" : ""}`,
        `${s.libelle} by ${retard} day${retard > 1 ? "s" : ""}`,
      ),
    };
  }
  return s;
}

/** « Facture FA-2027-0012 », « Avoir AV-2027-0003 ». */
export function designationFacturePortail(
  f: Pick<FacturePortail, "nature" | "numero">,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const nature = f.nature === "avoir" ? t("Avoir", "Credit note") : t("Facture", "Invoice");
  return f.numero ? `${nature} ${f.numero}` : nature;
}

/** Espace insécable avant l'unité (comme `formaterMontantMineur`). */
const NBSP = String.fromCharCode(0xa0);

/** Montant en unités mineures dans sa devise ; une devise inconnue reste lisible, sans conversion. */
export function montantPortail(
  valeur: number | null | undefined,
  devise: string,
  langue: Langue = "fr",
): string {
  if ((DEVISES as readonly string[]).includes(devise)) {
    return formaterMontantMineur(valeur, devise as Devise, langue);
  }
  return `${formaterNombre(valeur, 0, langue)}${NBSP}${devise}`;
}

const TYPES_LIVRABLE: Record<string, string> = {
  livrable: "Livrable",
  lettre_de_mission: "Lettre de mission",
};

const TYPES_LIVRABLE_EN: Record<string, string> = {
  livrable: "Deliverable",
  lettre_de_mission: "Engagement letter",
};

export const libelleTypeLivrable = (type: string, langue: Langue = "fr") =>
  (langue === "en" ? TYPES_LIVRABLE_EN : TYPES_LIVRABLE)[type] ?? "Document";
