import { aPermission, ASSERTIONS_MISSION_MAX, type LivrableCitation } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { assertionsDeMission, liensCourants, type AssertionCourante } from "./donnees.js";
import { chargerEtat } from "./synthese.js";
import { vuePreuve } from "./vues.js";

/*
 * Citations des livrables (PRV-06) : assertions RETENUES d'un livrable et sources numérotées.
 * Source UNIQUE de la numérotation [n], partagée par l'annexe « Sources » des exports PDF et Word
 * (`rapports/sources.ts`) et par les citations cliquables du web (routes /livrables/:livrable/sources).
 *
 * - Assertion citée : retenue, dont le livrable désigne le rapport (« notation » ou « plan »,
 *   comparaison sans casse ni accents). Une assertion sans livrable n'est citée par aucun.
 * - Numérotation : dans l'ordre de première citation ; pour chaque assertion, les preuves « pour »
 *   d'abord, puis l'ordre de liaison, puis l'identifiant.
 * - Une liste de citations est destinée à être reprise dans un livrable client : un verbatim
 *   NOMINATIF sans accord de la personne est masqué pour TOUS (`vuePreuve(…, false)`), quels que
 *   soient les droits de qui la lit. La solidité vient du moteur.
 * - Lecture seule ; le contrôle de droits (`preuve.lire`, mission lisible) est celui de l'appelant.
 */

export type LivrableSources = LivrableCitation;

const MOTS_CLES: Record<LivrableSources, string> = { notation: "notation", plan: "plan" };

const normaliser = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** L'assertion est-elle citée par un rapport de ce livrable ? */
export function assertionCitee(
  a: Pick<AssertionCourante, "statut" | "livrable">,
  l: LivrableSources,
) {
  return (
    a.statut === "retenue" && a.livrable !== null && normaliser(a.livrable).includes(MOTS_CLES[l])
  );
}

export interface AssertionCitee {
  id: string;
  enonce: string;
  solidite: { lecture: "solide" | "etayee" | "fragile"; indice: number } | null;
  avis_expert_signe: boolean;
  renvois: { pour: number[]; contre: number[] };
}

export interface SourceCitee {
  numero: number;
  preuve_id: string;
  type_source: string;
  source_precise: string;
  date_preuve: string;
  fiabilite: string;
  extrait: string | null;
  masque: boolean;
}

export interface SourcesLivrable {
  livrable: LivrableSources;
  assertions: AssertionCitee[];
  sources: SourceCitee[];
}

/**
 * Assertions citées et sources numérotées d'un livrable (mission déjà vérifiée lisible). Sans
 * `preuve.lire`, rien n'est révélé : listes vides.
 */
export async function sourcesDuLivrable(
  db: Db,
  auth: Auth,
  missionId: string,
  livrable: LivrableSources,
): Promise<SourcesLivrable> {
  if (!aPermission(auth.roles, "preuve.lire")) return { livrable, assertions: [], sources: [] };
  const citees = (await assertionsDeMission(db, missionId, ASSERTIONS_MISSION_MAX)).filter((a) =>
    assertionCitee(a, livrable),
  );
  if (citees.length === 0) return { livrable, assertions: [], sources: [] };
  const etat = await chargerEtat(db, missionId, citees);
  const numeros = new Map<string, number>();
  const assertions = citees.map((a): AssertionCitee => {
    const liens = etat.liens
      .filter((l) => l.assertion_id === a.id && etat.preuves.has(l.preuve_id))
      // Ordre stable : preuves « pour » d'abord, puis ordre de liaison, puis identifiant.
      .sort(
        (x, y) =>
          (x.sens === y.sens ? 0 : x.sens === "pour" ? -1 : 1) ||
          (x.horodatage < y.horodatage ? -1 : x.horodatage > y.horodatage ? 1 : 0) ||
          (x.preuve_id < y.preuve_id ? -1 : x.preuve_id > y.preuve_id ? 1 : 0),
      );
    const renvois = { pour: [] as number[], contre: [] as number[] };
    for (const l of liens) {
      if (!numeros.has(l.preuve_id)) numeros.set(l.preuve_id, numeros.size + 1);
      renvois[l.sens].push(numeros.get(l.preuve_id)!);
    }
    const s = etat.evaluations.get(a.id)?.solidite;
    return {
      id: a.id,
      enonce: a.enonce,
      solidite: s ? { lecture: s.lecture, indice: s.indice } : null,
      avis_expert_signe: a.avis_expert && a.signe_par !== null,
      renvois,
    };
  });
  const sources = [...numeros.entries()].map(([id, numero]): SourceCitee => {
    const p = vuePreuve(etat.preuves.get(id)!, false);
    return {
      numero,
      preuve_id: id,
      type_source: p.type_source,
      source_precise: p.source_precise,
      date_preuve: p.date_preuve,
      fiabilite: p.fiabilite,
      extrait: p.extrait,
      masque: p.masque,
    };
  });
  return { livrable, assertions, sources };
}

/** La preuve est-elle reliée (pour ou contre) à une assertion citée par ce livrable de la mission ? */
export async function preuveCitee(
  db: Db,
  missionId: string,
  livrable: LivrableSources,
  preuveId: string,
): Promise<boolean> {
  const ids = (await assertionsDeMission(db, missionId, ASSERTIONS_MISSION_MAX))
    .filter((a) => assertionCitee(a, livrable))
    .map((a) => a.id);
  if (ids.length === 0) return false;
  return (await liensCourants(db, missionId, ids)).some((l) => l.preuve_id === preuveId);
}
