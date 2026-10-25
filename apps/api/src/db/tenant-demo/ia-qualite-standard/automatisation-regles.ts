import { validerPayloadEvenement } from "@missionpilot/engines";
import {
  CATALOGUE_EVENEMENTS,
  definitionAutomatisationSchema,
  type DefinitionAutomatisationApi,
} from "@missionpilot/shared";
import { champsMoteur, validerDefinition } from "../../../automatisation/definitions.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { CASTING, CLES_TERMINEES, midi, type CleMission, type MissionLot } from "./commun.js";
import { REGLES, type PeriodeRegle, type RegleDemo } from "./automatisation-donnees.js";
import { EVENEMENTS_FIXES, type EvenementDemo } from "./automatisation-evenements.js";

/*
 * Règles d'automatisation et événements métier du seed (historique). Les règles s'écrivent par
 * SQL propriétaire parce que les routes créent tout « maintenant » et que les versions sont en
 * ajout seul (impossibles à antidater après coup) : même table, mêmes contrôles de définition
 * (schéma partagé + `validerDefinition` du moteur) que `POST /api/automatisations`.
 */

export interface RegleBd {
  id: string;
  spec: RegleDemo;
  definitions: Map<number, DefinitionAutomatisationApi>;
}

export interface EvenementBd {
  id: string;
  ref: string;
  code: EvenementDemo["code"];
  missionId: string;
  creeLe: string;
  payload: Record<string, unknown>;
}

/** Début d'une période d'activation : 09 h 30 UTC (la désactivation a lieu à 09 h 00). */
export const debutPeriode = (p: PeriodeRegle): string => midi(p.debut, -150);
export const finPeriode = (p: PeriodeRegle): string | null => (p.fin ? midi(p.fin, -180) : null);

function definitionsDe(spec: RegleDemo): Map<number, DefinitionAutomatisationApi> {
  return new Map(
    spec.versions.map((v) => {
      const d = definitionAutomatisationSchema.parse(v.definition);
      const erreurs = validerDefinition(d);
      if (erreurs.length > 0) {
        throw new Error(
          `Règle « ${spec.nom} » invalide : ${erreurs.map((e) => e.message).join(" ")}`,
        );
      }
      return [v.version, d];
    }),
  );
}

export async function assurerRegles(ctx: ContexteTenantDemo): Promise<RegleBd[]> {
  const c = ctx.proprietaire;
  const uid = (cle: Parameters<ContexteTenantDemo["session"]>[0]): string => {
    const id = ctx.utilisateurs[cle];
    if (!id) throw new Error(`Utilisateur « ${cle} » introuvable.`);
    return id;
  };
  const resultat: RegleBd[] = [];
  for (const spec of REGLES) {
    const definitions = definitionsDe(spec);
    const existante = await c.query<{ id: string }>(
      "SELECT id FROM automatisations WHERE cabinet_id = $1 AND nom = $2",
      [ctx.cabinetId, spec.nom],
    );
    if (existante.rows[0]) {
      resultat.push({ id: existante.rows[0].id, spec, definitions });
      continue;
    }
    const derniere = spec.periodes.at(-1);
    const active = derniere !== undefined && derniere.fin === null;
    const courante = spec.versions.at(-1)!;
    const modifieLe = derniere?.fin ? midi(derniere.fin, -180) : midi(courante.date, -180);
    await c.query("BEGIN");
    try {
      const ins = await c.query<{ id: string }>(
        `INSERT INTO automatisations (cabinet_id, nom, description, standard_code, evenement_code,
           version_courante, active, active_depuis, responsable_id, cree_par, cree_le, modifie_le)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          ctx.cabinetId,
          spec.nom,
          spec.description,
          spec.standardCode,
          courante.definition.evenement_code,
          courante.version,
          active,
          active && derniere ? debutPeriode(derniere) : null,
          uid(derniere?.responsable ?? spec.creePar),
          uid(spec.creePar),
          midi(spec.creeLe, -180),
          active && derniere ? debutPeriode(derniere) : modifieLe,
        ],
      );
      const id = ins.rows[0]!.id;
      for (const v of spec.versions) {
        await c.query(
          `INSERT INTO automatisation_versions (cabinet_id, automatisation_id, version, definition,
             cree_par, cree_le) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            ctx.cabinetId,
            id,
            v.version,
            JSON.stringify(definitions.get(v.version)),
            uid(v.auteur),
            midi(v.date, -180),
          ],
        );
      }
      await c.query("COMMIT");
      resultat.push({ id, spec, definitions });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  }
  return resultat;
}

/** Événements du seed : jalons, KPI, questionnaires et demandes de clôture (dates passées). */
export function evenementsDemo(
  ctx: ContexteTenantDemo,
  missions: Partial<Record<CleMission, MissionLot>>,
): EvenementDemo[] {
  const clotures: EvenementDemo[] = CLES_TERMINEES.map((cle) => ({
    ref: `cloture-${cle}`,
    code: "mission.cloture_demandee" as const,
    mission: cle,
    date: CASTING[cle].fin,
    payload: {},
  }));
  return [...EVENEMENTS_FIXES(ctx.dateAvant), ...clotures]
    .filter((e) => missions[e.mission] !== undefined && e.date <= ctx.aujourdhui)
    .sort((a, b) => `${a.date}${a.ref}`.localeCompare(`${b.date}${b.ref}`));
}

export async function assurerEvenements(
  ctx: ContexteTenantDemo,
  missions: Partial<Record<CleMission, MissionLot>>,
): Promise<EvenementBd[]> {
  const c = ctx.proprietaire;
  const resultat: EvenementBd[] = [];
  for (const e of evenementsDemo(ctx, missions)) {
    const mission = missions[e.mission]!;
    const payload = { mission_id: mission.id, ...e.payload };
    if (validerPayloadEvenement(payload, champsMoteur(e.code)).length > 0) {
      throw new Error(`Événement ${e.ref} : contenu invalide.`);
    }
    const creeLe = midi(e.date, e.minutes ?? 0);
    const cle = `${e.code}:${e.ref}`;
    const source = CATALOGUE_EVENEMENTS[e.code].source === "base" ? "base" : "systeme";
    await c.query(
      `INSERT INTO automatisation_evenements (cabinet_id, code, payload, cle, source, mission_id,
         cree_le) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (cabinet_id, cle) DO NOTHING`,
      [ctx.cabinetId, e.code, JSON.stringify(payload), cle, source, mission.id, creeLe],
    );
    const lu = await c.query<{ id: string; cree_le: Date }>(
      "SELECT id, cree_le FROM automatisation_evenements WHERE cabinet_id = $1 AND cle = $2",
      [ctx.cabinetId, cle],
    );
    resultat.push({
      id: lu.rows[0]!.id,
      ref: e.ref,
      code: e.code,
      missionId: mission.id,
      creeLe: lu.rows[0]!.cree_le.toISOString(),
      payload,
    });
  }
  return resultat;
}
