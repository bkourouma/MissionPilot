import { M } from "./redressement-outils.js";
import type { ActionDef, MouvementDef } from "./redressement-plan.js";

/*
 * Plan de redressement de la mission « Brasseries du Wouri » : neuf actions en deux volets, dont
 * sept avec un levier chiffré par le moteur d'après le dernier état financier accepté du client.
 * Trois versions de plan, toutes validées par le directeur de la mission : la première (avril)
 * ne porte que les gains rapides, la deuxième (mai) ajoute la restructuration, la troisième
 * (septembre) tient compte de l'abandon d'une action et d'un report d'échéance.
 * Toutes les actions sont terminées ou abandonnées à la clôture du dossier.
 */

/** Première vague : quatre gains rapides (créés début avril, plan v1). */
export const ACTIONS_M3_VAGUE_1: readonly ActionDef[] = [
  {
    titre: "Relancer les distributeurs en retard de paiement",
    description: "Courrier de relance, point hebdomadaire avec les cinq premiers distributeurs.",
    volet: "quick_win",
    domaine: "tresorerie",
    echeance: "2025-05-15",
    responsable: "consultant",
    levier: { code: "reduction_delai_clients", parametres: { joursGagnes: 8 } },
    creeLe: "2025-04-03",
    par: "chef",
  },
  {
    titre: "Mettre en place le point hebdomadaire de trésorerie",
    description:
      "Réunion du lundi avec la direction financière, prévisionnel mis à jour chaque semaine.",
    volet: "quick_win",
    domaine: "tresorerie",
    echeance: "2025-04-18",
    responsable: "chef.mission",
    creeLe: "2025-04-03",
    par: "chef",
  },
  {
    titre: "Négocier l'étalement des dettes fournisseurs",
    description: "Accords d'étalement avec le malt, le houblon et les emballages.",
    volet: "quick_win",
    domaine: "financement",
    echeance: "2025-05-31",
    responsable: "directeur.mission",
    levier: { code: "allongement_delai_fournisseurs", parametres: { joursGagnes: 15 } },
    creeLe: "2025-04-04",
    par: "chef",
  },
  {
    titre: "Réduire les stocks de matières et d'emballages",
    description: "Ramener les stocks de matières à quatre semaines de production.",
    volet: "quick_win",
    domaine: "exploitation",
    echeance: "2025-06-30",
    responsable: "consultant.junior",
    levier: { code: "reduction_stocks", parametres: { reductionPb: 800 } },
    creeLe: "2025-04-04",
    par: "consultant",
  },
];

/** Deuxième vague : restructuration (mai, plan v2). */
export const ACTIONS_M3_VAGUE_2: readonly ActionDef[] = [
  {
    titre: "Réduire les charges fixes des sites de production",
    description: "Regroupement des équipes de nuit et renégociation des contrats de maintenance.",
    volet: "restructuration",
    domaine: "exploitation",
    echeance: "2025-09-30",
    responsable: "chef.mission.2",
    levier: {
      code: "reduction_charges_fixes",
      parametres: { chargesFixesAnnuelles: 16_500 * M, reductionPb: 600, moisMiseEnOeuvre: 4 },
    },
    creeLe: "2025-05-12",
    par: "chef",
  },
  {
    titre: "Revoir la politique de prix des gammes",
    description: "Hausse ciblée sur les formats premium, suivi de la perte de volume.",
    volet: "restructuration",
    domaine: "activite",
    echeance: "2025-08-29",
    responsable: "consultant.2",
    levier: { code: "hausse_prix", parametres: { hausseParPb: 150, perteVolumePb: 50 } },
    creeLe: "2025-05-14",
    par: "chef",
  },
  {
    titre: "Céder les entrepôts secondaires",
    description: "Cession des deux entrepôts de Bonabéri, repris en location pour la logistique.",
    volet: "restructuration",
    domaine: "financement",
    echeance: "2025-08-31",
    responsable: "directeur.mission",
    levier: {
      code: "cession_actif",
      parametres: {
        prixCession: 2_400 * M,
        valeurComptableNette: 1_900 * M,
        fraisEtImpots: 150 * M,
      },
    },
    creeLe: "2025-05-16",
    par: "chef",
  },
  {
    titre: "Mettre à niveau le système de suivi de gestion",
    description: "Tableau de bord mensuel et prix de revient par gamme.",
    volet: "restructuration",
    domaine: "exploitation",
    echeance: "2025-11-07",
    responsable: "consultant.junior",
    creeLe: "2025-05-20",
    par: "consultant",
  },
];

