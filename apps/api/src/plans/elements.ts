import { controlerDependances, type InitiativeFeuilleDeRoute } from "@missionpilot/engines";
import {
  DONNEES_ELEMENT_PLAN,
  ROLES_CLIENT,
  type PlanElementCreation,
  type StatutContenuPlan,
  type TypeElementPlan,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { montant, traduireErreursPg } from "../db/outils.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  ELEMENTS_PAR_PLAN_MAX,
  exigerPlanPilotable,
  exigerPlanRedigeable,
  exigerPlanVisible,
  valideurDispense,
  type PlanAcces,
} from "./acces.js";
import { retirerPartageApresEcriture } from "./partage.js";

/*
 * Éléments du plan stratégique (diagnostic, SWOT, vision et mission, axes,
 * objectifs, initiatives) et leurs versions en ajout seul (SOC-06).
 *
 * - Créer : version 1 « brouillon ».
 * - Modifier : nouvelle version, contenu complet ; « brouillon » tant que le
 *   contenu n'a jamais quitté ce statut, « modifie » sinon. Un contenu
 *   identique à la version courante est refusé (409).
 * - Valider : nouvelle version « valide » au contenu identique, par un
 *   responsable de la mission qui n'a écrit aucune version depuis la dernière
 *   validation, sauf associé ou directeur de la mission (403 VALIDATION_REQUISE).
 * - Retirer : nouvelle version `retire: true` ; l'historique reste lisible.
 * - Initiative (PLA-05) : ses dépendances (`dependances`, contenu versionné)
 *   désignent d'autres initiatives ACTIVES du plan ; le moteur refuse doublons
 *   et cycles (400 DEPENDANCE_INVALIDE / DEPENDANCE_CYCLIQUE), la base double
 *   les contrôles structurels (0184).
 * - Créer, modifier ou retirer un élément d'un plan PARTAGÉ retire le partage
 *   (plans/partage.ts) : le client ne voit jamais un contenu non validé.
 */

const TYPES_PARENT: Partial<Record<TypeElementPlan, readonly TypeElementPlan[]>> = {
  objectif: ["axe"],
  initiative: ["axe", "objectif"],
};

const UNIQUES: Record<string, string> = {
  plan_elements_unique_uniq: "Ce plan a déjà un élément de ce type.",
};

interface ColonnesInitiative {
  responsable_id: string | null;
  debut: string | null;
  echeance: string | null;
  budget: number | null;
  statut_initiative: string | null;
}

const SANS_INITIATIVE: ColonnesInitiative = {
  responsable_id: null,
  debut: null,
  echeance: null,
  budget: null,
  statut_initiative: null,
};

export interface VersionDb extends Omit<ColonnesInitiative, "budget"> {
  element_id: string;
  type: TypeElementPlan;
  parent_id: string | null;
  element_cree_par: string;
  element_cree_le: string;
  version: number;
  statut_contenu: StatutContenuPlan;
  contenu: Record<string, unknown>;
  retire: boolean;
  budget: string | null;
  auteur_id: string;
  auteur_nom: string;
  version_le: string;
}

export const COLONNES_VERSION = `v.element_id, e.type, e.parent_id, e.cree_par AS element_cree_par,
  e.cree_le AS element_cree_le, v.version, v.statut_contenu, v.contenu, v.retire, v.responsable_id,
  v.debut::text AS debut, v.echeance::text AS echeance, v.budget, v.statut_initiative,
  v.auteur_id, u.nom AS auteur_nom, v.cree_le AS version_le`;

const DEPUIS_VERSIONS = `plan_element_versions v
  JOIN plan_elements e ON e.id = v.element_id
  JOIN utilisateurs u ON u.id = v.auteur_id`;

/** Données exposées d'une version : textes du contenu, plus les champs d'une initiative. */
export function donneesVersion(v: VersionDb): Record<string, unknown> {
  if (v.type !== "initiative") return v.contenu;
  return {
    ...v.contenu,
    responsable_id: v.responsable_id,
    debut: v.debut,
    echeance: v.echeance,
    budget: montant(v.budget),
    statut: v.statut_initiative,
  };
}

export function vueVersion(v: VersionDb) {
  return {
    version: v.version,
    statut_contenu: v.statut_contenu,
    retire: v.retire,
    donnees: donneesVersion(v),
    auteur_id: v.auteur_id,
    auteur_nom: v.auteur_nom,
    cree_le: v.version_le,
  };
}

/** Élément et sa version courante : `cree_le` date l'élément, `version_le` sa version. */
export function vueElement(v: VersionDb) {
  const { cree_le: version_le, ...version } = vueVersion(v);
  return {
    id: v.element_id,
    type: v.type,
    parent_id: v.parent_id,
    cree_par: v.element_cree_par,
    cree_le: v.element_cree_le,
    ...version,
    version_le,
  };
}

