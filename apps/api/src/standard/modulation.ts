import {
  comparerModulations,
  executerCasTypes,
  appliquerModulation,
  simulerModulation,
  validerContexteModulation,
  type CasTypeModulation,
  type ContexteModulation,
  type DefinitionFacteurContexte,
  type DifferentielModulation,
  type EcartCasType,
  type EffetApplique,
  type ReferentielModulation,
  type RegleModulation,
  type ResultatModulation,
} from "@missionpilot/engines";
import type { ContexteModulationApi } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import type { CasTypeContenu, ContenuMethode } from "./types.js";

/*
 * Pont entre le référentiel et le moteur pur de modulation
 * (`packages/engines/src/modulation`) : définitions des facteurs lues en
 * base, référentiel des codes d'une version, application, simulation, cas
 * types, et conversion des résultats du moteur en clés de l'API (snake_case).
 * Aucun calcul ici : le moteur décide, ce module traduit.
 */

export interface FacteurLigne {
  id: string;
  cabinet_id: string | null;
  code: string;
  libelle: string;
  description: string | null;
  type: DefinitionFacteurContexte["type"];
  valeurs: { code: string; libelle: string }[] | null;
  min: string | null;
  max: string | null;
  porte_par: "dossier" | "mission";
  ordre: number;
}

/** Facteurs visibles : standard puis cabinet (au plus 200 par cabinet, borne de création). */
export async function lireFacteurs(db: Db): Promise<FacteurLigne[]> {
  const r = await db.query(
    `SELECT id, cabinet_id, code, libelle, description, type, valeurs, min::text AS min,
            max::text AS max, porte_par, ordre
     FROM facteurs_contexte ORDER BY cabinet_id NULLS FIRST, ordre, code`,
  );
  return r.rows as FacteurLigne[];
}

/** Définition du moteur (`DefinitionFacteurContexte`) d'un facteur lu en base. */
export function definitionFacteur(f: FacteurLigne): DefinitionFacteurContexte {
  const d: { -readonly [K in keyof DefinitionFacteurContexte]: DefinitionFacteurContexte[K] } = {
    code: f.code,
    type: f.type,
  };
  if (f.valeurs) d.valeurs = f.valeurs.map((v) => v.code);
  if (f.min !== null) d.min = Number(f.min);
  if (f.max !== null) d.max = Number(f.max);
  return d;
}

/** Codes connus d'une version : briques, items, cibles (éléments, briques, rubriques). */
export function referentielVersion(
  contenu: ContenuMethode,
  facteurs: readonly FacteurLigne[],
): ReferentielModulation {
  const briques = contenu.briques.map((b) => b.code);
  const elements = contenu.elements.map((e) => e.code);
  return {
    facteurs: facteurs.map(definitionFacteur),
    briques,
    items: contenu.elements.filter((e) => e.type === "item").map((e) => e.code),
    cibles: [...new Set([...elements, ...briques, ...contenu.rubriques.map((r) => r.code)])],
    recommandations: elements,
  };
}

export const reglesDe = (contenu: ContenuMethode): RegleModulation[] =>
  contenu.regles.map((r) => r.regle as RegleModulation);

export const briquesDeBase = (contenu: ContenuMethode): string[] =>
  contenu.briques.filter((b) => b.active_par_defaut).map((b) => b.code);

/** Contexte conforme aux définitions des facteurs, sinon 400 `CONTEXTE_INVALIDE` (première anomalie). */
export function exigerContexteValide(
  facteurs: readonly FacteurLigne[],
  contexte: ContexteModulationApi,
): ContexteModulation {
  const validation = validerContexteModulation(facteurs.map(definitionFacteur), contexte);
  const premiere = validation.anomalies.find((a) => a.gravite === "erreur");
  if (premiere) {
    throw new AppError(
      400,
      "CONTEXTE_INVALIDE",
      `Contexte invalide (${premiere.chemin}) : ${premiere.message}`,
    );
  }
  return contexte as ContexteModulation;
}

// ---------------------------------------------------------------------------
// Conversion des résultats du moteur en clés de l'API
// ---------------------------------------------------------------------------

const effetApi = (e: EffetApplique) => ({
  cle: e.cle,
  effet: e.effet,
  priorite: e.priorite,
  regles: e.regles,
});

