import type { ContexteTenantDemo } from "../contexte.js";
import { MISSIONS, acteursPour, etape } from "./commun.js";
import {
  RELEVE_SUIVI_JALON_1,
  RELEVE_SUIVI_JALON_2,
  SCORES_M3,
  URGENCES_M3,
} from "./redressement-donnees-m3.js";
import { CREANCIERS_M3, JOUR_FIN_ACCORDS_M3 } from "./redressement-donnees-m3-creanciers.js";
import {
  CADRE_FINANCEMENT_M3,
  COVENANTS_M3_V1,
  COVENANTS_M3_V2,
  FINANCEMENT_M3_V1,
  FINANCEMENT_M3_V2,
  PRECISION_CAUSES_M3_V2,
} from "./redressement-donnees-m3-finance.js";
import {
  ACTION_M3_SEPTEMBRE,
  MODIFICATION_M3_SEPTEMBRE,
  MOUVEMENTS_M3_APRES_V3,
} from "./redressement-donnees-m3-plan.js";
import { TRESORERIE_M3 } from "./redressement-donnees-m3-tresorerie.js";
import {
  construireBilan,
  creerPlanSuivi,
  cloreDossier,
  evenementJalon,
  genererRapportCloture,
  jalonsDuSuivi,
  saisirReleve,
  validerBilan,
} from "./redressement-cloture.js";
import {
  genererCauses,
  retoucherCauses,
  validerCauses,
  versionCovenants,
  versionFinancement,
} from "./redressement-conformite.js";
import { jouerEvenements } from "./redressement-creanciers.js";
import { saisirScore, saisirUrgence } from "./redressement-diagnostic.js";
import { monde3 } from "./redressement-m3-etapes-1.js";
import { creerActions, jouerMouvements, versionDePlan } from "./redressement-plan.js";
import { lignesAccords, semerVersionTresorerie } from "./redressement-tresorerie.js";

/*
 * Mission 3 « Redressement — Brasseries du Wouri », seconde moitié (juin à novembre 2025, puis
 * le suivi post-mission jusqu'en octobre 2026) : paiements des accords, covenants, trésorerie en
 * fenêtre glissante, plan de financement, diagnostic de fin, troisième version du plan, bilan de
 * clôture validé par le directeur, clôture du dossier, rapport de clôture et suivi.
 */

export async function paiementsM3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:paiements", async () => {
    const { dossierId } = await monde3(ctx);
    await jouerEvenements(ctx, a, dossierId, CREANCIERS_M3, JOUR_FIN_ACCORDS_M3, "2025-12-31");
  });
}

export async function covenantsV1M3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:covenants-1", async () => {
    const { dossierId } = await monde3(ctx);
    await versionCovenants(
      ctx,
      dossierId,
      a.chef,
      COVENANTS_M3_V1,
      "Engagements de ratios proposés par la banque dans le cadre de l'accord d'étalement.",
      "2025-06-05",
    );
  });
}

export async function tresorerieV3M3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:tresorerie-v3", async () => {
    const { dossierId } = await monde3(ctx);
    const v = TRESORERIE_M3[2];
    if (!v) throw new Error("Trésorerie v3 absente.");
    const spec = {
      ...v.spec,
      lignesSupplementaires: await lignesAccords(ctx, dossierId, v.spec.debut),
    };
    await semerVersionTresorerie(
      ctx,
      dossierId,
      a.chef2,
      a.consultant2,
      spec,
      v.realises,
      ctx.alea.deriver("redressement:m3:tr3"),
    );
  });
}

export async function financementV1M3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:financement-1", async () => {
    const { dossierId } = await monde3(ctx);
    await versionFinancement(
      ctx,
      dossierId,
      a.chef,
      CADRE_FINANCEMENT_M3,
      FINANCEMENT_M3_V1,
      "Plan de financement initial sur trois ans.",
      "2025-07-08",
    );
  });
}

export async function diagnosticJuilletM3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:diagnostic-juillet", async () => {
    const { dossierId } = await monde3(ctx);
    const u = URGENCES_M3[2];
    const s = SCORES_M3[2];
    if (!u || !s) throw new Error("Données de diagnostic absentes.");
    await saisirUrgence(ctx, dossierId, a.chef, u.reponses, u.commentaire, u.jour);
    await saisirScore(ctx, dossierId, a.chef, s, s.jour);
  });
}

export async function tresorerieV4M3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:tresorerie-v4", async () => {
    const { dossierId } = await monde3(ctx);
    const v = TRESORERIE_M3[3];
    if (!v) throw new Error("Trésorerie v4 absente.");
    const spec = {
      ...v.spec,
      lignesSupplementaires: await lignesAccords(ctx, dossierId, v.spec.debut),
    };
    await semerVersionTresorerie(
      ctx,
      dossierId,
      a.chef,
      a.consultant,
      spec,
      v.realises,
      ctx.alea.deriver("redressement:m3:tr4"),
    );
  });
}

