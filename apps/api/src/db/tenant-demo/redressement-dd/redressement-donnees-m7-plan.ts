import { M } from "./redressement-outils.js";
import type { ActionDef, MouvementDef } from "./redressement-plan.js";

/*
 * Plan d'actions du dossier « Gabon Offshore Services » (montants des leviers en XOF, convertis dans
 * la devise de la mission par l'échelle de redressement-outils.ts). Dix actions en deux volets, dont
 * cinq avec un levier chiffré par le moteur d'après l'exercice 2025 du client.
 *
 * Deux versions de plan : la version 1 (5 août 2026) ne porte que les gains rapides de la phase de
 * lancement et est VALIDÉE par le directeur de la mission le 7 août ; la version 2 (5 octobre)
 * intègre la restructuration et reste en BROUILLON (révision en cours, non soumise au directeur).
 * Au 24 octobre 2026 : trois actions terminées, une bloquée, cinq en cours dont trois en retard
 * d'échéance, une à faire ; quatre actions non terminées ont une échéance passée.
 */

export const JOUR_PLAN_V1_M7 = "2026-08-05";
export const JOUR_VALIDATION_PLAN_V1_M7 = "2026-08-07";
export const JOUR_MISE_EN_OEUVRE_M7 = "2026-08-08";
export const JOUR_PLAN_V2_M7 = "2026-10-05";

/** Phase de lancement (juillet et début août) : quatre gains rapides, plan v1. */
export const ACTIONS_M7_VAGUE_1: readonly ActionDef[] = [
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
];

/** Suite du plan (août à septembre) : suivi des fournisseurs, stocks, restructuration. */
export const ACTIONS_M7_VAGUE_2: readonly ActionDef[] = [
  {
    titre: "Construire le tableau de suivi des échéances fournisseurs",
    description: "Calendrier des dettes fournisseurs et sous-traitants, priorités de règlement.",
    volet: "quick_win",
    domaine: "tresorerie",
    echeance: "2026-09-18",
    responsable: "consultant.junior.2",
    creeLe: "2026-08-17",
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
    titre: "Négocier un étalement avec l'administration fiscale",
    description: "Dépôt de la demande d'étalement des impôts et taxes en retard de paiement.",
    volet: "quick_win",
    domaine: "financement",
    echeance: "2026-10-15",
    responsable: "chef.mission.2",
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

const T = {
  suivi: "Mettre en place le suivi hebdomadaire de trésorerie",
  relance: "Relancer les opérateurs pétroliers en retard de paiement",
  facturer: "Facturer les jalons de maintenance en attente",
  banque: "Négocier un report d'échéances avec la banque",
  fournisseurs: "Construire le tableau de suivi des échéances fournisseurs",
  stocks: "Réduire les stocks de pièces détachées",
  fisc: "Négocier un étalement avec l'administration fiscale",
  sousTraitance: "Renégocier les contrats de sous-traitance maritime",
  navire: "Céder un navire d'appui inutilisé",
} as const;

const mouv = (
  jour: string,
  action: string,
  par: MouvementDef["par"],
  extra: Partial<MouvementDef>,
): MouvementDef => ({ jour, action, par, ...extra });

/** Mouvements du kanban, du lancement (juillet) à la mi-octobre, dans l'ordre chronologique. */
export const MOUVEMENTS_M7: readonly MouvementDef[] = [
  mouv("2026-07-27", T.suivi, "chef2", { statut: "en_cours" }),
  mouv("2026-08-10", T.relance, "consultant2", { statut: "en_cours" }),
  mouv("2026-08-12", T.suivi, "chef2", {
    statut: "terminee",
    commentaire: "Point du lundi tenu depuis trois semaines avec la direction financière.",
  }),
  mouv("2026-08-18", T.banque, "directeur", { statut: "en_cours" }),
  mouv("2026-08-24", T.fournisseurs, "consultant2", { statut: "en_cours" }),
  mouv("2026-09-16", T.fournisseurs, "consultant2", {
    statut: "terminee",
    commentaire: "Tableau livré à la direction financière, mis à jour chaque vendredi.",
  }),
  mouv("2026-09-19", T.banque, "directeur", {
    statut: "terminee",
    commentaire: "Accord signé le 18 septembre : huit mensualités à compter du 15 octobre.",
  }),
  mouv("2026-09-29", T.facturer, "consultant2", {
    statut: "bloquee",
    motif: "Attente des bons de réception signés par deux opérateurs.",
  }),
  mouv("2026-10-01", T.navire, "directeur", { statut: "en_cours" }),
  mouv("2026-10-05", T.fisc, "chef2", {
    statut: "en_cours",
    commentaire: "Proposition de six mensualités transmise au service de recouvrement.",
  }),
  mouv("2026-10-06", T.stocks, "consultant2", { statut: "en_cours" }),
  mouv("2026-10-12", T.sousTraitance, "chef", { statut: "en_cours" }),
];

/** Précision ajoutée par un consultant à la première cause racine (statut « modifié »). */
export const PRECISION_CAUSES_M7 =
  "Deux opérateurs représentent 62 % du chiffre d'affaires et règlent à plus de 120 jours ; les bons de réception manquants retardent la facturation de la maintenance.";
