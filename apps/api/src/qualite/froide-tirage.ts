import { randomBytes } from "node:crypto";
import {
  tirerEchantillon,
  type CandidatEchantillon,
  type CriteresTirage,
  type ResultatTirage,
} from "@missionpilot/engines";
import {
  BORNES_REVUE_FROIDE,
  campagneFroideListeQuerySchema,
  type CampagneFroideCreation,
  type CriteresEchantillon,
} from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { exigerCampagne } from "./froide-donnees.js";

/*
 * Tirage de l'échantillon de la revue à froid (QUA-05). Le moteur `tirerEchantillon` est
 * déterministe : même graine, mêmes critères, même population ⇒ même échantillon. La population
 * éligible (missions clôturées du cabinet filtrées par les critères) est COPIÉE dans la campagne
 * avec son empreinte ; la vérification rejoue le tirage sur cette copie. La graine est celle de
 * l'appelant ou, à défaut, 12 caractères hexadécimaux tirés par le serveur ; elle est toujours
 * enregistrée.
 */

/** Dates de clôture lues en UTC (jour civil), comme l'attend le moteur. */
const SQL_CANDIDATS = `SELECT m.id, m.type_mission_id, m.directeur_id,
    to_char(m.cloturee_le AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS cloturee_le
  FROM missions m
  WHERE m.statut = 'cloturee'
    AND (m.cloturee_le AT TIME ZONE 'UTC')::date BETWEEN $1::date AND $2::date
    AND (cardinality($3::uuid[]) = 0 OR m.type_mission_id = ANY($3::uuid[]))
    AND (cardinality($4::uuid[]) = 0 OR m.directeur_id = ANY($4::uuid[]))
    AND (NOT $5::boolean OR NOT EXISTS (
           SELECT 1 FROM qualite_froide_echantillon x WHERE x.mission_id = m.id))
  ORDER BY m.id LIMIT ${BORNES_REVUE_FROIDE.population + 1}`;

function criteresMoteur(c: CriteresEchantillon, exclus: readonly string[]): CriteresTirage {
  return {
    periode_debut: c.periode_debut,
    periode_fin: c.periode_fin,
    types_mission_ids: c.types_mission_ids,
    directeur_ids: c.directeur_ids,
    stratifier_par: c.stratifier_par,
    exclus,
  };
}

export const graineServeur = (): string => randomBytes(6).toString("hex");

/** Crée la campagne et tire l'échantillon, dans la transaction de l'appelant. Renvoie son identifiant. */
export async function creerCampagne(
  db: Db,
  auth: Auth,
  corps: CampagneFroideCreation,
): Promise<string> {
  // Deux campagnes simultanées ne tirent pas les mêmes missions « non encore revues ».
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `qualite_froide_tirage:${auth.cabinetId}`,
  ]);
  const c = corps.criteres;
  const r = await db.query(SQL_CANDIDATS, [
    c.periode_debut,
    c.periode_fin,
    c.types_mission_ids,
    c.directeur_ids,
    c.exclure_deja_revues,
  ]);
  if (r.rows.length > BORNES_REVUE_FROIDE.population) {
    throw new AppError(
      409,
      "POPULATION_TROP_GRANDE",
      `Plus de ${BORNES_REVUE_FROIDE.population} missions éligibles : affinez les critères (période, types, directeurs).`,
    );
  }
  const candidats = r.rows as CandidatEchantillon[];
  const graine = corps.graine ?? graineServeur();
  const tirage = tirerEchantillon(candidats, criteresMoteur(c, []), corps.taille, graine);
  if (tirage.population.length === 0) {
    throw new AppError(
      409,
      "POPULATION_VIDE",
      "Aucune mission clôturée n'est éligible avec ces critères.",
    );
  }
  const campagne = await db.query(
    `INSERT INTO qualite_froide_campagnes
       (cabinet_id, intitule, criteres, taille_demandee, graine, population_ids, empreinte_population,
        cree_par)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8) RETURNING id`,
    [
      auth.cabinetId,
      corps.intitule,
      JSON.stringify(c),
      corps.taille,
      graine,
      JSON.stringify(tirage.population),
      tirage.empreinte_population,
      auth.utilisateurId,
    ],
  );
  const id = campagne.rows[0].id as string;
  await db.query(
    `INSERT INTO qualite_froide_echantillon (cabinet_id, campagne_id, mission_id, rang, cle)
     SELECT $1, $2, t.mission_id, t.rang, t.cle
     FROM unnest($3::uuid[], $4::int[], $5::text[]) AS t(mission_id, rang, cle)`,
    [
      auth.cabinetId,
      id,
      tirage.selection.map((s) => s.id),
      tirage.selection.map((s) => s.rang),
      tirage.selection.map((s) => s.cle),
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.froide.campagne.creer",
    entite: "qualite_froide_campagne",
    entiteId: id,
    details: {
      taille_demandee: corps.taille,
      taille_obtenue: tirage.taille_obtenue,
      population: tirage.population.length,
      empreinte_population: tirage.empreinte_population,
      graine,
    },
  });
  return id;
}

