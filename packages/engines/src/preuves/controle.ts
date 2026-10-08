/**
 * Contrôle PRV-03 : toute assertion d'un livrable de classe R2 ou R3 est
 * rattachée à au moins une preuve « pour », ou marquée « avis d'expert » ET
 * signée. Une preuve « contre » seule ne fonde pas une assertion. Les classes
 * R0 et R1 (interne) ne sont pas contrôlées.
 */
import { estClasseRisque, rangClasseRisque, type ClasseRisque } from "../qualite/classes";
import { ErreurPreuves } from "./erreurs";
import { comparerIdentifiants, type SensPreuve } from "./preuve";

export interface AssertionLivrable {
  readonly id: string;
  /** Classe de risque du livrable qui porte l'assertion. */
  readonly classeRisque: ClasseRisque;
  readonly preuves: readonly { readonly id: string; readonly sens: SensPreuve }[];
  /** Assertion assumée comme avis d'expert, sans preuve. */
  readonly avisExpert?: boolean;
  /** Avis d'expert signé par son auteur. */
  readonly signee?: boolean;
}

export type CodeAnomaliePreuve = "SANS_PREUVE" | "AVIS_EXPERT_NON_SIGNE";

export interface AnomaliePreuve {
  readonly assertion: string;
  readonly classeRisque: ClasseRisque;
  readonly code: CodeAnomaliePreuve;
}

export interface ControlePreuvesLivrable {
  /** Aucune anomalie. */
  readonly conforme: boolean;
  /** Assertions R2 et R3 contrôlées. */
  readonly controlees: number;
  /** Assertions R0 et R1, non soumises au contrôle. */
  readonly ignorees: number;
  /** Anomalies triées par identifiant d'assertion. */
  readonly anomalies: readonly AnomaliePreuve[];
}

/** Classe minimale soumise au contrôle PRV-03. */
export const CLASSE_MIN_CONTROLE_PREUVE: ClasseRisque = "R2";

/** Repère les assertions R2 et R3 sans preuve « pour » ni avis d'expert signé. */
export function detecterAssertionsSansPreuve(
  assertions: readonly AssertionLivrable[],
): ControlePreuvesLivrable {
  const anomalies: AnomaliePreuve[] = [];
  const ids = new Set<string>();
  let controlees = 0;
  for (const a of assertions) {
    if (typeof a.id !== "string" || a.id === "" || ids.has(a.id)) {
      throw new ErreurPreuves("ASSERTION_INVALIDE", "Identifiant d'assertion absent ou en double.");
    }
    ids.add(a.id);
    if (!estClasseRisque(a.classeRisque) || !Array.isArray(a.preuves)) {
      throw new ErreurPreuves("ASSERTION_INVALIDE", "Classe de risque ou preuves invalides.");
    }
    if (rangClasseRisque(a.classeRisque) < rangClasseRisque(CLASSE_MIN_CONTROLE_PREUVE)) continue;
    controlees += 1;
    if (a.preuves.some((p) => p.sens === "pour")) continue;
    if (a.avisExpert === true && a.signee === true) continue;
    anomalies.push({
      assertion: a.id,
      classeRisque: a.classeRisque,
      code: a.avisExpert === true ? "AVIS_EXPERT_NON_SIGNE" : "SANS_PREUVE",
    });
  }
  anomalies.sort((x, y) => comparerIdentifiants(x.assertion, y.assertion));
  return {
    conforme: anomalies.length === 0,
    controlees,
    ignorees: assertions.length - controlees,
    anomalies,
  };
}
