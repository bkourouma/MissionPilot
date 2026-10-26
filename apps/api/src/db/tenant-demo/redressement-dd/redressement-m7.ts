import type { ContexteTenantDemo } from "../contexte.js";
import { MISSIONS, acteursPour, etape, type MissionTrouvee } from "./commun.js";
import {
  CORRESPONDANCE_M7,
  ETAT_M7_2024,
  ETAT_M7_2025,
  REPONSES_DEPART_M7_LOT1,
  REPONSES_DEPART_M7_LOT2,
  SCORES_M7,
  URGENCES_M7,
} from "./redressement-donnees-m7.js";
import { CREANCIERS_M7 } from "./redressement-donnees-m7-creanciers.js";
import {
  CADRE_FINANCEMENT_M7,
  COVENANTS_M7,
  FINANCEMENT_M7,
  TRESORERIE_M7,
} from "./redressement-donnees-m7-tresorerie.js";
import { construireBilan } from "./redressement-cloture.js";
import {
  activerChecklist,
  repondre,
  versionCovenants,
  versionFinancement,
} from "./redressement-conformite.js";
import { creerCreanciers, jouerEvenements } from "./redressement-creanciers.js";
import {
  constituerEquipe,
  exercicesAcceptes,
  ouvrirDossier,
  poserCorrespondance,
  saisirScore,
  saisirUrgence,
} from "./redressement-diagnostic.js";
import { monde7 } from "./redressement-m7-monde.js";
import { causesM7, planLancementM7, planOctobreM7, planSuiviM7 } from "./redressement-m7-plan.js";
import {
  creer,
  dateEtatsClient,
  dateReferenceBilan,
  debutAppel,
  type Echelle,
} from "./redressement-outils.js";
import { lignesAccords, semerVersionTresorerie } from "./redressement-tresorerie.js";

/*
 * Mission 7 « Redressement — Gabon Offshore Services » (depuis le 6 juillet 2026) : dossier VIVANT
 * au 24 octobre 2026, en mise en œuvre (jamais clos) :
 *  - états financiers du client (exercices 2024 et 2025) saisis par le chef de mission dans la
 *    DEVISE DE LA MISSION (USD, lue en base, jamais écrite en dur), acceptés par les contrôles du
 *    moteur ; les données sont écrites en millions de XOF et passent par l'échelle de la devise ;
 *  - urgence élevée (voyants rouges) et score d'alerte élevé, avec les seuils « services » v2 ;
 *  - trésorerie en deux versions, réalisés jusqu'au 12 octobre et tension de trésorerie ;
 *  - un seul accord en cours d'exécution (banque), les autres créanciers en négociation ;
 *  - plan d'actions (redressement-m7-plan.ts) : version 1 validée par le directeur de la mission,
 *    version 2 en brouillon, actions terminées, en cours, bloquée et en retard d'échéance ;
 *  - check-list de départ « services » commencée, causes racines retouchées mais non validées,
 *    bilan de clôture au brouillon (incomplet : causes non validées).
 */

/** États du client : posés par ce semis seulement s'ils n'existent pas déjà. */
async function semerEtatsClient(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
  devise: string,
  echelle: Echelle,
): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementEnCours);
  const presents = await exercicesAcceptes(a.chef, mission.clientId);
  const debut = await debutAppel(ctx);
  for (const [exercice, lignes] of [
    [2024, ETAT_M7_2024],
    [2025, ETAT_M7_2025],
  ] as const) {
    if (presents.includes(exercice)) continue;
    const r = await creer(
      a.chef,
      `/api/dossiers/${mission.clientId}/etats-financiers`,
      {
        exercice,
        date_cloture: `${exercice}-12-31`,
        devise,
        source_libelle: `États financiers ${exercice} remis par le client`,
        lignes: lignes.map((x) => ({ ...x, montant: echelle(x.montant) })),
      },
      `état financier ${exercice}`,
    );
    if (r.statut !== "accepte") {
      throw new Error(`L'état financier ${exercice} n'est pas accepté : ${String(r.statut)}`);
    }
  }
  await dateEtatsClient(ctx, mission.clientId, debut, "2026-07-09");
}

async function ouvertureM7(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementEnCours);
  await etape(ctx, "redressement:m7:ouverture", async () => {
    const { mission, devise, echelle } = await monde7(ctx, false);
    await constituerEquipe(ctx, mission, [
      "consultant.2",
      "consultant.junior.2",
      "chef.mission.2",
      "expert.metier.2",
    ]);
    await semerEtatsClient(ctx, mission, devise, echelle);
    const id = await ouvrirDossier(
      ctx,
      mission,
      a.chef,
      "Redressement — Gabon Offshore Services",
      "services",
      "2026-07-08",
    );
    await poserCorrespondance(
      ctx,
      id,
      a.chef,
      CORRESPONDANCE_M7,
      "Correspondance établie avec la direction financière du client.",
      "2026-07-10",
    );
  });
}

