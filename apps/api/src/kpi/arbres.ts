import {
  cleIncoherenceUniteKpi,
  decomposerArbreKpi,
  exigerUnitesCoherentesKpi,
  messageUniteIncoherenteKpi,
  unitesIncoherentesArbreKpi,
  type NoeudArbreKpi,
  type NoeudUniteKpi,
} from "@missionpilot/engines";
import {
  kpiArbreContributionsQuerySchema,
  kpiArbreCreationSchema,
  kpiArbreModificationSchema,
  kpiNoeudCreationSchema,
  kpiNoeudModificationSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { clauseSet } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import {
  exigerMissionModifiable,
  exigerMissionVisible,
  type MissionAcces,
} from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { lireDefinition } from "./donnees.js";
import {
  definitionsParIds,
  evaluerDefinitions,
  limiteLecturePilotage,
  plafonnerLecture,
} from "./pilotage-donnees.js";

/*
 * Arbres d'indicateurs (KPI-13) : décomposition d'un KPI en leviers, migration 0440.
 * Les contributions de chaque levier à la variation du KPI racine entre deux situations sont
 * calculées par le moteur (packages/engines/src/kpi/arbre.ts) à partir de la valeur de la
 * dernière période close mesurée de chaque KPI lié, à chacune des deux dates d'arrêté.
 *
 * Droits : lire = `kpi.lire` et mission visible ; écrire = `kpi.gerer` et mission modifiable
 * (non clôturée) ; un arbre d'une mission invisible répond 404, comme celui d'un autre cabinet.
 * Fermé au portail (tables en `portail_interdit`, aucune route dans LISTE_BLANCHE_PORTAIL).
 */

export interface LigneArbre {
  id: string;
  mission_id: string;
  kpi_racine_id: string;
  libelle: string;
  description: string | null;
  actif: boolean;
  cree_par: string;
  cree_le: Date;
  modifie_le: Date;
}

export interface LigneNoeud {
  id: string;
  arbre_id: string;
  parent_id: string | null;
  kpi_id: string | null;
  libelle: string;
  relation: "somme" | "produit";
  coefficient: number;
  rang: number;
  actif: boolean;
  kpi_libelle: string | null;
  kpi_unite: string | null;
  cree_le: Date;
}

const COLONNES_ARBRE = `a.id, a.mission_id, a.kpi_racine_id, a.libelle, a.description, a.actif,
  a.cree_par, a.cree_le, a.modifie_le`;

const COLONNES_NOEUD = `n.id, n.arbre_id, n.parent_id, n.kpi_id, n.libelle, n.relation,
  n.coefficient::text AS coefficient, n.rang, n.actif, d.libelle AS kpi_libelle,
  d.unite AS kpi_unite, n.cree_le`;

/** Plafond de nœuds actifs (doublé en base, MPK13, y compris à la réactivation, 0445). */
export const MAX_NOEUDS_ARBRE = 50;
/** Plafond de nœuds au total, désactivés compris (doublé en base, MPK13) : aucune lecture ne tronque. */
export const MAX_NOEUDS_TOTAL_ARBRE = 200;

function versNoeud(l: Record<string, unknown>): LigneNoeud {
  return { ...(l as unknown as LigneNoeud), coefficient: Number(l.coefficient) };
}

export const vueArbre = (a: LigneArbre) => ({
  id: a.id,
  mission_id: a.mission_id,
  kpi_racine_id: a.kpi_racine_id,
  libelle: a.libelle,
  description: a.description,
  actif: a.actif,
  cree_le: a.cree_le,
  modifie_le: a.modifie_le,
});

export const vueNoeud = (n: LigneNoeud) => ({
  id: n.id,
  parent_id: n.parent_id,
  kpi_id: n.kpi_id,
  kpi_libelle: n.kpi_libelle,
  kpi_unite: n.kpi_unite,
  libelle: n.libelle,
  relation: n.relation,
  coefficient: n.coefficient,
  rang: n.rang,
  actif: n.actif,
});

export async function lireArbre(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<LigneArbre | null> {
  const r = await db.query(
    `SELECT ${COLONNES_ARBRE} FROM kpi_arbres a WHERE a.id = $1 ${verrouiller ? "FOR UPDATE OF a" : ""}`,
    [id],
  );
  return (r.rows[0] as LigneArbre | undefined) ?? null;
}

export async function arbresDeMission(db: Db, missionId: string) {
  const r = await db.query(
    `SELECT ${COLONNES_ARBRE},
       (SELECT count(*)::int FROM kpi_arbre_noeuds n WHERE n.arbre_id = a.id AND n.actif) AS nombre_noeuds
     FROM kpi_arbres a WHERE a.mission_id = $1 ORDER BY lower(a.libelle), a.id LIMIT $2`,
    [missionId, limiteLecturePilotage()],
  );
  const page = plafonnerLecture(r.rows);
  return {
    elements: page.lignes.map((l) => ({
      ...vueArbre(l as LigneArbre),
      nombre_noeuds: l.nombre_noeuds as number,
    })),
    tronque: page.tronque,
  };
}

/** Tous les nœuds de l'arbre : le plafond total de la base (200) rend toute troncature impossible. */
export async function noeudsDe(db: Db, arbreId: string, actifsSeulement = false) {
  const r = await db.query(
    `SELECT ${COLONNES_NOEUD} FROM kpi_arbre_noeuds n
     LEFT JOIN kpi_definitions d ON d.id = n.kpi_id
     WHERE n.arbre_id = $1 AND ($2::boolean = false OR n.actif)
     ORDER BY n.rang, lower(n.libelle), n.id LIMIT $3`,
    [arbreId, actifsSeulement, MAX_NOEUDS_TOTAL_ARBRE],
  );
  return r.rows.map(versNoeud);
}

/** Arbre dont la mission est visible, ou 404. */
export async function exigerArbreVisible(
  db: Db,
  auth: Auth,
  id: string,
): Promise<{ arbre: LigneArbre; mission: MissionAcces }> {
  const arbre = await lireArbre(db, id);
  if (!arbre) throw introuvable("Arbre d'indicateurs");
  const mission = await exigerMissionVisible(db, auth, arbre.mission_id).catch((e: unknown) => {
    throw e instanceof AppError && e.statut === 404 ? introuvable("Arbre d'indicateurs") : e;
  });
  return { arbre, mission };
}

/** Arbre dont la mission est modifiable par l'utilisateur (404 / 403 / 409), verrouillé. */
export async function exigerArbreGerable(
  db: Db,
  auth: Auth,
  id: string,
): Promise<{ arbre: LigneArbre; mission: MissionAcces }> {
  const { arbre } = await exigerArbreVisible(db, auth, id);
  const mission = await exigerMissionModifiable(db, auth, arbre.mission_id);
  const verrouille = await lireArbre(db, id, true);
  if (!verrouille) throw introuvable("Arbre d'indicateurs");
  return { arbre: verrouille, mission };
}

/** Nœuds actifs avec l'unité de leur KPI, pour la règle « une somme n'additionne que des unités identiques ». */
function versNoeudsUnite(noeuds: readonly LigneNoeud[]): NoeudUniteKpi[] {
  return noeuds
    .filter((n) => n.actif)
    .map((n) => ({
      id: n.id,
      parentId: n.parent_id,
      relation: n.relation,
      unite: n.kpi_unite,
      libelle: n.libelle,
    }));
}

/** Clés (parent|levier) des incohérences d'unités déjà présentes : un arbre ancien reste modifiable. */
async function incoherencesExistantes(db: Db, arbreId: string): Promise<Set<string>> {
  const noeuds = versNoeudsUnite(await noeudsDe(db, arbreId, true));
  return new Set(unitesIncoherentesArbreKpi(noeuds).map(cleIncoherenceUniteKpi));
}

/**
 * Refuse (409 `KPI_ARBRE_UNITES`) une écriture qui ferait additionner des unités différentes
 * (« 55 jours + 72 % ») sous une relation « somme » ; sous un « produit » elles restent admises.
 * Appelée APRÈS l'écriture, dans la même transaction : l'erreur annule l'écriture.
 */
async function exigerUnitesCoherentes(db: Db, arbreId: string, avant: Set<string>) {
  exigerUnitesCoherentesKpi(versNoeudsUnite(await noeudsDe(db, arbreId, true)), avant);
}

function codePg(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e
    ? String((e as { code: unknown }).code)
    : "";
}
function contraintePg(e: unknown): string {
  return typeof e === "object" && e !== null && "constraint" in e
    ? String((e as { constraint: unknown }).constraint)
    : "";
}

export async function detailArbre(db: Db, arbre: LigneArbre) {
  return { ...vueArbre(arbre), noeuds: (await noeudsDe(db, arbre.id)).map(vueNoeud) };
}

export async function creerArbre(db: Db, auth: Auth, missionId: string, corps: unknown) {
  const c = kpiArbreCreationSchema.parse(corps);
  await exigerMissionModifiable(db, auth, missionId);
  const racine = await lireDefinition(db, c.kpi_racine_id);
  if (!racine || racine.mission_id !== missionId) {
    throw requeteInvalide("Le KPI racine est inconnu pour cette mission.");
  }
  let arbreId: string;
  try {
    const r = await db.query(
      `INSERT INTO kpi_arbres (cabinet_id, mission_id, kpi_racine_id, libelle, description, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        auth.cabinetId,
        missionId,
        c.kpi_racine_id,
        c.libelle,
        c.description ?? null,
        auth.utilisateurId,
      ],
    );
    arbreId = r.rows[0].id as string;
  } catch (e) {
    if (codePg(e) === "23505") throw conflit("Un arbre d'indicateurs existe déjà pour ce KPI.");
    throw e;
  }
  await db.query(
    `INSERT INTO kpi_arbre_noeuds (cabinet_id, arbre_id, parent_id, kpi_id, libelle, cree_par)
     VALUES ($1, $2, NULL, $3, $4, $5)`,
    [auth.cabinetId, arbreId, c.kpi_racine_id, racine.libelle, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.arbre.creer",
    entite: "kpi_arbre",
    entiteId: arbreId,
    details: { mission_id: missionId, kpi_racine_id: c.kpi_racine_id },
  });
  const arbre = await lireArbre(db, arbreId);
  if (!arbre) throw introuvable("Arbre d'indicateurs");
  return detailArbre(db, arbre);
}

export async function modifierArbre(db: Db, auth: Auth, id: string, corps: unknown) {
  const modif = kpiArbreModificationSchema.parse(corps);
  const { arbre } = await exigerArbreGerable(db, auth, id);
  const set = clauseSet(modif, 3);
  await db.query(`UPDATE kpi_arbres SET ${set.sql}, modifie_par = $2 WHERE id = $1`, [
    id,
    auth.utilisateurId,
    ...set.valeurs,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.arbre.modifier",
    entite: "kpi_arbre",
    entiteId: id,
    details: {
      champs: Object.keys(modif).filter((k) => modif[k as keyof typeof modif] !== undefined),
    },
  });
  const apres = await lireArbre(db, arbre.id);
  if (!apres) throw introuvable("Arbre d'indicateurs");
  return detailArbre(db, apres);
}

export async function creerNoeud(db: Db, auth: Auth, arbreId: string, corps: unknown) {
  const c = kpiNoeudCreationSchema.parse(corps);
  const { arbre } = await exigerArbreGerable(db, auth, arbreId);
  if (!arbre.actif) throw conflit("Cet arbre est désactivé.");
  const dejaIncoherent = await incoherencesExistantes(db, arbreId);
  let noeudId: string;
  try {
    const r = await db.query(
      `INSERT INTO kpi_arbre_noeuds (cabinet_id, arbre_id, parent_id, kpi_id, libelle, relation,
         coefficient, rang, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9) RETURNING id`,
      [
        auth.cabinetId,
        arbreId,
        c.parent_id,
        c.kpi_id ?? null,
        c.libelle,
        c.relation,
        String(c.coefficient),
        c.rang,
        auth.utilisateurId,
      ],
    );
    noeudId = r.rows[0].id as string;
  } catch (e) {
    if (codePg(e) === "23505" && contraintePg(e) === "kpi_arbre_noeuds_kpi_uniq") {
      throw conflit("Ce KPI figure déjà dans l'arbre.");
    }
    throw e;
  }
  await exigerUnitesCoherentes(db, arbreId, dejaIncoherent);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.arbre.noeud.creer",
    entite: "kpi_arbre_noeud",
    entiteId: noeudId,
    details: { arbre_id: arbreId, parent_id: c.parent_id, kpi_id: c.kpi_id ?? null },
  });
  const noeud = (await noeudsDe(db, arbreId)).find((n) => n.id === noeudId);
  if (!noeud) throw introuvable("Nœud");
  return vueNoeud(noeud);
}

export async function modifierNoeud(db: Db, auth: Auth, noeudId: string, corps: unknown) {
  const modif = kpiNoeudModificationSchema.parse(corps);
  const lu = await db.query("SELECT arbre_id FROM kpi_arbre_noeuds WHERE id = $1", [noeudId]);
  if (!lu.rows[0]) throw introuvable("Nœud");
  const arbreId = lu.rows[0].arbre_id as string;
  await exigerArbreGerable(db, auth, arbreId).catch((e: unknown) => {
    throw e instanceof AppError && e.statut === 404 ? introuvable("Nœud") : e;
  });
  const set = clauseSet(
    modif.coefficient === undefined ? modif : { ...modif, coefficient: String(modif.coefficient) },
    3,
  );
  const dejaIncoherent = await incoherencesExistantes(db, arbreId);
  try {
    await db.query(`UPDATE kpi_arbre_noeuds SET ${set.sql}, modifie_par = $2 WHERE id = $1`, [
      noeudId,
      auth.utilisateurId,
      ...set.valeurs,
    ]);
  } catch (e) {
    if (codePg(e) === "23505" && contraintePg(e) === "kpi_arbre_noeuds_kpi_uniq") {
      throw conflit("Ce KPI figure déjà dans l'arbre.");
    }
    throw e;
  }
  await exigerUnitesCoherentes(db, arbreId, dejaIncoherent);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "kpi.arbre.noeud.modifier",
    entite: "kpi_arbre_noeud",
    entiteId: noeudId,
    details: { arbre_id: arbreId, champs: Object.keys(modif) },
  });
  const noeud = (await noeudsDe(db, arbreId)).find((n) => n.id === noeudId);
  if (!noeud) throw introuvable("Nœud");
  return vueNoeud(noeud);
}

/**
 * Contributions des leviers à la variation du KPI racine entre deux situations (lecture).
 * Tous les chiffres sortent du moteur ; `evaluable` est faux tant qu'un levier n'a pas de
 * valeur aux deux dates (`manquants` les liste).
 */
export async function contributionsArbre(db: Db, auth: Auth, id: string, query: unknown) {
  const q = kpiArbreContributionsQuerySchema.parse(query);
  const apres = q.apres ?? aujourdhui();
  if (q.avant >= apres) throw requeteInvalide("La date « avant » précède la date « après ».");
  const { arbre } = await exigerArbreVisible(db, auth, id);
  const noeuds = await noeudsDe(db, id, true);
  const defs = await definitionsParIds(
    db,
    noeuds.flatMap((n) => (n.kpi_id ? [n.kpi_id] : [])),
  );
  const racine = defs.find((d) => d.id === arbre.kpi_racine_id);
  if (!racine) throw introuvable("KPI racine");
  const evalAvant = await evaluerDefinitions(db, defs, q.avant);
  const evalApres = await evaluerDefinitions(db, defs, apres);
  const valeur = (m: typeof evalAvant, kpiId: string | null) =>
    kpiId ? (m.get(kpiId)?.evaluation.derniere?.valeur ?? null) : null;
  const entree: NoeudArbreKpi[] = noeuds.map((n) => ({
    id: n.id,
    parentId: n.parent_id,
    relation: n.relation,
    coefficient: n.coefficient,
    rang: n.rang,
    avant: valeur(evalAvant, n.kpi_id),
    apres: valeur(evalApres, n.kpi_id),
  }));
  const r = decomposerArbreKpi(entree, { sens: racine.sens });
  // Arbre ancien ou KPI dont l'unité a changé : on le dit, sans bloquer la lecture.
  const unitesNoeuds = versNoeudsUnite(noeuds);
  const avertissementsUnites = unitesIncoherentesArbreKpi(unitesNoeuds).map((i) => ({
    parent_id: i.parentId,
    parent_libelle: unitesNoeuds.find((n) => n.id === i.parentId)?.libelle ?? "",
    noeud_id: i.noeudId,
    noeud_libelle: unitesNoeuds.find((n) => n.id === i.noeudId)?.libelle ?? "",
    unite_reference: i.uniteReference,
    unite: i.unite,
    message: messageUniteIncoherenteKpi(i, unitesNoeuds),
  }));
  const parId = new Map(noeuds.map((n) => [n.id, n]));
  const resultat = new Map(r.noeuds.map((n) => [n.id, n]));
  return {
    arbre_id: id,
    mission_id: arbre.mission_id,
    kpi_racine_id: arbre.kpi_racine_id,
    sens: racine.sens,
    unite: racine.unite,
    avant: q.avant,
    apres,
    evaluable: r.evaluable,
    manquants: r.manquants.map((nid) => ({
      noeud_id: nid,
      libelle: parId.get(nid)?.libelle ?? "",
    })),
    variation_racine: r.variationRacine,
    avertissements_unites: avertissementsUnites,
    noeuds: noeuds.map((n) => {
      const x = resultat.get(n.id);
      return {
        ...vueNoeud(n),
        profondeur: x?.profondeur ?? 0,
        feuille: x?.feuille ?? true,
        avant: x?.avant ?? null,
        apres: x?.apres ?? null,
        variation: x?.variation ?? null,
        residu_avant: x?.residuAvant ?? null,
        residu_apres: x?.residuApres ?? null,
        contribution_parent: x?.contributionParent ?? null,
        part_parent: x?.partParent ?? null,
        contribution_racine: x?.contributionRacine ?? null,
        contribution_racine_exacte: x?.contributionRacineExacte ?? null,
        part_racine: x?.partRacine ?? null,
        evaluable: x?.evaluable ?? false,
      };
    }),
    leviers: r.leviers.map((l) => ({
      noeud_id: l.id,
      libelle: parId.get(l.id)?.libelle ?? "",
      kpi_id: parId.get(l.id)?.kpi_id ?? null,
      contribution_racine: l.contributionRacine,
      part_racine: l.partRacine,
      favorable: l.favorable,
      rang: l.rang,
    })),
  };
}
