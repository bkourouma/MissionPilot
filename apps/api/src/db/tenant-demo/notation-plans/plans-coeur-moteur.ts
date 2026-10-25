import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import type { MissionTrouvee } from "./casting.js";
import type { Acteurs } from "./plans-coeur-acteurs.js";
import type {
  Donnees,
  Etape,
  Ids,
  SpecElement,
  SpecPlan,
  Valeur,
  Valideur,
} from "./plans-coeur-types.js";
import { exiger, existe, lire } from "./outils.js";

/*
 * Moteur de rejeu d'un plan, première moitié : plan, éléments (versions, validations, bibliothèque
 * d'initiatives) et rattachement des objectifs aux KPI de la mission. Tout passe par les routes
 * de l'API sauf le rattachement d'un KPI DÉJÀ existant (la route crée un KPI neuf).
 *
 * Idempotence : le plan se retrouve par (mission, titre) ; un élément par son type (vision,
 * diagnostic, SWOT) ou son titre (axe, objectif, initiative) ; le numéro de version courant dit
 * combien d'étapes de la spécification sont déjà jouées (création = version 1, puis une version
 * par étape de modification ou de validation).
 */

export interface ElementApi {
  id: string;
  type: string;
  version: number;
  statut_contenu: string;
  retire: boolean;
  donnees: Donnees;
}

/** État partagé par les deux moitiés du moteur pour un plan. */
export interface EtatPlan {
  ctx: ContexteTenantDemo;
  acteurs: Acteurs;
  mission: MissionTrouvee;
  spec: SpecPlan;
  planId: string;
  ids: Map<string, string>;
}

export const resoudre = <T>(v: Valeur<T>, ids: Ids): T =>
  typeof v === "function" ? (v as (i: Ids) => T)(ids) : v;

export const sessionValideur = (a: Acteurs, v: Valideur): SessionDemo =>
  v === "associe" ? a.associe : a.directeur;

/** Plan de la mission retrouvé par titre, sinon créé par le chef de mission (responsable). */
export async function trouverOuCreerPlan(
  ctx: ContexteTenantDemo,
  acteurs: Acteurs,
  mission: MissionTrouvee,
  spec: SpecPlan,
): Promise<string> {
  const liste = await acteurs.chef.get(`/api/missions/${mission.id}/plans?limite=100`);
  exiger(liste, 200, `plans de « ${mission.intitule} »`);
  const connu = (liste.json().elements as { id: string; titre: string }[]).find(
    (p) => p.titre === spec.titre,
  );
  if (connu) return connu.id;
  const r = await acteurs.chef.post(`/api/missions/${mission.id}/plans`, {
    titre: spec.titre,
    horizon: spec.horizon,
    devise: "XOF",
  });
  exiger(r, 201, `création du plan « ${spec.titre} »`);
  ctx.journal(`    plan créé : ${spec.titre}`);
  return r.json().id as string;
}

export async function lireElements(e: EtatPlan): Promise<ElementApi[]> {
  const r = await e.acteurs.chef.get(`/api/plans/${e.planId}`);
  exiger(r, 200, "lecture du plan");
  return r.json().elements as ElementApi[];
}

function retrouver(existants: readonly ElementApi[], s: SpecElement): ElementApi | undefined {
  const singleton = s.type === "diagnostic" || s.type === "swot" || s.type === "vision_mission";
  return existants.find(
    (x) => x.type === s.type && (singleton || (x.donnees as { titre?: string }).titre === s.titre),
  );
}

async function idTypeBibliotheque(e: EtatPlan, code: string): Promise<string> {
  const r = await e.acteurs.chef.get("/api/bibliotheque-initiatives?limite=100");
  exiger(r, 200, "bibliothèque d'initiatives");
  const t = (r.json().elements as { id: string; code: string }[]).find((x) => x.code === code);
  if (!t) throw new Error(`Initiative type « ${code} » absente de la bibliothèque.`);
  return t.id;
}

async function creerElement(e: EtatPlan, s: SpecElement): Promise<ElementApi> {
  const auteur = s.auteur === "chef" ? e.acteurs.chef : e.acteurs.consultant;
  const parentId = s.parent ? e.ids.get(s.parent) : undefined;
  if (s.parent && !parentId) throw new Error(`Parent « ${s.parent} » inconnu pour « ${s.cle} ».`);
  if (s.bibliotheque) {
    const b = s.bibliotheque;
    const r = await auteur.post(`/api/plans/${e.planId}/initiatives/depuis-bibliotheque`, {
      initiative_type_id: await idTypeBibliotheque(e, b.code),
      parent_id: parentId,
      debut: b.debut,
      ...(b.echeance ? { echeance: b.echeance } : {}),
      ...(b.budget !== undefined ? { budget: b.budget } : {}),
      ...(s.titre ? { titre: s.titre } : {}),
    });
    exiger(r, 201, `initiative « ${s.cle} » depuis la bibliothèque`);
    return r.json() as ElementApi;
  }
  const r = await auteur.post(`/api/plans/${e.planId}/elements`, {
    type: s.type,
    ...(parentId ? { parent_id: parentId } : {}),
    donnees: resoudre(s.creation, e.ids),
  });
  exiger(r, 201, `création de l'élément « ${s.cle} »`);
  return r.json() as ElementApi;
}

