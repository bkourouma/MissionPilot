/**
 * Erreurs du moteur de planification stratégique et de modèle financier
 * (service 3, PLA-06 et PLA-07).
 *
 * Toute hypothèse invalide lève une `ErreurPlan` portant un code stable et le
 * chemin de l'hypothèse fautive (`croissanceChiffreAffaires[2]`) : l'appelant
 * traduit le code, jamais le message.
 */
export type CodeErreurPlan =
  | "HORIZON_INVALIDE"
  | "HYPOTHESE_INVALIDE"
  | "MONTANT_INVALIDE"
  | "INVESTISSEMENT_INVALIDE"
  | "EMPRUNT_INVALIDE"
  | "BILAN_OUVERTURE_DESEQUILIBRE"
  | "FLUX_INVALIDES";

export class ErreurPlan extends Error {
  readonly code: CodeErreurPlan;
  /** Chemin de l'hypothèse fautive (vide si l'erreur porte sur l'ensemble). */
  readonly chemin: string;

  constructor(code: CodeErreurPlan, message: string, chemin = "") {
    super(message);
    this.name = "ErreurPlan";
    this.code = code;
    this.chemin = chemin;
  }
}
