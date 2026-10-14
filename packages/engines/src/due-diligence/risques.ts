/**
 * Synthèse des risques (DD-06, SPEC-3b §5.4) : totaux par famille et par niveau, risques de niveau
 * élevé ou critique à documenter (lecture fragile ou non évaluée), regroupement par étape de la
 * chaîne de valeur. Fonction pure.
 */
import type { LectureSolidite } from "../preuves/solidite";
import { ErreurDueDiligence } from "./erreurs";
import {
  FAMILLES_RISQUE_DD,
  NIVEAUX_RISQUE_DD,
  rangNiveauRisqueDd,
  type FamilleRisqueDd,
  type NiveauRisqueDd,
} from "./vocabulaire";

export interface RisqueEntree {
  readonly id: string;
  readonly famille: FamilleRisqueDd;
  readonly niveau: NiveauRisqueDd;
  readonly etapeId: string | null;
  /** Lecture de l'assertion de justification ; `null` : non évaluée. */
  readonly lecture: LectureSolidite | null;
}
export interface FamilleRisqueSynthese {
  readonly famille: FamilleRisqueDd;
  readonly total: number;
  readonly parNiveau: Readonly<Record<NiveauRisqueDd, number>>;
  readonly niveauMax: NiveauRisqueDd | null;
}
export interface SyntheseRisquesDd {
  readonly total: number;
  /** Ordre canonique : pays, change, operationnel, reglementaire. */
  readonly familles: readonly FamilleRisqueSynthese[];
  /** Niveau élevé ou critique ET lecture fragile ou `null` ; tri : niveau décroissant, puis id. */
  readonly aDocumenter: readonly string[];
  /** Tri par etapeId. */
  readonly parEtape: readonly {
    etapeId: string;
    total: number;
    niveauMax: NiveauRisqueDd;
  }[];
}

const LECTURES: readonly (LectureSolidite | null)[] = ["solide", "etayee", "fragile", null];

function comparerTexte(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function plusGrave(a: NiveauRisqueDd | null, b: NiveauRisqueDd): NiveauRisqueDd {
  return a === null || rangNiveauRisqueDd(b) > rangNiveauRisqueDd(a) ? b : a;
}

export function syntheseRisquesDd(risques: readonly RisqueEntree[]): SyntheseRisquesDd {
  for (const r of risques) {
    if (!(FAMILLES_RISQUE_DD as readonly string[]).includes(r.famille)) {
      throw new ErreurDueDiligence(
        "ENTREE_INVALIDE",
        `Famille de risque inconnue : « ${r.famille} ».`,
      );
    }
    if (!(NIVEAUX_RISQUE_DD as readonly string[]).includes(r.niveau)) {
      throw new ErreurDueDiligence(
        "ENTREE_INVALIDE",
        `Niveau de risque inconnu : « ${r.niveau} ».`,
      );
    }
    if (!LECTURES.includes(r.lecture)) {
      throw new ErreurDueDiligence(
        "ENTREE_INVALIDE",
        `Lecture inconnue : « ${String(r.lecture)} ».`,
      );
    }
  }

  const familles: FamilleRisqueSynthese[] = FAMILLES_RISQUE_DD.map((famille) => {
    const delaFamille = risques.filter((r) => r.famille === famille);
    const parNiveau = { faible: 0, modere: 0, eleve: 0, critique: 0 };
    let niveauMax: NiveauRisqueDd | null = null;
    for (const r of delaFamille) {
      parNiveau[r.niveau] += 1;
      niveauMax = plusGrave(niveauMax, r.niveau);
    }
    return { famille, total: delaFamille.length, parNiveau, niveauMax };
  });

  const aDocumenter = risques
    .filter(
      (r) => rangNiveauRisqueDd(r.niveau) >= 3 && (r.lecture === null || r.lecture === "fragile"),
    )
    .sort(
      (a, b) =>
        rangNiveauRisqueDd(b.niveau) - rangNiveauRisqueDd(a.niveau) || comparerTexte(a.id, b.id),
    )
    .map((r) => r.id);

  const parEtapeMap = new Map<string, { total: number; niveauMax: NiveauRisqueDd }>();
  for (const r of risques) {
    if (r.etapeId === null) continue;
    const courant = parEtapeMap.get(r.etapeId);
    parEtapeMap.set(r.etapeId, {
      total: (courant?.total ?? 0) + 1,
      niveauMax: plusGrave(courant?.niveauMax ?? null, r.niveau),
    });
  }
  const parEtape = [...parEtapeMap.entries()]
    .map(([etapeId, v]) => ({ etapeId, total: v.total, niveauMax: v.niveauMax }))
    .sort((a, b) => comparerTexte(a.etapeId, b.etapeId));

  return { total: risques.length, familles, aDocumenter, parEtape };
}
