import { createHash, randomUUID } from "node:crypto";
import type { Api } from "./api.js";
import type { Contexte } from "./helpers.js";
import { proprietaire } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/** Cabinet de test du lot qualité : mission, équipe et un livrable de chaque famille. */
export interface ScenarioQualite {
  c: CabinetMissions;
  missionId: string;
  consultant: ApiUtilisateur;
  expert: ApiUtilisateur;
  /** Chef de mission d'un autre périmètre : ne voit pas la mission. */
  etranger: ApiUtilisateur;
}

export async function preparerQualite(ctx: Contexte, nom: string): Promise<ScenarioQualite> {
  const c = await preparerCabinet(ctx, nom);
  const mission = await creerMission(c);
  const consultant = await c.avecRoles(["consultant"]);
  const expert = await c.avecRoles(["expert_metier"]);
  const etranger = await c.avecRoles(["chef_mission"]);
  await proprietaire(async (db) => {
    for (const u of [consultant, expert]) {
      await db.query(
        "INSERT INTO mission_equipe (cabinet_id, mission_id, utilisateur_id) VALUES ($1, $2, $3)",
        [c.cabinetId, mission.id, u.utilisateurId],
      );
    }
  });
  return { c, missionId: mission.id, consultant, expert, etranger };
}

export function attendre(statut: number, r: { statusCode: number; body: string }, quoi: string) {
  if (r.statusCode !== statut) throw new Error(`${quoi} : ${r.statusCode} ${r.body}`);
}

/** Rapport « généré » inséré directement (le rendu PDF n'est pas l'objet des tests qualité). */
export async function insererRapport(
  s: ScenarioQualite,
  options: { statut?: "brouillon" | "valide"; auteurId: string; contenu?: string },
): Promise<{ id: string; sha256: string }> {
  const sha256 = createHash("sha256")
    .update(options.contenu ?? randomUUID())
    .digest("hex");
  const id = randomUUID();
  await proprietaire(async (db) => {
    const f = await db.query(
      `INSERT INTO fichiers (cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256, envoye_par)
       VALUES ($1, $2, 'rapport.pdf', 'application/pdf', 100, $3, $4) RETURNING id`,
      [s.c.cabinetId, randomUUID().replaceAll("-", ""), sha256, options.auteurId],
    );
    await db.query(
      `INSERT INTO rapports_mission (id, cabinet_id, mission_id, fichier_id, modele, format, statut, niveau, genere_par)
       VALUES ($1, $2, $3, $4, 'etat_avancement', 'pdf', $5, 'base', $6)`,
      [id, s.c.cabinetId, s.missionId, f.rows[0].id, options.statut ?? "valide", options.auteurId],
    );
  });
  return { id, sha256 };
}

export function ouvrir(par: Api, s: ScenarioQualite, corps: Record<string, unknown>) {
  return par.post("/api/qualite/suivis", {
    mission_id: s.missionId,
    libelle: "Livrable de test",
    livrable_id: randomUUID(),
    ...corps,
  });
}

/** Preuve « document » de la mission, saisie par le chef (sert à tracer un chiffre de revue). */
export async function preuveDeTest(s: ScenarioQualite): Promise<string> {
  const r = await s.c.chef.post(`/api/missions/${s.missionId}/preuves`, {
    type_source: "document",
    source_precise: "Comptes annuels 2025, note 4",
    date_preuve: "2026-09-30",
    fiabilite: "A",
  });
  attendre(201, r, "preuve");
  return r.json().id as string;
}

/**
 * Éléments de revue déposés par un relecteur : toujours obligatoires, sans source libre ; le
 * chiffre est tracé par une preuve de la mission (`preuveId`).
 */
export async function elementsDeTest(par: Api, suiviId: string, preuveId: string, n = 2) {
  const elements = [
    { cle: "a1", kind: "assertion_fragile", libelle: "Assertion fragile sans preuve" },
    { cle: "c1", kind: "chiffre", libelle: "Chiffre d'affaires 2025", preuve_id: preuveId },
    { cle: "r1", kind: "recommandation", libelle: "Recommandation 1" },
  ].slice(0, n + 1);
  const r = await par.post(`/api/qualite/suivis/${suiviId}/elements`, { elements });
  attendre(200, r, "éléments");
  return r.json();
}
