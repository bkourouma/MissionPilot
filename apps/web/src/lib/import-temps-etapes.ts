/** Import des temps : étapes de l'écran et transitions (simulation, confirmation, exécution). */
import { executionPossible, type RapportImport } from "./temps-admin";

/**
 * `choix` : rien de simulé pour la source courante ; `simulation` / `execution` : appel en
 * cours ; `simule` : rapport de simulation affiché ; `confirmation` : l'utilisateur doit
 * confirmer l'import ; `importe` : import réalisé.
 */
export type EtapeImport =
  "choix" | "simulation" | "simule" | "confirmation" | "execution" | "importe";

export interface ErreurImportAffichee {
  titre: string;
  message: string;
  /** Rappel court sous le choix de fichier, quand le fichier lui-même est en cause. */
  rappel?: string;
}

export interface EtatImport {
  etape: EtapeImport;
  rapport: RapportImport | null;
  erreur: ErreurImportAffichee | null;
}

export const ETAT_INITIAL: EtatImport = { etape: "choix", rapport: null, erreur: null };

export type ActionImport =
  /** Fichier choisi ou retiré, CSV modifié, nouvel import : toute simulation est périmée. */
  | { type: "source_modifiee" }
  | { type: "simulation_lancee" }
  /** Le contrôle local a refusé la source après le lancement (erreur affichée sur le champ). */
  | { type: "preparation_refusee" }
  | { type: "simulation_terminee"; rapport: RapportImport }
  | { type: "confirmation_demandee" }
  | { type: "confirmation_annulee" }
  | { type: "execution_lancee" }
  | { type: "execution_terminee"; rapport: RapportImport }
  | { type: "echec"; erreur: ErreurImportAffichee };

const occupe = (e: EtapeImport) => e === "simulation" || e === "execution";

/** Une simulation se lance depuis le choix ou après une simulation (pour la refaire). */
export const peutSimuler = (s: EtatImport) => s.etape === "choix" || s.etape === "simule";

/** L'import ne se demande qu'après une simulation sans erreur, avec au moins une ligne valide. */
export const peutDemanderImport = (s: EtatImport) =>
  s.etape === "simule" && executionPossible(s.rapport, true);

/** La source ne se change pas pendant un appel (le résultat ne correspondrait plus). */
export const sourceModifiable = (s: EtatImport) => !occupe(s.etape);

/**
 * Transitions de l'écran. Toute action hors de son étape est ignorée : pas d'exécution sans
 * simulation réussie puis confirmation, pas de double envoi. Un échec de l'exécution périme la
 * simulation : son résultat est incertain (coupure) ou les données ont changé, il faut simuler
 * de nouveau avant de réessayer.
 */
export function reduireImport(s: EtatImport, a: ActionImport): EtatImport {
  switch (a.type) {
    case "source_modifiee":
      return occupe(s.etape) ? s : ETAT_INITIAL;
    case "simulation_lancee":
      return peutSimuler(s) ? { etape: "simulation", rapport: null, erreur: null } : s;
    case "preparation_refusee":
      return s.etape === "simulation" ? ETAT_INITIAL : s;
    case "simulation_terminee":
      return s.etape === "simulation" ? { etape: "simule", rapport: a.rapport, erreur: null } : s;
    case "confirmation_demandee":
      return peutDemanderImport(s) ? { ...s, etape: "confirmation" } : s;
    case "confirmation_annulee":
      return s.etape === "confirmation" ? { ...s, etape: "simule" } : s;
    case "execution_lancee":
      return s.etape === "confirmation" ? { ...s, etape: "execution", erreur: null } : s;
    case "execution_terminee":
      if (s.etape !== "execution") return s;
      // Sans exécution confirmée par l'API, le rapport n'autorise pas de nouvel essai direct.
      return { etape: a.rapport.executee ? "importe" : "simule", rapport: a.rapport, erreur: null };
    case "echec":
      return occupe(s.etape) ? { etape: "choix", rapport: null, erreur: a.erreur } : s;
  }
}
