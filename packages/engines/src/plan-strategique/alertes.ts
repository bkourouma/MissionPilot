/**
 * Alertes déterministes du modèle financier : aucune appréciation, seulement
 * des seuils (l'IA pourra les commenter, jamais les produire).
 *
 * - `TRESORERIE_NEGATIVE` (critique) : trésorerie nette de clôture < 0.
 * - `CAPITAUX_PROPRES_NEGATIFS` (critique) : capitaux propres < 0.
 * - `CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL` (attention) : capitaux propres
 *   positifs ou nuls mais inférieurs à la moitié du capital social (seuil de
 *   l'Acte uniforme OHADA sur les sociétés commerciales, qui impose de
 *   consulter les associés sur la poursuite de l'activité).
 * - `BILAN_DESEQUILIBRE` (critique) : actif ≠ passif ; ne doit jamais se
 *   produire, signale une anomalie du moteur.
 *
 * Ordre : par année, puis dans l'ordre ci-dessus.
 */

export type CodeAlertePlan =
  | "TRESORERIE_NEGATIVE"
  | "CAPITAUX_PROPRES_NEGATIFS"
  | "CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL"
  | "BILAN_DESEQUILIBRE";

export type GraviteAlertePlan = "critique" | "attention";

export interface AlertePlan {
  readonly code: CodeAlertePlan;
  readonly gravite: GraviteAlertePlan;
  /** Année du plan (1 à l'horizon). */
  readonly annee: number;
  readonly exercice: number;
  /** Montant en cause (trésorerie, capitaux propres ou écart d'équilibre). */
  readonly montant: number;
  /** Seuil franchi, en unités mineures. */
  readonly seuil: number;
}

/** Ce que la détection lit d'un exercice prévisionnel. */
export interface ExerciceSurveille {
  readonly annee: number;
  readonly exercice: number;
  readonly bilan: {
    readonly tresorerieNette: number;
    readonly capitauxPropres: number;
    readonly capital: number;
  };
  readonly controle: { readonly ecart: number; readonly equilibre: boolean };
}

export function detecterAlertesPlan(annees: readonly ExerciceSurveille[]): AlertePlan[] {
  const alertes: AlertePlan[] = [];
  for (const a of annees) {
    const base = { annee: a.annee, exercice: a.exercice };
    const { tresorerieNette, capitauxPropres, capital } = a.bilan;
    if (tresorerieNette < 0) {
      alertes.push({
        ...base,
        code: "TRESORERIE_NEGATIVE",
        gravite: "critique",
        montant: tresorerieNette,
        seuil: 0,
      });
    }
    if (capitauxPropres < 0) {
      alertes.push({
        ...base,
        code: "CAPITAUX_PROPRES_NEGATIFS",
        gravite: "critique",
        montant: capitauxPropres,
        seuil: 0,
      });
    } else if (2 * capitauxPropres < capital) {
      alertes.push({
        ...base,
        code: "CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL",
        gravite: "attention",
        montant: capitauxPropres,
        seuil: Math.ceil(capital / 2),
      });
    }
    if (!a.controle.equilibre) {
      alertes.push({
        ...base,
        code: "BILAN_DESEQUILIBRE",
        gravite: "critique",
        montant: a.controle.ecart,
        seuil: 0,
      });
    }
  }
  return alertes;
}
