import type { TypeAbsence } from "@missionpilot/shared";
import type { CleCollaborateur, CleCompteCabinet } from "./cles.js";

/*
 * Données pures des absences du cabinet « Tenant démo » (congés, maladie, formation, autre) :
 * dates passées en absolu (jeu figé), dates futures calculées avec l'horloge fictive (le premier
 * lundi suivant « aujourd'hui », 2026-10-24 étant un samedi). Toutes débutent un jour ouvré,
 * après l'arrivée du collaborateur, sans chevauchement entre absences actives d'une même
 * personne (la route le refuse). Seuls les collaborateurs avec compte peuvent demander une
 * absence ; les experts externes n'ont pas le droit `conges.demander`.
 */

export type StatutVoulu = "validee" | "refusee" | "demandee" | "annulee";

export interface DefAbsence {
  cle: Extract<CleCollaborateur, CleCompteCabinet>;
  type: TypeAbsence;
  debut: string;
  fin: string;
  statut: StatutVoulu;
  /** Motif de refus (statut « refusee »). */
  motif?: string;
  /** « annulee » : la demande est d'abord validée, puis annulée par le demandeur. */
  validerAvant?: boolean;
  commentaire?: string;
}

/** Commentaires de demande selon le type (tirage à graine : voir absences.ts). */
export const COMMENTAIRES: Readonly<Record<TypeAbsence, readonly string[]>> = {
  conge_paye: ["Congés annuels.", "Congés payés.", "Repos après une période de forte activité."],
  maladie: ["Arrêt maladie, certificat transmis.", "Indisponible pour raison de santé."],
  formation: ["Formation externe.", "Séminaire professionnel.", "Session de certification."],
  autre: ["Événement familial.", "Démarches administratives.", "Absence exceptionnelle."],
};

const REFUS_CHARGE = "Période de forte charge sur les missions en cours.";

