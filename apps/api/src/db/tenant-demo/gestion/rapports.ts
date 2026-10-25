import { ajouterJours } from "@missionpilot/engines";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { ecartJours } from "../horloge.js";
import {
  CLIENT_DE_MISSION,
  MISSIONS_EN_COURS,
  MISSIONS_TERMINEES,
  type Casting,
  type CleMission,
  type MissionLue,
} from "./casting.js";
import {
  COMMENTAIRE_ETAT_FINANCIER,
  FRACTION_MI_PARCOURS,
  FRACTIONS_EN_COURS,
  PARAMETRES_RAPPORTS,
} from "./donnees-rapports.js";
import { semerAvancementHebdo } from "./rapports-avancement.js";
import { formatDuRang, genererRapport, sessionDe } from "./rapports-outils.js";
import { ok } from "./outils.js";

/*
 * MODULE RAPPORTS de la phase `gestion` du Tenant démo (SOC-07, rapports générés). Tout passe par
 * les routes réelles, rendu déterministe, chiffres du moteur :
 *  1. paramètres de rapport du cabinet (conservation 5 ans, mention de l'IA) par l'associé ;
 *  2. rapports d'état d'avancement : trois par mission en cours (étalés depuis le démarrage, chef de
 *     mission), deux par mission terminée (mi-parcours par le chef, synthèse finale par un associé :
 *     niveau « finance ») ;
 *  3. rapports de services, SEULEMENT si leur source existe (notation publiée, plan, modèle financier
 *     validé, états acceptés du dossier) : une source absente ou un refus de l'autre domaine donne
 *     un avertissement `ctx.journal`, jamais un échec ;
 *  4. rapports d'avancement hebdomadaires (circuit chef -> directeur) : rapports-avancement.ts.
 * Hors périmètre : note au comité de la due diligence (0508) et rapport de clôture du redressement
 * (0551), semés par le lot 4. Une mission clôturée refuse la génération : elle est sautée.
 * Idempotent : clé naturelle (mission, modèle, source, jour de génération). Les dates sont
 * remontées par SQL (rapports-outils.ts) ; le contenu reste celui du jour (limite assumée).
 */

const hors = (
  m: MissionLue | undefined,
  ctx: ContexteTenantDemo,
  quoi: string,
): m is MissionLue => {
  if (!m || m.statut === "cloturee") {
    ctx.journal(`  [rapports] ${quoi} : mission absente ou clôturée, sautée.`);
    return false;
  }
  return true;
};

async function parametres(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");
  const actuels = await associe.get("/api/rapports/parametres");
  ok(200, actuels, "lecture des paramètres de rapport");
  if (actuels.json().par_defaut === false) return;
  ok(
    200,
    await associe.put("/api/rapports/parametres", PARAMETRES_RAPPORTS),
    "paramètres de rapport",
  );
}

/**
 * Session de l'associé de la mission (membre de l'équipe) ; à défaut, celle du directeur de
 * mission : un associé étranger à la mission ne devient pas intervenant qualité (indépendance de
 * la revue à froid).
 */
async function associeDe(
  ctx: ContexteTenantDemo,
  m: MissionLue,
  repli: SessionDemo,
): Promise<SessionDemo> {
  const r = await ctx.proprietaire.query(
    `SELECT e.utilisateur_id FROM mission_equipe e JOIN utilisateurs u ON u.id = e.utilisateur_id
      WHERE e.cabinet_id = $1 AND e.mission_id = $2 AND 'associe' = ANY (u.roles)
      ORDER BY e.ajoute_le, e.utilisateur_id LIMIT 1`,
    [ctx.cabinetId, m.id],
  );
  const id = r.rows[0]?.utilisateur_id as string | undefined;
  return (id ? sessionDe(ctx, id) : undefined) ?? sessionDe(ctx, m.directeurId) ?? repli;
}

/** Rapports d'état d'avancement d'une mission en cours ou terminée. */
async function avancementsDeMission(
  ctx: ContexteTenantDemo,
  m: MissionLue,
  rang: number,
): Promise<number> {
  if (!m.debut) return 0;
  const chef = sessionDe(ctx, m.chefId);
  if (!chef) return 0;
  let n = 0;
  const emettre = async (
    session: typeof chef,
    date: string,
    i: number,
    admis?: ("pdf" | "docx" | "pptx")[],
  ) => {
    const id = await genererRapport(ctx, {
      missionId: m.id,
      modele: "etat_avancement",
      session,
      url: `/api/missions/${m.id}/rapports`,
      format: formatDuRang(ctx, rang + i, admis),
      date,
      tolerant: false,
    });
    if (id) n += 1;
  };
  if (m.terminee) {
    const fin = m.fin ?? ctx.aujourdhui;
    const milieu = ajouterJours(
      m.debut,
      Math.round(ecartJours(m.debut, fin) * FRACTION_MI_PARCOURS),
    );
    await emettre(chef, milieu, 0);
    // Synthèse finale : un associé (niveau « finance »), fichier DOCX ou PDF pour l'archivage.
    await emettre(await associeDe(ctx, m, chef), fin, 1, ["docx", "pdf"]);
  } else {
    const ecoule = ecartJours(m.debut, ctx.aujourdhui);
    for (const [i, f] of FRACTIONS_EN_COURS.entries()) {
      const date = ajouterJours(m.debut, Math.max(7, Math.round(ecoule * f)));
      await emettre(chef, date > ctx.aujourdhui ? ctx.aujourdhui : date, i);
    }
  }
  return n;
}

async function idSource(
  ctx: ContexteTenantDemo,
  sql: string,
  missionId: string,
): Promise<string | null> {
  const r = await ctx.proprietaire.query(sql, [ctx.cabinetId, missionId]);
  return (r.rows[0]?.id as string | undefined) ?? null;
}

