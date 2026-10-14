/**
 * Signaux d'alerte applicables à un dossier (DD-11, SPEC-3b §5.6). La bibliothèque est tenue par
 * les experts du cabinet ; ce moteur ne décide que de l'applicabilité et de l'ordre de lecture.
 * Fonction pure.
 */
import { ErreurDueDiligence } from "./erreurs";
import {
  FAMILLES_RISQUE_DD,
  NIVEAUX_RISQUE_DD,
  rangNiveauRisqueDd,
  type FamilleRisqueDd,
  type NiveauRisqueDd,
} from "./vocabulaire";

export interface SignalBibliotheque {
  readonly id: string;
  /** `null` : tous les secteurs. */
  readonly secteurCode: string | null;
  /** `null` : tous les pays. */
  readonly paysCode: string | null;
  readonly famille: FamilleRisqueDd;
  readonly gravite: NiveauRisqueDd;
  readonly actif: boolean;
}
export interface ContexteSignaux {
  /** Filière puis secteur (parents compris). */
  readonly secteurCodes: readonly string[];
  /** Pays puis zone. */
  readonly paysCodes: readonly string[];
}
export interface SignalApplicable {
  readonly id: string;
  /** Nombre de critères (secteur, pays) renseignés par le signal. */
  readonly specificite: 0 | 1 | 2;
  readonly famille: FamilleRisqueDd;
  readonly gravite: NiveauRisqueDd;
}

/**
 * Applicable si `actif` et (secteur nul ou dans le contexte) et (pays nul ou dans le contexte).
 * Tri : spécificité décroissante, gravité décroissante, id.
 */
export function signauxApplicables(
  contexte: ContexteSignaux,
  signaux: readonly SignalBibliotheque[],
): readonly SignalApplicable[] {
  const ids = new Set<string>();
  for (const s of signaux) {
    if (ids.has(s.id)) {
      throw new ErreurDueDiligence("ENTREE_INVALIDE", `Signal « ${s.id} » en double.`);
    }
    ids.add(s.id);
    if (!(FAMILLES_RISQUE_DD as readonly string[]).includes(s.famille)) {
      throw new ErreurDueDiligence(
        "ENTREE_INVALIDE",
        `Famille de risque inconnue : « ${s.famille} ».`,
      );
    }
    if (!(NIVEAUX_RISQUE_DD as readonly string[]).includes(s.gravite)) {
      throw new ErreurDueDiligence("ENTREE_INVALIDE", `Gravité inconnue : « ${s.gravite} ».`);
    }
  }
  return signaux
    .filter(
      (s) =>
        s.actif &&
        (s.secteurCode === null || contexte.secteurCodes.includes(s.secteurCode)) &&
        (s.paysCode === null || contexte.paysCodes.includes(s.paysCode)),
    )
    .map((s) => ({
      id: s.id,
      specificite: ((s.secteurCode === null ? 0 : 1) + (s.paysCode === null ? 0 : 1)) as 0 | 1 | 2,
      famille: s.famille,
      gravite: s.gravite,
    }))
    .sort(
      (a, b) =>
        b.specificite - a.specificite ||
        rangNiveauRisqueDd(b.gravite) - rangNiveauRisqueDd(a.gravite) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}