/** Résultat d'application en clés de l'API : c'est la forme stockée dans le journal de la mission. */
export function resultatApi(r: ResultatModulation) {
  return {
    regles_declenchees: r.reglesDeclenchees,
    effets: r.effets.map(effetApi),
    etat: {
      briques_actives: r.etat.briquesActives,
      briques_activees: r.etat.briquesActivees,
      briques_retirees: r.etat.briquesRetirees,
      items_actives: r.etat.itemsActives,
      items_retires: r.etat.itemsRetires,
      ponderations: r.etat.ponderations,
      seuils: r.etat.seuils,
      benchmarks: r.etat.benchmarks,
      gabarits: r.etat.gabarits,
      formulations: r.etat.formulations,
      recommandations_candidates: r.etat.recommandationsCandidates,
      classes_risque_relevees: r.etat.classesRisqueRelevees,
    },
    conflits: r.conflits.map((c) => ({
      cle: c.cle,
      resolu: c.resolu,
      regle_retenue: c.regleRetenue,
      candidats: c.candidats,
    })),
    journal: r.journal.map((j) => ({
      regle: j.regle,
      priorite: j.priorite,
      active: j.active,
      declenchee: j.declenchee,
      verifications: j.verifications,
      effets_retenus: j.effetsRetenus,
      effets_ecartes: j.effetsEcartes,
    })),
  };
}
export type ResultatModulationApi = ReturnType<typeof resultatApi>;

export function differentielApi(d: DifferentielModulation) {
  return {
    identique: d.identique,
    ajoutes: d.ajoutes.map(effetApi),
    retires: d.retires.map(effetApi),
    modifies: d.modifies.map((m) => ({
      cle: m.cle,
      avant: effetApi(m.avant),
      apres: effetApi(m.apres),
    })),
    regles_declenchees: d.reglesDeclenchees,
    regles_eteintes: d.reglesEteintes,
    variation_conflits_non_resolus: d.variationConflitsNonResolus,
  };
}

function ecartApi(e: EcartCasType) {
  if (e.type === "REGLES_DECLENCHEES") {
    return { type: e.type, attendues: e.attendues, obtenues: e.obtenues };
  }
  if (e.type === "CONFLITS") return { type: e.type, attendus: e.attendus, obtenus: e.obtenus };
  return { type: e.type, effet: e.effet };
}

// ---------------------------------------------------------------------------
// Application, simulation, cas types
// ---------------------------------------------------------------------------

export function appliquer(
  contenu: ContenuMethode,
  contexte: ContexteModulation,
): ResultatModulation {
  return appliquerModulation(reglesDe(contenu), contexte, {
    briquesDeBase: briquesDeBase(contenu),
  });
}

/** Même jeu de règles sur deux contextes (STD-05, « simulable avant activation »). */
export function simuler(
  contenu: ContenuMethode,
  avant: ContexteModulation,
  apres: ContexteModulation,
) {
  const s = simulerModulation(reglesDe(contenu), avant, apres, {
    briquesDeBase: briquesDeBase(contenu),
  });
  return {
    avant: resultatApi(s.avant),
    apres: resultatApi(s.apres),
    differentiel: differentielApi(s.differentiel),
  };
}

/** Différentiel entre deux jeux de règles (deux versions) sur un même contexte. */
export function comparerApplications(
  avant: ContenuMethode,
  apres: ContenuMethode,
  contexte: ContexteModulation,
) {
  const a = appliquer(avant, contexte);
  const b = appliquer(apres, contexte);
  return {
    avant: resultatApi(a),
    apres: resultatApi(b),
    differentiel: differentielApi(comparerModulations(a, b)),
  };
}

/** Cas type de l'API → cas du moteur ; briques de base par défaut : celles de la version. */
export function casMoteur(cas: CasTypeContenu, contenu: ContenuMethode): CasTypeModulation {
  const a = cas.cas.attendu;
  return {
    code: cas.code,
    contexte: cas.cas.contexte as ContexteModulation,
    briquesDeBase: cas.cas.briques_de_base ?? briquesDeBase(contenu),
    attendu: {
      ...(a.presents ? { presents: a.presents } : {}),
      ...(a.absents ? { absents: a.absents } : {}),
      ...(a.regles_declenchees ? { reglesDeclenchees: a.regles_declenchees } : {}),
      ...(a.conflits_non_resolus !== undefined
        ? { conflitsNonResolus: a.conflits_non_resolus }
        : {}),
    },
  };
}

/** Rejoue les cas types d'une version (STD-05) ; les écarts sont listés, rien ne lève. */
export function executerCas(contenu: ContenuMethode) {
  const execution = executerCasTypes(
    reglesDe(contenu),
    contenu.cas_types.map((c) => casMoteur(c, contenu)),
  );
  return {
    reussi: execution.reussi,
    reussis: execution.reussis,
    echoues: execution.echoues,
    cas: execution.cas.map((c) => ({
      code: c.code,
      reussi: c.reussi,
      ecarts: c.ecarts.map(ecartApi),
      regles_declenchees: c.resultat.reglesDeclenchees,
      effets: c.resultat.effets.map(effetApi),
    })),
  };
}
export type ExecutionCasApi = ReturnType<typeof executerCas>;
