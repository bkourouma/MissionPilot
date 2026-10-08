/**
 * Seuils d'approbation (FIN-15) : selon l'objet (facture, remise, révision de
 * budget) et son montant, quel rôle doit approuver.
 *
 * Le montant est d'abord converti dans la devise de référence de la grille
 * (taux figé fourni par l'appelant), puis comparé en valeur absolue (un avoir
 * ou une révision à la baisse s'approuvent comme leur montant positif). Les
 * paliers sont lus dans l'ordre : le premier dont le plafond (inclus) couvre
 * le montant donne le rôle ; le dernier palier n'a pas de plafond.
 */
import { ErreurFinance } from "./erreurs";
import { convertir, type Devise, type Montant, type TauxChange } from "./monnaie";

export type RoleApprobateur = "chef_mission" | "directeur_mission" | "associe";

export type ObjetApprobation = "facture" | "remise" | "revision_budget";

export interface PalierApprobation {
  /** Plafond inclus en unités mineures de la devise de référence ; `null` = sans plafond. */
  readonly plafond: number | null;
  readonly role: RoleApprobateur;
}

export interface GrilleSeuils {
  readonly deviseReference: Devise;
  readonly paliers: Readonly<Record<ObjetApprobation, readonly PalierApprobation[]>>;
}

/**
 * Grille par défaut (hypothèse à confirmer par le cabinet, paramétrable), en XOF :
 * - facture : ≤ 5 000 000 chef de mission, ≤ 25 000 000 directeur, au-delà associé ;
 * - remise : ≤ 500 000 chef de mission, ≤ 2 500 000 directeur, au-delà associé ;
 * - révision de budget : jamais le chef de mission (FIN-03 : validée par le
 *   directeur de mission) ; ≤ 10 000 000 directeur, au-delà associé.
 */
export const GRILLE_SEUILS_PAR_DEFAUT: GrilleSeuils = {
  deviseReference: "XOF",
  paliers: {
    facture: [
      { plafond: 5_000_000, role: "chef_mission" },
      { plafond: 25_000_000, role: "directeur_mission" },
      { plafond: null, role: "associe" },
    ],
    remise: [
      { plafond: 500_000, role: "chef_mission" },
      { plafond: 2_500_000, role: "directeur_mission" },
      { plafond: null, role: "associe" },
    ],
    revision_budget: [
      { plafond: 10_000_000, role: "directeur_mission" },
      { plafond: null, role: "associe" },
    ],
  },
};

/** Vérifie qu'une liste de paliers est croissante et se termine sans plafond. */
export function verifierPaliers(paliers: readonly PalierApprobation[]): void {
  const dernier = paliers[paliers.length - 1];
  const plafonds = paliers.slice(0, -1).map((p) => p.plafond);
  const croissants = plafonds.every(
    (p, i) =>
      p !== null &&
      Number.isSafeInteger(p) &&
      p >= 0 &&
      (i === 0 || p > (plafonds[i - 1] as number)),
  );
  if (dernier === undefined || dernier.plafond !== null || !croissants) {
    throw new ErreurFinance(
      "GRILLE_SEUILS_INVALIDE",
      "Les paliers doivent avoir des plafonds entiers croissants et finir par un palier sans plafond.",
    );
  }
}

export interface DemandeApprobation {
  readonly objet: ObjetApprobation;
  readonly montant: Montant;
  readonly grille?: GrilleSeuils;
  /** Taux figé vers la devise de référence, requis si le montant est dans une autre devise. */
  readonly tauxChange?: TauxChange;
}

function montantReference(demande: DemandeApprobation, deviseReference: Devise): Montant {
  if (demande.montant.devise === deviseReference) return demande.montant;
  if (demande.tauxChange === undefined || demande.tauxChange.cible !== deviseReference) {
    throw new ErreurFinance(
      "TAUX_CHANGE_INVALIDE",
      `Un taux ${demande.montant.devise}→${deviseReference} est requis pour appliquer les seuils.`,
    );
  }
  return convertir(demande.montant, demande.tauxChange);
}

/**
 * Rôle requis pour approuver. Exemple (grille par défaut) : une facture de
 * 10 000,00 € convertie à 655,957 = 6 559 570 FCFA → « directeur_mission ».
 */
export function roleApprobateur(demande: DemandeApprobation): RoleApprobateur {
  const grille = demande.grille ?? GRILLE_SEUILS_PAR_DEFAUT;
  const paliers = grille.paliers[demande.objet];
  verifierPaliers(paliers);
  const valeur = Math.abs(montantReference(demande, grille.deviseReference).valeur);
  const palier = paliers.find(
    (p) => p.plafond === null || valeur <= p.plafond,
  ) as PalierApprobation;
  return palier.role;
}