async function diagnosticM7(ctx: ContexteTenantDemo, rang: 0 | 1): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementEnCours);
  await etape(ctx, `redressement:m7:diagnostic-${rang + 1}`, async () => {
    const { dossierId } = await monde7(ctx);
    const u = URGENCES_M7[rang];
    const s = SCORES_M7[rang];
    if (!u || !s) throw new Error("Données de diagnostic absentes.");
    await saisirUrgence(ctx, dossierId, a.chef, u.reponses, u.commentaire, u.jour);
    await saisirScore(ctx, dossierId, a.chef, s, s.jour);
  });
}

async function checklistM7(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementEnCours);
  await etape(ctx, "redressement:m7:checklist", async () => {
    const { dossierId } = await monde7(ctx);
    const liste = await activerChecklist(
      ctx,
      dossierId,
      a.consultant2,
      { origine: "depart", code: "depart_services" },
      "2026-07-20",
    );
    await repondre(ctx, dossierId, liste, a.consultant2, REPONSES_DEPART_M7_LOT1, "2026-07-22");
    await repondre(ctx, dossierId, liste, a.consultant2, REPONSES_DEPART_M7_LOT2, "2026-09-15");
  });
}

async function tresorerieM7(ctx: ContexteTenantDemo, rang: 0 | 1): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementEnCours);
  await etape(ctx, `redressement:m7:tresorerie-${rang + 1}`, async () => {
    const { dossierId, echelle } = await monde7(ctx);
    const v = TRESORERIE_M7[rang];
    if (!v) throw new Error("Trésorerie de la mission 7 absente.");
    const spec =
      rang === 1
        ? { ...v.spec, lignesSupplementaires: await lignesAccords(ctx, dossierId, v.spec.debut) }
        : v.spec;
    await semerVersionTresorerie(
      ctx,
      dossierId,
      a.chef,
      a.consultant2,
      spec,
      v.realises,
      ctx.alea.deriver(`redressement:m7:tr${rang + 1}`),
      echelle,
    );
  });
}

async function creanciersM7(ctx: ContexteTenantDemo, jusquau: string, nom: string): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementEnCours);
  await etape(ctx, `redressement:m7:${nom}`, async () => {
    const { dossierId, echelle } = await monde7(ctx);
    await creerCreanciers(ctx, a, dossierId, CREANCIERS_M7, echelle);
    await jouerEvenements(
      ctx,
      a,
      dossierId,
      CREANCIERS_M7,
      nom === "creanciers-1" ? "" : "2026-09-20",
      jusquau,
      echelle,
    );
  });
}

async function conformiteM7(ctx: ContexteTenantDemo): Promise<void> {
  const a = await acteursPour(ctx, MISSIONS.redressementEnCours);
  await etape(ctx, "redressement:m7:conformite", async () => {
    const { dossierId, echelle } = await monde7(ctx);
    await versionCovenants(
      ctx,
      dossierId,
      a.chef,
      COVENANTS_M7,
      "Engagements de ratios demandés par la banque avec l'accord de septembre.",
      "2026-09-30",
    );
    await versionFinancement(
      ctx,
      dossierId,
      a.chef,
      CADRE_FINANCEMENT_M7,
      FINANCEMENT_M7.map((x) => ({ ...x, montant: echelle(x.montant) })),
      "Plan de financement de travail, à rapprocher de la trésorerie à 13 semaines.",
      "2026-10-08",
    );
    // Bilan de clôture au brouillon (incomplet tant que les causes ne sont pas validées).
    const bilan = await construireBilan(ctx, dossierId, a.chef, "2026-10-20");
    await dateReferenceBilan(ctx, bilan.id as string);
  });
}

export async function semerM7(ctx: ContexteTenantDemo): Promise<void> {
  await ouvertureM7(ctx);
  await tresorerieM7(ctx, 0);
  await diagnosticM7(ctx, 0);
  await checklistM7(ctx);
  await creanciersM7(ctx, "2026-09-20", "creanciers-1");
  await planLancementM7(ctx);
  await tresorerieM7(ctx, 1);
  await diagnosticM7(ctx, 1);
  await creanciersM7(ctx, "2026-12-31", "creanciers-2");
  await planSuiviM7(ctx);
  await causesM7(ctx);
  await planOctobreM7(ctx);
  await conformiteM7(ctx);
}
