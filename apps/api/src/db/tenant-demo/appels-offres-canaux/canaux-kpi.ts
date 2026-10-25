import { ajouterJours } from "@missionpilot/engines";
import { attendre } from "../contexte.js";
import { corps, type ContexteCanaux } from "./canaux-contexte.js";
import { KPI_MESSAGERIE, MARQUE_CANAUX } from "./donnees-canaux-contacts.js";
import { chefDe, missionDuCasting, sql } from "./outils.js";

/*
 * KPI alimentés par message et questionnaire à relancer. Créés AVANT l'activation du compte de
 * canal : l'historique de mesures et l'envoi du questionnaire ne déclenchent ainsi ni alerte
 * sortante ni relance J+10 (l'activation vient ensuite). Idempotent : KPI retrouvés par leur
 * libellé distinctif, mesures et contributeurs complétés seulement s'il en manque.
 */

const DEBUT_SUIVI = "2026-01-01";

export interface KpiPret {
  id: string;
  libelle: string;
}

async function kpiParLibelle(cc: ContexteCanaux, libelle: string): Promise<string | null> {
  const r = await sql<{ id: string }>(
    cc.ctx,
    "SELECT id FROM kpi_definitions WHERE cabinet_id = $1 AND libelle = $2",
    [cc.ctx.cabinetId, libelle],
  );
  return r[0]?.id ?? null;
}

/** Crée (ou retrouve) les KPI de messagerie, leur historique de mesures et leurs contributeurs. */
export async function assurerKpiMessagerie(cc: ContexteCanaux): Promise<KpiPret[]> {
  const prets: KpiPret[] = [];
  for (const def of KPI_MESSAGERIE) {
    const mission = await missionDuCasting(cc.ctx, def.mission);
    const auteur = await chefDe(cc.ctx, mission.id);
    let id = await kpiParLibelle(cc, def.libelle);
    if (!id) {
      const c = corps<{ id: string }>(
        201,
        await cc.appel(auteur, "POST", `/api/missions/${mission.id}/kpi`, {
          libelle: def.libelle,
          description: `Indicateur alimenté par message (${MARQUE_CANAUX}, données fictives).`,
          unite: def.unite,
          perspective: "clients",
          sens: def.sens,
          nature: "stock",
          frequence: "mensuelle",
          debut_suivi: DEBUT_SUIVI,
          cible: def.cible,
          ...(def.alerteBas === undefined ? {} : { alerte_bas: def.alerteBas }),
          ...(def.alerteHaut === undefined ? {} : { alerte_haut: def.alerteHaut }),
          rappels_actifs: false,
        }),
        `KPI ${def.libelle}`,
      );
      id = c.id;
    }
    const n = await sql<{ n: number }>(
      cc.ctx,
      "SELECT count(*)::int AS n FROM kpi_mesures WHERE kpi_id = $1",
      [id],
    );
    if ((n[0]?.n ?? 0) === 0) {
      for (const [i, valeur] of def.historique.entries()) {
        const mois = String(i + 1).padStart(2, "0");
        attendre(
          201,
          await cc.appel(auteur, "POST", `/api/kpi/${id}/mesures`, {
            date_mesure: `2026-${mois}-28`,
            valeur,
          }),
          `mesure ${def.libelle} ${mois}`,
        );
      }
    }
    const voulus = def.contributeurs.map((cle) => cc.ctx.utilisateurs[cle] as string);
    const presents = (
      await sql<{ utilisateur_id: string }>(
        cc.ctx,
        "SELECT utilisateur_id FROM kpi_contributeurs WHERE kpi_id = $1",
        [id],
      )
    ).map((x) => x.utilisateur_id);
    if (voulus.some((v) => !presents.includes(v))) {
      attendre(
        200,
        await cc.appel(auteur, "PUT", `/api/kpi/${id}/contributeurs`, {
          utilisateurs: [...new Set([...presents, ...voulus])],
        }),
        `contributeurs ${def.libelle}`,
      );
    }
    prets.push({ id, libelle: def.libelle });
  }
  return prets;
}

export interface QuestionnairePret {
  id: string;
  /** Jour d'envoi (ISO) ; les relances ne lui sont jamais antérieures. */
  envoyeLe: string;
}

/**
 * Questionnaire envoyé à relancer : le premier envoi existant du cabinet, sinon un questionnaire
 * préliminaire créé par les routes (modèle validé par le directeur, envoi par le chef de mission).
 */
export async function assurerQuestionnaire(cc: ContexteCanaux): Promise<QuestionnairePret> {
  const lire = async () =>
    (
      await sql<{ id: string; jour: string }>(
        cc.ctx,
        `SELECT id, envoye_le::date::text AS jour FROM questionnaire_envois
         WHERE cabinet_id = $1 AND statut = 'envoye' ORDER BY envoye_le, id LIMIT 1`,
        [cc.ctx.cabinetId],
      )
    )[0];
  const existant = await lire();
  if (existant) return { id: existant.id, envoyeLe: existant.jour };

  const mission = await missionDuCasting(cc.ctx, "planSicafe");
  const auteur = await chefDe(cc.ctx, mission.id);
  const m = corps<{ versions: { id: string }[] }>(
    201,
    await cc.appel(auteur, "POST", "/api/questionnaires/modeles", {
      code: `demo_canaux_${cc.ctx.aujourdhui.replace(/-/g, "")}`,
      titre: `Questionnaire préliminaire (${MARQUE_CANAUX})`,
      source: { type: "gabarit", gabarit: "preliminaire_dirigeants" },
    }),
    "modèle de questionnaire",
  );
  const versionId = (m.versions[0] as { id: string }).id;
  attendre(
    200,
    await cc.appel(
      "directeur.mission",
      "POST",
      `/api/questionnaires/versions/${versionId}/valider`,
    ),
    "version de questionnaire validée",
  );
  const envoi = corps<{ id: string }>(
    201,
    await cc.appel(auteur, "POST", `/api/missions/${mission.id}/questionnaires`, {
      version_id: versionId,
      mode: "collectif",
      repondants: [
        { utilisateur_id: cc.ctx.utilisateurs["dirigeant.client"] },
        { utilisateur_id: cc.ctx.utilisateurs["contributeur.client"] },
      ],
      date_limite: ajouterJours(cc.ctx.aujourdhui, 14),
    }),
    "envoi de questionnaire",
  );
  attendre(
    200,
    await cc.appel(auteur, "POST", `/api/questionnaires/envois/${envoi.id}/envoyer`),
    "questionnaire envoyé",
  );
  const cree = await lire();
  if (!cree) throw new Error("Questionnaire de démonstration introuvable après envoi.");
  return { id: cree.id, envoyeLe: cree.jour };
}
