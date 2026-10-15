/**
 * Statut d'un envoi et décision de repli SMS (lot 3c, SPEC §9.3). Fonctions pures.
 */
import { type CategorieEnvoi, type ConsentementCourant } from "./autorisation";

export const STATUTS_ENVOI = [
  "reserve",
  "en_cours",
  "accepte",
  "livre",
  "lu",
  "echec",
  "bloque",
  "incertain",
] as const;
export type StatutEnvoi = (typeof STATUTS_ENVOI)[number];

/** Statut rapporté par le fournisseur (webhook). `envoye` vaut accepté. */
export type StatutRecu = "envoye" | "livre" | "lu" | "echec";

export const CODES_REFUS_ENVOI = [
  "NUMERO_NON_JOIGNABLE",
  "GABARIT_REFUSE",
  "QUOTA_ATTEINT",
  "FENETRE_FERMEE",
  "INDISPONIBLE",
] as const;
export type CodeRefusEnvoi = (typeof CODES_REFUS_ENVOI)[number];

const RANG: Record<"accepte" | "livre" | "lu", number> = { accepte: 2, livre: 3, lu: 4 };
const TERMINAUX: ReadonlySet<StatutEnvoi> = new Set(["bloque", "incertain", "echec", "lu"]);

/**
 * Fusion monotone d'un statut reçu : rangs `accepte` 2 < `livre` 3 < `lu` 4, un statut de rang
 * inférieur est ignoré ; `echec` n'est pris que depuis `accepte` ; les statuts terminaux
 * (`bloque`, `incertain`, `echec`, `lu`) ne changent plus ; un envoi qui n'est pas encore accepté
 * n'est pas modifié par un statut reçu.
 */
export function fusionnerStatutEnvoi(actuel: StatutEnvoi, recu: StatutRecu): StatutEnvoi {
  if (TERMINAUX.has(actuel)) return actuel;
  if (actuel !== "accepte" && actuel !== "livre") return actuel;
  if (recu === "echec") return actuel === "accepte" ? "echec" : actuel;
  const cible = recu === "envoye" ? "accepte" : recu;
  return RANG[cible] > RANG[actuel] ? cible : actuel;
}

const REFUS_DEFINITIFS: ReadonlySet<CodeRefusEnvoi> = new Set([
  "NUMERO_NON_JOIGNABLE",
  "GABARIT_REFUSE",
  "QUOTA_ATTEINT",
  "FENETRE_FERMEE",
]);
const CATEGORIES_AVEC_REPLI: ReadonlySet<CategorieEnvoi> = new Set([
  "relance",
  "synthese",
  "signature",
  "alerte",
]);

export interface EntreeRepli {
  readonly codeRefus: CodeRefusEnvoi;
  readonly tentativesEpuisees: boolean;
  readonly categorie: CategorieEnvoi;
  readonly repliActif: boolean;
  readonly consentementSms: ConsentementCourant;
  readonly numeroSmsVerifie: boolean;
}

/**
 * Faut-il créer l'envoi SMS de repli ? Oui si le refus est définitif, ou `INDISPONIBLE` après
 * épuisement des tentatives, ET que le repli est actif, le consentement SMS accordé, le numéro SMS
 * vérifié et la catégorie `relance`, `synthese`, `signature` ou `alerte` (jamais `verification`
 * ni `reponse_service`).
 */
export function decisionRepli(entree: EntreeRepli): boolean {
  const refusRepliable =
    REFUS_DEFINITIFS.has(entree.codeRefus) ||
    (entree.codeRefus === "INDISPONIBLE" && entree.tentativesEpuisees);
  return (
    refusRepliable &&
    entree.repliActif &&
    entree.consentementSms === "accorde" &&
    entree.numeroSmsVerifie &&
    CATEGORIES_AVEC_REPLI.has(entree.categorie)
  );
}
