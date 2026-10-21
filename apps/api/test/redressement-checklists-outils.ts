import type pg from "pg";
import type { Db } from "../src/db/pool.js";
import type { Api } from "./api.js";
import { proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import { ouvrirDossierRed, type ScenarioRed } from "./redressement-outils.js";

/*
 * Outils des tests des check-lists du redressement (RED-03) : items de test, modèle publié, dossier
 * neuf, et lecture du code SQLSTATE d'un refus de la base (rôle applicatif ou propriétaire).
 */

export const DOMAINES = [
  "tresorerie",
  "activite",
  "exploitation",
  "social",
  "financement",
] as const;

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const item = (id: string, domaine = "tresorerie", extra: Record<string, unknown> = {}) => ({
  id,
  domaine,
  libelle: `Point de contrôle ${id} ?`,
  ...extra,
});

/** `n` items `i1`…`in`, répartis sur les cinq domaines. */
export const itemsDe = (n: number) =>
  Array.from({ length: n }, (_, i) => item(`i${i + 1}`, DOMAINES[i % DOMAINES.length]));

export const corpsModele = (extra: Record<string, unknown> = {}) => ({
  code: "modele-test",
  intitule: "Modèle de test",
  secteur: "industrie",
  items: itemsDe(3),
  ...extra,
});

/** Nouveau dossier de redressement dans une mission neuve du cabinet A. */
export async function nouveauDossier(
  s: ScenarioRed,
  intitule: string,
  creerMissionAvec: (corps: Record<string, unknown>) => Promise<{ id: string }> = (corps) =>
    creerMission(s.a, corps),
): Promise<{ dossierId: string; missionId: string }> {
  const mission = await creerMissionAvec({ intitule });
  const dossier = await ouvrirDossierRed(s, mission.id);
  return { dossierId: dossier.id, missionId: mission.id };
}

/** Modèle créé par `auteur` et publié par `publieur` : renvoie le modèle (version 1 en vigueur). */
export async function modelePublie(
  auteur: Api,
  publieur: Api,
  corps: Record<string, unknown> = {},
): Promise<Json> {
  const cree = await auteur.post("/api/redressement/checklists/modeles", corpsModele(corps));
  attendre(201, cree, "modèle");
  const versionId = cree.json().brouillon.id as string;
  attendre(
    200,
    await publieur.post(`/api/redressement/checklists/versions/${versionId}/publication`, {}),
    "publication",
  );
  const liste = (await publieur.get("/api/redressement/checklists/modeles")).json();
  return liste.modeles.find((m: Json) => m.id === cree.json().id) as Json;
}

/** Code SQLSTATE d'un refus de la base (rôle applicatif sous la RLS du cabinet) ; « aucun » si accepté. */
export async function codeSql(
  ctx: Contexte,
  cabinetId: string,
  fn: (db: Db) => Promise<unknown>,
): Promise<string> {
  try {
    await ctx.db.withTenant(cabinetId, fn);
  } catch (e) {
    return (e as { code?: string }).code ?? "inconnu";
  }
  return "aucun";
}

/** Code SQLSTATE d'un refus de la base pour le rôle propriétaire (déclencheurs). */
export async function codeProprietaire(fn: (c: pg.Client) => Promise<unknown>): Promise<string> {
  try {
    await proprietaire(fn);
  } catch (e) {
    return (e as { code?: string }).code ?? "inconnu";
  }
  return "aucun";
}
