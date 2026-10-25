import type { DefinitionQuestionnaire } from "@missionpilot/engines";
import type { CleCompteCabinet } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { CASTING, trouverMission, type MissionCasting } from "./casting.js";
import { exiger, existe, lire } from "./outils.js";
import { versionDe } from "./questionnaires-modeles.js";
import type { CleRepondant, Repondant } from "./questionnaires-portail.js";
import { creerProfil, debut, genererReponses } from "./questionnaires-reponses.js";

/*
 * Envois de questionnaires aux répondants du portail client. Chaque envoi suit le vrai circuit :
 * création en brouillon, envoi, saisie puis soumission par les répondants depuis le portail,
 * relance manuelle, prolongation ou date limite, clôture. Reprise idempotente : la clé naturelle
 * d'un envoi est (mission, version de questionnaire) et chaque étape vérifie l'état déjà atteint.
 * Les dates des écritures sont celles de l'horloge réelle du serveur (les routes ne laissent
 * pas antidater un envoi ni une soumission) ; seules les dates limites suivent l'horloge fictive.
 */

type EtatReponse = "soumise" | "partielle" | "aucune";

export interface DefEnvoi {
  /** Clé stable de l'envoi (dérive le hasard à graine). */
  cle: string;
  mission: MissionCasting;
  modele: string;
  version: number;
  mode: "individuel" | "collectif" | "par_fonction";
  /** Compte du cabinet qui crée et envoie (questionnaire.gerer, mission visible). */
  par: CleCompteCabinet;
  /** Faux : l'envoi reste en brouillon (préparé, pas encore adressé). */
  envoye: boolean;
  /** Date limite à venir, en jours après aujourd'hui (posée à la création). */
  limiteDans?: number;
  /** Date limite passée (ISO), posée après les réponses : la soumission est refusée une fois dépassée. */
  limitePassee?: string;
  relancesAuto?: boolean;
  /** Maturité visée des réponses (0 à 1) : utile aux questionnaires de notation. */
  maturite: number;
  repondants: { cle: CleRepondant; etat: EtatReponse; fraction?: number; biais: number }[];
  /** Relance manuelle des répondants qui n'ont pas soumis. */
  relancer?: boolean;
  clos: boolean;
}

