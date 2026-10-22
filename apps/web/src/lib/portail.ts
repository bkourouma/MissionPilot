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
import { MOT_DE_PASSE_MIN, type StatutMission, type StatutPaiement } from "@missionpilot/shared";
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

export function statutMission(statut: string): Libelle {
  return STATUT_MISSION_PORTAIL[statut as StatutMission] ?? { libelle: "—", tonalite: "neutre" };
}

/** Période d'une mission : « Du 12 janv. 2027 au 30 juin 2027 », ou ce qui est connu. */
export function periodeMission(debut: string | null, fin: string | null): string {
  if (debut && fin) return `Du ${formaterDate(debut)} au ${formaterDate(fin)}`;
  if (debut) return `Depuis le ${formaterDate(debut)}`;
  if (fin) return `Jusqu'au ${formaterDate(fin)}`;
  return "Dates à préciser";
}

/** Rubriques consultables d'une mission partagée : « À consulter : jalons, documents et factures. » */
export function rubriquesMission(partage: MissionPortail["partage"]): string {
  const rubriques = [
    ...(partage.jalons ? ["jalons"] : []),
    "documents",
    ...(partage.factures ? ["factures"] : []),
  ];
  const liste =
    rubriques.length === 1
      ? rubriques[0]
      : `${rubriques.slice(0, -1).join(", ")} et ${rubriques[rubriques.length - 1]}`;
  return `À consulter : ${liste}.`;
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
export function etatPaiement(f: Pick<FacturePortail, "nature" | "statut" | "paiement">): Libelle {
  if (f.statut === "annulee") return { libelle: "Annulée par un avoir", tonalite: "neutre" };
  if (f.nature === "avoir" || !f.paiement) return { libelle: "Sans objet", tonalite: "neutre" };
  const s = STATUT_PAIEMENT_PORTAIL[f.paiement.statut_paiement] ?? {
    libelle: "—",
    tonalite: "neutre",
  };
  const retard = f.paiement.jours_retard;
  if (f.paiement.statut_paiement === "en_retard" && retard > 0) {
    return { ...s, libelle: `${s.libelle} de ${retard} jour${retard > 1 ? "s" : ""}` };
  }
  return s;
}

/** « Facture FA-2027-0012 », « Avoir AV-2027-0003 ». */
export function designationFacturePortail(f: Pick<FacturePortail, "nature" | "numero">): string {
  const nature = f.nature === "avoir" ? "Avoir" : "Facture";
  return f.numero ? `${nature} ${f.numero}` : nature;
}

/** Espace insécable avant l'unité (comme `formaterMontantMineur`). */
const NBSP = String.fromCharCode(0xa0);

/** Montant en unités mineures dans sa devise ; une devise inconnue reste lisible, sans conversion. */
export function montantPortail(valeur: number | null | undefined, devise: string): string {
  if ((DEVISES as readonly string[]).includes(devise)) {
    return formaterMontantMineur(valeur, devise as Devise);
  }
  return `${formaterNombre(valeur, 0)}${NBSP}${devise}`;
}

const TYPES_LIVRABLE: Record<string, string> = {
  livrable: "Livrable",
  lettre_de_mission: "Lettre de mission",
};

export const libelleTypeLivrable = (type: string) => TYPES_LIVRABLE[type] ?? "Document";
