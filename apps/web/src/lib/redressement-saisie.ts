/**
 * Redressement : de la saisie d'un formulaire au corps d'API (SPEC-3a §10.5). Conversions de
 * TEXTE en entier (montants, dates, codes), regroupements par catégorie et contrôles de forme avec
 * leurs messages en français. Aucun calcul métier : pas de somme de montants, pas de solde, pas
 * de ratio ; seule exception, `sommeDesPoids`, contrôle de saisie de l'éditeur de seuils (l'API
 * revalide). Logique pure, testée dans `redressement-saisie.test.ts`.
 *
 * Sous-modules : `redressement-saisie-base`, `-correspondance`, `-seuils`, `-tresorerie`,
 * `-creanciers` et `-plan`. Ce fichier les ré-exporte et porte la saisie du dossier.
 */
import type { RedDossierCreation, RedSecteur } from "@missionpilot/shared";
import type { Resultat } from "./saisie";

export {
  lireMontantRed,
  lireSolde,
  lireEntier,
  estLundi,
  prochainLundi,
  CODES_PAR_POSTE_MAX,
  parserCodes,
} from "./redressement-saisie-base";
export {
  saisieCorrespondanceDepuis,
  corpsCorrespondanceDepuisFormulaire,
  grouperQuestions,
  compterReponses,
  libelleCompteur,
  corpsUrgenceDepuisFormulaire,
  saisieIncidentsDepuis,
  corpsScoreDepuisFormulaire,
} from "./redressement-saisie-correspondance";
export type {
  SaisiePoste,
  SaisieCorrespondance,
  ChampCorrespondance,
  GrilleUrgence,
  GroupeQuestions,
  ChampUrgence,
  ReponseTernaire,
  SaisieIncidents,
  ChampIncidents,
} from "./redressement-saisie-correspondance";
export {
  facteurCritere,
  valeurVersSaisie,
  saisieSeuilsDepuis,
  sommeDesPoids,
  corpsSeuilsDepuisFormulaire,
} from "./redressement-saisie-seuils";
export type { SaisieSeuilCritere, SaisieSeuils, ChampSeuils } from "./redressement-saisie-seuils";
export {
  nouvelleCleLigne,
  ligneVide,
  montantVersTexte,
  saisieVersionDepuis,
  corpsVersionDepuisFormulaire,
  saisieRealiseVide,
  corpsRealiseDepuisFormulaire,
  corpsPointMortDepuisFormulaire,
} from "./redressement-saisie-tresorerie";
export type {
  SaisieLigneTresorerie,
  SaisieVersionTresorerie,
  ChampVersionTresorerie,
  SaisieRealise,
  ChampRealise,
  SaisiePointMort,
  ChampPointMort,
} from "./redressement-saisie-tresorerie";
export {
  corpsCreancierDepuisFormulaire,
  corpsCreanceDepuisFormulaire,
  evenementVide,
  corpsEvenementDepuisFormulaire,
  corpsAnnulationPaiement,
} from "./redressement-saisie-creanciers";
export type {
  SaisieCreancier,
  ChampCreancier,
  SaisieCreance,
  ChampCreance,
  SaisieLigneEcheance,
  SaisieEvenement,
  ChampEvenement,
} from "./redressement-saisie-creanciers";
export {
  parametresDepuisSaisie,
  parametresVersSaisie,
  corpsActionDepuisFormulaire,
  corpsSimulationDepuisFormulaire,
  aPlusOuMoinsValue,
} from "./redressement-saisie-plan";
export type { SaisieAction, ChampAction } from "./redressement-saisie-plan";

// --- Dossier --------------------------------------------------------------------------------------------------

export interface SaisieDossier {
  intitule: string;
  secteur: RedSecteur;
}
export type ChampDossier = "intitule";

export function corpsDossierDepuisFormulaire(
  s: SaisieDossier,
): Resultat<RedDossierCreation, ChampDossier> {
  const intitule = s.intitule.trim();
  if (intitule === "")
    return { ok: false, erreurs: { intitule: "Saisissez l'intitulé du dossier." } };
  if (intitule.length > 200) {
    return { ok: false, erreurs: { intitule: "L'intitulé compte 200 caractères au plus." } };
  }
  return { ok: true, charge: { intitule, secteur: s.secteur } };
}

export type ChampStatutDossier = "motif";

/** Clôture : un motif d'au moins 10 caractères est exigé (l'API revalide). */
export function corpsCloture(
  motif: string,
): Resultat<{ statut: "clos"; motif: string }, ChampStatutDossier> {
  const m = motif.trim();
  if (m.length < 10) {
    return {
      ok: false,
      erreurs: { motif: "Un motif d'au moins 10 caractères est exigé pour clore le dossier." },
    };
  }
  if (m.length > 1000) {
    return { ok: false, erreurs: { motif: "Le motif compte 1 000 caractères au plus." } };
  }
  return { ok: true, charge: { statut: "clos", motif: m } };
}
