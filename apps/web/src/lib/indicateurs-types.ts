/** Indicateurs : contrat de l'API (réponses, vues, éléments) et lecture du carnet de commandes. */
import type { NiveauIndicateurs } from "@missionpilot/shared";
import type { Devise } from "./format";

/** Ratio « réussis / attendus » des moteurs (taux `null` si rien d'attendu). */
export interface Ratio {
  reussis: number;
  attendus: number;
  taux: number | null;
}

export interface VueCharge {
  jours_disponibles: number;
  jours_affectes: number;
  taux_occupation: number | null;
  jours_facturables: number;
  taux_facturabilite: number | null;
  discipline_saisie: Ratio;
}

export interface VueMarge {
  honoraires: number;
  couts_internes: number;
  debours_non_refactures: number;
  sous_traitance: number;
  marge: number;
  taux_marge: number | null;
}

export interface VueMissions {
  nombre_missions: number;
  jours_budget: number;
  jours_realises: number;
  jours_atterrissage: number;
  consommation_budgetaire: number | null;
  ecart_terminaison: { jours: number; relatif_jours: number | null; couts_production?: number };
  respect_jalons: Ratio;
  /** Avec « finance.lire » seulement. */
  marge?: VueMarge;
  taux_realisation?: number | null;
  encours?: { encours_production: number; facture_d_avance: number };
  /** Avec « budget.lire_montants » ou « finance.lire ». */
  carnet_commandes?: number;
  /**
   * Avec « budget.lire_montants » : carnet fondé sur les honoraires facturés (signé − facturé),
   * servi à qui n'a pas « finance.lire » (la valeur produite repose sur des taux internes).
   */
  carnet_commandes_facture?: number;
}

export const LIBELLE_CARNET_PRODUIT =
  "Honoraires signés non encore produits (missions non clôturées)";
export const LIBELLE_CARNET_FACTURE =
  "Carnet fondé sur les honoraires facturés : signé moins déjà facturé";

/**
 * Carnet de commandes à afficher : celui fondé sur la production (finance.lire), sinon celui
 * fondé sur les honoraires facturés, avec un libellé qui dit lequel. `null` si aucun n'est servi.
 */
export function lireCarnet(
  v: Pick<VueMissions, "carnet_commandes" | "carnet_commandes_facture">,
): { valeur: number; libelle: string; base: "produit" | "facture" } | null {
  if (typeof v.carnet_commandes === "number")
    return { valeur: v.carnet_commandes, libelle: LIBELLE_CARNET_PRODUIT, base: "produit" };
  if (typeof v.carnet_commandes_facture === "number")
    return { valeur: v.carnet_commandes_facture, libelle: LIBELLE_CARNET_FACTURE, base: "facture" };
  return null;
}

export interface IndicateursCabinet extends VueCharge, VueMissions {
  delai_moyen_encaissement: number | null;
  factures_soldees: number;
}

export interface ElementMission extends VueMissions {
  mission_id: string;
  intitule: string;
  client_id: string;
  directeur_id: string | null;
  devise_mission: Devise;
}

export interface ElementAssocie extends VueMissions {
  directeur_id: string | null;
  nom: string;
}

export interface ElementCollaborateur extends VueCharge {
  collaborateur_id: string;
  nom: string;
  grade_code: string | null;
}

export interface ElementGrade extends VueCharge {
  grade_code: string | null;
  grade_libelle: string;
  nombre_collaborateurs: number;
}

export interface ElementClient {
  client_id: string;
  raison_sociale: string;
  nombre_missions: number;
  delai_moyen_encaissement: number | null;
  factures_soldees: number;
  marge?: VueMarge;
}

export interface ReponseIndicateurs {
  du: string;
  au: string;
  date_reference: string;
  niveau: NiveauIndicateurs;
  devise: Devise;
  droits: { finance: boolean; montants: boolean };
  cabinet: IndicateursCabinet;
  elements: unknown[];
  missions_exclues?: string[];
}
