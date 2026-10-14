import {
  controlerArbreHypotheses,
  indicationVerdict,
  type AssertionDeHypothese,
  type NoeudHypothese,
  type VerdictDd,
} from "@missionpilot/engines";
import {
  PLAFONDS_DD,
  type hypotheseAssertionSchema,
  type hypotheseCreationSchema,
  type hypotheseLienSchema,
  type hypotheseVersionSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit } from "../errors.js";
import type { MissionAcces } from "../missions/acces.js";
import { lireAssertion } from "../preuves/donnees.js";
import { assertionCitee, verdictRetenuCitant } from "../preuves/garde-citation.js";
import {
  exigerPlafondElements,
  exigerVersionCourante,
  exigerVersionsRestantes,
  type ElementLu,
} from "./acces.js";
import {
  CHAMPS_VIDES,
  champsDe,
  elementCourant,
  elementsCourants,
  fusionner,
  insererElement,
  insererVersionElement,
  type ElementCourant,
} from "./elements.js";
import { chargerRegistre, creerAffirmation, type RegistreDossier } from "./registre.js";
import { vueArbre, vueIndication } from "./vues.js";

/*
 * Arbre d'hypothèses, liens aux assertions et état des verdicts (DD-09, SPEC-3b §8.3, R16 à R20).
 * Une hypothèse est un élément `hypothese` versionné (parent : profondeur 4 au plus, contrôlée avant
 * l'insertion et doublée par MPZ22) ; ses sources sont les assertions du registre des preuves
 * liées par un journal `soutient` ou `contredit` (`dd_hypothese_liens`). L'état d'une hypothèse se
 * DÉRIVE (jamais stocké) : verdict en vigueur = dernier verdict validé, en attente = dernier
 * verdict sans décision, sinon ouverte ; un verdict rejeté laisse l'état antérieur.
 */

export type CorpsHypothese = z.infer<typeof hypotheseCreationSchema>;
export type CorpsHypotheseVersion = z.infer<typeof hypotheseVersionSchema>;
export type CorpsLien = z.infer<typeof hypotheseLienSchema>;
export type CorpsHypotheseAssertion = z.infer<typeof hypotheseAssertionSchema>;

export type SensLien = "soutient" | "contredit";

export interface LienHypothese {
  hypothese_id: string;
  assertion_id: string;
  sens: SensLien;
}

/** Liens courants (dernier événement du couple = « lier ») d'un dossier, ou d'une hypothèse. */
export async function liensCourantsHypotheses(
  db: Db,
  dossierId: string,
  hypotheseId: string | null = null,
): Promise<LienHypothese[]> {
  const r = await db.query(
    `SELECT d.hypothese_id, d.assertion_id, d.sens FROM (
       SELECT DISTINCT ON (l.hypothese_id, l.assertion_id) l.hypothese_id, l.assertion_id,
         l.action, l.sens
       FROM dd_hypothese_liens l
       WHERE l.dossier_id = $1 AND ($2::uuid IS NULL OR l.hypothese_id = $2::uuid)
       ORDER BY l.hypothese_id, l.assertion_id, l.numero DESC) d
     WHERE d.action = 'lier' ORDER BY d.hypothese_id, d.assertion_id`,
    [dossierId, hypotheseId],
  );
  return r.rows as LienHypothese[];
}

/** Borne de lecture des verdicts d'un dossier (50 par hypothèse, 100 hypothèses, plus un). */
const LECTURE_VERDICTS_MAX = 5_001;

export interface VerdictLigne {
  id: string;
  numero: string;
  hypothese_id: string;
  hypothese_version: number;
  verdict: VerdictDd;
  indication_moteur: VerdictDd;
  motif: string;
  assertions_citees: {
    assertion_id: string;
    version: number;
    sens: SensLien;
    indice_num: number;
    indice_den: number;
    lecture: string;
  }[];
  proposee_par: string;
  proposee_par_nom: string | null;
  proposee_le: Date;
  decision: {
    decision: "valide" | "rejete";
    motif: string | null;
    valide_par: string;
    valide_par_nom: string | null;
    valide_le: Date;
  } | null;
}

