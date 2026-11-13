import {
  CODE_BRIQUE_REVUE_CONTRADICTOIRE,
  creerTraduire,
  type Langue,
  type NiveauAutonomie,
} from "@missionpilot/shared";
import { libelleNiveau } from "../../../../lib/agents-libelles";

/*
 * Préparation de l'agent contradicteur depuis l'écran des agents (AGT-06) : logique pure, testée
 * dans `contradicteur-agent.test.ts`. La préparation (POST /api/agents/revues-contradictoires/
 * preparation, droit « agent.gerer ») sème le prompt et le jeu d'essai ; la brique
 * `revue_contradictoire` se déclare ensuite par POST /api/agents/briques. L'API reste seule juge
 * des droits, des plafonds et des règles.
 */

export const CODE_AGENT_CONTRADICTEUR = "contradicteur";

/** Analyse interne : la revue est un brouillon IA non bloquant, jamais un livrable client. */
export const CLASSE_BRIQUE_CONTRADICTEUR = "R1" as const;

/** Niveaux proposés : N4 est réservé aux briques R0, le standard plafonne cet agent à N3. */
export const NIVEAUX_CONTRADICTEUR: readonly NiveauAutonomie[] = ["N0", "N1", "N2", "N3"];

/** Niveau proposé par défaut : N2, comme toute nouvelle brique confiée à un agent. */
export const NIVEAU_CONTRADICTEUR_DEFAUT: NiveauAutonomie = "N2";

export const libelleNiveauContradicteur = (n: NiveauAutonomie, langue: Langue = "fr") =>
  libelleNiveau(n, langue);

/** Charge du POST /api/agents/briques, ou null si le niveau n'est pas l'un des niveaux proposés. */
export function chargeBriqueContradicteur(niveau: string) {
  if (!(NIVEAUX_CONTRADICTEUR as readonly string[]).includes(niveau)) return null;
  return {
    brique_code: CODE_BRIQUE_REVUE_CONTRADICTOIRE,
    agent_code: CODE_AGENT_CONTRADICTEUR,
    classe_risque: CLASSE_BRIQUE_CONTRADICTEUR,
    niveau_max: niveau as NiveauAutonomie,
  };
}

/** La brique est-elle déjà déclarée (dans la page de briques chargée) ? */
export function briqueContradicteurDeclaree(briques: readonly { code: string }[]): boolean {
  return briques.some((b) => b.code === CODE_BRIQUE_REVUE_CONTRADICTOIRE);
}

/** Réponse de POST /api/agents/revues-contradictoires/preparation. */
export interface PreparationRevue {
  prompt?: { nom?: string; version?: number } | null;
  jeu_essai_cree?: boolean;
}

/** Message de succès de la préparation (prompt semé, jeu d'essai créé ou déjà présent). */
export function messagePreparation(r: PreparationRevue, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  const version = r.prompt?.version;
  const prompt =
    typeof version === "number"
      ? t(
          `Prompt de la revue contradictoire prêt (version ${version})`,
          `Counter-analysis prompt ready (version ${version})`,
        )
      : t("Prompt de la revue contradictoire prêt", "Counter-analysis prompt ready");
  const jeu = r.jeu_essai_cree
    ? t("jeu d'essai recommandé enregistré", "recommended test set saved")
    : t("jeu d'essai déjà enregistré", "test set already saved");
  return t(
    `${prompt}, ${jeu}. Lancez maintenant l'évaluation de non-régression.`,
    `${prompt}, ${jeu}. Now run the non-regression evaluation.`,
  );
}
