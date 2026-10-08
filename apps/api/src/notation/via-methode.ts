import {
  appliquerPonderationsContexte,
  detecterEcarts,
  ErreurNotation,
  noterQuestionnaire,
  noterRepondants,
  preparerReponses,
  type EcartRepondants,
  type GrilleNotation,
  type PonderationContexte,
  type ReponsesNotation,
  type ResultatNotation,
} from "@missionpilot/engines";
import type { CodeMoteurStandard } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { methodeEffectiveMission, type MethodeEffective } from "../standard/index.js";
import { lireContenu } from "../standard/contenu.js";
import type { ResultatModulationApi } from "../standard/modulation.js";
import type { CalculNotationMoteur, EntreesCalculNotation } from "./calcul.js";

/*
 * Notation exécutée DEPUIS LE RÉFÉRENTIEL DE MÉTHODES (vague 1, condition de passage : « la
 * notation tourne sur le référentiel avec des résultats identiques à la V2 » ; ADR-004).
 *
 * Quand la mission d'une notation est liée à une version de méthode, `calculer` (notations.ts)
 * n'appelle plus les moteurs directement : il lit la méthode EFFECTIVE de la mission
 * (`methodeEffectiveMission` : version figée → règles de modulation sur le contexte → dérogations
 * approuvées) et exécute, dans l'ordre des étapes et des briques, chaque brique ACTIVE dont le
 * `moteur` (code de `MOTEURS_STANDARD`, amorçage 0205) est un moteur de calcul de la notation :
 *
 * | Code du moteur (brique de 0205)                      | Moteur appelé (le même que la V2)       |
 * | ---------------------------------------------------- | --------------------------------------- |
 * | `questionnaires.notation_repondants` (notation_repondants) | `preparerReponses` par répondant  |
 * | `notation.ecarts_perception` (ecarts_perception)     | `detecterEcarts`                        |
 * | `notation.score_global` (calcul_note)                | `noterRepondants` / `noterQuestionnaire` |
 *
 * Les autres moteurs (`questionnaires.etat`, `notation.ajustement`, `notation.forces_faiblesses`…)
 * agissent hors du calcul (envoi, ajustement motivé, rapport) et ne sont pas exécutés ici.
 *
 * RÉSULTATS IDENTIQUES À LA V2 quand aucune règle n'ajuste le calcul : mêmes moteurs, mêmes
 * entrées, même grille (identité). Les règles qui activent ou retirent d'autres briques, des
 * items, choisissent un gabarit, une formulation, une recommandation ou relèvent une classe de
 * risque ne changent RIEN au calcul (test `notation-methode.test.ts`).
 *
 * CE QUI CHANGE quand une règle ajuste le calcul (et seulement alors) :
 * - `ponderation` dont la cible est une RUBRIQUE de la version rattachée à une dimension de la
 *   grille (`methode_rubriques.dimension`) : le poids de cette dimension est remplacé, dans la
 *   grille par défaut ET dans les surcharges sectorielles qui la nomment, par le moteur pur
 *   `appliquerPonderationsContexte` ; les poids étant normalisés à 100, la part de TOUTES les
 *   dimensions dans le score global change (pas le score d'une dimension). La grille adaptée est
 *   celle copiée dans la version de notation, et le journal (`execution.ponderations`) donne le
 *   poids avant et après : le calcul reste reproductible ;
 * - `seuil` dont la cible est la brique au moteur `notation.ecarts_perception` : seuil
 *   d'écart entre répondants (entier ≥ 1) passé à `detecterEcarts` ;
 * - une brique de calcul RETIRÉE (règle ou dérogation) : `ecarts_perception` retirée → aucun
 *   écart calculé ; `notation_repondants` retirée en mode individuel ou `calcul_note` retirée →
 *   calcul impossible (409 METHODE_NOTATION_INCOMPLETE).
 * Tout autre ajustement (pondération d'une brique, d'un élément ou d'une rubrique sans dimension
 * de la grille, seuil d'une autre cible, seuil non entier) n'a AUCUN effet sur le calcul et est
 * tracé dans `execution.non_appliques`, jamais ignoré en silence.
 */

