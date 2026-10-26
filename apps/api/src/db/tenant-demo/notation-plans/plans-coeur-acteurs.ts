import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import type { MissionTrouvee } from "./casting.js";
import { exiger, lire } from "./outils.js";

/*
 * Acteurs d'un plan : qui écrit, qui valide (règles de plans/acces.ts).
 * - le chef de la mission crée le plan et calcule les versions du modèle ;
 * - un consultant de l'équipe rédige les éléments (ajouté à l'équipe par la route si absent) ;
 * - le DIRECTEUR de la mission valide contenus et versions du modèle (dispensé de la séparation
 *   des tâches) et arbitre le portefeuille ; un associé peut valider aussi (dispensé).
 */

export interface Acteurs {
  chef: SessionDemo;
  directeur: SessionDemo;
  associe: SessionDemo;
  consultant: SessionDemo;
  /** Identifiants d'utilisateur. */
  ids: { chef: string; directeur: string; consultant: string; associe: string };
}

function sessionDe(ctx: ContexteTenantDemo, utilisateurId: string | null, repli: string) {
  const trouvee = Object.values(ctx.sessions).find((s) => s?.utilisateurId === utilisateurId);
  return trouvee ?? ctx.session(repli as Parameters<ContexteTenantDemo["session"]>[0]);
}

/** Acteurs de la mission, équipe complétée par la route si le consultant n'en fait pas partie. */
export async function resoudreActeurs(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
  besoinConsultant = true,
): Promise<Acteurs> {
  const [m] = await lire<{ directeur_id: string | null; chef_id: string | null }>(
    ctx,
    "SELECT directeur_id, chef_id FROM missions WHERE id = $1",
    [mission.id],
  );
  const directeur = sessionDe(ctx, m?.directeur_id ?? null, "directeur.mission");
  const chef = sessionDe(ctx, m?.chef_id ?? null, "chef.mission");
  const consultant = ctx.session("consultant");
  const associe = ctx.session("associe");

  const dejaMembre = await lire(
    ctx,
    "SELECT 1 FROM mission_equipe WHERE mission_id = $1 AND utilisateur_id = $2",
    [mission.id, consultant.utilisateurId],
  );
  const responsable =
    consultant.utilisateurId === m?.directeur_id || consultant.utilisateurId === m?.chef_id;
  if (besoinConsultant && dejaMembre.length === 0 && !responsable) {
    const r = await chef.post(`/api/missions/${mission.id}/equipe`, {
      utilisateur_id: consultant.utilisateurId,
    });
    exiger(r, 201, `ajout du consultant à l'équipe de « ${mission.intitule} »`);
  }
  return {
    chef,
    directeur,
    associe,
    consultant,
    ids: {
      chef: chef.utilisateurId,
      directeur: directeur.utilisateurId,
      consultant: consultant.utilisateurId,
      associe: associe.utilisateurId,
    },
  };
}
