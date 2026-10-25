import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { CASTING, CLES_MISSIONS, CLES_TERMINEES, chargerMissions } from "./commun.js";

/*
 * Missions de SUBSTITUTION : pour tester la phase avant (ou sans) la phase « missions » du lot 2a.
 * Crée, par la vraie route, les missions du casting ABSENTES (même intitulé exact) puis leur donne
 * l'état attendu (signée ou en cours) par SQL propriétaire. Comme avec le lot 2a, les missions
 * « terminées » restent OUVERTES (en cours) pendant la phase : leur clôture n'a lieu qu'à la fin
 * de la phase « gestion » (`cloturerSubstituts` la simule pour tester la revue à froide).
 * Appelé par les tests et l'outil de développement (`lancer-module.ts`), jamais par la phase.
 */
export async function assurerMissionsSubstituts(ctx: ContexteTenantDemo): Promise<number> {
  const existantes = await chargerMissions(ctx);
  const associe = ctx.session("associe");
  const directeur = ctx.session("directeur.mission");
  const chef = ctx.session("chef.mission");
  let creees = 0;
  for (const cle of CLES_MISSIONS) {
    if (existantes[cle]) continue;
    const c = CASTING[cle];
    const r = await associe.post("/api/missions", {
      intitule: c.intitule,
      client_id: ctx.client(c.client),
      type_mission_id: null,
      directeur_id: directeur.utilisateurId,
      chef_id: chef.utilisateurId,
      date_debut: c.debut,
      date_fin: c.fin,
      mode_facturation: "forfait",
      activite: "Conseil en stratégie",
      bureau: "Abidjan",
    });
    attendre(201, r, `mission de substitution ${c.intitule}`);
    const id = r.json().id as string;
    creees++;
    if (c.etat === "preparation") continue;
    const statut = c.etat === "signee" ? "signee" : "en_cours";
    const signature = c.etat === "signee" ? ctx.jour(-20) : c.debut;
    await ctx.proprietaire.query(
      `UPDATE missions SET statut = $2, date_signature = $3, signee_par = $4,
              taux_change = 1, devise_reference = 'XOF', modifie_le = now()
        WHERE id = $1`,
      [id, statut, signature, directeur.utilisateurId],
    );
  }
  return creees;
}

/** Simule la clôture finale de la phase « gestion » : les 5 missions terminées passent à « clôturée ». */
export async function cloturerSubstituts(ctx: ContexteTenantDemo): Promise<void> {
  const directeur = ctx.session("directeur.mission");
  for (const cle of CLES_TERMINEES) {
    const c = CASTING[cle];
    await ctx.proprietaire.query(
      `UPDATE missions SET statut = 'cloturee', cloturee_le = $3::timestamptz, cloturee_par = $4,
              modifie_le = now()
        WHERE cabinet_id = $1 AND intitule = $2 AND statut <> 'cloturee'`,
      [ctx.cabinetId, c.intitule, `${c.fin}T12:00:00Z`, directeur.utilisateurId],
    );
  }
}
