/**
 * Autorisation d'envoi d'un message (lot 3c, SPEC §9.2). Fonction pure : l'appelant lit l'état
 * (consentement, compteurs) sous verrou, le moteur décide et rend TOUS les refus dans l'ordre des
 * règles. Aucune horloge : le compte des envois récents est fourni.
 */
import { ErreurCanaux } from "./erreurs";

export const CATEGORIES_ENVOI = [
  "verification",
  "relance",
  "synthese",
  "alerte",
  "signature",
  "reponse_service",
] as const;
export type CategorieEnvoi = (typeof CATEGORIES_ENVOI)[number];

export const MOTIFS_BLOCAGE = [
  "consentement_absent",
  "consentement_retire",
  "numero_non_verifie",
  "canal_inactif",
  "destinataire_inactif",
  "coupe_circuit",
  "plafond_destinataire",
  "plafond_cabinet",
  "plafond_reponses",
  "fenetre_fermee",
] as const;
export type MotifBlocage = (typeof MOTIFS_BLOCAGE)[number];

export type ConsentementCourant = "accorde" | "retire" | "absent";

/** Messages à l'initiative du cabinet, par destinataire et par 24 h (valeur PROVISOIRE, O-16). */
export const PLAFOND_ENVOIS_DESTINATAIRE_24H = 3;
/** Messages à l'initiative du cabinet, par cabinet et par mois civil UTC (PROVISOIRE, O-01). */
export const PLAFOND_ENVOIS_CABINET_MOIS = 2000;
/** Réponses de service, par destinataire et par 24 h (PROVISOIRE). */
export const PLAFOND_REPONSES_SERVICE_24H = 10;
/** Fenêtre de service WhatsApp : une réponse libre n'est permise que dans les 24 h (O-02). */
export const FENETRE_SERVICE_HEURES = 24;

export interface EntreeAutorisationEnvoi {
  readonly compteActif: boolean;
  readonly destinataireActif: boolean;
  readonly numeroVerifie: boolean;
  readonly consentement: ConsentementCourant;
  readonly categorie: CategorieEnvoi;
  readonly coupeCircuitN4: boolean;
  /** Messages à l'initiative du cabinet envoyés à ce destinataire sur les 24 dernières heures. */
  readonly envoisInitiesDernieres24h: number;
  /** Messages à l'initiative du cabinet envoyés par le cabinet sur le mois civil UTC. */
  readonly envoisInitiesMois: number;
  /** Réponses de service envoyées à ce destinataire sur les 24 dernières heures. */
  readonly reponsesService24h: number;
  /** Heures écoulées depuis le dernier message entrant de ce destinataire ; nul si aucun. */
  readonly heuresDepuisDernierEntrant: number | null;
}

export interface DecisionEnvoi {
  readonly autorise: boolean;
  readonly refus: readonly MotifBlocage[];
}

function compteur(valeur: number): void {
  if (!Number.isFinite(valeur) || valeur < 0) throw new ErreurCanaux("ENTREE_INVALIDE");
}

export function peutEnvoyer(entree: EntreeAutorisationEnvoi): DecisionEnvoi {
  compteur(entree.envoisInitiesDernieres24h);
  compteur(entree.envoisInitiesMois);
  compteur(entree.reponsesService24h);
  if (entree.heuresDepuisDernierEntrant !== null) compteur(entree.heuresDepuisDernierEntrant);

  const refus: MotifBlocage[] = [];
  // 1. Compte et destinataire.
  if (!entree.compteActif) refus.push("canal_inactif");
  if (!entree.destinataireActif) refus.push("destinataire_inactif");

  // 2. Code de vérification : exempté de consentement et de vérification (le plafond de codes
  //    est compté en base, 429 TROP_DE_TENTATIVES).
  if (entree.categorie === "verification") return { autorise: refus.length === 0, refus };

  // 3. Réponse de service : exemptée de consentement, soumise à la fenêtre de 24 h et au plafond.
  if (entree.categorie === "reponse_service") {
    if (
      entree.heuresDepuisDernierEntrant === null ||
      entree.heuresDepuisDernierEntrant > FENETRE_SERVICE_HEURES
    ) {
      refus.push("fenetre_fermee");
    }
    if (entree.reponsesService24h >= PLAFOND_REPONSES_SERVICE_24H) refus.push("plafond_reponses");
    return { autorise: refus.length === 0, refus };
  }

  // 4. Les autres catégories exigent un consentement accordé et un numéro vérifié.
  if (entree.consentement === "retire") refus.push("consentement_retire");
  else if (entree.consentement === "absent") refus.push("consentement_absent");
  if (!entree.numeroVerifie) refus.push("numero_non_verifie");

  // 5. Classe R0 vers le client : suspendue par le coupe-circuit N4.
  if (
    (entree.categorie === "relance" || entree.categorie === "synthese") &&
    entree.coupeCircuitN4
  ) {
    refus.push("coupe_circuit");
  }

  // 6. Plafonds des messages à l'initiative du cabinet.
  if (entree.envoisInitiesDernieres24h >= PLAFOND_ENVOIS_DESTINATAIRE_24H) {
    refus.push("plafond_destinataire");
  }
  if (entree.envoisInitiesMois >= PLAFOND_ENVOIS_CABINET_MOIS) refus.push("plafond_cabinet");

  return { autorise: refus.length === 0, refus };
}
