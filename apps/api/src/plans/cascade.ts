import { analyserCascade, type NoeudCascade } from "@missionpilot/engines";
import {
  DONNEES_NOEUD_CASCADE,
  ROLES_CLIENT,
  TYPES_ELEMENT_A_PORTEUR,
  type PlanNoeudCascadeCreation,
  type TypeNoeudCascadePlan,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { traduireErreursPg } from "../db/outils.js";
import { conflit, introuvable, requeteInvalide } from "../errors.js";
import { aujourdhui } from "../missions/outils.js";
import { exigerPlanRedigeable, exigerPlanVisible } from "./acces.js";
import { elementsCourants, type VersionDb } from "./elements.js";

/*
 * Cascade stratégique en graphe (PLA-12) : vision → axes → objectifs →
 * initiatives → projets → jalons, et KPI des objectifs (PLA-10), chaque nœud
 * avec un porteur. Les TROUS (objectif sans KPI, initiative sans porteur…) et
 * les taux de couverture sont calculés par le moteur (analyserCascade) à
 * chaque lecture, à la date du jour ; rien n'est stocké.
 *
 * Porteurs : vision, axe, objectif → `plan_porteurs` (0420, ajout seul) ;
 * initiative → son responsable (0180) ; KPI → son propriétaire (0160) ; projet
 * et jalon → `porteur_id` de leur version. Un porteur est un membre interne
 * actif du cabinet (jamais un utilisateur du portail, doublé en base).
 *
 * Droits (routes/plans-augmentes.ts) : lecture « plan.lire » ; porteur,
 * projets et jalons « plan.ecrire » sur un plan rédigeable (mission visible,
 * non clôturée). Ni porteur ni projet n'est un contenu exposé au client (tables
 * `portail_interdit`) : le partage du plan n'est pas retiré.
 */

/** Projets et jalons par plan : la lecture complète de la cascade reste bornée. */
export const NOEUDS_CASCADE_PAR_PLAN_MAX = 600;

interface NoeudCourant {
  id: string;
  type: TypeNoeudCascadePlan;
  initiative_id: string | null;
  projet_id: string | null;
  version: number;
  titre: string;
  description: string | null;
  porteur_id: string | null;
  debut: string | null;
  echeance: string;
  statut: string;
  retire: boolean;
  auteur_id: string;
  cree_le: string;
}

const COLONNES_NOEUD = `n.id, n.type, n.initiative_id, n.projet_id, v.version, v.titre, v.description,
  v.porteur_id, v.debut::text AS debut, v.echeance::text AS echeance, v.statut, v.retire,
  v.auteur_id, v.cree_le`;

/** Version courante des projets et jalons du plan, par ordre de création. */
async function noeudsCourants(db: Db, planId: string): Promise<NoeudCourant[]> {
  const r = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (n.id) ${COLONNES_NOEUD}, n.cree_le AS noeud_cree_le
       FROM plan_cascade_noeuds n JOIN plan_cascade_versions v ON v.noeud_id = n.id
       WHERE n.plan_id = $1
       ORDER BY n.id, v.version DESC) c
     ORDER BY c.noeud_cree_le, c.id`,
    [planId],
  );
  return r.rows as NoeudCourant[];
}

async function noeudCourant(db: Db, planId: string, noeudId: string): Promise<NoeudCourant> {
  const r = await db.query(
    `SELECT ${COLONNES_NOEUD} FROM plan_cascade_noeuds n
     JOIN plan_cascade_versions v ON v.noeud_id = n.id
     WHERE n.id = $1 AND n.plan_id = $2 ORDER BY v.version DESC LIMIT 1`,
    [noeudId, planId],
  );
  if (!r.rows[0]) throw introuvable("Projet ou jalon du plan");
  return r.rows[0] as NoeudCourant;
}

function vueNoeud(n: NoeudCourant) {
  return {
    id: n.id,
    type: n.type,
    parent_id: n.type === "projet" ? n.initiative_id : n.projet_id,
    version: n.version,
    titre: n.titre,
    description: n.description,
    porteur_id: n.porteur_id,
    debut: n.debut,
    echeance: n.echeance,
    statut: n.statut,
    retire: n.retire,
    auteur_id: n.auteur_id,
    cree_le: n.cree_le,
  };
}

/** Porteur : membre interne actif du cabinet (sinon 400). */
export async function exigerPorteurInterne(db: Db, porteurId: string | null | undefined) {
  if (!porteurId) return;
  const r = await db.query(
    `SELECT 1 FROM utilisateurs WHERE id = $1 AND actif AND NOT (roles && $2::text[])`,
    [porteurId, ROLES_CLIENT],
  );
  if (!r.rowCount) throw requeteInvalide("Porteur inconnu.");
}

/* ----- Lecture et analyse ----- */

interface PorteurElement {
  element_id: string;
  porteur_id: string | null;
}

interface KpiCascade {
  objectif_id: string;
  id: string;
  libelle: string;
  proprietaire_id: string | null;
  actif: boolean;
}

/** Nœuds du moteur depuis les éléments, porteurs, projets, jalons et KPI du plan. */
function noeudsMoteur(
  elements: readonly VersionDb[],
  porteurs: ReadonlyMap<string, string | null>,
  noeuds: readonly NoeudCourant[],
  kpis: readonly KpiCascade[],
): NoeudCascade[] {
  const actifs = elements.filter((e) => !e.retire);
  const vision = actifs.find((e) => e.type === "vision_mission");
  const titre = (e: VersionDb) => String((e.contenu as { titre?: string }).titre ?? "");
  const resultat: NoeudCascade[] = [];
  if (vision) {
    const v = vision.contenu as { vision?: string };
    resultat.push({
      id: vision.element_id,
      type: "vision",
      parentId: null,
      titre: String(v.vision ?? "Vision").slice(0, 200),
      porteurId: porteurs.get(vision.element_id) ?? null,
    });
  }
  for (const e of actifs) {
    if (e.type === "axe" || e.type === "objectif") {
      resultat.push({
        id: e.element_id,
        type: e.type,
        parentId: e.type === "axe" ? (vision?.element_id ?? null) : e.parent_id,
        titre: titre(e),
        porteurId: porteurs.get(e.element_id) ?? null,
      });
    } else if (e.type === "initiative") {
      resultat.push({
        id: e.element_id,
        type: "initiative",
        parentId: e.parent_id,
        titre: titre(e),
        porteurId: e.responsable_id,
        actif: e.statut_initiative !== "abandonnee",
      });
    }
  }
  for (const n of noeuds.filter((x) => !x.retire)) {
    resultat.push({
      id: n.id,
      type: n.type,
      parentId: n.type === "projet" ? n.initiative_id : n.projet_id,
      titre: n.titre,
      porteurId: n.porteur_id,
      actif: n.statut !== "abandonne",
      echeance: n.echeance,
      statut: n.statut,
    });
  }
  for (const k of kpis) {
    resultat.push({
      id: k.id,
      type: "kpi",
      parentId: k.objectif_id,
      titre: k.libelle,
      porteurId: k.proprietaire_id,
      actif: k.actif,
    });
  }
  return resultat;
}

async function porteursCourants(db: Db, planId: string): Promise<Map<string, string | null>> {
  const r = await db.query(
    `SELECT DISTINCT ON (element_id) element_id, porteur_id FROM plan_porteurs
     WHERE plan_id = $1 ORDER BY element_id, version DESC`,
    [planId],
  );
  return new Map((r.rows as PorteurElement[]).map((p) => [p.element_id, p.porteur_id]));
}

async function kpisCascade(db: Db, planId: string): Promise<KpiCascade[]> {
  const r = await db.query(
    `SELECT l.objectif_id, k.id, k.libelle, k.proprietaire_id, k.actif
     FROM plan_objectif_kpis l JOIN kpi_definitions k ON k.id = l.kpi_id
     WHERE l.plan_id = $1 ORDER BY l.cree_le, k.id`,
    [planId],
  );
  return r.rows as KpiCascade[];
}

/** Cascade du plan analysée par le moteur, à la date du jour (`reference`). */
export async function lireCascade(db: Db, auth: Auth, planId: string, voirKpi: boolean) {
  await exigerPlanVisible(db, auth, planId);
  // Lectures successives : une transaction n'a qu'une connexion.
  const elements = await elementsCourants(db, planId);
  const porteurs = await porteursCourants(db, planId);
  const noeuds = await noeudsCourants(db, planId);
  const kpis = await kpisCascade(db, planId);
  const reference = aujourdhui();
  // Sans « kpi.lire », le KPI compte pour la couverture mais son libellé est tu.
  const visibles = voirKpi ? kpis : kpis.map((k) => ({ ...k, libelle: "KPI" }));
  const analyse = analyserCascade(noeudsMoteur(elements, porteurs, noeuds, visibles), reference);
  const ids = [...new Set(analyse.noeuds.map((n) => n.porteurId).filter((x): x is string => !!x))];
  const noms = ids.length
    ? ((await db.query("SELECT id, nom FROM utilisateurs WHERE id = ANY($1::uuid[])", [ids]))
        .rows as { id: string; nom: string }[])
    : [];
  const details = new Map(noeuds.map((n) => [n.id, n]));
  return {
    plan_id: planId,
    reference,
    racines: analyse.racines,
    noeuds: analyse.noeuds.map((n) => ({
      id: n.id,
      type: n.type,
      parent_id: n.parentId,
      titre: n.titre,
      porteur_id: n.porteurId,
      actif: n.actif,
      profondeur: n.profondeur,
      enfants: n.enfants,
      orphelin: n.orphelin,
      trous: n.trous,
      description: details.get(n.id)?.description ?? null,
      debut: details.get(n.id)?.debut ?? null,
      echeance: details.get(n.id)?.echeance ?? null,
      statut: details.get(n.id)?.statut ?? null,
      modifiable: details.has(n.id),
    })),
    trous: analyse.trous.map((t) => ({
      code: t.code,
      gravite: t.gravite,
      noeud_id: t.noeudId,
      type: t.type,
    })),
    compteurs: analyse.compteurs,
    couverture: {
      noeuds_actifs: analyse.couverture.noeudsActifs,
      noeuds_avec_porteur: analyse.couverture.noeudsAvecPorteur,
      taux_porteurs: analyse.couverture.tauxPorteurs,
      objectifs: analyse.couverture.objectifs,
      objectifs_avec_kpi: analyse.couverture.objectifsAvecKpi,
      taux_kpi: analyse.couverture.tauxKpi,
    },
    synthese: analyse.synthese,
    porteurs: Object.fromEntries(noms.map((u) => [u.id, u.nom])),
  };
}

/* ----- Porteur d'un élément (vision, axe, objectif) ----- */

export async function designerPorteur(
  db: Db,
  auth: Auth,
  planId: string,
  elementId: string,
  porteurId: string | null,
) {
  await exigerPlanRedigeable(db, auth, planId);
  const e = await db.query("SELECT type FROM plan_elements WHERE id = $1 AND plan_id = $2", [
    elementId,
    planId,
  ]);
  if (!e.rows[0]) throw introuvable("Élément du plan");
  if (!(TYPES_ELEMENT_A_PORTEUR as readonly string[]).includes(e.rows[0].type as string)) {
    throw requeteInvalide(
      "Seuls la vision, les axes et les objectifs ont un porteur désigné à part.",
    );
  }
  await exigerPorteurInterne(db, porteurId);
  const c = await db.query(
    `SELECT version, porteur_id FROM plan_porteurs WHERE element_id = $1
     ORDER BY version DESC LIMIT 1`,
    [elementId],
  );
  const courant = c.rows[0] as { version: number; porteur_id: string | null } | undefined;
  if ((courant?.porteur_id ?? null) === porteurId) throw conflit("Ce porteur est déjà désigné.");
  const version = (courant?.version ?? 0) + 1;
  await traduireErreursPg(
    db.query(
      `INSERT INTO plan_porteurs (cabinet_id, plan_id, element_id, version, porteur_id, auteur_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [auth.cabinetId, planId, elementId, version, porteurId, auth.utilisateurId],
    ),
    {},
    "Porteur inconnu.",
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.porteur.designer",
    entite: "plan_element",
    entiteId: elementId,
    details: { plan_id: planId, version, porteur_id: porteurId },
  });
  return { element_id: elementId, version, porteur_id: porteurId };
}