/** Verdicts d'un dossier ou d'une hypothèse, du plus ancien au plus récent. */
export async function lireVerdicts(
  db: Db,
  p: { dossierId: string | null; hypotheseId: string | null },
): Promise<VerdictLigne[]> {
  const r = await db.query(
    `SELECT v.id, v.numero::text AS numero, v.hypothese_id, v.hypothese_version, v.verdict,
       v.indication_moteur, v.motif, v.assertions_citees, v.proposee_par, up.nom AS proposee_par_nom,
       v.proposee_le, x.decision, x.motif AS decision_motif, x.valide_par, ux.nom AS valide_par_nom,
       x.valide_le
     FROM dd_verdicts v
       LEFT JOIN dd_verdict_validations x ON x.verdict_id = v.id
       LEFT JOIN utilisateurs up ON up.id = v.proposee_par
       LEFT JOIN utilisateurs ux ON ux.id = x.valide_par
     WHERE ($1::uuid IS NULL OR v.dossier_id = $1::uuid)
       AND ($2::uuid IS NULL OR v.hypothese_id = $2::uuid)
     ORDER BY v.numero ASC LIMIT $3`,
    [p.dossierId, p.hypotheseId, LECTURE_VERDICTS_MAX],
  );
  return r.rows.map((l) => ({
    id: l.id,
    numero: l.numero,
    hypothese_id: l.hypothese_id,
    hypothese_version: l.hypothese_version,
    verdict: l.verdict,
    indication_moteur: l.indication_moteur,
    motif: l.motif,
    assertions_citees: l.assertions_citees,
    proposee_par: l.proposee_par,
    proposee_par_nom: l.proposee_par_nom ?? null,
    proposee_le: l.proposee_le,
    decision:
      l.decision === null
        ? null
        : {
            decision: l.decision,
            motif: l.decision_motif ?? null,
            valide_par: l.valide_par,
            valide_par_nom: l.valide_par_nom ?? null,
            valide_le: l.valide_le,
          },
  })) as VerdictLigne[];
}

export interface EtatVerdicts {
  enVigueur: VerdictLigne | null;
  enAttente: VerdictLigne | null;
}

const RANG_LECTURE: Record<string, number> = { fragile: 0, etayee: 1, solide: 2 };

export interface ContexteEtatVerdicts {
  /** Version courante de l'hypothèse : un verdict validé d'une autre version n'est plus en vigueur. */
  versionCourante: number;
  /** Lecture de solidité COURANTE d'une assertion citée (null si inconnue : pas de comparaison). */
  lectureCourante?: (assertionId: string) => string | null;
}

/**
 * Un verdict validé n'est en vigueur que s'il porte sur la version courante de l'hypothèse ET si
 * aucune de ses sources ne se lit plus faiblement qu'à la photographie du verdict (une preuve
 * contraire arrivée depuis) : sinon il est périmé et l'hypothèse se lit comme « ouverte ».
 */
function verdictEnVigueur(v: VerdictLigne, ctx: ContexteEtatVerdicts): boolean {
  if (v.hypothese_version !== ctx.versionCourante) return false;
  if (!ctx.lectureCourante) return true;
  return v.assertions_citees.every((c) => {
    const actuelle = ctx.lectureCourante?.(c.assertion_id) ?? null;
    return actuelle === null || (RANG_LECTURE[actuelle] ?? 0) >= (RANG_LECTURE[c.lecture] ?? 0);
  });
}

/**
 * État dérivé d'une hypothèse (verdicts du plus ancien au plus récent) : le DERNIER verdict validé
 * fait foi ; s'il est périmé (version de l'hypothèse changée, source dégradée), aucun verdict n'est
 * en vigueur — un verdict validé plus ancien ne reprend pas le dessus.
 */
export function etatDesVerdicts(
  verdicts: readonly VerdictLigne[],
  ctx: ContexteEtatVerdicts,
): EtatVerdicts {
  let dernierValide: VerdictLigne | null = null;
  let enAttente: VerdictLigne | null = null;
  for (const v of verdicts) {
    if (v.decision === null) enAttente = v;
    else if (v.decision.decision === "valide") dernierValide = v;
  }
  const enVigueur =
    dernierValide !== null && verdictEnVigueur(dernierValide, ctx) ? dernierValide : null;
  return { enVigueur, enAttente };
}

function parHypothese<T extends { hypothese_id: string }>(lignes: readonly T[]): Map<string, T[]> {
  const sortie = new Map<string, T[]>();
  for (const l of lignes) {
    const liste = sortie.get(l.hypothese_id);
    if (liste) liste.push(l);
    else sortie.set(l.hypothese_id, [l]);
  }
  return sortie;
}

