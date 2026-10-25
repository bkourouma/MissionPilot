import type { ContexteTenantDemo } from "../contexte.js";
import { exiger, existe, lire } from "./outils.js";
import type { PlanAtelier } from "./plans-avances-ateliers.js";

/*
 * Plan vivant (PLA-18) : réalisés trimestriels versionnés puis re-prévisions du moteur, par les
 * VRAIES routes (saisie par le consultant, re-prévision et explication par le chef de mission).
 *
 * Les réalisés sont des SAISIES du client (comptes trimestriels) : ils sont dérivés du modèle validé
 * du plan (part saisonnière du trimestre × un facteur d'écart propre au trimestre), avec des entiers
 * et sans hasard. Les écarts, la décomposition de l'EBE et la re-prévision sont ceux du moteur.
 * Chaque re-prévision est créée juste après le trimestre qu'elle couvre (les réalisés courants à cet
 * instant) ; l'explication IA reste en brouillon, ou retouchée par le consultant (« modifié »), jamais
 * validée d'office. Idempotent : réalisé par (exercice, trimestre), re-prévision par (exercice,
 * dernier trimestre, méthode), explication par re-prévision.
 */

type Methode = "reste_du_plan" | "tendance";
type Repartition = readonly [number, number, number, number];

export interface SpecExercice {
  exercice: number;
  /** Écart du chiffre d'affaires et de l'EBE réalisés au prévu du trimestre (1 = conforme). */
  facteursCa: readonly number[];
  facteursEbe: readonly number[];
  commentaires: readonly (string | null)[];
  /** Correction d'un trimestre après clôture des comptes (nouvelle version du réalisé). */
  correction?: { trimestre: number; deltaCa: number; deltaEbe: number; commentaire: string };
  reprevisions: readonly {
    apres: number;
    methode: Methode;
    explication?: "brouillon" | "modifie";
  }[];
}

export interface SpecPlanVivant {
  version: number;
  repartition?: Repartition;
  seuil: number;
  exercices: readonly SpecExercice[];
}

interface AnneeModele {
  exercice: number;
  compteResultat: {
    chiffreAffaires: number;
    excedentBrutExploitation: number;
    resultatNet: number;
  };
  fluxTresorerie: { tresorerieOuverture: number; tresorerieCloture: number };
}

interface Realise {
  chiffre_affaires: number;
  ebe: number;
  resultat_net: number;
  tresorerie_fin: number;
  commentaire: string | null;
}

const REPARTITION_DEFAUT: Repartition = [250, 250, 250, 250];

/** Réalisés d'un exercice (initial, et final après correction éventuelle), dérivés du prévu. */
export function realisesDe(
  prevu: AnneeModele,
  ouverture: number,
  spec: SpecExercice,
  repartition: Repartition,
): { initial: Realise[]; final: Realise[] } {
  const cr = prevu.compteResultat;
  const chargesHorsEbe = cr.excedentBrutExploitation - cr.resultatNet;
  const variation =
    prevu.fluxTresorerie.tresorerieCloture - prevu.fluxTresorerie.tresorerieOuverture;
  const initial: Realise[] = [];
  let part = 0;
  let ecartCumule = 0;
  spec.facteursCa.forEach((fCa, i) => {
    const p = (repartition[i] as number) / 1000;
    part += p;
    const ebePrevu = cr.excedentBrutExploitation * p;
    const ebe = Math.round(ebePrevu * (spec.facteursEbe[i] as number));
    ecartCumule += (ebe - ebePrevu) * 0.6;
    initial.push({
      chiffre_affaires: Math.round(cr.chiffreAffaires * p * fCa),
      ebe,
      resultat_net: ebe - Math.round(chargesHorsEbe * p),
      tresorerie_fin: Math.round(ouverture + variation * part + ecartCumule),
      commentaire: spec.commentaires[i] ?? null,
    });
  });
  const c = spec.correction;
  const final = initial.map((r, i) => {
    if (!c || c.trimestre !== i + 1) return r;
    const ebe = Math.round(r.ebe * (1 + c.deltaEbe));
    return {
      chiffre_affaires: Math.round(r.chiffre_affaires * (1 + c.deltaCa)),
      ebe,
      resultat_net: r.resultat_net + (ebe - r.ebe),
      tresorerie_fin: r.tresorerie_fin + Math.round((ebe - r.ebe) * 0.6),
      commentaire: c.commentaire,
    };
  });
  return { initial, final };
}