export const ENVOIS: readonly DefEnvoi[] = [
  /* --- Missions clôturées --- */
  {
    cle: "sicafe-preliminaire",
    mission: CASTING.sicafe,
    modele: "preliminaire_dirigeants",
    version: 1,
    mode: "par_fonction",
    par: "directeur.mission",
    envoye: true,
    limitePassee: "2024-11-22",
    maturite: 0.6,
    repondants: [
      { cle: "sicafe.dg", etat: "soumise", biais: 0.08 },
      { cle: "sicafe.daf", etat: "soumise", biais: -0.04 },
    ],
    clos: true,
  },
  {
    cle: "sicafe-satisfaction",
    mission: CASTING.sicafe,
    modele: "satisfaction-client",
    version: 1,
    mode: "individuel",
    par: "directeur.mission",
    envoye: true,
    limitePassee: "2025-05-16",
    maturite: 0.78,
    repondants: [
      { cle: "sicafe.dg", etat: "soumise", biais: 0.06 },
      { cle: "sicafe.daf", etat: "soumise", biais: -0.05 },
    ],
    clos: true,
  },
  {
    // Questionnaire de NOTATION de la mission 2 : trois répondants, tous soumis, envoi clos.
    cle: "coton-notation",
    mission: CASTING.sahelCoton,
    modele: "notation_generique",
    version: 1,
    mode: "par_fonction",
    par: "directeur.mission",
    envoye: true,
    limitePassee: "2025-03-14",
    maturite: 0.52,
    repondants: [
      { cle: "coton.dg", etat: "soumise", biais: 0.12 },
      { cle: "coton.daf", etat: "soumise", biais: -0.03 },
      { cle: "coton.production", etat: "soumise", biais: -0.08 },
    ],
    clos: true,
  },
  {
    cle: "coton-satisfaction",
    mission: CASTING.sahelCoton,
    modele: "satisfaction-client",
    version: 1,
    mode: "individuel",
    par: "associe",
    envoye: true,
    limitePassee: "2025-06-27",
    maturite: 0.7,
    repondants: [
      { cle: "coton.dg", etat: "soumise", biais: 0.05 },
      { cle: "coton.daf", etat: "soumise", biais: 0 },
      { cle: "coton.production", etat: "aucune", biais: 0 },
    ],
    clos: true,
  },
  /* --- Missions en cours --- */
  {
    // Questionnaire de NOTATION de la mission 9 (version 2 du modèle) : collecte terminée, envoi clos.
    cle: "banque-notation",
    mission: CASTING.banqueSahel,
    modele: "notation_generique",
    version: 2,
    mode: "par_fonction",
    par: "directeur.mission.2",
    envoye: true,
    limitePassee: "2026-09-25",
    maturite: 0.66,
    repondants: [
      { cle: "banque.dg", etat: "soumise", biais: 0.1 },
      { cle: "banque.controle", etat: "soumise", biais: -0.04 },
      { cle: "banque.risques", etat: "soumise", biais: -0.02 },
    ],
    clos: true,
  },
  {
    // Réponse collective commencée, jamais soumise, relancée.
    cle: "banque-diagnostic-financier",
    mission: CASTING.banqueSahel,
    modele: "diagnostic-financier",
    version: 1,
    mode: "collectif",
    par: "directeur.mission.2",
    envoye: true,
    limiteDans: 9,
    maturite: 0.6,
    repondants: [
      { cle: "banque.controle", etat: "partielle", fraction: 0.6, biais: 0 },
      { cle: "banque.risques", etat: "aucune", biais: 0 },
    ],
    relancer: true,
    clos: false,
  },
  {
    cle: "baobab-preliminaire",
    mission: CASTING.baobab,
    modele: "preliminaire_dirigeants",
    version: 1,
    mode: "par_fonction",
    par: "directeur.mission",
    envoye: true,
    limiteDans: 6,
    maturite: 0.62,
    repondants: [
      { cle: "baobab.dg", etat: "soumise", biais: 0.07 },
      { cle: "baobab.technique", etat: "partielle", fraction: 0.5, biais: 0 },
      { cle: "baobab.rh", etat: "aucune", biais: 0 },
    ],
    relancer: true,
    clos: false,
  },
  {
    // Tout juste adressé : personne n'a encore commencé.
    cle: "baobab-climat",
    mission: CASTING.baobab,
    modele: "climat-social",
    version: 1,
    mode: "individuel",
    par: "directeur.mission.2",
    envoye: true,
    limiteDans: 14,
    maturite: 0.55,
    repondants: [
      { cle: "baobab.dg", etat: "aucune", biais: 0 },
      { cle: "baobab.technique", etat: "aucune", biais: 0 },
      { cle: "baobab.rh", etat: "aucune", biais: 0 },
    ],
    clos: false,
  },
  {
    // Modèle proposé par l'IA et validé par un consultant : préparé, pas encore envoyé.
    cle: "baobab-execution",
    mission: CASTING.baobab,
    modele: "diagnostic-execution-ia",
    version: 1,
    mode: "individuel",
    par: "directeur.mission",
    envoye: false,
    limiteDans: 21,
    maturite: 0.6,
    repondants: [
      { cle: "baobab.dg", etat: "aucune", biais: 0 },
      { cle: "baobab.technique", etat: "aucune", biais: 0 },
    ],
    clos: false,
  },
];

interface LigneEnvoi extends Record<string, unknown> {
  id: string;
  statut: string;
  date_limite: string | null;
  definition: DefinitionQuestionnaire;
}

async function lireEnvoi(
  ctx: ContexteTenantDemo,
  missionId: string,
  versionId: string,
): Promise<LigneEnvoi | undefined> {
  return (
    await lire<LigneEnvoi>(
      ctx,
      `SELECT id, statut, date_limite::text AS date_limite, definition FROM questionnaire_envois
        WHERE cabinet_id = $1 AND mission_id = $2 AND version_id = $3`,
      [ctx.cabinetId, missionId, versionId],
    )
  )[0];
}

async function statutReponse(
  ctx: ContexteTenantDemo,
  envoiId: string,
  collectif: boolean,
  utilisateurId: string,
): Promise<string | null> {
  const l = await lire<{ statut: string }>(
    ctx,
    collectif
      ? "SELECT statut FROM questionnaire_reponses WHERE envoi_id = $1 AND repondant_id IS NULL"
      : `SELECT q.statut FROM questionnaire_reponses q
           JOIN questionnaire_repondants r ON r.id = q.repondant_id
          WHERE q.envoi_id = $1 AND r.utilisateur_id = $2`,
    collectif ? [envoiId] : [envoiId, utilisateurId],
  );
  return l[0]?.statut ?? null;
}

