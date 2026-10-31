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
 *
 * Horloge réelle et date limite : le portail refuse saisie et soumission après la date limite
 * comparée au jour RÉEL (409 DATE_LIMITE_DEPASSEE, déclencheur MPQ07), alors que la date voulue
 * suit l'horloge fictive (`ctx.jour(limiteDans)`), dépassée dès que le semis tourne quelques jours
 * après `AUJOURDHUI`. Le temps des saisies, une date limite atteinte est donc levée (null, ce que
 * la route PATCH accepte tant que l'envoi n'est pas clos), puis la date fictive est reposée avant
 * la relance (texte de la notification identique) et la clôture : l'état final ne dépend pas du
 * jour d'exécution. Un envoi déjà créé avec une date dépassée (semis interrompu) est repris ainsi.
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

/**
 * Date limite à laisser en place pendant les saisies du portail, au jour réel `jourReel` (UTC) :
 * la date voulue si le portail l'accepte encore, sinon aucune (null). Une date limite égale au
 * jour réel est levée aussi : le semis dure plusieurs minutes et peut franchir minuit.
 */
export function limitePendantSaisie(limite: string | null, jourReel: string): string | null {
  return limite !== null && limite <= jourReel ? null : limite;
}

/** Date limite posée à la création (et pendant la relance) : `limiteDans` sur l'horloge fictive. */
export function limiteInitiale(
  def: Pick<DefEnvoi, "limiteDans">,
  jour: (offset: number) => string,
): string | null {
  return def.limiteDans === undefined ? null : jour(def.limiteDans);
}

/** Date limite de l'état final : la date passée voulue, sinon la date initiale. */
export function limiteFinale(
  def: Pick<DefEnvoi, "limiteDans" | "limitePassee">,
  jour: (offset: number) => string,
): string | null {
  return def.limitePassee ?? limiteInitiale(def, jour);
}

/** Jour réel du serveur PostgreSQL (UTC), celui du déclencheur MPQ07. */
async function jourReelBase(ctx: ContexteTenantDemo): Promise<string> {
  const r = await ctx.proprietaire.query<{ jour: string }>(
    "SELECT (now() AT TIME ZONE 'UTC')::date::text AS jour",
  );
  return r.rows[0]!.jour;
}

/** Jour réel retenu : le plus tardif de l'API (Node) et de la base, qui contrôlent tous deux. */
async function jourReel(ctx: ContexteTenantDemo): Promise<string> {
  const base = await jourReelBase(ctx);
  const api = new Date().toISOString().slice(0, 10);
  return base > api ? base : api;
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

/**
 * Réponses des répondants depuis le portail : brouillon commencé ou soumission. `avantSaisie`
 * est appelé une fois, juste avant la première écriture du portail (aucune si tout est déjà fait).
 */
async function repondre(
  ctx: ContexteTenantDemo,
  def: DefEnvoi,
  envoi: LigneEnvoi,
  repondants: Record<CleRepondant, Repondant>,
  avantSaisie: () => Promise<void>,
): Promise<void> {
  const alea = ctx.alea.deriver(`questionnaire-${def.cle}`);
  const profil = creerProfil(def.maturite, alea);
  const collectif = def.mode === "collectif";
  let pret = false;
  for (const r of def.repondants) {
    // Les tirages sont consommés même si la réponse existe déjà : résultat stable à la reprise.
    const complet = genererReponses(envoi.definition, profil, r.biais, alea, ctx.jour(-30));
    if (r.etat === "aucune") continue;
    const repondant = repondants[r.cle];
    const statut = await statutReponse(ctx, envoi.id, collectif, repondant.utilisateurId);
    if (statut === "soumise") continue;
    if (r.etat === "partielle" && statut !== null) continue;
    if (!pret) {
      await avantSaisie();
      pret = true;
    }
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
  const initiale = limiteInitiale(def, ctx.jour);
  let envoi = await lireEnvoi(ctx, mission.id, versionId);
  if (!envoi) {
    // La création et l'envoi ne contrôlent pas la date limite : la date fictive est posée telle
    // quelle (le texte de l'invitation la cite) ; seules les saisies du portail la contrôlent.
    const r = await session.post(`/api/missions/${mission.id}/questionnaires`, {
      version_id: versionId,
      mode: def.mode,
      repondants: def.repondants.map((x) => ({
        utilisateur_id: repondants[x.cle].utilisateurId,
        ...(def.mode === "par_fonction" ? { fonction: repondants[x.cle].fonction } : {}),
      })),
      relances_auto: def.relancesAuto ?? true,
      date_limite: initiale,
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
    const courant = envoi;
    /** Pose la date limite voulue par la route PATCH (refusée seulement sur un envoi clos). */
    const poserLimite = async (limite: string | null, quoi: string): Promise<void> => {
      if (courant.date_limite === limite) return;
      exiger(
        await session.patch(`/api/questionnaires/envois/${courant.id}`, { date_limite: limite }),
        200,
        `${quoi} de ${def.cle}`,
      );
      courant.date_limite = limite;
    };
    await repondre(ctx, def, courant, repondants, async () =>
      poserLimite(
        limitePendantSaisie(courant.date_limite, await jourReel(ctx)),
        "Date limite levée le temps des saisies",
      ),
    );
    if (def.relancer) {
      // La relance ne contrôle pas la date limite : la date fictive est reposée avant, pour que
      // le texte de la notification cite la même échéance qu'au premier passage.
      await poserLimite(initiale, "Date limite reposée avant la relance");
      await relancer(ctx, def, courant.id);
    }
    await poserLimite(limiteFinale(def, ctx.jour), "Date limite");
    if (def.clos) {
      exiger(
        await session.post(`/api/questionnaires/envois/${envoi.id}/clore`),
        200,
        `Clôture de ${def.cle}`,
      );
    }
  }
}
