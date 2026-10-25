import type { ContexteTenantDemo } from "../contexte.js";
import { corps } from "./capitalisation-outils.js";

/*
 * Dérogations (CAP-05) et recherche (CAP-07).
 *
 * Dérogations : l'analyse du comité méthode (`/capitalisation/derogations/analyse`) groupe les
 * dérogations des missions ; chaque groupe au-dessus du seuil sans proposition devient une
 * proposition d'évolution du standard PAR LA ROUTE (`/derogations/propositions`). Aucune
 * proposition n'est écrite à la main ; sans dérogation au-dessus du seuil (les dérogations
 * relèvent de la phase « ia-qualite-standard »), rien n'est créé.
 *
 * Recherche : la recherche unifiée lit les retours VALIDÉS ; on vérifie qu'elle répond.
 */

interface Groupe {
  cle: string;
  au_dessus_du_seuil: boolean;
  proposition: unknown;
}

export async function proposerDerogations(ctx: ContexteTenantDemo): Promise<number> {
  const associe = ctx.session("associe");
  const analyse = corps<{ elements: Groupe[] }>(
    await associe.get("/api/capitalisation/derogations/analyse"),
    [200],
    "analyse des dérogations",
  );
  let creees = 0;
  for (const g of analyse.elements) {
    if (!g.au_dessus_du_seuil || g.proposition) continue;
    corps(
      await associe.post("/api/capitalisation/derogations/propositions", { cle: g.cle }),
      [201],
      `proposition ${g.cle}`,
    );
    creees += 1;
  }
  return creees;
}

/** Nombre de résultats « connaissance » (retours validés) pour un mot-clé. */
export async function rechercher(ctx: ContexteTenantDemo, mot: string): Promise<number> {
  const r = corps<{ resultats?: { type: string }[]; elements?: { type: string }[] }>(
    await ctx
      .session("associe")
      .get(`/api/capitalisation/recherche?q=${encodeURIComponent(mot)}&types=connaissance`),
    [200],
    "recherche",
  );
  return (r.resultats ?? r.elements ?? []).filter((x) => x.type === "connaissance").length;
}
