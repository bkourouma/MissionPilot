import type { ContexteTenantDemo } from "../contexte.js";
import { MISSIONS, acteursPour, etape, trouverMission, type MissionTrouvee } from "./commun.js";
import {
  CORRESPONDANCE_COMPLETE,
  CORRESPONDANCE_PARTIELLE,
  REPONSES_DEPART_M3_LOT1,
  REPONSES_DEPART_M3_LOT2,
  REPONSES_MODELE_M3_LOT1,
  REPONSES_MODELE_M3_LOT2,
  SCORES_M3,
  URGENCES_M3,
} from "./redressement-donnees-m3.js";
import { CREANCIERS_M3, JOUR_FIN_ACCORDS_M3 } from "./redressement-donnees-m3-creanciers.js";
import {
  ACTIONS_M3_VAGUE_1,
  ACTIONS_M3_VAGUE_2,
  MOUVEMENTS_M3_AVANT_V3,
} from "./redressement-donnees-m3-plan.js";
import { TRESORERIE_M3 } from "./redressement-donnees-m3-tresorerie.js";
import { PRECISION_CAUSES_M3_V1 } from "./redressement-donnees-m3-finance.js";
import { CODE_MODELE_BRASSERIE } from "./redressement-donnees-parametres.js";
import {
  activerChecklist,
  genererCauses,
  repondre,
  retoucherCauses,
  validerCauses,
} from "./redressement-conformite.js";
import { creerCreanciers, jouerEvenements } from "./redressement-creanciers.js";
import {
  constituerEquipe,
  exercicesAcceptes,
  ouvrirDossier,
  passerEnMiseEnOeuvre,
  poserCorrespondance,
  saisirScore,
  saisirUrgence,
} from "./redressement-diagnostic.js";
import { creerActions, jouerMouvements, versionDePlan } from "./redressement-plan.js";
import { dossierDeMission, lire } from "./redressement-outils.js";
import { lignesAccords, semerVersionTresorerie } from "./redressement-tresorerie.js";

/*
 * Mission 3 « Redressement — Brasseries du Wouri », première moitié (mars à mai 2025 puis les
 * mouvements du plan jusqu'en septembre) : ouverture du dossier, diagnostic initial, trésorerie,
 * créanciers et accords, plan de redressement, causes racines. Les étapes sont rejouées dans
 * l'ordre fictif des dates ; chacune est marquée (une seule exécution par cabinet).
 *
 * Qui fait quoi : le chef de mission ouvre le dossier et saisit le diagnostic ; les consultants
 * renseignent check-lists, créanciers et réalisés ; le DIRECTEUR de la mission valide le plan
 * (jamais le créateur de la version) ; la cartographie des causes est demandée par le chef,
 * retouchée par la consultante junior et validée par le consultant.
 */

export interface MondeM3 {
  ctx: ContexteTenantDemo;
  mission: MissionTrouvee;
  dossierId: string;
}

export async function monde3(ctx: ContexteTenantDemo, avecDossier = true): Promise<MondeM3> {
  const mission = await trouverMission(ctx, MISSIONS.redressementTermine);
  const dossierId = avecDossier ? ((await dossierDeMission(ctx, mission.id)) ?? "") : "";
  return { ctx, mission, dossierId };
}

export async function ouvertureM3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:ouverture", async () => {
    const m = await monde3(ctx, false);
    await constituerEquipe(ctx, m.mission, [
      "consultant",
      "consultant.junior",
      "consultant.2",
      "chef.mission.2",
      "expert.metier",
    ]);
    const exercices = await exercicesAcceptes(a.chef, m.mission.clientId);
    if (!exercices.includes(2024) || !exercices.includes(2025)) {
      throw new Error("Les états financiers 2024 et 2025 du client sont absents (socle).");
    }
    const id = await ouvrirDossier(
      ctx,
      m.mission,
      a.chef,
      "Redressement — Brasseries du Wouri",
      "industrie",
      "2025-03-11",
    );
    await poserCorrespondance(ctx, id, a.chef, CORRESPONDANCE_PARTIELLE, null, "2025-03-12");
    await poserCorrespondance(
      ctx,
      id,
      a.chef,
      CORRESPONDANCE_COMPLETE,
      "Correspondance complétée après l'échange avec la direction financière.",
      "2025-03-18",
    );
  });
}