/** Neuvième action, ajoutée en septembre (plan v3). */
export const ACTION_M3_SEPTEMBRE: ActionDef = {
  titre: "Former les équipes commerciales au suivi des encours clients",
  description: "Deux demi-journées de formation, tableau des encours remis à chaque commercial.",
  volet: "quick_win",
  domaine: "activite",
  echeance: "2025-10-15",
  responsable: "consultant",
  creeLe: "2025-09-05",
  par: "chef",
};

const mouv = (
  jour: string,
  action: string,
  par: MouvementDef["par"],
  extra: Partial<MouvementDef>,
): MouvementDef => ({ jour, action, par, ...extra });

const T = {
  relance: "Relancer les distributeurs en retard de paiement",
  point: "Mettre en place le point hebdomadaire de trésorerie",
  etalement: "Négocier l'étalement des dettes fournisseurs",
  stocks: "Réduire les stocks de matières et d'emballages",
  charges: "Réduire les charges fixes des sites de production",
  prix: "Revoir la politique de prix des gammes",
  entrepots: "Céder les entrepôts secondaires",
  suivi: "Mettre à niveau le système de suivi de gestion",
  formation: ACTION_M3_SEPTEMBRE.titre,
} as const;

/** Mouvements jusqu'à la création de la version 3 du plan (4 septembre). */
export const MOUVEMENTS_M3_AVANT_V3: readonly MouvementDef[] = [
  mouv("2025-04-04", T.point, "chef", { statut: "en_cours" }),
  mouv("2025-04-07", T.relance, "consultant", { statut: "en_cours" }),
  mouv("2025-04-08", T.etalement, "directeur", { statut: "en_cours" }),
  mouv("2025-04-14", T.point, "chef", {
    statut: "terminee",
    commentaire: "Point du lundi tenu depuis trois semaines.",
  }),
  mouv("2025-04-22", T.stocks, "consultant", { statut: "en_cours" }),
  mouv("2025-05-09", T.relance, "consultant", { statut: "terminee" }),
  mouv("2025-05-23", T.etalement, "directeur", {
    statut: "terminee",
    commentaire: "Quatre accords signés sur cinq.",
  }),
  mouv("2025-05-26", T.charges, "chef2", { statut: "en_cours" }),
  mouv("2025-06-02", T.prix, "consultant2", { statut: "en_cours" }),
  mouv("2025-06-10", T.entrepots, "directeur", { statut: "en_cours" }),
  mouv("2025-06-23", T.charges, "chef2", {
    statut: "bloquee",
    motif: "Attente de l'avis des représentants du personnel.",
  }),
  mouv("2025-06-27", T.stocks, "consultant", { statut: "terminee" }),
  mouv("2025-07-01", T.suivi, "consultant", { statut: "en_cours" }),
  mouv("2025-07-07", T.charges, "chef2", { statut: "en_cours" }),
  mouv("2025-08-22", T.prix, "consultant2", { statut: "terminee" }),
  mouv("2025-08-22", T.entrepots, "directeur", {
    statut: "terminee",
    commentaire: "Cession finalisée, produit encaissé.",
  }),
  mouv("2025-09-04", T.suivi, "consultant", {
    statut: "abandonnee",
    motif: "Reportée par le client à l'exercice 2026 : budget informatique réaffecté.",
  }),
];

/** Report d'échéance décidé en septembre, avant la version 3 du plan. */
export const MODIFICATION_M3_SEPTEMBRE = mouv("2025-09-05", T.charges, "chef2", {
  modification: { echeance: "2025-10-31" },
});

/** Mouvements après la version 3 du plan. */
export const MOUVEMENTS_M3_APRES_V3: readonly MouvementDef[] = [
  mouv("2025-09-19", T.charges, "chef2", {
    statut: "terminee",
    commentaire: "Équipes regroupées sur deux sites.",
  }),
  mouv("2025-09-22", T.formation, "consultant", { statut: "en_cours" }),
  mouv("2025-10-10", T.formation, "consultant", { statut: "terminee" }),
];
