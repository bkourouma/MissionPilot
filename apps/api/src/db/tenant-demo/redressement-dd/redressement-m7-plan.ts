import type { ContexteTenantDemo } from "../contexte.js";
import { MISSIONS, acteursPour, etape } from "./commun.js";
import {
  ACTIONS_M7_VAGUE_1,
  ACTIONS_M7_VAGUE_2,
  JOUR_MISE_EN_OEUVRE_M7,
  JOUR_PLAN_V1_M7,
  JOUR_PLAN_V2_M7,
  JOUR_VALIDATION_PLAN_V1_M7,
  MOUVEMENTS_M7,
  PRECISION_CAUSES_M7,
} from "./redressement-donnees-m7-plan.js";
import { genererCauses, retoucherCauses } from "./redressement-conformite.js";
import { passerEnMiseEnOeuvre } from "./redressement-diagnostic.js";
import { monde7 } from "./redressement-m7-monde.js";
import { creerActions, jouerMouvements, versionDePlan } from "./redressement-plan.js";

/*
 * Mission 7 « Redressement — Gabon Offshore Services » : plan d'actions et causes racines, en
 * étapes distinctes (une étape = un thème), toutes passées par les routes.
 *  - lancement : quatre gains rapides, version 1 du plan créée par le chef de mission puis VALIDÉE
 *    par le directeur de la mission (jamais le créateur), dossier « plan validé » puis « mise en
 *    œuvre » ;
 *  - suivi : actions de la suite du plan et mouvements du kanban jusqu'au 5 octobre, puis version 2
 *    du plan laissée en BROUILLON (révision en cours, non soumise au directeur) ;
 *  - octobre : derniers mouvements du kanban (les actions en retard d'échéance restent ouvertes) ;
 *  - causes : cartographie fabriquée par le gabarit (brouillon IA), retouchée par une consultante
 *    qui n'est pas la demandeuse (statut « modifié »), jamais validée.
 */

const AVANT = (jour: string) => (m: { jour: string }) => m.jour <= jour;

/** Juillet et début août : actions de lancement, plan v1 validé, mise en œuvre. */
export async function planLancementM7(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementEnCours);
  await etape(ctx, "redressement:m7:plan-lancement", async () => {
    const { dossierId, echelle } = await monde7(ctx);
    await creerActions(ctx, a, dossierId, ACTIONS_M7_VAGUE_1, echelle);
    await jouerMouvements(ctx, a, dossierId, MOUVEMENTS_M7.filter(AVANT(JOUR_PLAN_V1_M7)));
    await versionDePlan(ctx, dossierId, a.chef, JOUR_PLAN_V1_M7, {
      par: a.directeur,
      jour: JOUR_VALIDATION_PLAN_V1_M7,
      motif: "Plan de gains rapides validé : priorité à la trésorerie et aux relances clients.",
    });
    await passerEnMiseEnOeuvre(ctx, dossierId, a.chef, JOUR_MISE_EN_OEUVRE_M7);
  });
}

/** Août à début octobre : suite du plan, mouvements du kanban, version 2 en brouillon. */
export async function planSuiviM7(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementEnCours);
  await etape(ctx, "redressement:m7:plan-suivi", async () => {
    const { dossierId, echelle } = await monde7(ctx);
    await creerActions(ctx, a, dossierId, ACTIONS_M7_VAGUE_2, echelle);
    const mouvements = MOUVEMENTS_M7.filter(
      (m) => m.jour > JOUR_PLAN_V1_M7 && m.jour <= JOUR_PLAN_V2_M7,
    );
    await jouerMouvements(ctx, a, dossierId, mouvements);
    await versionDePlan(ctx, dossierId, a.chef, JOUR_PLAN_V2_M7);
  });
}

/** Octobre : derniers mouvements du kanban, après la création de la version 2. */
export async function planOctobreM7(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementEnCours);
  await etape(ctx, "redressement:m7:plan-octobre", async () => {
    const { dossierId } = await monde7(ctx);
    await jouerMouvements(
      ctx,
      a,
      dossierId,
      MOUVEMENTS_M7.filter((m) => m.jour > JOUR_PLAN_V2_M7),
    );
  });
}

/** Causes racines : brouillon IA (gabarit) le 25 septembre, retouché le 2 octobre, non validé. */
export async function causesM7(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementEnCours);
  await etape(ctx, "redressement:m7:causes", async () => {
    const { dossierId } = await monde7(ctx);
    const vue = await genererCauses(ctx, dossierId, a.chef2, "2026-09-25");
    await retoucherCauses(ctx, dossierId, a.consultant2, vue, PRECISION_CAUSES_M7, "2026-10-02");
  });
}