export async function diagnosticInitialM3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:diagnostic-initial", async () => {
    const { dossierId } = await monde3(ctx);
    const u = URGENCES_M3[0];
    const s = SCORES_M3[0];
    if (!u || !s) throw new Error("Données de diagnostic absentes.");
    await saisirUrgence(ctx, dossierId, a.chef, u.reponses, u.commentaire, u.jour);
    const liste = await activerChecklist(
      ctx,
      dossierId,
      a.consultant,
      { origine: "depart", code: "depart_industrie" },
      "2025-03-19",
    );
    await repondre(ctx, dossierId, liste, a.consultant, REPONSES_DEPART_M3_LOT1, "2025-03-20");
    await repondre(ctx, dossierId, liste, a.consultant, REPONSES_DEPART_M3_LOT2, "2025-03-27");
    await saisirScore(ctx, dossierId, a.chef, s, s.jour);
  });
}

export async function checklistModeleM3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:checklist-modele", async () => {
    const { dossierId } = await monde3(ctx);
    const modeles = await lire(a.consultant, "/api/redressement/checklists/modeles", "modèles");
    const modele = (modeles.modeles as { id: string; code: string }[]).find(
      (x) => x.code === CODE_MODELE_BRASSERIE,
    );
    if (!modele) throw new Error("Modèle de check-list du cabinet introuvable.");
    const liste = await activerChecklist(
      ctx,
      dossierId,
      a.junior,
      { origine: "modele", modele_id: modele.id },
      "2025-04-14",
    );
    await repondre(ctx, dossierId, liste, a.junior, REPONSES_MODELE_M3_LOT1, "2025-04-16");
    await repondre(ctx, dossierId, liste, a.junior, REPONSES_MODELE_M3_LOT2, "2025-09-30");
  });
}

export async function tresorerieV1M3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:tresorerie-v1", async () => {
    const { dossierId } = await monde3(ctx);
    const v = TRESORERIE_M3[0];
    if (!v) throw new Error("Trésorerie de la mission 3 absente.");
    await semerVersionTresorerie(
      ctx,
      dossierId,
      a.chef,
      a.consultant,
      v.spec,
      v.realises,
      ctx.alea.deriver("redressement:m3:tr1"),
    );
  });
}

export async function creanciersAvantV2M3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:creanciers-1", async () => {
    const { dossierId } = await monde3(ctx);
    await creerCreanciers(ctx, a, dossierId, CREANCIERS_M3);
    await jouerEvenements(ctx, a, dossierId, CREANCIERS_M3, "", "2025-04-22");
  });
}

export async function planVague1M3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:plan-1", async () => {
    const { dossierId } = await monde3(ctx);
    await creerActions(ctx, a, dossierId, ACTIONS_M3_VAGUE_1);
    await versionDePlan(ctx, dossierId, a.chef, "2025-04-04", {
      par: a.directeur,
      jour: "2025-04-07",
      motif: "Plan de gains rapides validé : priorité à la trésorerie.",
    });
    await passerEnMiseEnOeuvre(ctx, dossierId, a.chef, "2025-04-09");
  });
}

export async function tresorerieV2M3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:tresorerie-v2", async () => {
    const { dossierId } = await monde3(ctx);
    const v = TRESORERIE_M3[1];
    if (!v) throw new Error("Trésorerie v2 absente.");
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
      ctx.alea.deriver("redressement:m3:tr2"),
    );
  });
}

export async function causesV1M3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:causes-1", async () => {
    const { dossierId } = await monde3(ctx);
    const vue = await genererCauses(ctx, dossierId, a.chef, "2025-04-18");
    await retoucherCauses(ctx, dossierId, a.junior, vue, PRECISION_CAUSES_M3_V1, "2025-04-22");
    await validerCauses(ctx, dossierId, a.consultant, vue.id as string, "2025-04-25");
  });
}

export async function creanciersAccordsM3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:creanciers-2", async () => {
    const { dossierId } = await monde3(ctx);
    await jouerEvenements(ctx, a, dossierId, CREANCIERS_M3, "2025-04-22", JOUR_FIN_ACCORDS_M3);
  });
}

export async function diagnosticMaiM3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:diagnostic-mai", async () => {
    const { dossierId } = await monde3(ctx);
    const u = URGENCES_M3[1];
    const s = SCORES_M3[1];
    if (!u || !s) throw new Error("Données de diagnostic absentes.");
    await saisirUrgence(ctx, dossierId, a.chef, u.reponses, u.commentaire, u.jour);
    await saisirScore(ctx, dossierId, a.chef, s, s.jour);
  });
}

export async function planVague2M3(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementTermine);
  await etape(ctx, "redressement:m3:plan-2", async () => {
    const { dossierId } = await monde3(ctx);
    await creerActions(ctx, a, dossierId, ACTIONS_M3_VAGUE_2);
    await versionDePlan(ctx, dossierId, a.chef, "2025-05-26", {
      par: a.directeur,
      jour: "2025-05-28",
      motif: "Plan élargi à la restructuration : cession d'actifs et charges fixes.",
    });
    await jouerMouvements(ctx, a, dossierId, MOUVEMENTS_M3_AVANT_V3);
  });
}
