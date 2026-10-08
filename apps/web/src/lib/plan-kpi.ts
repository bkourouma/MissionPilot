/**
 * KPI issus des objectifs du plan stratégique (PLA-10) : types de la réponse de l'API, saisie
 * préremplie depuis l'objectif, contrôle (celui du module KPI, `validerCreationKpi`), chemins
 * et messages. Logique pure, testée dans `plan-kpi.test.ts`.
 *
 * Le KPI est créé DANS le module de pilotage (#4) par l'API, sur la mission du plan, avec les
 * mêmes règles qu'une création depuis l'onglet KPI ; il y est ensuite suivi (mesures, cibles,
 * alertes). Aucun chiffre n'est calculé ici : la cible éventuelle est saisie par l'utilisateur.
 */
import { aPermission, type Role } from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { SAISIE_KPI_VIDE, validerCreationKpi, type SaisieKpi } from "./kpi-saisie";
import { cheminPlan, hrefPlan } from "./plan-strategique";

export interface KpiDObjectif {
  id: string;
  libelle: string;
  unite: string;
  perspective: string | null;
  frequence: string;
  actif: boolean;
  objectif_version: number;
  cree_le: string;
}

export interface ObjectifAvecKpi {
  id: string;
  parent_id: string | null;
  version: number;
  statut_contenu: string;
  retire: boolean;
  titre: string;
  perspective: string | null;
  indicateur: string | null;
  cible: string | null;
  kpis: KpiDObjectif[];
}

export interface KpiPlan {
  plan_id: string;
  objectifs: ObjectifAvecKpi[];
}

/** Champs du formulaire simplifié de création (les réglages fins se font dans l'onglet KPI). */
export type ChampKpiObjectif =
  | "libelle"
  | "description"
  | "unite"
  | "perspective"
  | "sens"
  | "nature"
  | "frequence"
  | "debut_suivi"
  | "cible";

export type SaisieKpiObjectif = Pick<SaisieKpi, ChampKpiObjectif>;

const DESCRIPTION_MAX = 2000;

/**
 * Saisie préremplie depuis l'objectif : libellé = indicateur de l'objectif (sinon son titre),
 * perspective de l'objectif, description rappelant l'objectif, suivi trimestriel à partir du
 * premier jour du mois courant. La cible chiffrée reste à saisir (la cible de l'objectif est
 * un texte libre : elle n'est jamais convertie en nombre).
 */
export function saisieDepuisObjectif(o: ObjectifAvecKpi, aujourdhui: string): SaisieKpiObjectif {
  const description = `Issu de l'objectif « ${o.titre} »${o.cible ? ` (cible : ${o.cible})` : ""}.`;
  return {
    libelle: (o.indicateur ?? o.titre).slice(0, 200),
    description: description.slice(0, DESCRIPTION_MAX),
    unite: "",
    perspective: o.perspective ?? "",
    sens: "plus_haut_mieux",
    nature: "stock",
    frequence: "trimestrielle",
    debut_suivi: `${aujourdhui.slice(0, 8)}01`,
    cible: "",
  };
}

/** Contrôle de la saisie : mêmes règles que la création d'un KPI dans le module de pilotage. */
export function validerKpiObjectif(s: SaisieKpiObjectif, aujourdhui: string) {
  return validerCreationKpi({ ...SAISIE_KPI_VIDE, ...s }, { aujourdhui, proprietaires: [] });
}

/** Objectifs proposés : actifs ; un objectif retiré n'apparaît que pour ses KPI existants. */
export function objectifsActifs(p: Pick<KpiPlan, "objectifs">): ObjectifAvecKpi[] {
  return p.objectifs.filter((o) => !o.retire);
}

/** Décompte affiché (« 2 objectifs sur 3 ont un KPI »). */
export function decompteObjectifsKpi(p: Pick<KpiPlan, "objectifs">): string {
  const actifs = objectifsActifs(p);
  if (actifs.length === 0) return "Aucun objectif dans ce plan.";
  const avec = actifs.filter((o) => o.kpis.length > 0).length;
  return `${avec} objectif${avec > 1 ? "s" : ""} sur ${actifs.length} ${avec > 1 ? "ont" : "a"} au moins un KPI.`;
}

/** Créer un KPI depuis le plan : « plan.ecrire » ET « kpi.gerer » (l'API décide). */
export function peutCreerKpiPlan(roles: readonly Role[], missionCloturee: boolean): boolean {
  return !missionCloturee && aPermission(roles, "plan.ecrire") && aPermission(roles, "kpi.gerer");
}

/** Message français d'un refus de création. */
export function messageKpiPlan(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.statut === 403) {
      return "Créer un KPI exige de pouvoir rédiger le plan et gérer les KPI, en responsable de la mission (directeur, chef de mission ou associé).";
    }
    if (e.statut === 404) return "Cet objectif est introuvable ou ne vous est plus accessible.";
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}

const seg = (id: string) => encodeURIComponent(id);

export const hrefKpiPlan = (missionId: string, planId: string) =>
  `${hrefPlan(missionId, planId)}/kpi`;
export const hrefKpiMission = (missionId: string) => `/missions/${seg(missionId)}/kpi`;
export const hrefDetailKpi = (missionId: string, kpiId: string) =>
  `${hrefKpiMission(missionId)}/${seg(kpiId)}`;

export const cheminKpiPlan = (planId: string) => `${cheminPlan(planId)}/kpi`;
export const cheminKpiObjectif = (planId: string, objectifId: string) =>
  `${cheminPlan(planId)}/objectifs/${seg(objectifId)}/kpi`;