/** Moteurs de calcul de la notation désignés par code dans les briques de la méthode. */
export const MOTEURS_CALCUL_NOTATION = [
  "questionnaires.notation_repondants",
  "notation.ecarts_perception",
  "notation.score_global",
] as const satisfies readonly CodeMoteurStandard[];
type MoteurCalculNotation = (typeof MOTEURS_CALCUL_NOTATION)[number];

const estMoteurCalcul = (m: string | null): m is MoteurCalculNotation =>
  m !== null && (MOTEURS_CALCUL_NOTATION as readonly string[]).includes(m);

/** Méthode effective utile au calcul (forme de `methodeEffectiveMission`, plus les rubriques). */
export interface MethodeNotation {
  version: { id: string; version: number; methode_code: string; origine: string };
  liaison: { id: string; rang: number; evenement: string };
  etapes: MethodeEffective["etapes"];
  ajustements: MethodeEffective["ajustements"];
  modulation: ResultatModulationApi;
  rubriques: readonly { code: string; dimension: string | null }[];
  /** Recommandations candidates de la modulation (déposées dans la revue guidée). */
  recommandations: readonly string[];
}

export interface BriqueExecutee {
  etape: string;
  brique: string;
  moteur: MoteurCalculNotation;
  statut: "execute" | "sans_objet";
}

export interface NonApplique {
  type: "ponderation" | "seuil";
  cible: string;
  valeur: number;
  raison: string;
}

/** Journal d'exécution enregistré avec la version de notation (`notation_versions_methode`). */
export interface JournalNotationMethode {
  methode: { version_id: string; methode_code: string; version: number; origine: string };
  liaison: { id: string; rang: number; evenement: string };
  regles_declenchees: readonly string[];
  briques: BriqueExecutee[];
  briques_inactives: { brique: string; moteur: MoteurCalculNotation }[];
  ponderations: {
    cible: string;
    dimension: string;
    poids_avant: number;
    poids_apres: number;
    secteurs: readonly string[];
  }[];
  seuil_ecarts: { cible: string; valeur: number } | null;
  non_appliques: NonApplique[];
}

export interface CalculNotationMethode extends CalculNotationMoteur {
  /** Grille réellement utilisée (la grille reçue si aucune pondération de contexte). */
  grille: GrilleNotation;
  journal: JournalNotationMethode;
}

const incomplete = (message: string) => new AppError(409, "METHODE_NOTATION_INCOMPLETE", message);

/** Pondérations de contexte applicables à la grille, et ajustements sans effet sur le calcul. */
function ponderationsDeMethode(m: MethodeNotation, grille: GrilleNotation) {
  const dimensions = new Set(grille.dimensions.map((d) => d.id));
  const rubriques = new Map(m.rubriques.map((r) => [r.code, r.dimension]));
  const retenues: (PonderationContexte & { cible: string })[] = [];
  const nonAppliques: NonApplique[] = [];
  for (const [cible, valeur] of Object.entries(m.ajustements.ponderations).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const dimension = rubriques.get(cible) ?? null;
    if (dimension === null || !dimensions.has(dimension)) {
      nonAppliques.push({
        type: "ponderation",
        cible,
        valeur,
        raison: "Cible sans dimension dans la grille de notation : sans effet sur le calcul.",
      });
      continue;
    }
    if (retenues.some((r) => r.dimension === dimension)) {
      throw new AppError(
        409,
        "PONDERATIONS_EN_CONFLIT",
        `Deux règles pondèrent la dimension « ${dimension} » : le comité méthode doit trancher.`,
      );
    }
    retenues.push({ cible, dimension, poids: valeur });
  }
  return { retenues, nonAppliques };
}

