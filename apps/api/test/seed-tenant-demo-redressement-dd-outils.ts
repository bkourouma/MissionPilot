import { attendre, type ContexteTenantDemo } from "../src/db/tenant-demo/contexte.js";
import type { CleClient } from "../src/db/tenant-demo/cles.js";
import { MISSIONS } from "../src/db/tenant-demo/redressement-dd/commun.js";

/*
 * Casting MINIMAL des 11 missions (noms et clients du brief commun), à la place de la phase
 * « missions » (lot 2a) pour tester la phase « redressement-dd » seule : missions créées par la
 * vraie route puis statuts posés par SQL propriétaire (sans déclencheurs) comme le lot 2a les
 * laissera : 1 à 5 terminées mais OUVERTES (en cours : leur clôture réelle est faite en fin de phase « gestion »), 6 à 9 en cours, 10 signée, 11 en préparation.
 */

interface Def {
  /** 1 = directeur.mission, 2 = directeur.mission.2 (idem chef) : répartition du vrai casting. */
  directeur: 1 | 2;
  chef: 1 | 2;
  nom: string;
  client: CleClient;
  debut: string;
  fin: string;
  statut: "cloturee" | "en_cours" | "signee" | "proposition";
}

const CASTING: Def[] = [
  {
    nom: MISSIONS.plan2025,
    directeur: 1,
    chef: 1,
    client: "sicafe",
    debut: "2024-11-04",
    fin: "2025-04-30",
    statut: "en_cours",
  },
  {
    nom: MISSIONS.notation,
    directeur: 2,
    chef: 1,
    client: "sahel-coton",
    debut: "2025-02-03",
    fin: "2025-06-20",
    statut: "en_cours",
  },
  {
    nom: MISSIONS.redressementTermine,
    directeur: 1,
    chef: 1,
    client: "brasseries-wouri",
    debut: "2025-03-10",
    fin: "2025-11-14",
    statut: "en_cours",
  },
  {
    nom: MISSIONS.ddTerminee,
    directeur: 2,
    chef: 2,
    client: "mboa-solaire",
    debut: "2025-09-01",
    fin: "2025-12-19",
    statut: "en_cours",
  },
  {
    nom: MISSIONS.businessPlan,
    directeur: 1,
    chef: 2,
    client: "atlantique-retail",
    debut: "2026-01-12",
    fin: "2026-05-29",
    statut: "en_cours",
  },
  {
    nom: MISSIONS.planBaobab,
    directeur: 2,
    chef: 1,
    client: "baobab-assurances",
    debut: "2026-06-08",
    fin: "2026-12-18",
    statut: "en_cours",
  },
  {
    nom: MISSIONS.redressementEnCours,
    directeur: 1,
    chef: 2,
    client: "gabon-offshore",
    debut: "2026-07-06",
    fin: "2027-01-29",
    statut: "en_cours",
  },
  {
    nom: MISSIONS.diagnosticFlash,
    directeur: 2,
    chef: 1,
    client: "teranga-logistique",
    debut: "2026-09-14",
    fin: "2026-11-20",
    statut: "en_cours",
  },
  {
    nom: MISSIONS.notationBanque,
    directeur: 1,
    chef: 2,
    client: "banque-sahel",
    debut: "2026-08-24",
    fin: "2026-12-18",
    statut: "en_cours",
  },
  {
    nom: MISSIONS.planExport,
    directeur: 2,
    chef: 1,
    client: "sicafe-export",
    debut: "2026-11-09",
    fin: "2027-03-31",
    statut: "signee",
  },
  {
    nom: MISSIONS.ddPreparation,
    directeur: 1,
    chef: 2,
    client: "wouri-distribution",
    debut: "2026-10-26",
    fin: "2026-12-18",
    statut: "proposition",
  },
];

export async function creerMissionsCasting(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");
  const directeurs = [ctx.session("directeur.mission"), ctx.session("directeur.mission.2")];
  const chefs = [ctx.session("chef.mission"), ctx.session("chef.mission.2")];
  for (const d of CASTING) {
    const directeur = directeurs[d.directeur - 1] as (typeof directeurs)[number];
    const chef = chefs[d.chef - 1] as (typeof chefs)[number];
    const deja = await ctx.proprietaire.query(
      "SELECT id, statut FROM missions WHERE cabinet_id = $1 AND intitule = $2",
      [ctx.cabinetId, d.nom],
    );
    let id = (deja.rows[0] as { id: string } | undefined)?.id;
    if (!id) {
      const r = await associe.post("/api/missions", {
        intitule: d.nom,
        client_id: ctx.client(d.client),
        type_mission_id: null,
        directeur_id: directeur.utilisateurId,
        chef_id: chef.utilisateurId,
        date_debut: d.debut,
        date_fin: d.fin,
        mode_facturation: "forfait",
        activite: "Conseil",
        bureau: "Abidjan",
      });
      attendre(201, r, `mission ${d.nom}`);
      id = r.json().id as string;
    } else if ((deja.rows[0] as { statut: string }).statut !== "proposition") continue;
    if (d.statut === "proposition") continue;
    const cloture = false;
    const c = ctx.proprietaire;
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query(
        `UPDATE missions SET statut = $2, date_signature = $3::date, signee_par = $4::uuid,
                taux_change = 1, devise_reference = 'XOF',
                cloturee_le = CASE WHEN $5::boolean THEN $6::timestamptz END,
                cloturee_par = CASE WHEN $5::boolean THEN $4::uuid END
          WHERE id = $1`,
        [id, d.statut, d.debut, directeur.utilisateurId, cloture, `${d.fin}T12:00:00Z`],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  }
}
