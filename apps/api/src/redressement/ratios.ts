import {
  agregerPostes,
  calculerRatiosRedressement,
  calculerTendancesRedressement,
  type CorrespondancePostes,
  type RatiosExercice,
  type TendancesRedressement,
} from "@missionpilot/engines";
import type { RedRatiosVue } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { calculerFiabilite } from "../dossier/fiabilite.js";
import type { DossierRed } from "./acces.js";
import { correspondanceCourante } from "./correspondances.js";
import { etatsAcceptes, etatsNonUtilises, type EtatLu } from "./etats.js";
import { vueRatiosExercice, vueTendances } from "./vues.js";

/*
 * Ratios (RED-02) : calculés à la LECTURE par le moteur depuis les états ACCEPTÉS et courants du
 * dossier client, par la correspondance de postes courante ; rien n'est stocké. Un poste non
 * renseigné rend le ratio « non calculable », jamais zéro. Sans correspondance, tous les postes
 * sont « à renseigner » (hors résultat net déclaré par l'état).
 */

export interface ExerciceCalcule {
  lu: EtatLu;
  ratios: RatiosExercice;
}

export interface CalculRatios {
  correspondanceVersion: number | null;
  correspondance: CorrespondancePostes;
  /** Le plus récent d'abord (3 au plus). */
  exercices: ExerciceCalcule[];
  /** Dernier exercice et précédent ; null sans exercice. */
  tendances: TendancesRedressement | null;
}

/** États acceptés → ratios et tendances, par le moteur (aucun calcul ici). */
export async function calculerRatiosDossier(db: Db, dossier: DossierRed): Promise<CalculRatios> {
  const corr = await correspondanceCourante(db, dossier.id);
  const correspondance: CorrespondancePostes = corr?.postes ?? {};
  const etats = await etatsAcceptes(db, dossier.client_id);
  const exercices = etats.map((lu) => ({
    lu,
    ratios: calculerRatiosRedressement(lu.etat, correspondance),
  }));
  const courant = exercices[0];
  const tendances = courant
    ? calculerTendancesRedressement(courant.ratios, exercices[1]?.ratios ?? null)
    : null;
  return { correspondanceVersion: corr?.version ?? null, correspondance, exercices, tendances };
}

/** Route 10. */
export async function lireRatios(db: Db, dossier: DossierRed): Promise<RedRatiosVue> {
  const calcul = await calculerRatiosDossier(db, dossier);
  const fiabilite = await calculerFiabilite(db, dossier.client_id);
  return {
    correspondance_version: calcul.correspondanceVersion,
    exercices: calcul.exercices.map((e) => ({
      ...vueRatiosExercice(e.ratios),
      etat_id: e.lu.id,
      date_cloture: e.lu.date_cloture,
      accepte_sous_reserve: e.lu.accepte_sous_reserve,
    })),
    tendances: calcul.tendances ? vueTendances(calcul.tendances) : null,
    etats_non_utilises: await etatsNonUtilises(db, dossier.client_id),
    analyses_indicatives: fiabilite.analysesIndicatives,
    fiabilite: { classe: fiabilite.classe, points: fiabilite.points },
  };
}

/** Postes agrégés du dernier état accepté (base des leviers), ou null sans état accepté. */
export function postesDuDernierEtat(calcul: CalculRatios) {
  const dernier = calcul.exercices[0];
  if (!dernier) return null;
  return {
    devise: dernier.lu.devise,
    postes: agregerPostes(dernier.lu.etat, calcul.correspondance).valeurs,
  };
}