/** Seuil d'écart de la brique au moteur `notation.ecarts_perception` ; autres seuils non appliqués. */
function seuilsDeMethode(m: MethodeNotation) {
  const briquesEcarts = new Set(
    m.etapes.flatMap((e) =>
      e.briques.filter((b) => b.moteur === "notation.ecarts_perception").map((b) => b.code),
    ),
  );
  let seuil: { cible: string; valeur: number } | null = null;
  const nonAppliques: NonApplique[] = [];
  for (const [cible, valeur] of Object.entries(m.ajustements.seuils).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (briquesEcarts.has(cible) && Number.isInteger(valeur) && valeur >= 1 && seuil === null) {
      seuil = { cible, valeur };
      continue;
    }
    nonAppliques.push({
      type: "seuil",
      cible,
      valeur,
      raison: briquesEcarts.has(cible)
        ? "Seuil d'écart non entier, inférieur à 1 ou en double : seuil par défaut du moteur conservé."
        : "Cible sans effet sur le calcul de la note.",
    });
  }
  return { seuil, nonAppliques };
}

interface EtatCalcul {
  preparees: ReponsesNotation[] | null;
  resultat: ResultatNotation | null;
  ecarts: EcartRepondants[];
}

/**
 * Exécute le calcul depuis la méthode (fonction PURE : mêmes entrées, même sortie). Lève 409
 * METHODE_NOTATION_INCOMPLETE si la méthode effective ne permet pas de calculer la note.
 */
export function executerNotationMethode(
  m: MethodeNotation,
  e: EntreesCalculNotation,
): CalculNotationMethode {
  const p = ponderationsDeMethode(m, e.grille);
  const s = seuilsDeMethode(m);
  let adaptation: ReturnType<typeof appliquerPonderationsContexte>;
  try {
    adaptation = appliquerPonderationsContexte(e.grille, p.retenues);
  } catch (err) {
    if (err instanceof ErreurNotation) {
      throw new AppError(
        409,
        "PONDERATIONS_INVALIDES",
        `Les pondérations de contexte de la méthode rendent la grille invalide (${err.code}).`,
      );
    }
    throw err;
  }
  const grille = adaptation.grille;
  const def = e.definition;
  const etat: EtatCalcul = { preparees: null, resultat: null, ecarts: [] };
  const briques: BriqueExecutee[] = [];
  const inactives: JournalNotationMethode["briques_inactives"] = [];

  const moteurs: Record<MoteurCalculNotation, () => BriqueExecutee["statut"]> = {
    "questionnaires.notation_repondants": () => {
      if (e.collectif) return "sans_objet";
      etat.preparees = e.soumises.map((x) => {
        const prep = preparerReponses(grille, def, x.reponses);
        return {
          repondant: x.repondant_id as string,
          reponses: prep.reponses,
          nonApplicables: prep.nonApplicables,
        };
      });
      return "execute";
    },
    "notation.ecarts_perception": () => {
      if (e.collectif) return "sans_objet";
      etat.ecarts = detecterEcarts(
        def,
        e.soumises.map((x) => ({ repondant: x.repondant_id as string, reponses: x.reponses })),
        s.seuil ? { seuil: s.seuil.valeur } : {},
      );
      return "execute";
    },
    "notation.score_global": () => {
      if (e.collectif) {
        const premiere = e.soumises[0] as (typeof e.soumises)[number];
        etat.resultat = noterQuestionnaire(grille, def, premiere.reponses, e.options);
        return "execute";
      }
      if (!etat.preparees) {
        throw incomplete(
          "La brique de calcul de la note exige les notes par répondant : une brique au moteur « questionnaires.notation_repondants » doit être active et la précéder.",
        );
      }
      etat.resultat = noterRepondants(grille, etat.preparees, e.options);
      return "execute";
    },
  };

  for (const etape of m.etapes) {
    for (const b of etape.briques) {
      if (!estMoteurCalcul(b.moteur)) continue;
      if (!b.active) {
        inactives.push({ brique: b.code, moteur: b.moteur });
        continue;
      }
      briques.push({
        etape: etape.code,
        brique: b.code,
        moteur: b.moteur,
        statut: moteurs[b.moteur](),
      });
    }
  }
  if (!etat.resultat) {
    throw incomplete(
      "La méthode de la mission n'a aucune brique active de calcul de la note (moteur « notation.score_global ») : rétablissez-la ou retirez la méthode.",
    );
  }
  return {
    grille,
    resultat: etat.resultat,
    ecarts: etat.ecarts,
    journal: {
      methode: {
        version_id: m.version.id,
        methode_code: m.version.methode_code,
        version: m.version.version,
        origine: m.version.origine,
      },
      liaison: m.liaison,
      regles_declenchees: m.modulation.regles_declenchees,
      briques,
      briques_inactives: inactives,
      ponderations: adaptation.appliquees.map((a) => ({
        cible: p.retenues.find((r) => r.dimension === a.dimension)!.cible,
        dimension: a.dimension,
        poids_avant: a.poidsAvant,
        poids_apres: a.poidsApres,
        secteurs: a.secteurs,
      })),
      seuil_ecarts: s.seuil,
      non_appliques: [...p.nonAppliques, ...s.nonAppliques],
    },
  };
}