export type ElementCourant = ReturnType<typeof vueElement>;

/** Version courante de chaque élément du plan (au plus ELEMENTS_PAR_PLAN_MAX), par ordre de création. */
export async function elementsCourants(db: Db, planId: string): Promise<VersionDb[]> {
  const r = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (v.element_id) ${COLONNES_VERSION}
       FROM ${DEPUIS_VERSIONS}
       WHERE e.plan_id = $1
       ORDER BY v.element_id, v.version DESC) c
     ORDER BY c.element_cree_le, c.element_id`,
    [planId],
  );
  return r.rows as VersionDb[];
}

async function versionCourante(db: Db, planId: string, elementId: string): Promise<VersionDb> {
  const r = await db.query(
    `SELECT ${COLONNES_VERSION} FROM ${DEPUIS_VERSIONS}
     WHERE e.id = $1 AND e.plan_id = $2 ORDER BY v.version DESC LIMIT 1`,
    [elementId, planId],
  );
  if (!r.rows[0]) throw introuvable("Élément du plan");
  return r.rows[0] as VersionDb;
}

/** Sépare les textes (jsonb) des champs typés d'une initiative, après contrôle du schéma du type. */
function decomposer(
  type: TypeElementPlan,
  donnees: unknown,
): { contenu: Record<string, unknown>; colonnes: ColonnesInitiative } {
  if (type !== "initiative") {
    return {
      contenu: DONNEES_ELEMENT_PLAN[type].parse(donnees) as Record<string, unknown>,
      colonnes: SANS_INITIATIVE,
    };
  }
  const { responsable_id, debut, echeance, budget, statut, dependances, ...reste } =
    DONNEES_ELEMENT_PLAN.initiative.parse(donnees);
  // Identifiants normalisés en minuscules (forme renvoyée par PostgreSQL).
  const contenu =
    dependances === undefined
      ? reste
      : { ...reste, dependances: dependances.map((d) => d.toLowerCase()) };
  return {
    contenu,
    colonnes: {
      responsable_id: responsable_id ?? null,
      debut: debut ?? null,
      echeance,
      budget,
      statut_initiative: statut,
    },
  };
}

/**
 * Dépendances d'une initiative (PLA-05) : initiatives actives du plan, autres qu'elle-même, sans
 * cycle avec les dépendances des autres initiatives (contrôle du moteur). Les dépendances des
 * AUTRES initiatives vers une initiative retirée sont ignorées (elles ne bloquent pas l'écriture).
 */
async function controlerDependancesInitiative(
  db: Db,
  plan: PlanAcces,
  elementId: string | null,
  contenu: Record<string, unknown>,
  c: ColonnesInitiative,
): Promise<void> {
  const dependances = (contenu.dependances as string[] | undefined) ?? [];
  if (dependances.length === 0) return;
  const autres = (await elementsCourants(db, plan.id)).filter(
    (v) => v.type === "initiative" && !v.retire && v.element_id !== elementId,
  );
  const actives = new Set(autres.map((v) => v.element_id));
  if (dependances.some((d) => !actives.has(d))) {
    throw new AppError(
      400,
      "DEPENDANCE_INVALIDE",
      "Une initiative ne dépend que d'autres initiatives actives de ce plan.",
    );
  }
  // Les autres initiatives gardent leurs dépendances vers les actives ET vers celle-ci.
  const connues = new Set(actives);
  if (elementId) connues.add(elementId);
  const graphe: InitiativeFeuilleDeRoute[] = autres.map((v) => ({
    id: v.element_id,
    debut: v.debut,
    echeance: v.echeance as string,
    statut: v.statut_initiative as InitiativeFeuilleDeRoute["statut"],
    dependances: ((v.contenu.dependances as string[] | undefined) ?? []).filter((d) =>
      connues.has(d),
    ),
  }));
  graphe.push({
    id: elementId ?? "nouvelle-initiative",
    debut: c.debut,
    echeance: c.echeance as string,
    statut: c.statut_initiative as InitiativeFeuilleDeRoute["statut"],
    dependances,
  });
  controlerDependances(graphe);
}

/** Contrôles d'une initiative : dates ordonnées, gains sur l'horizon, responsable interne actif. */
async function controlerInitiative(
  db: Db,
  plan: PlanAcces,
  contenu: Record<string, unknown>,
  c: ColonnesInitiative,
  elementId: string | null = null,
  retire = false,
): Promise<void> {
  if (c.debut && c.echeance && c.debut > c.echeance) {
    throw requeteInvalide("Le début de l'initiative précède son échéance.");
  }
  const gains = contenu.gains_annuels as readonly number[] | undefined;
  if (gains && gains.length !== plan.horizon) {
    throw requeteInvalide(`Gains annuels : exactement ${plan.horizon} valeurs attendues.`);
  }
  if (c.responsable_id) {
    const r = await db.query(
      `SELECT 1 FROM utilisateurs WHERE id = $1 AND actif AND NOT (roles && $2::text[])`,
      [c.responsable_id, ROLES_CLIENT],
    );
    if (!r.rowCount) throw requeteInvalide("Responsable inconnu.");
  }
  if (!retire) await controlerDependancesInitiative(db, plan, elementId, contenu, c);
}

async function insererVersion(
  db: Db,
  auth: Auth,
  elementId: string,
  version: number,
  statut: StatutContenuPlan,
  contenu: Record<string, unknown>,
  retire: boolean,
  c: ColonnesInitiative,
): Promise<void> {
  await traduireErreursPg(
    db.query(
      `INSERT INTO plan_element_versions (cabinet_id, element_id, version, statut_contenu, contenu,
         retire, responsable_id, debut, echeance, budget, statut_initiative, auteur_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        auth.cabinetId,
        elementId,
        version,
        statut,
        JSON.stringify(contenu),
        retire,
        c.responsable_id,
        c.debut,
        c.echeance,
        c.budget,
        c.statut_initiative,
        auth.utilisateurId,
      ],
    ),
    {},
    "Responsable inconnu.",
  );
}

