/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { CRITERES_REVUE_FROIDE } from "@missionpilot/shared";
import type { Api } from "./api.js";
import type { Contexte } from "./helpers.js";
import { proprietaire } from "./helpers.js";
import {
  creerMission,
  creerMissionSignee,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/** Outils des tests de la revue à froid (QUA-05). */

export const P = "/api/qualite/revue-froide";

export function attendre(statut: number, r: { statusCode: number; body: string }, quoi: string) {
  if (r.statusCode !== statut) throw new Error(`${quoi} : ${r.statusCode} ${r.body}`);
}

export interface ScenarioFroide {
  c: CabinetMissions;
  /** Relecteur indépendant (expert métier) et second relecteur (directeur de mission). */
  tiers: ApiUtilisateur;
  tiers2: ApiUtilisateur;
  consultant: ApiUtilisateur;
  gestionnaire: ApiUtilisateur;
  ressources: ApiUtilisateur;
  /** Missions clôturées (identifiants), dans l'ordre de création. */
  missions: string[];
}

/** Clôture une mission signée (propriétaire de la base : la clôture réelle exige un parcours complet). */
export async function cloturerMission(missionId: string, jour: string, par: string): Promise<void> {
  await proprietaire((cl) =>
    cl.query(
      `UPDATE missions SET statut = 'cloturee', cloturee_le = $2::timestamptz, cloturee_par = $3
       WHERE id = $1`,
      [missionId, `${jour}T10:00:00Z`, par],
    ),
  );
}

/** Mission signée puis clôturée. */
export async function missionCloturee(
  c: CabinetMissions,
  jour: string,
  corps: Record<string, unknown> = {},
): Promise<string> {
  const m = await creerMissionSignee(c, corps);
  await cloturerMission(m.id, jour, c.directeur.utilisateurId);
  return m.id;
}

/** Cabinet avec `n` missions clôturées, de dates de clôture croissantes en 2026. */
export async function preparerFroide(ctx: Contexte, nom: string, n = 6): Promise<ScenarioFroide> {
  const c = await preparerCabinet(ctx, nom);
  const missions: string[] = [];
  for (let i = 0; i < n; i++) {
    const jour = `2026-0${(i % 6) + 1}-15`;
    missions.push(await missionCloturee(c, jour, { intitule: `Mission close ${i + 1}` }));
  }
  return {
    c,
    tiers: await c.avecRoles(["expert_metier"]),
    tiers2: await c.avecRoles(["directeur_mission"]),
    consultant: await c.avecRoles(["consultant"]),
    gestionnaire: await c.avecRoles(["gestionnaire"]),
    ressources: await c.avecRoles(["ressources"]),
    missions,
  };
}

export const CRITERES_2026 = { periode_debut: "2026-01-01", periode_fin: "2026-12-31" };

/** Crée une campagne (échantillon de toute la population par défaut, sans exclure les revues passées). */
export async function creerCampagne(
  associe: Api,
  corps: Record<string, unknown> = {},
): Promise<any> {
  const r = await associe.post(`${P}/campagnes`, {
    intitule: "Campagne de test",
    criteres: { ...CRITERES_2026, exclure_deja_revues: false },
    taille: 100,
    graine: "graine-de-test",
    ...corps,
  });
  attendre(201, r, "campagne");
  return r.json();
}

export function echantillonDe(campagne: any, missionId: string | undefined): any {
  const e = campagne.echantillon.find((x: any) => x.mission_id === missionId);
  if (!e) throw new Error("mission absente de l'échantillon");
  return e;
}

/** Note de chaque critère de la grille (toutes à `note`). */
export async function evaluerTout(relecteur: Api, echantillonId: string, note = 4): Promise<void> {
  for (const crit of CRITERES_REVUE_FROIDE) {
    const r = await relecteur.put(`${P}/echantillons/${echantillonId}/evaluations`, {
      critere: crit.code,
      note,
    });
    attendre(200, r, `évaluation ${crit.code}`);
  }
}

/** Affecte puis fait terminer la revue. */
export async function revueTerminee(
  associe: Api,
  relecteur: ApiUtilisateur,
  echantillonId: string,
  note = 4,
  constat?: Record<string, unknown>,
): Promise<any> {
  attendre(
    200,
    await associe.post(`${P}/echantillons/${echantillonId}/affectation`, {
      relecteur_id: relecteur.utilisateurId,
    }),
    "affectation",
  );
  await evaluerTout(relecteur, echantillonId, note);
  if (constat) {
    attendre(
      201,
      await relecteur.post(`${P}/echantillons/${echantillonId}/constats`, constat),
      "constat",
    );
  }
  const t = await relecteur.post(`${P}/echantillons/${echantillonId}/terminer`, {
    synthese: "Revue à froid terminée.",
  });
  attendre(200, t, "terminaison");
  return t.json();
}

/** Mission clôturée dont on a fait le relecteur candidat sous une casquette donnée. */
export type CasViolation =
  | "DIRECTEUR"
  | "CHEF"
  | "EQUIPE"
  | "AFFECTE"
  | "CREATEUR"
  | "CLOTURE"
  | "SIGNATAIRE"
  | "INTERVENANT_QUALITE";

/**
 * Crée une mission clôturée sur laquelle `candidat` (utilisateur) tient la casquette `cas`.
 * Les casquettes sont posées en base (propriétaire) ; SIGNATAIRE passe par la vraie signature.
 */
export async function missionAvecCasquette(
  c: CabinetMissions,
  cas: CasViolation,
  candidat: ApiUtilisateur,
): Promise<string> {
  let m: { id: string };
  if (cas === "SIGNATAIRE") {
    m = await creerMission(c, { intitule: `Mission ${cas}` });
    attendre(
      200,
      await candidat.post(`/api/missions/${m.id}/signer`, { date_signature: "2026-02-01" }),
      "signature par le candidat",
    );
  } else {
    m = await creerMissionSignee(c, { intitule: `Mission ${cas}` });
  }
  await cloturerMission(m.id, "2026-03-20", c.directeur.utilisateurId);
  const u = candidat.utilisateurId;
  await proprietaire(async (cl) => {
    switch (cas) {
      case "DIRECTEUR":
        await cl.query("UPDATE missions SET directeur_id = $2 WHERE id = $1", [m.id, u]);
        break;
      case "CHEF":
        await cl.query("UPDATE missions SET chef_id = $2 WHERE id = $1", [m.id, u]);
        break;
      case "EQUIPE":
        await cl.query(
          "INSERT INTO mission_equipe (cabinet_id, mission_id, utilisateur_id) VALUES ($1, $2, $3)",
          [c.cabinetId, m.id, u],
        );
        break;
      case "AFFECTE": {
        const phase = await cl.query(
          "INSERT INTO mission_phases (cabinet_id, mission_id, libelle) VALUES ($1, $2, 'Phase') RETURNING id",
          [c.cabinetId, m.id],
        );
        const tache = await cl.query(
          `INSERT INTO mission_taches (cabinet_id, mission_id, phase_id, libelle)
           VALUES ($1, $2, $3, 'Tâche') RETURNING id`,
          [c.cabinetId, m.id, phase.rows[0].id],
        );
        const col = await cl.query(
          `INSERT INTO collaborateurs (cabinet_id, utilisateur_id, nom) VALUES ($1, $2, 'Affecté') RETURNING id`,
          [c.cabinetId, u],
        );
        await cl.query(
          `INSERT INTO affectations (cabinet_id, mission_id, tache_id, collaborateur_id, jours_alloues,
             date_debut, date_fin) VALUES ($1, $2, $3, $4, 1, '2026-02-02', '2026-02-06')`,
          [c.cabinetId, m.id, tache.rows[0].id, col.rows[0].id],
        );
        break;
      }
      case "CREATEUR":
        await cl.query("UPDATE missions SET cree_par = $2 WHERE id = $1", [m.id, u]);
        break;
      case "CLOTURE":
        await cl.query("UPDATE missions SET cloturee_par = $2 WHERE id = $1", [m.id, u]);
        break;
      case "SIGNATAIRE":
        break;
      case "INTERVENANT_QUALITE":
        await cl.query(
          `INSERT INTO qualite_suivis (cabinet_id, mission_id, type_livrable, livrable_id, libelle,
             version, classe_minimale, classe, auteur_id, ouvert_par)
           VALUES ($1, $2, 'rapport', $3, 'Rapport', 1, 'R1', 'R1', $4, $5)`,
          [c.cabinetId, m.id, randomUUID(), u, c.directeur.utilisateurId],
        );
        break;
    }
  });
  return m.id;
}

/** Clés (récursif) d'une valeur JSON. */
export function cles(valeur: unknown, acc: string[] = []): string[] {
  if (Array.isArray(valeur)) for (const v of valeur) cles(v, acc);
  else if (valeur && typeof valeur === "object") {
    for (const [k, v] of Object.entries(valeur)) {
      acc.push(k);
      cles(v, acc);
    }
  }
  return acc;
}
