import type { MethodeAtelier } from "@missionpilot/shared";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import type { Alea } from "../horloge.js";
import { exiger, existe, lire } from "./outils.js";
import type { Acteurs } from "./plans-coeur-acteurs.js";
import type { OptionSpec, Personne, SpecAtelier } from "./plans-avances-ateliers-donnees.js";
import type { Dirigeant } from "./plans-avances-portail.js";

/*
 * Moteur de rejeu des ateliers en ligne (PLA-15), par les VRAIES routes :
 *   chef de mission : crée l'atelier, l'ouvre, le clôt, génère la synthèse IA ;
 *   associé         : invite les dirigeants du client (« portail.gerer » en plus de « plan.ecrire ») ;
 *   participants    : le cabinet dépose par /plans/:id/ateliers/:atelierId/contribution/:méthode,
 *                     les dirigeants du client DEPUIS LE PORTAIL (/portail/ateliers/:id/contribution/:méthode).
 * Les agrégats sont figés par le moteur à la clôture, masqués sous 3 contributeurs par méthode.
 *
 * Idempotence : atelier retrouvé par (plan, titre) ; participants, contributions (une version 1 par
 * participant et méthode, une version 2 pour les révisions) et synthèse contrôlés avant chaque
 * écriture ; l'étape reprend donc là où un échec l'a laissée.
 */

export interface PlanAtelier {
  id: string;
  titre: string;
  acteurs: Acteurs;
}

interface Intervenant {
  session: SessionDemo;
  utilisateurId: string;
  portail: boolean;
}

export type Annuaire = (qui: Personne) => Intervenant;

/** Annuaire des intervenants : équipe de la mission (cabinet) et dirigeants du portail. */
export function annuaire(
  acteurs: Acteurs,
  dirigeants: Partial<Record<string, Dirigeant>>,
): Annuaire {
  return (qui) => {
    if (qui === "chef")
      return { session: acteurs.chef, utilisateurId: acteurs.ids.chef, portail: false };
    if (qui === "directeur") {
      return { session: acteurs.directeur, utilisateurId: acteurs.ids.directeur, portail: false };
    }
    if (qui === "consultant") {
      return { session: acteurs.consultant, utilisateurId: acteurs.ids.consultant, portail: false };
    }
    if (qui === "associe") {
      return { session: acteurs.associe, utilisateurId: acteurs.ids.associe, portail: false };
    }
    const d = dirigeants[qui];
    if (!d) throw new Error(`Dirigeant « ${qui} » non préparé pour cet atelier.`);
    return { session: d.session, utilisateurId: d.utilisateurId, portail: true };
  };
}

interface OptionAtelier {
  id: string;
  impact: number;
  effort: number;
}

/** Titre et description des initiatives du plan (version courante), dans l'ordre de création. */
async function initiativesDuPlan(ctx: ContexteTenantDemo, planId: string) {
  return lire<{ titre: string; description: string | null }>(
    ctx,
    `SELECT v.contenu->>'titre' AS titre, v.contenu->>'description' AS description
       FROM plan_elements e
       JOIN LATERAL (SELECT contenu, retire FROM plan_element_versions
                      WHERE element_id = e.id ORDER BY version DESC LIMIT 1) v ON true
      WHERE e.plan_id = $1 AND e.type = 'initiative' AND NOT v.retire
      ORDER BY e.cree_le, e.id`,
    [planId],
  );
}

async function optionsACreer(
  ctx: ContexteTenantDemo,
  planId: string,
  options: readonly OptionSpec[],
) {
  const initiatives = await initiativesDuPlan(ctx, planId);
  return options.map((o) => {
    if ("libelle" in o) {
      return { libelle: o.libelle, ...(o.description ? { description: o.description } : {}) };
    }
    const i = initiatives[o.initiative - 1];
    if (!i) throw new Error(`Initiative n° ${o.initiative} introuvable dans le plan ${planId}.`);
    return {
      libelle: i.titre.slice(0, 200),
      ...(i.description ? { description: i.description.slice(0, 300) } : {}),
    };
  });
}