/** Crée un élément du plan (version 1, brouillon). */
export async function creerElement(db: Db, auth: Auth, planId: string, corps: PlanElementCreation) {
  const plan = await exigerPlanRedigeable(db, auth, planId);
  const n = await db.query("SELECT count(*)::int AS n FROM plan_elements WHERE plan_id = $1", [
    planId,
  ]);
  if ((n.rows[0] as { n: number }).n >= ELEMENTS_PAR_PLAN_MAX) {
    throw conflit(`Un plan compte au plus ${ELEMENTS_PAR_PLAN_MAX} éléments.`);
  }
  const parentId = "parent_id" in corps ? corps.parent_id : null;
  if (parentId) {
    const p = await db.query("SELECT type FROM plan_elements WHERE id = $1 AND plan_id = $2", [
      parentId,
      planId,
    ]);
    const typeParent = p.rows[0]?.type as TypeElementPlan | undefined;
    if (!typeParent || !TYPES_PARENT[corps.type]?.includes(typeParent)) {
      throw requeteInvalide("Élément parent inconnu ou incompatible.");
    }
  }
  const { contenu, colonnes } = decomposer(corps.type, corps.donnees);
  if (corps.type === "initiative") await controlerInitiative(db, plan, contenu, colonnes);
  const e = await traduireErreursPg(
    db.query(
      `INSERT INTO plan_elements (cabinet_id, plan_id, type, parent_id, cree_par)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [auth.cabinetId, planId, corps.type, parentId, auth.utilisateurId],
    ),
    UNIQUES,
  );
  const elementId = e.rows[0].id as string;
  await insererVersion(db, auth, elementId, 1, "brouillon", contenu, false, colonnes);
  await retirerPartageApresEcriture(db, auth, plan, "element.creer");
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.element.creer",
    entite: "plan_element",
    entiteId: elementId,
    details: { plan_id: planId, type: corps.type },
  });
  return vueElement(await versionCourante(db, planId, elementId));
}

/** Nouvelle version d'un élément (contenu complet), ou retrait. */
export async function ajouterVersion(
  db: Db,
  auth: Auth,
  planId: string,
  elementId: string,
  corps: { donnees: unknown; retire: boolean },
) {
  const plan = await exigerPlanRedigeable(db, auth, planId);
  const courante = await versionCourante(db, planId, elementId);
  const { contenu, colonnes } = decomposer(courante.type, corps.donnees);
  if (courante.type === "initiative") {
    await controlerInitiative(db, plan, contenu, colonnes, elementId, corps.retire);
  }
  const identique = await db.query(
    `SELECT 1 FROM plan_element_versions
     WHERE element_id = $1 AND version = $2 AND contenu = $3::jsonb AND retire = $4
       AND responsable_id IS NOT DISTINCT FROM $5::uuid AND debut IS NOT DISTINCT FROM $6::date
       AND echeance IS NOT DISTINCT FROM $7::date AND budget IS NOT DISTINCT FROM $8::bigint
       AND statut_initiative IS NOT DISTINCT FROM $9::text`,
    [
      elementId,
      courante.version,
      JSON.stringify(contenu),
      corps.retire,
      colonnes.responsable_id,
      colonnes.debut,
      colonnes.echeance,
      colonnes.budget,
      colonnes.statut_initiative,
    ],
  );
  if (identique.rowCount) throw conflit("Contenu identique à la version courante.");
  const statut: StatutContenuPlan =
    courante.statut_contenu === "brouillon" ? "brouillon" : "modifie";
  await insererVersion(
    db,
    auth,
    elementId,
    courante.version + 1,
    statut,
    contenu,
    corps.retire,
    colonnes,
  );
  await retirerPartageApresEcriture(db, auth, plan, "element.version");
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: corps.retire ? "plan.element.retirer" : "plan.element.modifier",
    entite: "plan_element",
    entiteId: elementId,
    details: { plan_id: planId, version: courante.version + 1, statut_contenu: statut },
  });
  return vueElement(await versionCourante(db, planId, elementId));
}

/**
 * Recalage (PLA-05, plans/feuille-de-route.ts) : nouvelle version d'une initiative qui ne change
 * QUE ses dates, contenu et autres champs repris de la version courante ; statut « brouillon »
 * tant que le contenu n'a jamais quitté ce statut, « modifie » sinon (validation à refaire).
 */
export async function versionDatesRecalees(
  db: Db,
  auth: Auth,
  courante: VersionDb,
  debut: string | null,
  echeance: string,
): Promise<number> {
  const statut: StatutContenuPlan =
    courante.statut_contenu === "brouillon" ? "brouillon" : "modifie";
  await insererVersion(
    db,
    auth,
    courante.element_id,
    courante.version + 1,
    statut,
    courante.contenu,
    courante.retire,
    {
      responsable_id: courante.responsable_id,
      debut,
      echeance,
      budget: montant(courante.budget),
      statut_initiative: courante.statut_initiative,
    },
  );
  return courante.version + 1;
}

/** Valide la version courante d'un élément (séparation des tâches). */
export async function validerElement(db: Db, auth: Auth, planId: string, elementId: string) {
  const plan = await exigerPlanPilotable(db, auth, planId);
  const courante = await versionCourante(db, planId, elementId);
  if (courante.statut_contenu === "valide") {
    throw new AppError(409, "CONTENU_VALIDE", "La version courante est déjà validée.");
  }
  if (!valideurDispense(auth, plan)) {
    const contribue = await db.query(
      `SELECT 1 FROM plan_element_versions
       WHERE element_id = $1 AND auteur_id = $2 AND version > coalesce(
         (SELECT max(version) FROM plan_element_versions
          WHERE element_id = $1 AND statut_contenu = 'valide'), 0)`,
      [elementId, auth.utilisateurId],
    );
    if (contribue.rowCount) {
      throw new AppError(
        403,
        "VALIDATION_REQUISE",
        "L'auteur d'un contenu ne le valide pas lui-même : la faire valider par un autre responsable.",
      );
    }
  }
  await db.query(
    `INSERT INTO plan_element_versions (cabinet_id, element_id, version, statut_contenu, contenu,
       retire, responsable_id, debut, echeance, budget, statut_initiative, auteur_id)
     SELECT cabinet_id, element_id, version + 1, 'valide', contenu, retire, responsable_id, debut,
       echeance, budget, statut_initiative, $3
     FROM plan_element_versions WHERE element_id = $1 AND version = $2`,
    [elementId, courante.version, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.element.valider",
    entite: "plan_element",
    entiteId: elementId,
    details: { plan_id: planId, version: courante.version + 1 },
  });
  return vueElement(await versionCourante(db, planId, elementId));
}

/** Historique des versions d'un élément, de la plus récente à la plus ancienne. */
export async function historiqueElement(
  db: Db,
  auth: Auth,
  planId: string,
  elementId: string,
  q: { limite: number; curseur?: string | undefined },
) {
  await exigerPlanVisible(db, auth, planId);
  const courante = await versionCourante(db, planId, elementId);
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT lpad(v.version::text, 10, '0') AS cle_tri, v.id, ${COLONNES_VERSION}
     FROM ${DEPUIS_VERSIONS}
     WHERE v.element_id = $1
       AND ($2::text IS NULL OR (lpad(v.version::text, 10, '0'), v.id) < ($2, $3::uuid))
     ORDER BY v.version DESC LIMIT $4`,
    [elementId, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(r.rows as (VersionDb & { cle_tri: string; id: string })[], q.limite);
  return {
    element: { id: elementId, type: courante.type, parent_id: courante.parent_id },
    elements: page.elements.map((v) => vueVersion(v as VersionDb)),
    curseur_suivant: page.curseur_suivant,
  };
}
