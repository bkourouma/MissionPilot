import type { ContexteTenantDemo } from "../contexte.js";
import { sousFenetre, type Fenetre } from "./antidatage.js";
import { CASTING, type MissionCasting, type MissionTrouvee } from "./casting.js";

/*
 * Fenêtres d'antidatage des questionnaires et notations d'une mission terminée.
 *
 * - « tôt » : questionnaires préliminaires et de notation, fraction 0,10 → 0,45 de la période ;
 * - « tard » : questionnaire de satisfaction de fin de mission, fraction 0,80 → 0,95 ;
 * - notation : 0,50 → fin de mission + 4 jours, mais APRÈS la clôture des questionnaires de
 *   notation (calcul postérieur aux réponses).
 * Un questionnaire ne s'ouvre jamais avant le compte de portail d'un de ses répondants : si le
 * compte est plus récent que la fenêtre suggérée, la fenêtre est décalée (au moins 28 jours pour
 * « tôt », 7 pour « tard »). Aucune écriture ici : calcul pur à partir de la base et de la mission.
 */

/** Mission terminée absente de `CASTING` (numéro 3 du casting de la phase « missions »). */
export const BRASSERIES_WOURI = {
  numero: 3,
  intitule: "Redressement — Brasseries du Wouri",
  client: "brasseries-wouri",
} as const satisfies MissionCasting;

/** Missions terminées du casting dont les questionnaires et notations sont antidatés. */
export const MISSIONS_ANTIDATEES: readonly MissionCasting[] = [
  CASTING.sicafe,
  CASTING.sahelCoton,
  BRASSERIES_WOURI,
  CASTING.atlantique,
];

const JOUR_MS = 86_400_000;

export interface PlanMission {
  mission: MissionTrouvee;
  tot: Fenetre;
  tard: Fenetre;
  notation: Fenetre;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** Lendemain 08:00 UTC de l'instant donné (ms). */
const lendemainMatin = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 8);
};

/** Création du compte de portail le plus récent parmi les répondants (null s'il n'y en a pas). */
async function dernierCompteRepondant(
  ctx: ContexteTenantDemo,
  missionId: string,
  satisfaction: boolean,
): Promise<number | null> {
  const r = await ctx.proprietaire.query<{ t: Date | null }>(
    `SELECT max(u.cree_le) AS t
       FROM questionnaire_repondants r
       JOIN questionnaire_envois e ON e.id = r.envoi_id AND e.cabinet_id = r.cabinet_id
       JOIN utilisateurs u ON u.id = r.utilisateur_id
      WHERE e.cabinet_id = $1 AND e.mission_id = $2 AND (e.titre LIKE 'Satisfaction%') = $3`,
    [ctx.cabinetId, missionId, satisfaction],
  );
  return r.rows[0]?.t?.getTime() ?? null;
}

function apresComptes(f: Fenetre, compte: number | null, dureeMiniJours: number): Fenetre {
  if (compte === null) return f;
  const debut = Math.max(Date.parse(f.debut), lendemainMatin(compte));
  const fin = Math.max(Date.parse(f.fin), debut + dureeMiniJours * JOUR_MS);
  return { debut: iso(debut), fin: iso(fin) };
}

/** Calcule les trois fenêtres de la mission ; erreur claire si elles débordent de la période. */
export async function planifier(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
): Promise<PlanMission> {
  const tot = apresComptes(
    sousFenetre(mission, 0.1, 0.45),
    await dernierCompteRepondant(ctx, mission.id, false),
    28,
  );
  const tard = apresComptes(
    sousFenetre(mission, 0.8, 0.95),
    await dernierCompteRepondant(ctx, mission.id, true),
    7,
  );
  const base = sousFenetre(mission, 0.5, 1, { apresFin: true });
  const debutNotation = Math.max(Date.parse(base.debut), lendemainMatin(Date.parse(tot.fin)));
  const notation = { debut: iso(debutNotation), fin: iso(Date.parse(base.fin)) };

  const finMission = Date.parse(`${mission.dateFin}T17:00:00Z`);
  if (Date.parse(tot.fin) > finMission || Date.parse(tard.fin) > finMission) {
    throw new Error(`Mission « ${mission.intitule} » : fenêtre de questionnaires hors période.`);
  }
  if (debutNotation >= Date.parse(notation.fin)) {
    throw new Error(`Mission « ${mission.intitule} » : fenêtre de notation vide.`);
  }
  return { mission, tot, tard, notation };
}
