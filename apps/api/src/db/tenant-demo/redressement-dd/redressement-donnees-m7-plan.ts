import { M } from "./redressement-outils.js";
import type { ActionDef, MouvementDef } from "./redressement-plan.js";

/*
 * Plan d'actions du dossier « Gabon Offshore Services » : huit actions en deux volets, dont cinq avec
 * un levier chiffré par le moteur d'après l'exercice 2025 du client. Le plan reste en BROUILLON
 * (deux versions non validées) ; au 24 octobre 2026, quatre actions dont l'échéance est passée ne
 * sont pas terminées (en retard) : relance clients, facturation, report bancaire, stocks.
 */

export const ACTIONS_M7: readonly ActionDef[] = [
  {
    titre: "Mettre en place le suivi hebdomadaire de trésorerie",
    description:
      "Point du lundi avec la direction financière et prévisionnel actualisé chaque semaine.",
    volet: "quick_win",
    domaine: "tresorerie",
    echeance: "2026-08-14",
    responsable: "chef.mission.2",
    creeLe: "2026-07-20",
    par: "chef",
  },
  {
    titre: "Relancer les opérateurs pétroliers en retard de paiement",
    description:
      "Relances formelles des trois clients à plus de 120 jours, calendrier de règlement.",
    volet: "quick_win",
    domaine: "tresorerie",
    echeance: "2026-09-30",
    responsable: "consultant.2",
    levier: { code: "reduction_delai_clients", parametres: { joursGagnes: 12 } },
    creeLe: "2026-07-20",
    par: "chef",
  },
  {
    titre: "Facturer les jalons de maintenance en attente",
    description:
      "Dix-huit jalons de maintenance achevés mais non facturés faute de bon de réception.",
    volet: "quick_win",
    domaine: "tresorerie",
    echeance: "2026-10-10",
    responsable: "consultant.junior.2",
    creeLe: "2026-08-03",
    par: "chef",
  },
  {
    titre: "Négocier un report d'échéances avec la banque",
    description: "Étalement du crédit d'équipement et ligne de découvert de dépannage.",
    volet: "quick_win",
    domaine: "financement",
    echeance: "2026-10-05",
    responsable: "directeur.mission",
    creeLe: "2026-08-03",
    par: "chef",
  },
  {
    titre: "Réduire les stocks de pièces détachées",
    description: "Inventaire physique puis restitution ou revente des pièces dormantes.",
    volet: "quick_win",
    domaine: "exploitation",
    echeance: "2026-10-20",
    responsable: "consultant.2",
    levier: { code: "reduction_stocks", parametres: { reductionPb: 1_500 } },
    creeLe: "2026-09-28",
    par: "chef",
  },
  {
    titre: "Renégocier les contrats de sous-traitance maritime",
    description: "Révision des tarifs journaliers et des clauses de pénalité.",
    volet: "restructuration",
    domaine: "exploitation",
    echeance: "2027-01-15",
    responsable: "chef.mission",
    levier: {
      code: "reduction_charges_fixes",
      parametres: { chargesFixesAnnuelles: 1_480 * M, reductionPb: 800, moisMiseEnOeuvre: 3 },
    },
    creeLe: "2026-09-28",
    par: "chef",
  },
  {
    titre: "Céder un navire d'appui inutilisé",
    description: "Mise en vente d'une unité immobilisée à quai depuis le début de l'année.",
    volet: "restructuration",
    domaine: "financement",
    echeance: "2026-12-18",
    responsable: "directeur.mission",
    levier: {
      code: "cession_actif",
      parametres: { prixCession: 520 * M, valeurComptableNette: 410 * M, fraisEtImpots: 25 * M },
    },
    creeLe: "2026-09-28",
    par: "chef",
  },
  {
    titre: "Revoir la grille tarifaire des prestations de maintenance",
    description: "Indexation des tarifs sur le coût des pièces, avenants aux contrats cadres.",
    volet: "restructuration",
    domaine: "activite",
    echeance: "2026-11-30",
    responsable: "consultant.2",
    levier: { code: "hausse_prix", parametres: { hausseParPb: 300, perteVolumePb: 100 } },
    creeLe: "2026-09-28",
    par: "chef",
  },
];

/** Version 1 du plan à la fin de la phase de lancement (août), version 2 fin septembre. */
export const JOUR_PLAN_V1_M7 = "2026-08-05";
export const JOUR_PLAN_V2_M7 = "2026-10-05";
export const ACTIONS_M7_LANCEMENT = 4;

const mouv = (
  jour: string,
  action: string,
  par: MouvementDef["par"],
  extra: Partial<MouvementDef>,
): MouvementDef => ({ jour, action, par, ...extra });

export const MOUVEMENTS_M7: readonly MouvementDef[] = [
  mouv("2026-07-27", "Mettre en place le suivi hebdomadaire de trésorerie", "chef2", {
    statut: "en_cours",
  }),
  mouv("2026-08-12", "Mettre en place le suivi hebdomadaire de trésorerie", "chef2", {
    statut: "terminee",
    commentaire: "Point du lundi tenu depuis trois semaines avec la direction financière.",
  }),
  mouv("2026-08-10", "Relancer les opérateurs pétroliers en retard de paiement", "consultant2", {
    statut: "en_cours",
  }),
  mouv("2026-09-14", "Négocier un report d'échéances avec la banque", "directeur", {
    statut: "en_cours",
  }),
  mouv("2026-09-29", "Facturer les jalons de maintenance en attente", "consultant2", {
    statut: "bloquee",
    motif: "Attente des bons de réception signés par deux opérateurs.",
  }),
  mouv("2026-10-01", "Céder un navire d'appui inutilisé", "directeur", { statut: "en_cours" }),
];
