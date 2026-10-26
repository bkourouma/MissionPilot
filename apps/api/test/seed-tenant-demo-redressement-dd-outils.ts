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
  /** Devise du client du socle (la mission porte la même). */
  devise?: "XAF" | "EUR" | "USD";
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
    devise: "XAF",
    directeur: 1,
    chef: 1,
    client: "brasseries-wouri",
    debut: "2025-03-10",
    fin: "2025-11-14",
    statut: "en_cours",
  },
  {
    nom: MISSIONS.ddTerminee,
    devise: "XAF",
    directeur: 2,
    chef: 2,
    client: "mboa-solaire",
    debut: "2025-09-01",
    fin: "2025-12-19",
    statut: "en_cours",
  },
  {
    nom: MISSIONS.businessPlan,
    devise: "EUR",
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
    devise: "USD",
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
    devise: "XAF",
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
    if (d.devise) await poserDevise(ctx, id, d.devise);
    if (d.statut === "proposition") continue;
    const cloture = false;
    const c = ctx.proprietaire;
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query(
        `UPDATE missions SET statut = $2, date_signature = $3::date, signee_par = $4::uuid,
                taux_change = $7::numeric, devise_reference = 'XOF',
                cloturee_le = CASE WHEN $5::boolean THEN $6::timestamptz END,
                cloturee_par = CASE WHEN $5::boolean THEN $4::uuid END
          WHERE id = $1`,
        [
          id,
          d.statut,
          d.debut,
          directeur.utilisateurId,
          cloture,
          `${d.fin}T12:00:00Z`,
          d.devise === "USD" ? 600 : d.devise === "EUR" ? 655.957 : 1,
        ],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  }
}

/** Devise de la mission = devise du client du socle (le casting réel les aligne). */
async function poserDevise(ctx: ContexteTenantDemo, id: string, devise: string): Promise<void> {
  const c = ctx.proprietaire;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query("UPDATE missions SET devise = $2 WHERE id = $1", [id, devise]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

/** Les 44 tables du périmètre : aucune ne doit rester vide pour le cabinet. */
export const TABLES_PERIMETRE = (
  "dossier_facteurs dossier_exports dossier_faits_decisions preuve_dimensions preuves " +
  "preuve_versions assertions assertion_versions assertion_preuve_liens preuve_arbitrages " +
  "red_seuils_versions red_checklist_modeles red_checklist_versions red_suivi_evenements " +
  "red_action_evenements red_actions red_causes_historique red_causes_versions " +
  "red_checklist_reponses red_checklists red_clotures red_correspondances red_covenants_lignes " +
  "red_covenants_versions red_creances red_creanciers red_dossiers red_echeances " +
  "red_financement_lignes red_financement_versions red_negociation_evenements red_plan_versions " +
  "red_scores red_suivi_jalons red_suivi_plans red_suivi_releves red_tresorerie_lignes " +
  "red_tresorerie_realises red_tresorerie_versions red_urgences " +
  "dd_dossiers dd_signaux dd_exclusion_listes dd_portail_options dd_modeles_secteur " +
  "dd_cadrage_versions dd_signal_versions dd_elements dd_dimensionnements " +
  "dd_exclusion_liste_versions dd_ajustements dd_notes dd_portail_invites " +
  "dd_modele_secteur_versions dd_element_versions dd_signal_constats dd_hypothese_liens " +
  "dd_verdicts dd_dimensionnement_versions dd_filtrages dd_note_versions " +
  "dd_verdict_validations dd_filtrage_decisions dd_note_validations dd_portail_publications " +
  "dd_portail_pieces dd_portail_publication_retraits portail_parametres"
).split(" ");