const borne = (n: number) => Math.min(5, Math.max(1, Math.round(n)));
const bruit = (alea: Alea, amplitude: number) => (alea.suivant() * 2 - 1) * amplitude;
/** Points d'un vote (budget 10, plafond 5) selon le rang de l'option dans le choix du votant. */
const PARTS_DU_VOTE = [4, 3, 2, 1] as const;

/** Corps de contribution d'une personne : la tendance du groupe plus un écart à graine fixe. */
export function corpsContribution(
  methode: MethodeAtelier,
  options: readonly OptionAtelier[],
  alea: Alea,
): Record<string, unknown> {
  if (methode === "vote") {
    const classes = options
      .map((o) => ({ o, s: o.impact + bruit(alea, 1.3) }))
      .sort((a, b) => b.s - a.s);
    const points = new Map(classes.map((c, i) => [c.o.id, PARTS_DU_VOTE[i] ?? 0]));
    return { points: options.map((o) => ({ option_id: o.id, points: points.get(o.id) ?? 0 })) };
  }
  if (methode === "priorisation") {
    const classes = options
      .map((o) => ({ o, s: o.impact - 0.3 * o.effort + bruit(alea, 1) }))
      .sort((a, b) => b.s - a.s);
    return { classement: classes.map((c) => c.o.id) };
  }
  return {
    positions: options.map((o) => ({
      option_id: o.id,
      x: borne(o.impact + bruit(alea, 0.9)),
      y: borne(o.effort + bruit(alea, 0.9)),
    })),
  };
}

async function deposer(
  plan: PlanAtelier,
  atelierId: string,
  qui: Intervenant,
  methode: MethodeAtelier,
  corps: Record<string, unknown>,
  libelle: string,
) {
  const url = qui.portail
    ? `/api/portail/ateliers/${atelierId}/contribution/${methode}`
    : `/api/plans/${plan.id}/ateliers/${atelierId}/contribution/${methode}`;
  exiger(await qui.session.put(url, corps), 200, libelle);
}

/** Atelier du plan (par titre) : le crée en brouillon s'il n'existe pas. */
async function trouverOuCreer(ctx: ContexteTenantDemo, plan: PlanAtelier, spec: SpecAtelier) {
  const [existant] = await lire<{ id: string; statut: string }>(
    ctx,
    "SELECT id, statut FROM plan_ateliers WHERE plan_id = $1 AND titre = $2",
    [plan.id, spec.titre],
  );
  if (existant) return existant;
  const r = await plan.acteurs.chef.post(`/api/plans/${plan.id}/ateliers`, {
    titre: spec.titre,
    consigne: spec.consigne,
    methodes: spec.methodes,
    budget_points: 10,
    plafond_par_option: 5,
    options: await optionsACreer(ctx, plan.id, spec.options),
  });
  exiger(r, 201, `création de l'atelier « ${spec.titre} »`);
  return { id: r.json().id as string, statut: "brouillon" };
}

async function inviter(
  ctx: ContexteTenantDemo,
  plan: PlanAtelier,
  atelierId: string,
  spec: SpecAtelier,
  qui: Annuaire,
) {
  for (const p of spec.participants) {
    const cible = qui(p);
    const deja = await existe(
      ctx,
      "SELECT 1 FROM plan_atelier_participants WHERE atelier_id = $1 AND utilisateur_id = $2",
      [atelierId, cible.utilisateurId],
    );
    if (deja) continue;
    // Un dirigeant du client s'invite avec « portail.gerer » (associé) ; le cabinet, par le chef.
    const invitant = cible.portail ? plan.acteurs.associe : plan.acteurs.chef;
    const r = await invitant.post(`/api/plans/${plan.id}/ateliers/${atelierId}/participants`, {
      utilisateur_id: cible.utilisateurId,
    });
    exiger(r, 201, `invitation de ${p} à « ${spec.titre} »`);
  }
}

