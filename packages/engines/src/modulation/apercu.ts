/**
 * Aperçu d'une version de méthode (STD-11) : synthèse chiffrée des briques et
 * éléments actifs. Les temps sont additionnés en centièmes de jour entiers,
 * puis ramenés en jours : aucun arrondi flottant visible. Fonction pure.
 */
import { classeRisqueMax, type ClasseRisque } from "../qualite/classes";
import { gardesRequises } from "../qualite/gardes";
import { comparerCodes } from "./effets";

export interface BriqueApercuEntree {
  code: string;
  etape_code: string;
  active: boolean;
  classe_risque: "R0" | "R1" | "R2" | "R3";
  temps_type_jours: number | null;
}
export interface ElementApercuEntree {
  type: string;
  actif: boolean;
}
export interface SyntheseApercu {
  briques_actives: number;
  briques_inactives: number;
  briques_par_classe: Record<"R0" | "R1" | "R2" | "R3", number>;
  classe_max: "R0" | "R1" | "R2" | "R3" | null;
  briques_quatre_yeux: number;
  briques_signature: number;
  temps_type_total_jours: number;
  /** Étapes qui comptent au moins une brique active ; jours = 0 si aucune n'a de temps. */
  temps_par_etape: { etape_code: string; jours: number }[];
  briques_sans_temps: string[];
  elements_actifs_par_type: Record<string, number>;
}

export function synthetiserApercu(
  briques: readonly BriqueApercuEntree[],
  elements: readonly ElementApercuEntree[],
): SyntheseApercu {
  const actives = briques.filter((b) => b.active);
  const parClasse: Record<ClasseRisque, number> = { R0: 0, R1: 0, R2: 0, R3: 0 };
  let quatreYeux = 0;
  let signature = 0;
  let total = 0;
  const parEtape = new Map<string, number>();
  const sansTemps: string[] = [];
  for (const b of actives) {
    parClasse[b.classe_risque] += 1;
    const garde = gardesRequises(b.classe_risque);
    if (garde.quatreYeux) quatreYeux += 1;
    if (garde.signature) signature += 1;
    let c = 0;
    if (b.temps_type_jours === null) sansTemps.push(b.code);
    else c = Math.round(b.temps_type_jours * 100);
    total += c;
    parEtape.set(b.etape_code, (parEtape.get(b.etape_code) ?? 0) + c);
  }
  const parType = new Map<string, number>();
  for (const el of elements) if (el.actif) parType.set(el.type, (parType.get(el.type) ?? 0) + 1);
  const elementsActifs: Record<string, number> = {};
  for (const type of [...parType.keys()].sort(comparerCodes)) {
    elementsActifs[type] = parType.get(type)!;
  }
  return {
    briques_actives: actives.length,
    briques_inactives: briques.length - actives.length,
    briques_par_classe: parClasse,
    classe_max: classeRisqueMax(actives.map((b) => b.classe_risque)),
    briques_quatre_yeux: quatreYeux,
    briques_signature: signature,
    temps_type_total_jours: total / 100,
    temps_par_etape: [...parEtape.keys()]
      .sort(comparerCodes)
      .map((etape_code) => ({ etape_code, jours: parEtape.get(etape_code)! / 100 })),
    briques_sans_temps: sansTemps.sort(comparerCodes),
    elements_actifs_par_type: elementsActifs,
  };
}
