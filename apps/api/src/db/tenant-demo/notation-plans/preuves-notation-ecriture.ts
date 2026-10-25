import { ajouterJours } from "@missionpilot/engines";
import type { CleCompteCabinet } from "../cles.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { trouverMission, type MissionTrouvee } from "./casting.js";
import { assurerEquipe, json, versionGrilleValidee } from "./notations-outils.js";
import { exiger, lire } from "./outils.js";
import { antidaterRegistreNotation } from "./preuves-notation-dates.js";
import {
  DIMENSIONS_GRILLE,
  DIMENSIONS_PARTIELLES_POSSIBLES,
  PREUVES_PAR_DIMENSION,
  REDACTEURS_PAR_POSITION,
  TYPES_PAR_POSITION,
  type DefRegistreNotation,
  type DimensionGrille,
  type Redacteur,
} from "./preuves-notation-types.js";
import { LIVRABLE_NOTATION as LIVRABLE } from "./preuves-notation-compte.js";

/*
 * Écriture, par les VRAIES routes, du registre de preuves d'une mission notée : dimensions du
 * registre = dimensions de la grille de notation, six preuves de types variés, affirmations
 * « retenue » rattachées aux dimensions (`rattachement_type: "dimension"`) avec deux liens « pour »
 * de types distincts (triangulation), sauf une dimension partiellement étayée (une seule preuve)
 * et une dimension sans affirmation. C'est ce que lit l'indice de confiance de la notation
 * (notation/confiance.ts : assertions retenues rattachées à une dimension de la grille).
 *
 * Idempotent : clés naturelles = code de dimension, `source_precise` de la preuve (version 1),
 * énoncé de l'affirmation (version 1), couple affirmation-preuve. Les missions restent ouvertes.
 */

interface Existant {
  dimensions: Set<string>;
  preuves: Map<string, string>;
  assertions: Map<string, string>;
  liens: Set<string>;
}

async function lireExistant(ctx: ContexteTenantDemo, missionId: string): Promise<Existant> {
  const dims = await lire<{ code: string }>(
    ctx,
    "SELECT code FROM preuve_dimensions WHERE mission_id = $1",
    [missionId],
  );
  const preuves = await lire<{ id: string; source_precise: string }>(
    ctx,
    `SELECT p.id, v.source_precise FROM preuves p
       JOIN preuve_versions v ON v.preuve_id = p.id AND v.version = 1
      WHERE p.mission_id = $1`,
    [missionId],
  );
  const assertions = await lire<{ id: string; enonce: string }>(
    ctx,
    `SELECT a.id, v.enonce FROM assertions a
       JOIN assertion_versions v ON v.assertion_id = a.id AND v.version = 1
      WHERE a.mission_id = $1`,
    [missionId],
  );
  const liens = await lire<{ assertion_id: string; preuve_id: string }>(
    ctx,
    "SELECT assertion_id, preuve_id FROM assertion_preuve_liens WHERE mission_id = $1 AND action = 'lier'",
    [missionId],
  );
  return {
    dimensions: new Set(dims.map((d) => d.code)),
    preuves: new Map(preuves.map((p) => [p.source_precise, p.id])),
    assertions: new Map(assertions.map((a) => [a.enonce, a.id])),
    liens: new Set(liens.map((l) => `${l.assertion_id}|${l.preuve_id}`)),
  };
}

/** Dimensions de la grille validée (code et libellé), lues en base : jamais écrites en dur. */
async function dimensionsGrille(
  ctx: ContexteTenantDemo,
  grille: string,
): Promise<Map<DimensionGrille, string>> {
  const versionId = await versionGrilleValidee(ctx, grille);
  const lignes = await lire<{ code: string; libelle: string }>(
    ctx,
    `SELECT d->>'id' AS code, d->>'libelle' AS libelle
       FROM notation_grille_versions v, jsonb_array_elements(v.contenu->'dimensions') d
      WHERE v.id = $1`,
    [versionId],
  );
  const carte = new Map(lignes.map((l) => [l.code, l.libelle]));
  for (const code of DIMENSIONS_GRILLE) {
    if (!carte.has(code)) throw new Error(`Grille « ${grille} » sans dimension « ${code} ».`);
  }
  return new Map(DIMENSIONS_GRILLE.map((c) => [c, carte.get(c) as string]));
}

/** Date ISO située à la fraction `f` de la période de la mission, jamais après « aujourd'hui ». */
function datePreuve(m: MissionTrouvee, f: number, aujourdhui: string): string {
  const debut = m.dateDebut ?? aujourdhui;
  const fin = m.dateFin ?? aujourdhui;
  const jours = Math.round((Date.parse(fin) - Date.parse(debut)) / 86_400_000);
  const brute = ajouterJours(debut, Math.round(jours * f));
  return [brute, fin, aujourdhui].reduce((a, b) => (b < a ? b : a));
}

/** Clé de compte du cabinet de l'utilisateur donné (chef réel de la mission). */
function cleDe(ctx: ContexteTenantDemo, utilisateurId: string | null): CleCompteCabinet {
  const cle = Object.entries(ctx.utilisateurs).find(([, id]) => id === utilisateurId)?.[0];
  if (!cle) throw new Error(`Chef de mission ${utilisateurId ?? "(absent)"} sans clé de compte.`);
  return cle as CleCompteCabinet;
}

