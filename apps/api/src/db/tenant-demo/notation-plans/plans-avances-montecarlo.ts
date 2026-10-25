import type { HypotheseIncertaineSaisie } from "@missionpilot/shared";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { exiger, existe, lire } from "./outils.js";
import type { PlanAtelier } from "./plans-avances-ateliers.js";

/*
 * Simulations de Monte-Carlo du plan financier (PLA-16) par les VRAIES routes. Les chiffres (VAN,
 * probabilités, empreinte) sortent du moteur ; la graine est TIRÉE PAR L'API (jamais fournie ici),
 * si bien qu'une simulation se retrouve par (version, tirages, cibles) et non par sa graine.
 * Lancer exige « plan.ecrire » (chef ou consultant) ; REJOUER n'exige que « plan.lire » : le
 * directeur de la mission rejoue la simulation avec la graine enregistrée et vérifie l'identité du
 * résultat. Un rejeu n'écrit que sa trace de débit (`plan_rejeux_montecarlo`).
 */

export type Lanceur = "chef" | "consultant";

export interface SpecSimulation {
  version: number;
  tirages: number;
  par: Lanceur;
  hypotheses: readonly HypotheseIncertaineSaisie[];
  /** Un rejeu à l'identique est demandé sur cette simulation (par le directeur de la mission). */
  rejeu?: boolean;
}

const triangulaire = (
  cible: HypotheseIncertaineSaisie["cible"],
  min: number,
  mode: number,
  max: number,
) => ({ cible, loi: { type: "triangulaire", min, mode, max } }) as HypotheseIncertaineSaisie;

export const SIMULATIONS: Record<"sicafe" | "atlantique" | "baobab", readonly SpecSimulation[]> = {
  sicafe: [
    {
      version: 2,
      tirages: 1500,
      par: "chef",
      rejeu: true,
      hypotheses: [
        triangulaire("croissanceChiffreAffaires", -4, 0, 3),
        triangulaire("tauxMargeBrute", -2, 0, 1.5),
        triangulaire("chargesFixes", -3, 0, 8),
        triangulaire("delaiClientsJours", 0, 0, 25),
      ],
    },
    {
      // Scénario de stress demandé par la direction : prix du cacao orientés à la baisse.
      version: 2,
      tirages: 1000,
      par: "consultant",
      hypotheses: [
        {
          cible: "croissanceChiffreAffaires",
          loi: { type: "normale", moyenne: -2, ecartType: 2.5, min: -8, max: 4 },
        },
        { cible: "tauxChargesVariables", loi: { type: "uniforme", min: -1, max: 2 } },
      ],
    },
  ],
  atlantique: [
    {
      version: 2,
      tirages: 1000,
      par: "chef",
      hypotheses: [
        triangulaire("croissanceChiffreAffaires", -6, 0, 4),
        triangulaire("chargesFixes", -2, 0, 12),
        { cible: "delaiClientsJours", loi: { type: "uniforme", min: 0, max: 45 } },
      ],
    },
  ],
  baobab: [
    {
      version: 1,
      tirages: 1000,
      par: "chef",
      rejeu: true,
      hypotheses: [
        triangulaire("croissanceChiffreAffaires", -5, 0, 5),
        triangulaire("tauxMargeBrute", -3, 0, 2),
        triangulaire("chargesFixes", -2, 0, 10),
      ],
    },
  ],
};

const cleDe = (version: number, tirages: number, cibles: readonly string[]) =>
  `${version}|${tirages}|${[...cibles].sort().join(",")}`;

/** Lance les simulations absentes du plan, puis le rejeu demandé. */
export async function jouerMonteCarlo(
  ctx: ContexteTenantDemo,
  plan: PlanAtelier,
  specs: readonly SpecSimulation[],
): Promise<void> {
  const existantes = await lire<{
    id: string;
    version: number;
    tirages: number;
    parametres: { hypotheses: { cible: string }[] };
  }>(
    ctx,
    `SELECT s.id, v.version, s.tirages, s.parametres FROM plan_simulations_montecarlo s
       JOIN plan_modele_versions v ON v.id = s.modele_version_id WHERE s.plan_id = $1`,
    [plan.id],
  );
  const dejaFaites = new Map(
    existantes.map((s) => [
      cleDe(
        s.version,
        s.tirages,
        s.parametres.hypotheses.map((h) => h.cible),
      ),
      s.id,
    ]),
  );
  for (const spec of specs) {
    const cle = cleDe(
      spec.version,
      spec.tirages,
      spec.hypotheses.map((h) => h.cible),
    );
    let id = dejaFaites.get(cle);
    if (!id) {
      const session: SessionDemo = plan.acteurs[spec.par];
      const r = await session.post(`/api/plans/${plan.id}/montecarlo/simulations`, {
        version: spec.version,
        tirages: spec.tirages,
        hypotheses: spec.hypotheses,
      });
      exiger(r, 201, `simulation de Monte-Carlo de « ${plan.titre} »`);
      id = r.json().id as string;
      ctx.journal(
        `      Monte-Carlo ${plan.titre} v${spec.version} : probabilité de VAN négative ${String(r.json().resultat.probabiliteVanNegative)}`,
      );
    }
    if (spec.rejeu) {
      const dejaRejoue = await existe(
        ctx,
        "SELECT 1 FROM plan_rejeux_montecarlo WHERE plan_id = $1",
        [plan.id],
      );
      if (!dejaRejoue) {
        const r = await plan.acteurs.directeur.post(
          `/api/plans/${plan.id}/montecarlo/simulations/${id}/rejeu`,
        );
        exiger(r, 200, `rejeu de la simulation de « ${plan.titre} »`);
        if (r.json().identique !== true) {
          throw new Error(`Le rejeu de la simulation de « ${plan.titre} » n'est pas identique.`);
        }
      }
    }
  }
}