/**
 * Méthode de calcul de la mission (null : mission sans méthode, ou dont la méthode n'a aucune
 * brique de calcul de la notation : chemin V2). Mission déjà vérifiée visible.
 */
export async function methodeNotationMission(
  db: Db,
  missionId: string,
): Promise<MethodeNotation | null> {
  const effective = await methodeEffectiveMission(db, missionId);
  if (!effective) return null;
  // Une méthode sans aucune brique de calcul de la notation (ex. « Plan stratégique ») ne
  // gouverne pas la notation de la mission : chemin V2.
  if (!effective.etapes.some((e) => e.briques.some((b) => estMoteurCalcul(b.moteur)))) return null;
  const contenu = await lireContenu(db, effective.version.id);
  return {
    version: {
      id: effective.version.id,
      version: effective.version.version,
      methode_code: effective.version.methode_code,
      origine: effective.version.origine,
    },
    liaison: {
      id: effective.liaison.id,
      rang: effective.liaison.rang,
      evenement: effective.liaison.evenement,
    },
    etapes: effective.etapes,
    ajustements: effective.ajustements,
    modulation: effective.modulation,
    rubriques: contenu.rubriques.map((r) => ({ code: r.code, dimension: r.dimension })),
    recommandations: effective.recommandations_candidates,
  };
}

/** Enregistre la méthode et le journal d'un calcul (ajout seul, cohérence MPN07 en base). */
export async function enregistrerCalculMethode(
  db: Db,
  cabinetId: string,
  versionId: string,
  m: MethodeNotation,
  journal: JournalNotationMethode,
): Promise<void> {
  await db.query(
    `INSERT INTO notation_versions_methode (cabinet_id, version_id, mission_methode_id,
       methode_version_id, modulation, execution)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      cabinetId,
      versionId,
      m.liaison.id,
      m.version.id,
      JSON.stringify(m.modulation),
      JSON.stringify(journal),
    ],
  );
}

/** La mission a-t-elle une méthode liée (référentiel) ? Mission déjà vérifiée. */
export async function missionLieeAMethode(db: Db, missionId: string): Promise<boolean> {
  const r = await db.query("SELECT 1 FROM mission_methodes WHERE mission_id = $1 LIMIT 1", [
    missionId,
  ]);
  return r.rowCount !== 0;
}

/** Méthode d'une version de notation (null : calcul V2), pour la lecture. */
export async function lireCalculMethode(db: Db, versionId: string) {
  const r = await db.query(
    `SELECT nm.methode_version_id, nm.mission_methode_id, nm.execution, nm.cree_le
     FROM notation_versions_methode nm WHERE nm.version_id = $1`,
    [versionId],
  );
  const l = r.rows[0] as
    | {
        methode_version_id: string;
        mission_methode_id: string;
        execution: JournalNotationMethode;
        cree_le: Date;
      }
    | undefined;
  return l ?? null;
}