/** Réponses des répondants depuis le portail : brouillon commencé ou soumission. */
async function repondre(
  ctx: ContexteTenantDemo,
  def: DefEnvoi,
  envoi: LigneEnvoi,
  repondants: Record<CleRepondant, Repondant>,
): Promise<void> {
  const alea = ctx.alea.deriver(`questionnaire-${def.cle}`);
  const profil = creerProfil(def.maturite, alea);
  const collectif = def.mode === "collectif";
  for (const r of def.repondants) {
    // Les tirages sont consommés même si la réponse existe déjà : résultat stable à la reprise.
    const complet = genererReponses(envoi.definition, profil, r.biais, alea, ctx.jour(-30));
    if (r.etat === "aucune") continue;
    const repondant = repondants[r.cle];
    const statut = await statutReponse(ctx, envoi.id, collectif, repondant.utilisateurId);
    if (statut === "soumise") continue;
    if (r.etat === "partielle" && statut !== null) continue;
    const saisie = r.etat === "soumise" ? complet : debut(complet, r.fraction ?? 0.5);
    const patch = await repondant.session.patch(
      `/api/portail/questionnaires/${envoi.id}/reponses`,
      { reponses: saisie },
    );
    exiger(patch, 200, `Saisie de ${r.cle} (${def.cle})`);
    if (r.etat === "soumise") {
      const soumis = await repondant.session.post(
        `/api/portail/questionnaires/${envoi.id}/soumettre`,
      );
      exiger(soumis, 200, `Soumission de ${r.cle} (${def.cle})`);
    }
  }
}

async function relancer(ctx: ContexteTenantDemo, def: DefEnvoi, envoiId: string): Promise<void> {
  if (await existe(ctx, "SELECT 1 FROM questionnaire_relances WHERE envoi_id = $1", [envoiId]))
    return;
  const r = await ctx.session(def.par).post(`/api/questionnaires/envois/${envoiId}/relancer`, {});
  exiger(r, 200, `Relance (${def.cle})`);
}

/** Crée, envoie, fait répondre, relance et clôt un envoi ; reprend là où un passage précédent s'est arrêté. */
export async function assurerEnvoi(
  ctx: ContexteTenantDemo,
  def: DefEnvoi,
  repondants: Record<CleRepondant, Repondant>,
): Promise<void> {
  const mission = await trouverMission(ctx, def.mission);
  const versionId = await versionDe(ctx, def.modele, def.version);
  const session = ctx.session(def.par);
  let envoi = await lireEnvoi(ctx, mission.id, versionId);
  if (!envoi) {
    const r = await session.post(`/api/missions/${mission.id}/questionnaires`, {
      version_id: versionId,
      mode: def.mode,
      repondants: def.repondants.map((x) => ({
        utilisateur_id: repondants[x.cle].utilisateurId,
        ...(def.mode === "par_fonction" ? { fonction: repondants[x.cle].fonction } : {}),
      })),
      relances_auto: def.relancesAuto ?? true,
      date_limite: def.limiteDans === undefined ? null : ctx.jour(def.limiteDans),
    });
    exiger(r, 201, `Envoi ${def.cle}`);
    envoi = await lireEnvoi(ctx, mission.id, versionId);
  }
  if (!envoi) throw new Error(`Envoi ${def.cle} introuvable après création.`);
  if (def.envoye && envoi.statut === "brouillon") {
    exiger(
      await session.post(`/api/questionnaires/envois/${envoi.id}/envoyer`),
      200,
      `Envoi de ${def.cle}`,
    );
    envoi = (await lireEnvoi(ctx, mission.id, versionId)) as LigneEnvoi;
  }
  if (envoi.statut === "envoye") {
    await repondre(ctx, def, envoi, repondants);
    if (def.relancer) await relancer(ctx, def, envoi.id);
    if (def.limitePassee && envoi.date_limite !== def.limitePassee) {
      exiger(
        await session.patch(`/api/questionnaires/envois/${envoi.id}`, {
          date_limite: def.limitePassee,
        }),
        200,
        `Date limite de ${def.cle}`,
      );
    }
    if (def.clos) {
      exiger(
        await session.post(`/api/questionnaires/envois/${envoi.id}/clore`),
        200,
        `Clôture de ${def.cle}`,
      );
    }
  }
}