async function contributions(
  ctx: ContexteTenantDemo,
  plan: PlanAtelier,
  atelierId: string,
  spec: SpecAtelier,
  qui: Annuaire,
) {
  const rangs = await lire<{ id: string; rang: number }>(
    ctx,
    "SELECT id, rang::int AS rang FROM plan_atelier_options WHERE atelier_id = $1 ORDER BY rang",
    [atelierId],
  );
  const options: OptionAtelier[] = rangs.map((o, i) => ({
    id: o.id,
    impact: (spec.options[i] as OptionSpec).impact,
    effort: (spec.options[i] as OptionSpec).effort,
  }));
  const alea = ctx.alea.deriver(`plans-avances:atelier:${spec.titre}`);
  for (const [p, methodes] of spec.contributions) {
    const cible = qui(p);
    for (const methode of methodes) {
      const [v] = await lire<{ version: number }>(
        ctx,
        `SELECT coalesce(max(version), 0)::int AS version FROM plan_atelier_contributions
          WHERE atelier_id = $1 AND utilisateur_id = $2 AND methode = $3`,
        [atelierId, cible.utilisateurId, methode],
      );
      const revise = spec.revisions?.some(([r, m]) => r === p && m === methode) ?? false;
      const cibleVersion = revise ? 2 : 1;
      for (let version = (v?.version ?? 0) + 1; version <= cibleVersion; version++) {
        // Un flux dérivé par (personne, méthode, version) : la reprise reproduit les mêmes dépôts.
        const flux = alea.deriver(`${p}:${methode}:${version}`);
        await deposer(
          plan,
          atelierId,
          cible,
          methode,
          corpsContribution(methode, options, flux),
          `contribution ${methode} v${version} de ${p} à « ${spec.titre} »`,
        );
      }
    }
  }
}

const PRECISION_SYNTHESE =
  "Relecture du consultant : les résultats donnent une tendance de priorités qui reste à confronter au " +
  "budget et à la capacité d'exécution avant arbitrage ; les points de désaccord seront repris en comité de pilotage.";

async function synthese(
  ctx: ContexteTenantDemo,
  plan: PlanAtelier,
  atelierId: string,
  spec: SpecAtelier,
) {
  if (!spec.synthese) return;
  const deja = await existe(
    ctx,
    "SELECT 1 FROM ia_demandes WHERE entite_type = 'plan_atelier' AND entite_id = $1",
    [atelierId],
  );
  if (deja) return;
  const s = plan.acteurs.chef;
  const r = await s.post(`/api/plans/${plan.id}/ateliers/${atelierId}/synthese`, {});
  exiger(r, 201, `synthèse IA de « ${spec.titre} »`);
  const vue = r.json().synthese as { id: string; texte: string; statut_contenu: string };
  if (spec.synthese === "modifie") {
    const m = await s.post(`/api/ia/generations/${vue.id}/modifier`, {
      texte: `${vue.texte}\n\n${PRECISION_SYNTHESE}`,
    });
    exiger(m, 200, `retouche de la synthèse de « ${spec.titre} »`);
  }
}

/** Rejoue un atelier jusqu'au statut visé (brouillon, ouvert ou clos). */
export async function jouerAtelier(
  ctx: ContexteTenantDemo,
  plan: PlanAtelier,
  spec: SpecAtelier,
  qui: Annuaire,
): Promise<void> {
  const atelier = await trouverOuCreer(ctx, plan, spec);
  const url = `/api/plans/${plan.id}/ateliers/${atelier.id}`;
  let statut = atelier.statut;
  if (statut === "brouillon") await inviter(ctx, plan, atelier.id, spec, qui);
  if (statut === "brouillon" && spec.statut !== "brouillon") {
    exiger(await plan.acteurs.chef.post(`${url}/ouvrir`), 200, `ouverture de « ${spec.titre} »`);
    statut = "ouvert";
  }
  if (statut === "ouvert" && spec.statut !== "brouillon") {
    await contributions(ctx, plan, atelier.id, spec, qui);
  }
  if (statut === "ouvert" && spec.statut === "clos") {
    exiger(await plan.acteurs.chef.post(`${url}/clore`), 200, `clôture de « ${spec.titre} »`);
    statut = "clos";
  }
  if (statut === "clos") await synthese(ctx, plan, atelier.id, spec);
  ctx.journal(`      atelier « ${spec.titre} » : ${statut}`);
}