export async function planVersion3M3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:plan-3", async () => {
    const { dossierId } = await monde3(ctx);
    await jouerMouvements(ctx, a, dossierId, [MODIFICATION_M3_SEPTEMBRE]);
    await creerActions(ctx, a, dossierId, [ACTION_M3_SEPTEMBRE]);
    await versionDePlan(ctx, dossierId, a.chef, "2025-09-08", {
      par: a.directeur,
      jour: "2025-09-10",
      motif: "Plan mis à jour : une action abandonnée, un report, une action de formation.",
    });
    await jouerMouvements(ctx, a, dossierId, MOUVEMENTS_M3_APRES_V3);
  });
}

export async function causesV2M3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:causes-2", async () => {
    const { dossierId } = await monde3(ctx);
    const vue = await genererCauses(ctx, dossierId, a.chef2, "2025-09-15");
    await retoucherCauses(ctx, dossierId, a.consultant2, vue, PRECISION_CAUSES_M3_V2, "2025-09-17");
    await validerCauses(ctx, dossierId, a.consultant, vue.id as string, "2025-09-19");
  });
}

export async function conformiteFinM3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:conformite-fin", async () => {
    const { dossierId } = await monde3(ctx);
    await versionCovenants(
      ctx,
      dossierId,
      a.chef,
      COVENANTS_M3_V2,
      "Seuil d'endettement relevé à la suite de la renégociation avec la banque.",
      "2025-09-22",
    );
    await versionFinancement(
      ctx,
      dossierId,
      a.chef,
      CADRE_FINANCEMENT_M3,
      FINANCEMENT_M3_V2,
      "Plan actualisé : cession encaissée, accords soldés.",
      "2025-10-06",
    );
  });
}

export async function diagnosticFinM3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:diagnostic-fin", async () => {
    const { dossierId } = await monde3(ctx);
    const u4 = URGENCES_M3[3];
    const u5 = URGENCES_M3[4];
    const s4 = SCORES_M3[3];
    if (!u4 || !u5 || !s4) throw new Error("Données de diagnostic absentes.");
    await saisirUrgence(ctx, dossierId, a.chef, u4.reponses, u4.commentaire, u4.jour);
    await saisirScore(ctx, dossierId, a.chef, s4, s4.jour);
    await saisirUrgence(ctx, dossierId, a.chef, u5.reponses, u5.commentaire, u5.jour);
  });
}

/** Bilan, validation par le directeur, clôture, rapport de clôture (novembre 2025). */
export async function clotureM3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:cloture", async () => {
    const { dossierId, mission } = await monde3(ctx);
    const bilan = await construireBilan(ctx, dossierId, a.chef, "2025-11-11");
    const bilanId = bilan.id as string;
    await validerBilan(
      ctx,
      dossierId,
      a.directeur,
      bilanId,
      "Objectifs du redressement atteints : trésorerie rétablie, accords soldés.",
      "2025-11-12",
    );
    await cloreDossier(
      ctx,
      dossierId,
      a.directeur,
      "Objectifs atteints : trésorerie rétablie, accords soldés, plan exécuté.",
      "2025-11-14",
    );
    await genererRapportCloture(ctx, mission.id, bilanId, a.directeur, "2025-11-14");
  });
}

/** Suivi post-mission : jalons à 6 et 12 mois après la clôture du 14 novembre 2025. */
export async function suiviM3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:suivi", async () => {
    const { dossierId } = await monde3(ctx);
    await creerPlanSuivi(ctx, dossierId, a.chef, "2025-11-17");
    const jalons = await jalonsDuSuivi(a.chef, dossierId);
    const j1 = jalons.find((j) => j.rang === 1);
    const j2 = jalons.find((j) => j.rang === 2);
    if (!j1 || !j2) throw new Error("Le plan de suivi n'a pas produit deux jalons.");
    await saisirReleve(ctx, dossierId, a.consultant, j1.id, RELEVE_SUIVI_JALON_1, "2026-05-12");
    await evenementJalon(
      ctx,
      dossierId,
      a.chef,
      j1.id,
      {
        type: "reporte",
        dateEffet: "2026-05-29",
        motif: "Comptes semestriels du client remis avec deux semaines de retard.",
      },
      "2026-05-13",
    );
    await evenementJalon(
      ctx,
      dossierId,
      a.chef,
      j1.id,
      { type: "realise", dateEffet: "2026-05-28" },
      "2026-05-28",
    );
    await saisirReleve(ctx, dossierId, a.consultant2, j2.id, RELEVE_SUIVI_JALON_2, "2026-10-15");
  });
}