const SQL_ECHANTILLON_VUE = `SELECT e.id, e.rang, e.cle, e.statut, e.mission_id,
    m.intitule AS mission_intitule, cl.raison_sociale AS client_nom, t.libelle AS type_mission_libelle,
    d.nom AS directeur_nom, m.cloturee_le AS mission_cloturee_le,
    e.relecteur_id, u.nom AS relecteur_nom, e.affecte_le, e.score::float8 AS score, e.conclusion,
    e.terminee_le
  FROM qualite_froide_echantillon e
  JOIN missions m ON m.id = e.mission_id
  JOIN clients cl ON cl.id = m.client_id
  LEFT JOIN types_mission t ON t.id = m.type_mission_id
  LEFT JOIN utilisateurs d ON d.id = m.directeur_id
  LEFT JOIN utilisateurs u ON u.id = e.relecteur_id
  WHERE e.campagne_id = $1
  ORDER BY e.rang`;

/** Détail d'une campagne : critères, graine, échantillon avec la mission, le relecteur et le résultat. */
export async function detailCampagne(db: Db, id: string) {
  const c = await exigerCampagne(db, id);
  const pop = await db.query(
    "SELECT jsonb_array_length(population_ids) AS n FROM qualite_froide_campagnes WHERE id = $1",
    [id],
  );
  const par = await db.query("SELECT u.nom AS cree_par_nom FROM utilisateurs u WHERE u.id = $1", [
    c.cree_par,
  ]);
  const echantillon = (await db.query(SQL_ECHANTILLON_VUE, [id])).rows;
  return {
    ...c,
    cree_par_nom: (par.rows[0]?.cree_par_nom as string | undefined) ?? null,
    population_taille: pop.rows[0].n as number,
    taille_obtenue: echantillon.length,
    progression: {
      total: echantillon.length,
      terminees: echantillon.filter((e) => e.statut === "terminee").length,
    },
    echantillon,
  };
}

export async function listerCampagnes(
  db: Db,
  requete: z.infer<typeof campagneFroideListeQuerySchema>,
) {
  const q = campagneFroideListeQuerySchema.parse(requete);
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT c.id, c.intitule, c.statut, c.graine, c.taille_demandee, c.cree_le, c.cloturee_le,
       (SELECT count(*)::int FROM qualite_froide_echantillon e WHERE e.campagne_id = c.id) AS taille_obtenue,
       (SELECT count(*)::int FROM qualite_froide_echantillon e
          WHERE e.campagne_id = c.id AND e.statut = 'terminee') AS terminees,
       to_char(c.cree_le AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') AS cle_tri
     FROM qualite_froide_campagnes c
     WHERE ($2::text IS NULL OR c.statut = $2)
       AND ($3::text IS NULL OR (to_char(c.cree_le AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS'), c.id)
            < ($3, $4::uuid))
     ORDER BY cle_tri DESC, c.id DESC LIMIT $1`,
    [q.limite + 1, q.statut ?? null, apres?.[0] ?? null, apres?.[1] ?? null],
  );
  return paginer(r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[], q.limite);
}

export interface EcartTirage {
  type: "population" | "echantillon";
  message: string;
  attendu?: unknown;
  obtenu?: unknown;
}

/**
 * Rejoue le tirage avec la graine et les critères enregistrés sur la population STOCKÉE (les
 * métadonnées des missions — type, directeur, date de clôture — sont relues à l'instant) et
 * compare à l'échantillon enregistré. `reproductible` est vrai tant que rien ne s'écarte.
 */
export async function verifierCampagne(db: Db, id: string) {
  const c = await exigerCampagne(db, id);
  const stockee = await db.query(
    "SELECT population_ids FROM qualite_froide_campagnes WHERE id = $1",
    [id],
  );
  const population = stockee.rows[0].population_ids as string[];
  const meta = await db.query(
    `SELECT m.id, m.type_mission_id, m.directeur_id,
       to_char(m.cloturee_le AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS cloturee_le
     FROM missions m WHERE m.id = ANY($1::uuid[])`,
    [population],
  );
  const criteres = c.criteres as unknown as CriteresEchantillon;
  const rejeu: ResultatTirage = tirerEchantillon(
    meta.rows as CandidatEchantillon[],
    criteresMoteur(criteres, []),
    c.taille_demandee,
    c.graine,
  );
  const enregistre = (
    await db.query(
      "SELECT mission_id, rang, cle FROM qualite_froide_echantillon WHERE campagne_id = $1 ORDER BY rang",
      [id],
    )
  ).rows as { mission_id: string; rang: number; cle: string }[];

  const ecarts: EcartTirage[] = [];
  if (rejeu.empreinte_population !== c.empreinte_population) {
    ecarts.push({
      type: "population",
      message: "L'empreinte de la population rejouée diffère de celle enregistrée.",
      attendu: c.empreinte_population,
      obtenu: rejeu.empreinte_population,
    });
  }
  const attendu = rejeu.selection.map((s) => `${s.rang}:${s.id}:${s.cle}`);
  const obtenu = enregistre.map((s) => `${s.rang}:${s.mission_id}:${s.cle}`);
  for (let i = 0; i < Math.max(attendu.length, obtenu.length); i++) {
    if (attendu[i] !== obtenu[i]) {
      ecarts.push({
        type: "echantillon",
        message: `Le rang ${i + 1} de l'échantillon diffère du tirage rejoué.`,
        attendu: attendu[i] ?? null,
        obtenu: obtenu[i] ?? null,
      });
    }
  }
  return {
    reproductible: ecarts.length === 0,
    graine: c.graine,
    empreinte_population: c.empreinte_population,
    population_taille: population.length,
    taille_echantillon: enregistre.length,
    ecarts,
  };
}