/** Profondeur (1 = racine) d'une hypothèse existante, par remontée des parents. */
async function profondeur(db: Db, id: string): Promise<number> {
  let n = 1;
  let courant: string | null = id;
  while (courant !== null && n <= PLAFONDS_DD.profondeur_hypotheses + 1) {
    const r: { rows: { parent_id: string | null }[] } = await db.query(
      "SELECT parent_id FROM dd_elements WHERE id = $1",
      [courant],
    );
    courant = r.rows[0]?.parent_id ?? null;
    if (courant !== null) n += 1;
  }
  return n;
}

export async function creerHypothese(
  db: Db,
  auth: Auth,
  dossierId: string,
  c: CorpsHypothese,
): Promise<{ id: string; version: 1 }> {
  await exigerPlafondElements(
    db,
    dossierId,
    "hypothese",
    PLAFONDS_DD.hypotheses_par_dossier,
    "hypothèses par dossier",
  );
  if (c.parent_id !== null) {
    const parent = await db.query(
      `SELECT 1 FROM dd_elements WHERE id = $1 AND dossier_id = $2 AND type = 'hypothese'`,
      [c.parent_id, dossierId],
    );
    if (!parent.rows[0]) {
      throw new AppError(
        400,
        "RATTACHEMENT_INCOHERENT",
        "Le parent d'une hypothèse est une hypothèse du même dossier.",
      );
    }
    if ((await profondeur(db, c.parent_id)) + 1 > PLAFONDS_DD.profondeur_hypotheses) {
      throw new AppError(
        400,
        "ARBRE_TROP_PROFOND",
        `L'arbre d'hypothèses ne dépasse pas ${PLAFONDS_DD.profondeur_hypotheses} niveaux.`,
      );
    }
  }
  const id = await insererElement(db, auth, {
    dossierId,
    type: "hypothese",
    parentId: c.parent_id,
  });
  await insererVersionElement(
    db,
    auth,
    { id, type: "hypothese" },
    1,
    { ...CHAMPS_VIDES, libelle: c.libelle, description: c.description, critere: c.critere },
    null,
  );
  return { id, version: 1 };
}

// La garde « assertion citée » vit dans le module des preuves (routes génériques du registre).
export { assertionCitee, verdictRetenuCitant };

/** Verdict validé de l'hypothèse sur sa version COURANTE : son contenu est figé avec lui. */
async function verdictValideSurVersion(
  db: Db,
  hypotheseId: string,
  version: number,
): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM dd_verdicts v JOIN dd_verdict_validations x ON x.verdict_id = v.id
     WHERE v.hypothese_id = $1 AND v.hypothese_version = $2 AND x.decision = 'valide' LIMIT 1`,
    [hypotheseId, version],
  );
  return r.rows.length > 0;
}

/** Plafond du journal des liens d'une hypothèse (sous le verrou de la mission pris par la route). */
export async function exigerPlafondLiens(db: Db, hypotheseId: string): Promise<void> {
  const r = await db.query(
    "SELECT count(*)::int AS n FROM dd_hypothese_liens WHERE hypothese_id = $1",
    [hypotheseId],
  );
  if ((r.rows[0].n as number) >= PLAFONDS_DD.evenements_liens_par_hypothese) {
    throw new AppError(
      409,
      "PLAFOND_ATTEINT",
      `Plafond atteint : ${PLAFONDS_DD.evenements_liens_par_hypothese} événements de liens par hypothèse au plus.`,
    );
  }
}

async function verdictValideDe(db: Db, hypotheseId: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM dd_verdicts v JOIN dd_verdict_validations x ON x.verdict_id = v.id
     WHERE v.hypothese_id = $1 AND x.decision = 'valide' LIMIT 1`,
    [hypotheseId],
  );
  return r.rows.length > 0;
}

