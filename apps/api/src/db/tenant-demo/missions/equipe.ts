import { attendre, type ContexteTenantDemo, type SessionDemo } from "../contexte.js";
import type { CleCollaborateur, CleCompteCabinet } from "../cles.js";
import { EQUIPE_PREPARATION, type Grade } from "./donnees-casting.js";
import type { MissionBatie, TacheLue } from "./construction.js";

/*
 * Équipe d'une mission du casting : un collaborateur réel (grade, ancienneté, type) par grade du
 * budget, affecté tâche par tâche pour les jours budgétés (affectations par la route, chef de la
 * mission). Les membres qui ont un compte entrent dans l'équipe de la mission par l'affectation.
 */

/** Collaborateur de repli quand le casting n'indique personne pour un grade. */
function repli(grade: string, m: MissionBatie): CleCollaborateur[] {
  const fixes: Record<Grade, CleCollaborateur> = {
    associe: "associe",
    directeur: m.def.directeur as CleCollaborateur,
    manager: m.def.chef as CleCollaborateur,
    senior: "consultant",
    junior: "consultant.junior",
    stagiaire: "consultant.stagiaire",
  };
  return [fixes[grade as Grade]];
}

/** Collaborateurs qui se partagent les jours d'un grade pour cette mission. */
function effectif(m: MissionBatie, grade: string): CleCollaborateur[] {
  const liste = m.def.equipe[grade as Grade];
  return liste && liste.length > 0 ? liste : repli(grade, m);
}

/** Affecte une tâche : une affectation par ligne de budget, sur la fenêtre planifiée de la tâche. */
export async function affecterTache(
  ctx: ContexteTenantDemo,
  chef: SessionDemo,
  m: MissionBatie,
  tache: TacheLue,
  rang: number,
): Promise<number> {
  const fenetre = m.fenetres.get(tache.id);
  if (!fenetre) return 0;
  const debut = fenetre.debut < m.def.debut ? m.def.debut : fenetre.debut;
  const fin = fenetre.fin > m.def.fin ? m.def.fin : fenetre.fin;
  let n = 0;
  for (const ligne of tache.budget) {
    // Le cabinet saisit à la demi-journée : jours arrondis à l'inférieur (jamais au-delà du budget).
    const jours = Math.floor(ligne.jours * 2) / 2;
    if (jours <= 0) continue;
    const gens = effectif(m, ligne.grade_code);
    const cle = gens[rang % gens.length] as CleCollaborateur;
    attendre(
      201,
      await chef.post(`/api/missions/${m.id}/affectations`, {
        tache_id: tache.id,
        collaborateur_id: ctx.collaborateur(cle),
        jours_alloues: jours,
        date_debut: debut,
        date_fin: fin,
      }),
      `affectation ${cle} sur ${tache.libelle}`,
    );
    n++;
  }
  return n;
}

/** Affecte toutes les tâches de la mission (signée) : renvoie le nombre d'affectations. */
export async function constituerEquipe(
  ctx: ContexteTenantDemo,
  chef: SessionDemo,
  m: MissionBatie,
): Promise<number> {
  let n = 0;
  for (const [i, t] of m.taches.entries()) n += await affecterTache(ctx, chef, m, t, i);
  return n;
}

/** Mission en préparation : équipe pressentie ajoutée à la main (aucune affectation encore). */
export async function pressentirEquipe(
  ctx: ContexteTenantDemo,
  chef: SessionDemo,
  m: MissionBatie,
): Promise<void> {
  for (const cle of EQUIPE_PREPARATION[m.def.cle] ?? []) {
    const id = ctx.utilisateurs[cle as CleCompteCabinet];
    if (!id) throw new Error(`Compte « ${cle} » introuvable pour l'équipe de ${m.def.nom}.`);
    attendre(
      201,
      await chef.post(`/api/missions/${m.id}/equipe`, { utilisateur_id: id }),
      "équipe",
    );
  }
}