const SQL_NOTATION_PUBLIEE = `SELECT n.id FROM notations n
   WHERE n.cabinet_id = $1 AND n.mission_id = $2
     AND EXISTS (SELECT 1 FROM notation_versions v
                   JOIN notation_evenements e ON e.version_id = v.id AND e.action = 'publication'
                  WHERE v.notation_id = n.id)
   LIMIT 1`;
const SQL_PLAN = `SELECT p.id FROM plans_strategiques p
   WHERE p.cabinet_id = $1 AND p.mission_id = $2 ORDER BY p.cree_le, p.id LIMIT 1`;

/** Rapports de services (notation, plan, dossier bancaire, état financier) si leur source existe. */
async function rapportsDeServices(ctx: ContexteTenantDemo, casting: Casting): Promise<number> {
  let n = 0;
  const jourFin = (m: MissionLue, avant: number): string =>
    m.terminee && m.fin ? ajouterJours(m.fin, -avant) : ctx.jour(-avant - 6);
  for (const cle of ["sahel-coton-notation", "banque-sahel-notation"] as const) {
    const m = casting.missions[cle];
    if (!hors(m, ctx, `notation ${cle}`)) continue;
    const session = sessionDe(ctx, m.chefId);
    const notationId = await idSource(ctx, SQL_NOTATION_PUBLIEE, m.id);
    if (!session || !notationId) {
      ctx.journal(`  [rapports] notation ${cle} : aucune notation publiée, rapport sauté.`);
      continue;
    }
    const id = await genererRapport(ctx, {
      missionId: m.id,
      modele: "notation",
      session,
      url: `/api/notations/${notationId}/rapports`,
      format: formatDuRang(ctx, 1, ["pdf", "docx"]),
      date: jourFin(m, 3),
      sourceId: notationId,
      tolerant: true,
    });
    if (id) n += 1;
  }
  for (const [rang, cle] of (["sicafe-plan", "baobab-plan", "atlantique-bp"] as const).entries()) {
    const m = casting.missions[cle];
    if (!hors(m, ctx, `plan ${cle}`)) continue;
    const session = sessionDe(ctx, m.chefId);
    const planId = await idSource(ctx, SQL_PLAN, m.id);
    if (!session || !planId) {
      ctx.journal(`  [rapports] plan ${cle} : aucun plan stratégique, rapports sautés.`);
      continue;
    }
    const plan = await genererRapport(ctx, {
      missionId: m.id,
      modele: "plan_strategique",
      session,
      url: `/api/plans/${planId}/rapports`,
      format: formatDuRang(ctx, rang, ["pdf", "docx"]),
      date: jourFin(m, 5),
      sourceId: planId,
      tolerant: true,
    });
    if (plan) n += 1;
    const banque = await genererRapport(ctx, {
      missionId: m.id,
      modele: "dossier_bancaire",
      session,
      url: `/api/plans/${planId}/dossier-bancaire`,
      format: formatDuRang(ctx, rang + 1, ["pdf", "docx"]),
      date: jourFin(m, 2),
      sourceId: planId,
      tolerant: true,
    });
    if (banque) n += 1;
  }
  for (const cle of [
    "sicafe-plan",
    "atlantique-bp",
    "wouri-redressement",
    "teranga-flash",
  ] as const) {
    const m = casting.missions[cle];
    if (!hors(m, ctx, `état financier ${cle}`)) continue;
    const session = sessionDe(ctx, m.chefId);
    const clientId = ctx.clients[CLIENT_DE_MISSION[cle] as keyof typeof ctx.clients];
    if (!session || !clientId) continue;
    const accepte = await ctx.proprietaire.query(
      `SELECT 1 FROM dossier_etats_financiers e
        WHERE e.cabinet_id = $1 AND e.client_id = $2
          AND EXISTS (SELECT 1 FROM dossier_etats_decisions d WHERE d.etat_id = e.id AND d.decision = 'accepte')
        LIMIT 1`,
      [ctx.cabinetId, clientId],
    );
    if (!accepte.rowCount) {
      ctx.journal(`  [rapports] état financier ${cle} : aucun état accepté au dossier, sauté.`);
      continue;
    }
    const id = await genererRapport(ctx, {
      missionId: m.id,
      modele: "etat_financier",
      session,
      url: `/api/dossiers/${clientId}/rapports/etat-financier`,
      requete: `mission_id=${m.id}`,
      format: formatDuRang(ctx, 2, ["pdf", "docx"]),
      date: jourFin(m, 7),
      corps: { commentaire: COMMENTAIRE_ETAT_FINANCIER },
      tolerant: true,
    });
    if (id) n += 1;
  }
  return n;
}

export async function semerRapports(ctx: ContexteTenantDemo, casting: Casting): Promise<void> {
  ctx.journal("[rapports] paramètres du cabinet…");
  await parametres(ctx);

  let avancements = 0;
  const missions: CleMission[] = [...MISSIONS_TERMINEES, ...MISSIONS_EN_COURS];
  for (const [rang, cle] of missions.entries()) {
    const m = casting.missions[cle];
    if (!hors(m, ctx, `avancement ${cle}`)) continue;
    avancements += await avancementsDeMission(ctx, m, rang);
  }
  ctx.journal(`[rapports] états d'avancement créés : ${avancements}`);

  const services = await rapportsDeServices(ctx, casting);
  ctx.journal(`[rapports] rapports de services créés : ${services}`);

  const hebdo = await semerAvancementHebdo(ctx, casting);
  ctx.journal(`[rapports] rapports hebdomadaires créés : ${hebdo}`);
}
