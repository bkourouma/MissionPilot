import { ajouterJours } from "@missionpilot/engines";
import type { Role } from "@missionpilot/shared";
import type { Api } from "./api.js";
import { creerMission, type ApiUtilisateur, type CabinetMissions } from "./missions-outils.js";
import { utilisateurCollaborateur } from "./planification-outils.js";

export function attendre(statut: number, r: { statusCode: number; body: string }, quoi: string) {
  if (r.statusCode !== statut) throw new Error(`${quoi} : ${r.statusCode} ${r.body}`);
}

export interface MissionTemps {
  id: string;
  /** Libellé de phase → identifiant de sa tâche unique. */
  taches: Record<string, string>;
  debut: string;
  fin: string;
}

/**
 * Mission (non signée) dont chaque phase porte une tâche du même libellé,
 * budgétée par grade et longue de 60 jours ouvrés (12 semaines) (fenêtre large pour les
 * affectations). Par défaut du 2026-11-02 au 2027-01-29.
 */
export async function missionTemps(
  c: CabinetMissions,
  phases: Record<string, Record<string, number>>,
  options: { intitule?: string; debut?: string; fin?: string } = {},
): Promise<MissionTemps> {
  const debut = options.debut ?? "2026-11-02";
  const fin = options.fin ?? "2027-01-29";
  const m = await creerMission(c, {
    type_mission_id: null,
    mode_facturation: "regie",
    intitule: options.intitule ?? "Audit organisationnel",
    date_debut: debut,
    date_fin: fin,
  });
  const taches: Record<string, string> = {};
  for (const [libelle, budget] of Object.entries(phases)) {
    const phase = await c.chef.post(`/api/missions/${m.id}/phases`, { libelle });
    attendre(201, phase, "phase");
    const tache = await c.chef.post(`/api/missions/${m.id}/taches`, {
      parent_id: phase.json().id,
      libelle,
      duree_jours_ouvres: 60,
    });
    attendre(201, tache, "tâche");
    taches[libelle] = tache.json().id;
    attendre(
      200,
      await c.chef.put(`/api/missions/${m.id}/taches/${tache.json().id}/budget`, {
        lignes: Object.entries(budget).map(([code, jours]) => ({
          grade_id: c.grades[code],
          jours,
        })),
      }),
      "budget",
    );
  }
  return { id: m.id, taches, debut, fin };
}

/** Consultant (utilisateur + collaborateur actif) affecté aux tâches données. */
export async function consultantAffecte(
  c: CabinetMissions,
  m: MissionTemps,
  affectations: Record<string, number>,
  options: { roles?: Role[]; grade?: string; debut?: string; fin?: string } = {},
): Promise<ApiUtilisateur & { collaborateurId: string }> {
  const u = await utilisateurCollaborateur(
    c,
    options.roles ?? ["consultant"],
    options.grade ?? "senior",
  );
  await affecter(c, m, u.collaborateurId, affectations, options);
  return u;
}

export async function affecter(
  c: CabinetMissions,
  m: MissionTemps,
  collaborateurId: string,
  affectations: Record<string, number>,
  options: { debut?: string; fin?: string } = {},
): Promise<void> {
  for (const [libelle, jours] of Object.entries(affectations)) {
    const r = await c.chef.post(`/api/missions/${m.id}/affectations`, {
      tache_id: m.taches[libelle],
      collaborateur_id: collaborateurId,
      jours_alloues: jours,
      date_debut: options.debut ?? m.debut,
      date_fin: options.fin ?? ajouterJours(m.debut, 7 * 11 + 4),
    });
    attendre(201, r, "affectation");
  }
}

/** Lignes d'une semaine : jours répartis du lundi au vendredi, 1 jour au plus par jour. */
export function lignesSemaine(
  lundi: string,
  travaux: readonly { tache_id: string; jours: number }[],
): { date: string; tache_id: string; jours: number }[] {
  const lignes: { date: string; tache_id: string; jours: number }[] = [];
  let jour = 0;
  let libre = 2; // demi-journées
  for (const t of travaux) {
    let reste = Math.round(t.jours * 2);
    while (reste > 0 && jour < 5) {
      const pris = Math.min(reste, libre);
      const date = ajouterJours(lundi, jour);
      const existante = lignes.find((l) => l.date === date && l.tache_id === t.tache_id);
      if (existante) existante.jours += pris / 2;
      else lignes.push({ date, tache_id: t.tache_id, jours: pris / 2 });
      reste -= pris;
      libre -= pris;
      if (libre === 0) {
        jour++;
        libre = 2;
      }
    }
  }
  return lignes;
}

/** Crée (sans pré-remplissage), saisit et soumet la feuille de la semaine ; renvoie son id. */
export async function saisirEtSoumettre(
  auteur: Api,
  lundi: string,
  lignes: readonly Record<string, unknown>[],
): Promise<string> {
  const f = await auteur.post("/api/feuilles-temps", { semaine: lundi, pre_remplir: false });
  attendre(201, f, "feuille");
  const id = f.json().id as string;
  attendre(200, await auteur.put(`/api/feuilles-temps/${id}/lignes`, { lignes }), "lignes");
  attendre(200, await auteur.post(`/api/feuilles-temps/${id}/soumettre`), "soumission");
  return id;
}