export async function verdictEnAttenteDe(db: Db, hypotheseId: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM dd_verdicts v WHERE v.hypothese_id = $1
       AND NOT EXISTS (SELECT 1 FROM dd_verdict_validations x WHERE x.verdict_id = v.id)`,
    [hypotheseId],
  );
  return r.rows.length > 0;
}

export async function corrigerHypothese(
  db: Db,
  auth: Auth,
  element: ElementLu,
  c: CorpsHypotheseVersion,
): Promise<number> {
  const courant = await elementCourant(db, element.id);
  exigerVersionCourante(c.version_courante, courant.version);
  exigerVersionsRestantes(courant.version + 1, PLAFONDS_DD.versions_par_objet);
  if (c.retire === true && !courant.retire && (await verdictEnAttenteDe(db, courant.id))) {
    throw new AppError(
      409,
      "VERDICT_EN_ATTENTE",
      "Un verdict de cette hypothèse attend une décision : décidez-en avant de la retirer.",
    );
  }
  if (c.retire === true && !courant.retire && (await verdictValideDe(db, courant.id))) {
    throw new AppError(
      409,
      "HYPOTHESE_AVEC_VERDICT",
      "Cette hypothèse porte un verdict validé : elle ne se retire plus (le verdict ne disparaît pas sans trace).",
    );
  }
  // Un verdict validé fige le contenu de l'hypothèse (libellé, description, critère) : toute
  // nouvelle version le laisserait « en vigueur » sur un texte que personne n'a validé.
  if (await verdictValideSurVersion(db, courant.id, courant.version)) {
    throw new AppError(
      409,
      "HYPOTHESE_AVEC_VERDICT",
      "Cette hypothèse porte un verdict validé : son libellé, sa description et son critère ne se modifient plus (posez une nouvelle hypothèse).",
    );
  }
  const suivant = fusionner(champsDe(courant), {
    libelle: c.libelle,
    description: c.description,
    critere: c.critere,
    retire: c.retire,
  });
  await insererVersionElement(db, auth, courant, courant.version + 1, suivant, c.motif);
  return courant.version + 1;
}

/** R19 : lie ou délie une assertion de la mission (journal en ajout seul). */
export async function modifierLien(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  hypothese: ElementLu,
  c: CorpsLien,
): Promise<void> {
  const assertion = await lireAssertion(db, c.assertion_id);
  if (!assertion || assertion.mission_id !== mission.id) {
    throw new AppError(
      400,
      "RATTACHEMENT_INCOHERENT",
      "L'assertion n'appartient pas à la mission du dossier.",
    );
  }
  const existant = (await liensCourantsHypotheses(db, hypothese.dossier_id, hypothese.id)).find(
    (l) => l.assertion_id === c.assertion_id,
  );
  if (c.action === "lier") {
    if (assertion.statut === "abandonnee") {
      throw new AppError(409, "ASSERTION_ABANDONNEE", "Cette assertion est abandonnée.");
    }
    if (existant?.sens === c.sens) throw conflit("Cette assertion est déjà liée dans ce sens.");
    await exigerPlafondLiens(db, hypothese.id);
    if (existant && (await verdictRetenuCitant(db, c.assertion_id, hypothese.id))) {
      throw assertionCitee();
    }
  } else if (!existant) {
    throw new AppError(
      400,
      "RATTACHEMENT_INCOHERENT",
      "Cette assertion n'est pas liée à l'hypothèse.",
    );
  }
  if (c.action === "delier") {
    await exigerPlafondLiens(db, hypothese.id);
    if (await verdictRetenuCitant(db, c.assertion_id, hypothese.id)) throw assertionCitee();
  }
  await ajouterLien(db, auth, hypothese, c.assertion_id, c.action, c.sens);
}

export async function ajouterLien(
  db: Db,
  auth: Auth,
  hypothese: ElementLu,
  assertionId: string,
  action: "lier" | "delier",
  sens: SensLien | null,
): Promise<void> {
  await db.query(
    `INSERT INTO dd_hypothese_liens (cabinet_id, dossier_id, hypothese_id, assertion_id, action,
       sens, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      auth.cabinetId,
      hypothese.dossier_id,
      hypothese.id,
      assertionId,
      action,
      action === "lier" ? sens : null,
      auth.utilisateurId,
    ],
  );
}

/** R20 : nouvelle assertion rattachée à l'hypothèse (rattachement `hypothese`), puis lien. */
export async function creerAssertionHypothese(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  hypothese: ElementLu,
  c: CorpsHypotheseAssertion,
): Promise<{ assertion_id: string; version: 1 }> {
  await exigerPlafondLiens(db, hypothese.id);
  const assertionId = await creerAffirmation(db, auth, mission, c, {
    type: "hypothese",
    code: hypothese.id,
  });
  await ajouterLien(db, auth, hypothese, assertionId, "lier", c.sens);
  return { assertion_id: assertionId, version: 1 };
}

/** Entrées du moteur d'indication : assertions liées et non abandonnées, avec leur lecture. */
export function entreesVerdict(
  liens: readonly LienHypothese[],
  reg: RegistreDossier,
): AssertionDeHypothese[] {
  return liens.flatMap((l) => {
    const a = reg.assertions.get(l.assertion_id);
    const s = reg.etat.evaluations.get(l.assertion_id)?.solidite;
    if (!a || a.statut === "abandonnee" || !s) return [];
    return [{ id: l.assertion_id, sens: l.sens, lecture: s.lecture }];
  });
}