/** Positions des preuves liées à une dimension : les deux de sa paire, ou la dernière si partielle. */
function positionsLiees(def: DefRegistreNotation, dim: DimensionGrille): readonly number[] {
  const paire = PREUVES_PAR_DIMENSION[dim];
  return def.partielle === dim ? [paire[1]] : paire;
}

function verifierDefinition(def: DefRegistreNotation): void {
  if (!DIMENSIONS_PARTIELLES_POSSIBLES.includes(def.partielle)) {
    throw new Error(`Registre « ${def.mission.intitule} » : dimension partielle impossible.`);
  }
  const fragile = def.preuves[PREUVES_PAR_DIMENSION[def.partielle][1]];
  if (!fragile || fragile.fiabilite === "A" || fragile.fiabilite === "B") {
    throw new Error(
      `Registre « ${def.mission.intitule} » : la preuve de la dimension partielle doit être C ou D.`,
    );
  }
  if (def.assertions[def.sans] !== undefined) {
    throw new Error(
      `Registre « ${def.mission.intitule} » : la dimension sans affirmation en porte une.`,
    );
  }
}

export async function semerRegistreNotation(
  ctx: ContexteTenantDemo,
  def: DefRegistreNotation,
): Promise<void> {
  verifierDefinition(def);
  const mission = await trouverMission(ctx, def.mission);
  const libelles = await dimensionsGrille(ctx, def.grille);
  const dimsAvecAssertion = DIMENSIONS_GRILLE.filter((d) => def.assertions[d] !== undefined);
  let ex = await lireExistant(ctx, mission.id);
  const complet =
    DIMENSIONS_GRILLE.every((d) => ex.dimensions.has(d)) &&
    def.preuves.every((p) => ex.preuves.has(p.source)) &&
    dimsAvecAssertion.every((d) => {
      const id = ex.assertions.get(def.assertions[d]?.enonce ?? "");
      return (
        id !== undefined &&
        positionsLiees(def, d).every((i) => {
          const p = ex.preuves.get((def.preuves[i] as { source: string }).source);
          return p !== undefined && ex.liens.has(`${id}|${p}`);
        })
      );
    });
  if (complet) {
    ctx.journal(`    registre de notation « ${mission.intitule} » déjà semé.`);
    await antidaterRegistreNotation(ctx, def, mission);
    return;
  }

  // Équipe : le chef RÉEL de la mission (jamais en dur) ajoute les rédacteurs ; tous ont preuve.ecrire.
  const lignes = await lire<{ chef_id: string | null }>(
    ctx,
    "SELECT chef_id FROM missions WHERE id = $1",
    [mission.id],
  );
  const cleChef = cleDe(ctx, lignes[0]?.chef_id ?? null);
  await assurerEquipe(ctx, mission.id, cleChef, ["consultant", "consultant.2"]);
  const session = (r: Redacteur): SessionDemo =>
    ctx.session(r === "chef" ? cleChef : (r as CleCompteCabinet));
  const chef = session("chef");

  for (const code of DIMENSIONS_GRILLE) {
    if (ex.dimensions.has(code)) continue;
    const r = await chef.post(`/api/missions/${mission.id}/preuves/dimensions`, {
      code,
      libelle: libelles.get(code),
    });
    exiger(r, 201, `dimension de preuve « ${code} » (${mission.intitule})`);
  }

  for (const [i, p] of def.preuves.entries()) {
    if (ex.preuves.has(p.source)) continue;
    const dimensions = DIMENSIONS_GRILLE.filter((d) => PREUVES_PAR_DIMENSION[d].includes(i));
    const r = await session(REDACTEURS_PAR_POSITION[i] as Redacteur).post(
      `/api/missions/${mission.id}/preuves`,
      {
        type_source: TYPES_PAR_POSITION[i],
        source_precise: p.source,
        date_preuve: datePreuve(mission, p.f, ctx.aujourdhui),
        fiabilite: p.fiabilite,
        extrait: p.extrait,
        dimensions,
        // Comptes rendus sans nom de personne : aucun verbatim nominatif.
        nominatif: false,
        accord_nominatif: false,
      },
    );
    exiger(r, 201, `preuve « ${p.source} » (${mission.intitule})`);
  }
  ex = await lireExistant(ctx, mission.id);

  for (const dim of dimsAvecAssertion) {
    const a = def.assertions[dim];
    if (!a) continue;
    let id = ex.assertions.get(a.enonce);
    if (!id) {
      const r = await chef.post(`/api/missions/${mission.id}/assertions`, {
        enonce: a.enonce,
        classe_risque: a.classe,
        livrable: LIVRABLE,
        statut: "retenue",
        rattachement_type: "dimension",
        rattachement_code: dim,
      });
      exiger(r, 201, `affirmation « ${dim} » (${mission.intitule})`);
      id = json<{ id: string }>(r).id;
    }
    for (const i of positionsLiees(def, dim)) {
      const preuveId = ex.preuves.get((def.preuves[i] as { source: string }).source) as string;
      if (ex.liens.has(`${id}|${preuveId}`)) continue;
      const r = await session("consultant").post(`/api/assertions/${id}/liens`, {
        preuve_id: preuveId,
        sens: "pour",
      });
      exiger(r, 201, `lien « pour » de l'affirmation « ${dim} » (${mission.intitule})`);
    }
  }
  ctx.journal(
    `    registre de notation « ${mission.intitule} » : ${def.preuves.length} preuves, ${dimsAvecAssertion.length} affirmations.`,
  );
  await antidaterRegistreNotation(ctx, def, mission);
}