async function jouerEtape(
  e: EtatPlan,
  s: SpecElement,
  etape: Etape,
  courant: ElementApi,
): Promise<ElementApi> {
  if ("valider" in etape) {
    const r = await sessionValideur(e.acteurs, etape.valider).post(
      `/api/plans/${e.planId}/elements/${courant.id}/validation`,
      {},
    );
    exiger(r, 200, `validation de « ${s.cle} »`);
    return r.json() as ElementApi;
  }
  const auteur = (etape.auteur ?? s.auteur) === "chef" ? e.acteurs.chef : e.acteurs.consultant;
  const donnees = { ...courant.donnees, ...resoudre(etape.maj, e.ids) };
  const r = await auteur.post(`/api/plans/${e.planId}/elements/${courant.id}/versions`, {
    donnees,
    retire: false,
  });
  exiger(r, 201, `nouvelle version de « ${s.cle} »`);
  return r.json() as ElementApi;
}

/** Joue les éléments dans l'ordre de la spécification (parents avant enfants). */
export async function jouerElements(e: EtatPlan): Promise<void> {
  const existants = await lireElements(e);
  for (const s of e.spec.elements) {
    let courant = retrouver(existants, s) ?? (await creerElement(e, s));
    e.ids.set(s.cle, courant.id);
    const etapes = s.etapes ?? [];
    for (let i = courant.version - 1; i < etapes.length; i++) {
      courant = await jouerEtape(e, s, etapes[i] as Etape, courant);
    }
  }
}

/** Rattache les objectifs aux KPI de la mission : SQL pour un KPI existant, route pour un neuf. */
export async function lierKpis(e: EtatPlan): Promise<void> {
  const elements = await lireElements(e);
  for (const s of e.spec.elements) {
    for (const libelle of s.kpiExistants ?? []) {
      const id = e.ids.get(s.cle);
      const objectif = elements.find((x) => x.id === id);
      const [kpi] = await lire<{ id: string }>(
        e.ctx,
        "SELECT id FROM kpi_definitions WHERE mission_id = $1 AND libelle = $2",
        [e.mission.id, libelle],
      );
      if (!objectif || !kpi) {
        e.ctx.journal(`    KPI « ${libelle} » introuvable dans la mission : lien ignoré`);
        continue;
      }
      if (await existe(e.ctx, "SELECT 1 FROM plan_objectif_kpis WHERE kpi_id = $1", [kpi.id])) {
        continue;
      }
      await e.ctx.proprietaire.query(
        `INSERT INTO plan_objectif_kpis (cabinet_id, plan_id, objectif_id, kpi_id, objectif_version, cree_par)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [e.ctx.cabinetId, e.planId, objectif.id, kpi.id, objectif.version, e.acteurs.ids.directeur],
      );
    }
  }
  for (const k of e.spec.kpiNouveaux ?? []) {
    const objectifId = e.ids.get(k.objectif);
    const libelle = String(k.corps.libelle);
    const deja = await existe(
      e.ctx,
      `SELECT 1 FROM plan_objectif_kpis l JOIN kpi_definitions d ON d.id = l.kpi_id
       WHERE l.plan_id = $1 AND d.libelle = $2`,
      [e.planId, libelle],
    );
    if (deja) continue;
    const r = await e.acteurs.directeur.post(
      `/api/plans/${e.planId}/objectifs/${objectifId}/kpi`,
      k.corps,
    );
    exiger(r, 201, `KPI « ${libelle} » depuis l'objectif`);
  }
}

/** Désigne les porteurs de la vision, des axes et des objectifs (409 : déjà désigné). */
export async function designerPorteurs(e: EtatPlan): Promise<void> {
  for (const s of e.spec.elements) {
    if (!s.porteur) continue;
    const r = await e.acteurs.chef.put(
      `/api/plans/${e.planId}/elements/${e.ids.get(s.cle)}/porteur`,
      { porteur_id: e.ctx.utilisateurs[s.porteur] },
    );
    exiger(r, [200, 409], `porteur de « ${s.cle} »`);
  }
}