export interface HypotheseEvaluee {
  courant: ElementCourant;
  liens: LienHypothese[];
  verdicts: VerdictLigne[];
  etat: EtatVerdicts;
  indication: ReturnType<typeof indicationVerdict>;
}

export interface ArbreDuDossier {
  hypotheses: HypotheseEvaluee[];
  /** Hypothèses retirées comprises (entrées du contrôle de l'arbre). */
  noeuds: NoeudHypothese[];
  registre: RegistreDossier;
  arbre: ReturnType<typeof controlerArbreHypotheses>;
}

/** Charge l'arbre d'un dossier : hypothèses, liens, verdicts, solidité des sources et contrôle. */
export async function chargerArbre(
  db: Db,
  missionId: string,
  dossierId: string,
  registreCharge: RegistreDossier | null = null,
): Promise<ArbreDuDossier> {
  const toutes = await elementsCourants(
    db,
    dossierId,
    "hypothese",
    PLAFONDS_DD.hypotheses_par_dossier,
    {
      retires: true,
    },
  );
  const liens = await liensCourantsHypotheses(db, dossierId);
  const registre =
    registreCharge ??
    (await chargerRegistre(db, missionId, [...new Set(liens.map((l) => l.assertion_id))]));
  const verdicts = await lireVerdicts(db, { dossierId, hypotheseId: null });
  const liensParH = parHypothese(liens);
  const verdictsParH = parHypothese(verdicts);
  const evaluees = toutes.map((h) => {
    const mesLiens = liensParH.get(h.id) ?? [];
    const mesVerdicts = verdictsParH.get(h.id) ?? [];
    return {
      courant: h,
      liens: mesLiens,
      verdicts: mesVerdicts,
      etat: etatDesVerdicts(mesVerdicts, {
        versionCourante: h.version,
        lectureCourante: (id) => registre.etat.evaluations.get(id)?.solidite.lecture ?? null,
      }),
      indication: indicationVerdict(entreesVerdict(mesLiens, registre)),
    };
  });
  const noeuds: NoeudHypothese[] = evaluees.map((h) => ({
    id: h.courant.id,
    parentId: h.courant.parent_id,
    retiree: h.courant.retire,
    verdict: h.etat.enVigueur?.verdict ?? null,
    enAttente: h.etat.enAttente !== null,
  }));
  return {
    hypotheses: evaluees,
    noeuds,
    registre,
    arbre: controlerArbreHypotheses(noeuds),
  };
}

export function vueVerdictCourt(v: VerdictLigne | null) {
  return v === null
    ? null
    : {
        id: v.id,
        verdict: v.verdict,
        indication_moteur: v.indication_moteur,
        proposee_par: v.proposee_par,
        proposee_le: v.proposee_le,
        decision: v.decision?.decision ?? null,
        decide_le: v.decision?.valide_le ?? null,
      };
}

/** R16 : nœuds (hypothèses non retirées) avec liens, indication du moteur et état, et contrôle de l'arbre. */
export async function lireHypotheses(db: Db, missionId: string, dossierId: string) {
  const { hypotheses, registre, arbre } = await chargerArbre(db, missionId, dossierId);
  const points = await elementsCourants(
    db,
    dossierId,
    "point_analyse",
    PLAFONDS_DD.points_par_dossier,
  );
  const pointParAssertion = new Map(points.map((p) => [p.assertion_id as string, p]));
  return {
    noeuds: hypotheses
      .filter((h) => !h.courant.retire)
      .map((h) => ({
        id: h.courant.id,
        parent_id: h.courant.parent_id,
        version: h.courant.version,
        libelle: h.courant.libelle,
        description: h.courant.description,
        critere: h.courant.critere,
        liens: h.liens.map((l) => {
          const point = pointParAssertion.get(l.assertion_id);
          const a = registre.assertions.get(l.assertion_id);
          return {
            assertion_id: l.assertion_id,
            sens: l.sens,
            enonce: a?.enonce ?? "",
            statut: a?.statut ?? null,
            solidite: registre.etat.evaluations.get(l.assertion_id)?.solidite ?? null,
            analyse_point:
              point === undefined ? null : { analyse: point.analyse, categorie: point.categorie },
          };
        }),
        indication: vueIndication(h.indication),
        verdict_en_vigueur: vueVerdictCourt(h.etat.enVigueur),
        verdict_en_attente: vueVerdictCourt(h.etat.enAttente),
        etat: h.etat.enVigueur?.verdict ?? (h.etat.enAttente ? "en_attente" : "ouverte"),
      })),
    arbre: vueArbre(arbre),
  };
}