/* ----- Projets et jalons ----- */

interface ColonnesNoeud {
  titre: string;
  description: string | null;
  porteur_id: string | null;
  debut: string | null;
  echeance: string;
  statut: string;
}

function decomposer(type: TypeNoeudCascadePlan, donnees: unknown): ColonnesNoeud {
  const d = DONNEES_NOEUD_CASCADE[type].parse(donnees);
  return {
    titre: d.titre,
    description: d.description ?? null,
    porteur_id: d.porteur_id ?? null,
    debut: "debut" in d ? (d.debut ?? null) : null,
    echeance: d.echeance,
    statut: d.statut,
  };
}

async function insererVersionNoeud(
  db: Db,
  auth: Auth,
  noeudId: string,
  version: number,
  c: ColonnesNoeud,
  retire: boolean,
) {
  await traduireErreursPg(
    db.query(
      `INSERT INTO plan_cascade_versions (cabinet_id, noeud_id, version, titre, description,
         porteur_id, debut, echeance, statut, retire, auteur_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        auth.cabinetId,
        noeudId,
        version,
        c.titre,
        c.description,
        c.porteur_id,
        c.debut,
        c.echeance,
        c.statut,
        retire,
        auth.utilisateurId,
      ],
    ),
    {},
    "Porteur inconnu.",
  );
}

/** Parent actif du plan : initiative non retirée (projet), projet non retiré (jalon). */
async function exigerParent(db: Db, planId: string, corps: PlanNoeudCascadeCreation) {
  if (corps.type === "projet") {
    const actives = (await elementsCourants(db, planId)).filter(
      (e) => e.type === "initiative" && !e.retire,
    );
    if (!actives.some((e) => e.element_id === corps.parent_id.toLowerCase())) {
      throw requeteInvalide("Un projet se rattache à une initiative active de ce plan.");
    }
    return;
  }
  const r = await db.query(
    `SELECT n.type, v.retire FROM plan_cascade_noeuds n
     JOIN plan_cascade_versions v ON v.noeud_id = n.id
     WHERE n.id = $1 AND n.plan_id = $2 ORDER BY v.version DESC LIMIT 1`,
    [corps.parent_id, planId],
  );
  const projet = r.rows[0] as { type: string; retire: boolean } | undefined;
  if (!projet || projet.type !== "projet" || projet.retire) {
    throw requeteInvalide("Un jalon se rattache à un projet actif de ce plan.");
  }
}

export async function creerNoeud(
  db: Db,
  auth: Auth,
  planId: string,
  corps: PlanNoeudCascadeCreation,
) {
  await exigerPlanRedigeable(db, auth, planId);
  const n = await db.query(
    "SELECT count(*)::int AS n FROM plan_cascade_noeuds WHERE plan_id = $1",
    [planId],
  );
  if ((n.rows[0] as { n: number }).n >= NOEUDS_CASCADE_PAR_PLAN_MAX) {
    throw conflit(`Un plan compte au plus ${NOEUDS_CASCADE_PAR_PLAN_MAX} projets et jalons.`);
  }
  await exigerParent(db, planId, corps);
  const colonnes = decomposer(corps.type, corps.donnees);
  await exigerPorteurInterne(db, colonnes.porteur_id);
  const parent = corps.parent_id.toLowerCase();
  const r = await db.query(
    `INSERT INTO plan_cascade_noeuds (cabinet_id, plan_id, type, initiative_id, projet_id, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      auth.cabinetId,
      planId,
      corps.type,
      corps.type === "projet" ? parent : null,
      corps.type === "jalon" ? parent : null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await insererVersionNoeud(db, auth, id, 1, colonnes, false);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: `plan.${corps.type}.creer`,
    entite: "plan_cascade_noeud",
    entiteId: id,
    details: { plan_id: planId, parent_id: parent },
  });
  return vueNoeud(await noeudCourant(db, planId, id));
}

/** Nouvelle version (contenu complet) d'un projet ou d'un jalon, ou retrait. */
export async function ajouterVersionNoeud(
  db: Db,
  auth: Auth,
  planId: string,
  noeudId: string,
  corps: { donnees: unknown; retire: boolean },
) {
  await exigerPlanRedigeable(db, auth, planId);
  const courant = await noeudCourant(db, planId, noeudId);
  const c = decomposer(courant.type, corps.donnees);
  await exigerPorteurInterne(db, c.porteur_id);
  const identique =
    c.titre === courant.titre &&
    c.description === courant.description &&
    c.porteur_id === courant.porteur_id &&
    c.debut === courant.debut &&
    c.echeance === courant.echeance &&
    c.statut === courant.statut &&
    corps.retire === courant.retire;
  if (identique) throw conflit("Contenu identique à la version courante.");
  await insererVersionNoeud(db, auth, noeudId, courant.version + 1, c, corps.retire);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: corps.retire ? `plan.${courant.type}.retirer` : `plan.${courant.type}.modifier`,
    entite: "plan_cascade_noeud",
    entiteId: noeudId,
    details: { plan_id: planId, version: courant.version + 1 },
  });
  return vueNoeud(await noeudCourant(db, planId, noeudId));
}
