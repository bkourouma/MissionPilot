import { classeRisqueMax, gardesRequises } from "@missionpilot/engines";
import type { ClasseRisque, NatureDerogation } from "@missionpilot/shared";
import type { ResultatModulationApi } from "./modulation.js";
import type { BriqueContenu, ContenuMethode, ElementContenu } from "./types.js";

/*
 * Méthode EFFECTIVE d'une mission (ADR-004, héritage à quatre niveaux) :
 * 1. version figée de la mission (standard, ou variante du cabinet qui en
 *    copie le contenu) : briques actives par défaut ;
 * 2. variante de contexte : résultat du moteur de modulation (briques et
 *    items activés ou retirés, pondérations, seuils, gabarits, formulations,
 *    recommandations, classes de risque relevées) ;
 * 3. mission : dérogations APPROUVÉES, dans l'ordre de leur demande.
 * La classe de risque effective d'une brique est le maximum de sa classe et
 * de la classe relevée par les règles : elle ne baisse jamais, pas même par
 * dérogation. Fonction pure : aucune base, aucune horloge.
 */

export interface DerogationAppliquee {
  id: string;
  brique_code: string;
  nature: NatureDerogation;
  description: string | null;
}

export type OrigineEtat = "methode" | "modulation" | "derogation";

export interface BriqueEffective extends BriqueContenu {
  active: boolean;
  origine: OrigineEtat;
  classe_risque_base: ClasseRisque;
  garde: string | null;
  garde_requise: { etapes: string[]; quatre_yeux: boolean; signature: boolean };
  ajustements: {
    ponderation: number | null;
    seuil: number | null;
    benchmark: string | null;
    gabarit: string | null;
    formulation: string | null;
  };
  adaptations: string[];
  derogations: string[];
}

export interface MethodeEffective {
  etapes: {
    code: string;
    libelle: string;
    description: string | null;
    ordre: number;
    briques: BriqueEffective[];
  }[];
  elements: (ElementContenu & { actif: boolean; origine: OrigineEtat })[];
  /** Ajustements portant sur une autre cible qu'une brique (élément, rubrique). */
  ajustements: Pick<
    ResultatModulationApi["etat"],
    | "ponderations"
    | "seuils"
    | "benchmarks"
    | "gabarits"
    | "formulations"
    | "classes_risque_relevees"
  >;
  recommandations_candidates: string[];
}

function etatBrique(
  b: BriqueContenu,
  modulation: ResultatModulationApi,
  derogations: readonly DerogationAppliquee[],
): Pick<BriqueEffective, "active" | "origine" | "adaptations" | "derogations"> {
  let active = modulation.etat.briques_actives.includes(b.code);
  let origine: OrigineEtat = active === b.active_par_defaut ? "methode" : "modulation";
  const adaptations: string[] = [];
  const ids: string[] = [];
  for (const d of derogations.filter((x) => x.brique_code === b.code)) {
    ids.push(d.id);
    if (d.nature === "adapter_brique") {
      if (d.description) adaptations.push(d.description);
      continue;
    }
    active = d.nature === "activer_brique";
    origine = "derogation";
  }
  return { active, origine, adaptations, derogations: ids };
}

function briqueEffective(
  b: BriqueContenu,
  modulation: ResultatModulationApi,
  derogations: readonly DerogationAppliquee[],
): BriqueEffective {
  const e = modulation.etat;
  const relevee = e.classes_risque_relevees[b.code] as ClasseRisque | undefined;
  const classe = classeRisqueMax(relevee ? [b.classe_risque, relevee] : [b.classe_risque])!;
  const garde = gardesRequises(classe);
  return {
    ...b,
    ...etatBrique(b, modulation, derogations),
    classe_risque_base: b.classe_risque,
    classe_risque: classe,
    garde_requise: {
      etapes: [...garde.etapes],
      quatre_yeux: garde.quatreYeux,
      signature: garde.signature,
    },
    ajustements: {
      ponderation: e.ponderations[b.code] ?? null,
      seuil: e.seuils[b.code] ?? null,
      benchmark: e.benchmarks[b.code] ?? null,
      gabarit: e.gabarits[b.code] ?? null,
      formulation: e.formulations[b.code] ?? null,
    },
  };
}

/** Résout la méthode effective : contenu figé, résultat de modulation, dérogations approuvées. */
export function resoudreMethode(
  contenu: ContenuMethode,
  modulation: ResultatModulationApi,
  derogations: readonly DerogationAppliquee[],
): MethodeEffective {
  const e = modulation.etat;
  const etapes = [...contenu.etapes]
    .sort((a, b) => a.ordre - b.ordre || (a.code < b.code ? -1 : 1))
    .map((etape) => ({
      code: etape.code,
      libelle: etape.libelle,
      description: etape.description,
      ordre: etape.ordre,
      briques: contenu.briques
        .filter((b) => b.etape_code === etape.code)
        .sort((a, b) => a.ordre - b.ordre || (a.code < b.code ? -1 : 1))
        .map((b) => briqueEffective(b, modulation, derogations)),
    }));
  const elements = contenu.elements.map((el) => {
    const active = e.items_actives.includes(el.code);
    const retire = e.items_retires.includes(el.code);
    const actif = active || (el.actif_par_defaut && !retire);
    return {
      ...el,
      actif,
      origine: (actif === el.actif_par_defaut ? "methode" : "modulation") as OrigineEtat,
    };
  });
  return {
    etapes,
    elements,
    ajustements: {
      ponderations: e.ponderations,
      seuils: e.seuils,
      benchmarks: e.benchmarks,
      gabarits: e.gabarits,
      formulations: e.formulations,
      classes_risque_relevees: e.classes_risque_relevees,
    },
    recommandations_candidates: [...e.recommandations_candidates],
  };
}

/** Brique effective par code (lecture ponctuelle par un autre module). */
export function trouverBrique(m: MethodeEffective, code: string): BriqueEffective | null {
  for (const etape of m.etapes) {
    const b = etape.briques.find((x) => x.code === code);
    if (b) return b;
  }
  return null;
}