async function explication(
  ctx: ContexteTenantDemo,
  plan: PlanAtelier,
  revId: string,
  mode: "brouillon" | "modifie",
) {
  const deja = await existe(
    ctx,
    "SELECT 1 FROM ia_demandes WHERE entite_type = 'plan_reprevision' AND entite_id = $1",
    [revId],
  );
  if (deja) return;
  const s = plan.acteurs.chef;
  const r = await s.post(`/api/plans/${plan.id}/reprevisions/${revId}/explication`, {});
  exiger(r, 201, `explication IA de la re-prévision de « ${plan.titre} »`);
  if (mode === "modifie") {
    const vue = r.json().explication as { id: string; texte: string };
    const m = await s.post(`/api/ia/generations/${vue.id}/modifier`, {
      texte: `${vue.texte}\n\nRelecture du chef de mission : les écarts de marge tiennent surtout au coût des intrants et aux retards de livraison constatés sur la période ; un point d'étape avec la direction financière est prévu.`,
    });
    exiger(m, 200, `retouche de l'explication de la re-prévision de « ${plan.titre} »`);
  }
}

/** Saisit les réalisés et lance les re-prévisions d'un plan, exercice après exercice. */
export async function jouerPlanVivant(
  ctx: ContexteTenantDemo,
  plan: PlanAtelier,
  spec: SpecPlanVivant,
): Promise<void> {
  const [modele] = await lire<{ annees: AnneeModele[] }>(
    ctx,
    `SELECT resultat->'base'->'annees' AS annees FROM plan_modele_versions
      WHERE plan_id = $1 AND version = $2`,
    [plan.id, spec.version],
  );
  if (!modele)
    throw new Error(`Version ${spec.version} du modèle introuvable pour « ${plan.titre} ».`);
  const repartition = spec.repartition ?? REPARTITION_DEFAUT;
  let ouvertureReelle: number | null = null;
  for (const ex of spec.exercices) {
    const prevu = modele.annees.find((a) => a.exercice === ex.exercice);
    if (!prevu)
      throw new Error(`Exercice ${ex.exercice} hors horizon du modèle de « ${plan.titre} ».`);
    const ouverture = ouvertureReelle ?? prevu.fluxTresorerie.tresorerieOuverture;
    const { initial, final } = realisesDe(prevu, ouverture, ex, repartition);
    for (let t = 1; t <= initial.length; t++) {
      const [v] = await lire<{ version: number }>(
        ctx,
        `SELECT coalesce(max(version), 0)::int AS version FROM plan_realises
          WHERE plan_id = $1 AND exercice = $2 AND trimestre = $3`,
        [plan.id, ex.exercice, t],
      );
      const url = `/api/plans/${plan.id}/realises/${ex.exercice}/${t}`;
      const saisir = async (corps: Realise, quoi: string) =>
        exiger(
          await plan.acteurs.consultant.put(url, corps),
          200,
          `réalisé ${ex.exercice} T${t} (${quoi})`,
        );
      let version = v?.version ?? 0;
      if (version === 0) {
        await saisir(initial[t - 1] as Realise, "saisie");
        version = 1;
      }
      if (ex.correction?.trimestre === t && version === 1) {
        await saisir(final[t - 1] as Realise, "correction");
      }
      for (const rp of ex.reprevisions.filter((x) => x.apres === t)) {
        await reprevoir(ctx, plan, spec, ex.exercice, rp);
      }
    }
    ouvertureReelle = (final[final.length - 1] as Realise).tresorerie_fin;
  }
}

async function reprevoir(
  ctx: ContexteTenantDemo,
  plan: PlanAtelier,
  spec: SpecPlanVivant,
  exercice: number,
  rp: SpecExercice["reprevisions"][number],
) {
  const [existante] = await lire<{ id: string }>(
    ctx,
    `SELECT id FROM plan_reprevisions
      WHERE plan_id = $1 AND exercice = $2 AND dernier_trimestre = $3 AND methode = $4`,
    [plan.id, exercice, rp.apres, rp.methode],
  );
  let id = existante?.id;
  if (!id) {
    const r = await plan.acteurs.chef.post(`/api/plans/${plan.id}/reprevisions`, {
      version: spec.version,
      exercice,
      methode: rp.methode,
      seuil: spec.seuil,
      ...(spec.repartition ? { repartition: spec.repartition } : {}),
    });
    exiger(r, 201, `re-prévision ${exercice} T${rp.apres} de « ${plan.titre} »`);
    id = r.json().id as string;
    ctx.journal(`      re-prévision ${plan.titre} ${exercice} après T${rp.apres} (${rp.methode})`);
  }
  if (rp.explication) await explication(ctx, plan, id, rp.explication);
}
