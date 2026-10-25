import type { ContexteTenantDemo } from "../contexte.js";
import { preparerBriques } from "./capitalisation-briques.js";
import { semerCompetences } from "./capitalisation-competences.js";
import { proposerDerogations, rechercher } from "./capitalisation-connaissances.js";
import { semerEfficacite } from "./capitalisation-efficacite.js";
import { traiterRetour } from "./capitalisation-retours.js";
import { CLES_MISSIONS_TERMINEES } from "./outils.js";

/*
 * Capitalisation du Tenant démo (CAP-01 à CAP-07) pour les 5 missions « terminées » du casting
 * (encore ouvertes à ce stade, clôturées en fin de phase « gestion ») : retours d'expérience,
 * briques et base d'estimation, compétences, recommandations et efficacité, dérogations.
 * Idempotent : chaque objet est retrouvé par sa clé naturelle avant création.
 */
export async function semerCapitalisation(ctx: ContexteTenantDemo): Promise<void> {
  for (const cle of CLES_MISSIONS_TERMINEES) {
    const briques = await preparerBriques(ctx, cle);
    const fait = await traiterRetour(ctx, cle);
    ctx.journal(
      `  capitalisation : ${cle} (${briques} tâche(s) rattachée(s), retour ${fait ? "validé" : "déjà fait"}).`,
    );
  }
  await semerCompetences(ctx);
  await semerEfficacite(ctx);
  const propositions = await proposerDerogations(ctx);
  const trouves = await rechercher(ctx, "trésorerie");
  ctx.journal(
    `  capitalisation : ${propositions} proposition(s) de dérogations ; recherche « trésorerie » : ${trouves} retour(s) trouvé(s).`,
  );
}
