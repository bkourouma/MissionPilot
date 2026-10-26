import { attendre, type ContexteTenantDemo } from "../contexte.js";

/*
 * Propositions d'évolution du standard tirées des DÉROGATIONS FRÉQUENTES (CAP-05) : l'associé
 * (`standard.gerer`) lit l'analyse des dérogations (seuil abaissé à 2 missions, le cabinet de
 * démonstration ayant peu de missions par méthode) puis soumet une proposition pour chaque groupe
 * (méthode, brique, nature) qui atteint le seuil. Route réelle `POST /capitalisation/derogations/
 * propositions` : elle crée la proposition du standard et la ligne `cap_propositions_derogations`.
 * Rejouable : un groupe qui porte déjà une proposition est sauté.
 */

const SEUIL_DEMO = 2;

interface Groupe {
  cle: string;
  au_dessus_du_seuil: boolean;
  proposition: { id: string } | null;
}

export async function semerPropositionsDerogations(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");
  const analyse = await associe.get(`/api/capitalisation/derogations/analyse?seuil=${SEUIL_DEMO}`);
  attendre(200, analyse, "analyse des dérogations");
  const groupes = (analyse.json() as { elements: Groupe[] }).elements;
  let crees = 0;
  for (const g of groupes) {
    if (!g.au_dessus_du_seuil || g.proposition) continue;
    const r = await associe.post("/api/capitalisation/derogations/propositions", {
      cle: g.cle,
      seuil: SEUIL_DEMO,
    });
    attendre(201, r, `proposition issue des dérogations (${g.cle})`);
    crees += 1;
  }
  ctx.journal(`  propositions issues des dérogations fréquentes : ${crees} créée(s).`);
}