/** Les lundis suivant « aujourd'hui » : `lundi(k)` = k-ième lundi à venir, k >= 0. */
export function planAbsences(jour: (offset: number) => string): readonly DefAbsence[] {
  // « Aujourd'hui » est un samedi : le prochain lundi est dans 2 jours.
  const lundi = (k: number): string => jour(2 + 7 * k);
  const f = (k: number, n: number): string => jour(2 + 7 * k + n);
  return [
    {
      cle: "consultant",
      type: "conge_paye",
      debut: "2024-12-23",
      fin: "2024-12-31",
      statut: "validee",
    },
    {
      cle: "associe",
      type: "conge_paye",
      debut: "2024-12-26",
      fin: "2025-01-03",
      statut: "validee",
    },
    {
      cle: "directeur.mission",
      type: "conge_paye",
      debut: "2025-01-06",
      fin: "2025-01-10",
      statut: "validee",
    },
    {
      cle: "chef.mission",
      type: "maladie",
      debut: "2025-02-11",
      fin: "2025-02-13",
      statut: "validee",
    },
    {
      cle: "consultant.2",
      type: "formation",
      debut: "2025-03-10",
      fin: "2025-03-11",
      statut: "validee",
    },
    {
      cle: "expert.metier",
      type: "autre",
      debut: "2025-03-03",
      fin: "2025-03-03",
      statut: "validee",
    },
    {
      cle: "associe.2",
      type: "conge_paye",
      debut: "2025-04-14",
      fin: "2025-04-18",
      statut: "validee",
    },
    {
      cle: "consultant",
      type: "conge_paye",
      debut: "2025-05-26",
      fin: "2025-05-30",
      statut: "refusee",
      motif: REFUS_CHARGE,
    },
    {
      cle: "chef.mission.2",
      type: "formation",
      debut: "2025-06-16",
      fin: "2025-06-18",
      statut: "validee",
    },
    {
      cle: "consultant.junior",
      type: "conge_paye",
      debut: "2025-07-21",
      fin: "2025-07-25",
      statut: "validee",
    },
    {
      cle: "directeur.mission.2",
      type: "conge_paye",
      debut: "2025-08-04",
      fin: "2025-08-15",
      statut: "validee",
    },
    {
      cle: "consultant",
      type: "conge_paye",
      debut: "2025-08-11",
      fin: "2025-08-22",
      statut: "validee",
    },
    {
      cle: "associe",
      type: "formation",
      debut: "2025-09-22",
      fin: "2025-09-24",
      statut: "validee",
    },
    {
      cle: "consultant.junior.2",
      type: "maladie",
      debut: "2025-10-08",
      fin: "2025-10-10",
      statut: "validee",
    },
    {
      cle: "expert.metier.2",
      type: "conge_paye",
      debut: "2025-12-22",
      fin: "2025-12-31",
      statut: "validee",
    },
    {
      cle: "chef.mission",
      type: "conge_paye",
      debut: "2025-12-22",
      fin: "2026-01-02",
      statut: "validee",
    },
    {
      cle: "consultant.2",
      type: "maladie",
      debut: "2026-01-14",
      fin: "2026-01-16",
      statut: "validee",
    },
    {
      cle: "consultant.junior",
      type: "formation",
      debut: "2026-02-09",
      fin: "2026-02-10",
      statut: "validee",
    },
    {
      cle: "directeur.mission",
      type: "autre",
      debut: "2026-02-26",
      fin: "2026-02-26",
      statut: "refusee",
      motif: "Comité de pilotage client prévu le même jour.",
    },
    {
      cle: "associe.2",
      type: "formation",
      debut: "2026-03-23",
      fin: "2026-03-25",
      statut: "validee",
    },
    {
      cle: "chef.mission.2",
      type: "conge_paye",
      debut: "2026-04-06",
      fin: "2026-04-10",
      statut: "validee",
    },
    {
      cle: "consultant.stagiaire",
      type: "autre",
      debut: "2026-04-20",
      fin: "2026-04-21",
      statut: "validee",
      commentaire: "Examens universitaires.",
    },
    {
      cle: "expert.metier",
      type: "conge_paye",
      debut: "2026-05-04",
      fin: "2026-05-08",
      statut: "validee",
    },
    {
      cle: "consultant.junior.2",
      type: "conge_paye",
      debut: "2026-06-29",
      fin: "2026-07-10",
      statut: "validee",
    },
    {
      cle: "consultant",
      type: "maladie",
      debut: "2026-07-06",
      fin: "2026-07-07",
      statut: "validee",
    },
    {
      cle: "associe",
      type: "conge_paye",
      debut: "2026-08-03",
      fin: "2026-08-14",
      statut: "validee",
    },
    {
      cle: "directeur.mission.2",
      type: "formation",
      debut: "2026-09-14",
      fin: "2026-09-16",
      statut: "validee",
    },
    {
      cle: "consultant.2",
      type: "conge_paye",
      debut: "2026-09-21",
      fin: "2026-09-25",
      statut: "refusee",
      motif: "Période de clôture des missions du trimestre.",
    },
    // Futur proche : validées d'avance, en attente, annulées.
    {
      cle: "consultant.junior",
      type: "formation",
      debut: lundi(1),
      fin: f(1, 1),
      statut: "validee",
    },
    { cle: "consultant.2", type: "conge_paye", debut: lundi(2), fin: f(2, 4), statut: "demandee" },
    { cle: "chef.mission", type: "formation", debut: lundi(3), fin: f(3, 1), statut: "demandee" },
    {
      cle: "expert.metier.2",
      type: "autre",
      debut: lundi(4),
      fin: lundi(4),
      statut: "annulee",
      validerAvant: true,
    },
    {
      cle: "directeur.mission",
      type: "conge_paye",
      debut: lundi(5),
      fin: f(5, 4),
      statut: "annulee",
    },
    { cle: "associe", type: "formation", debut: lundi(6), fin: f(6, 1), statut: "demandee" },
    { cle: "associe.2", type: "conge_paye", debut: lundi(7), fin: f(7, 4), statut: "validee" },
    { cle: "consultant", type: "conge_paye", debut: lundi(8), fin: f(8, 11), statut: "demandee" },
  ];
}
