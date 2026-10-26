import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { ficheDe } from "./ao-banque-offres.js";
import { OFFRES_FINANCIERES_DEMO, type OffreFinanciereDemo } from "./donnees-banque-offres.js";
import { sql } from "./outils.js";

/*
 * Offres financières de la banque d'AO (AO-07), par les routes. Seuls les jours et les taux
 * journaliers sont saisis : les totaux sortent du moteur `offre-financiere` (simulation, puis
 * enregistrement qui recalcule). Création et révision par un compte `finance.lire` +
 * `taux.gerer` (associé, gestionnaire) ; contrôle FIN-02 : un compte sans `finance.lire`
 * (cheffe de mission, consultant) ne lit ni taux ni totaux. Tables en ajout seul : date du jour
 * d'exécution. Rejouable : clé = appel d'offres de l'offre.
 */

interface Entree {
  devise: string;
  honoraires: {
    cle: string;
    libelle: string;
    jours: number;
    taux_journalier: number;
    cv_id: string | null;
  }[];
  per_diem: { libelle: string; quantite: number; prix_unitaire: number }[];
  debours: { libelle: string; quantite: number; prix_unitaire: number }[];
  taxes: { libelle: string; taux: number; assiette: "honoraires" | "total_ht" }[];
  conversion: null;
}

function entreeDe(o: OffreFinanciereDemo, cvIds: Record<string, string>, facteur = 1): Entree {
  return {
    devise: o.devise,
    honoraires: o.honoraires.map((h) => ({
      cle: h.expert,
      libelle: h.libelle,
      jours: Math.round(h.jours * facteur),
      taux_journalier: h.taux,
      cv_id: cvIds[h.expert] ?? null,
    })),
    per_diem: o.per_diem,
    debours: o.debours,
    taxes: [{ libelle: "TVA", taux: o.tva, assiette: "total_ht" }],
    conversion: null,
  };
}

interface ResultatSimulation {
  total_ht: number;
  total_ttc: number;
}

async function simuler(ctx: ContexteTenantDemo, o: OffreFinanciereDemo, e: Entree) {
  const r = await ctx.session(o.createur).post("/api/banque-ao/offres-financieres/simulation", e);
  attendre(200, r, `simulation ${o.cle}`);
  return r.json() as ResultatSimulation;
}

async function semerOffre(
  ctx: ContexteTenantDemo,
  o: OffreFinanciereDemo,
  cvIds: Record<string, string>,
): Promise<void> {
  const aoId = await ficheDe(ctx, o.cle);
  let id = (
    await sql<{ id: string }>(
      ctx,
      "SELECT id FROM ao_offres_financieres WHERE cabinet_id = $1 AND appel_offres_id = $2",
      [ctx.cabinetId, aoId],
    )
  )[0]?.id;
  if (!id) {
    const entree = entreeDe(o, cvIds);
    const calcul = await simuler(ctx, o, entree);
    const r = await ctx.session(o.createur).post("/api/banque-ao/offres-financieres", {
      titre: o.titre,
      appel_offres_id: aoId,
      entree,
    });
    attendre(201, r, `offre financière ${o.cle}`);
    const cree = r.json() as { id: string; courante: { resultat: ResultatSimulation } };
    if (cree.courante.resultat.total_ht !== calcul.total_ht) {
      throw new Error(`Offre financière ${o.cle} : le total enregistré diffère de la simulation.`);
    }
    id = cree.id;
  }
  const n = (
    await sql<{ n: number }>(
      ctx,
      "SELECT count(*)::int AS n FROM ao_offre_financiere_versions WHERE offre_id = $1",
      [id],
    )
  )[0]?.n;
  if (o.revision && n === 1) {
    const entree = entreeDe(o, cvIds, o.revision.facteurJours);
    await simuler(ctx, o, entree);
    const r = await ctx
      .session(o.revision.auteur)
      .post(`/api/banque-ao/offres-financieres/${id}/versions`, {
        entree,
        motif: o.revision.motif,
      });
    attendre(201, r, `version 2 de l'offre financière ${o.cle}`);
  }
}

/** FIN-02 : refus net pour un compte sans `finance.lire`, lecture pour le gestionnaire. */
async function controlerFin02(ctx: ContexteTenantDemo): Promise<void> {
  for (const cle of ["chef.mission", "consultant", "directeur.mission"] as const) {
    const liste = await ctx.session(cle).get("/api/banque-ao/offres-financieres");
    if (liste.statusCode !== 403) {
      throw new Error(`FIN-02 : ${cle} lit les offres financières (HTTP ${liste.statusCode}).`);
    }
    const une = await sql<{ id: string }>(
      ctx,
      "SELECT id FROM ao_offres_financieres WHERE cabinet_id = $1 ORDER BY id LIMIT 1",
      [ctx.cabinetId],
    );
    const id = une[0]?.id;
    if (id) {
      const d = await ctx.session(cle).get(`/api/banque-ao/offres-financieres/${id}`);
      if (d.statusCode !== 403 || /taux_journalier|marge/.test(d.body)) {
        throw new Error(`FIN-02 : ${cle} reçoit le détail d'une offre financière.`);
      }
    }
  }
  const fin = await ctx.session("gestionnaire").get("/api/banque-ao/offres-financieres");
  attendre(200, fin, "lecture des offres financières par le gestionnaire");
}

export async function semerOffresFinancieres(
  ctx: ContexteTenantDemo,
  cvIds: Record<string, string>,
): Promise<void> {
  for (const o of OFFRES_FINANCIERES_DEMO) await semerOffre(ctx, o, cvIds);
  await controlerFin02(ctx);
}
