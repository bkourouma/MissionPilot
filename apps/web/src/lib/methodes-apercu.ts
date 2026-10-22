/**
 * Aperçu de la mission générée par une version de méthode (STD-11) : types de la réponse de
 * `POST /api/methodes/versions/:id/apercu`, corps de requête et formulations françaises. Les
 * chiffres (jours, répartition par classe, gardes) viennent du moteur de calcul par l'API ; ce
 * fichier ne fait que les mettre en phrases. Testé dans `methodes-apercu.test.ts`.
 */
import {
  apercuMissionSchema,
  TYPE_ELEMENT_LIBELLES,
  type ClasseRisque,
} from "@missionpilot/shared";
import { libelleLisible } from "./codes-lisibles";
import { formaterJours, formaterNombre } from "./format";
import {
  construireContexte,
  libelleEtapeGarde,
  type BriqueEffective,
  type Facteur,
  type ResultatModulation,
  type SaisieContexte,
} from "./methodes";
import type { Resultat } from "./saisie";

/** Mention affichée sur toute page d'aperçu. */
export const MENTION_APERCU =
  "Aperçu : rien n'est enregistré. Les chiffres viennent du moteur de calcul, pas de l'IA.";

export type BriqueApercu = BriqueEffective;

export interface ApercuMission {
  version: {
    id: string;
    version: number;
    statut: string;
    methode_id: string;
    methode_libelle: string;
  };
  contexte: Record<string, unknown>;
  regles_declenchees: string[];
  conflits: {
    cle: string;
    resolu: boolean;
    regle_retenue: string | null;
    candidats?: unknown;
  }[];
  journal: ResultatModulation["journal"];
  methode: {
    etapes: {
      code: string;
      libelle: string;
      description: string | null;
      ordre: number;
      briques: BriqueApercu[];
    }[];
    elements: {
      type: string;
      code: string;
      libelle: string;
      description: string | null;
      essentiel: boolean;
      actif: boolean;
      origine: string;
      brique_code: string | null;
    }[];
    ajustements: {
      ponderations: Record<string, unknown>;
      seuils: Record<string, unknown>;
      benchmarks: Record<string, unknown>;
      gabarits: Record<string, unknown>;
      formulations: Record<string, unknown>;
      classes_risque_relevees: Record<string, string>;
    };
    recommandations_candidates: string[];
  };
  synthese: {
    briques_actives: number;
    briques_inactives: number;
    briques_par_classe: Record<ClasseRisque, number>;
    classe_max: ClasseRisque | null;
    briques_quatre_yeux: number;
    briques_signature: number;
    temps_type_total_jours: number;
    temps_par_etape: { etape_code: string; jours: number }[];
    briques_sans_temps: string[];
    elements_actifs_par_type: Record<string, number>;
  };
}

/** Contexte saisi → corps de l'aperçu (`apercuMissionSchema`) ; facteurs vides omis. */
export function construireCorpsApercu(
  saisie: SaisieContexte,
  facteurs: readonly Facteur[],
): Resultat<{ contexte: Record<string, unknown> }, string> {
  const c = construireContexte(saisie, facteurs);
  if (!c.ok) return c;
  const p = apercuMissionSchema.safeParse({ contexte: c.charge });
  return p.success
    ? { ok: true, charge: p.data }
    : { ok: false, erreurs: { contexte: "Contexte invalide." } };
}

/** Pourquoi une brique est (ou n'est pas) dans la mission, en une phrase. */
export function explicationOrigine(b: Pick<BriqueApercu, "active" | "origine">): string {
  switch (b.origine) {
    case "modulation":
      return b.active
        ? "Activée par une règle de contexte (elle est inactive par défaut)."
        : "Retirée par une règle de contexte (elle est active par défaut).";
    case "derogation":
      return "Modifiée par une dérogation.";
    default:
      return b.active
        ? "Prévue par la méthode, sans règle de contexte."
        : "Inactive par défaut dans la méthode, aucune règle ne l'active.";
  }
}

/** « Classe R2, relevée depuis R1 » ou « Classe R1 » (le libellé de la classe est ajouté par l'écran). */
export function texteClasseEffective(
  b: Pick<BriqueApercu, "classe_risque" | "classe_risque_base">,
) {
  return b.classe_risque === b.classe_risque_base
    ? b.classe_risque
    : `${b.classe_risque}, relevée depuis ${b.classe_risque_base}`;
}

export const briqueRelevee = (b: Pick<BriqueApercu, "classe_risque" | "classe_risque_base">) =>
  b.classe_risque !== b.classe_risque_base;

/** Garde requise : étapes de validation humaine, quatre yeux et signature en toutes lettres. */
export function texteGardeApercu(g: BriqueApercu["garde_requise"]): string {
  if (g.etapes.length === 0) return "Automatique, journalisée";
  const etapes = g.etapes.map(libelleEtapeGarde).join(" → ");
  const marques = [g.quatre_yeux ? "quatre yeux" : null, g.signature ? "signature" : null].filter(
    (m): m is string => m !== null,
  );
  return marques.length > 0 ? `${etapes} (${marques.join(", ")})` : etapes;
}

/** Temps type d'une brique : « 2,5 j » ou « non estimé ». */
export const texteTempsBrique = (jours: number | null): string =>
  jours === null ? "non estimé" : formaterJours(jours);

/** Libellé d'un type d'élément (« Livrable »), sinon le type tel que rendu. */
export function libelleTypeElement(type: string): string {
  return (TYPE_ELEMENT_LIBELLES as Record<string, string>)[type] ?? type;
}

/** Une ligne par classe de risque, de R0 à R3, avec le nombre de briques actives. */
export function repartitionParClasse(
  s: Pick<ApercuMission["synthese"], "briques_par_classe">,
): { classe: ClasseRisque; nombre: number }[] {
  return (["R0", "R1", "R2", "R3"] as const).map((classe) => ({
    classe,
    nombre: s.briques_par_classe[classe] ?? 0,
  }));
}

/** Libellé d'une étape (par son code) pour la répartition du temps ; code si inconnue. */
export function libelleEtapeApercu(a: Pick<ApercuMission, "methode">, code: string): string {
  return a.methode.etapes.find((e) => e.code === code)?.libelle ?? code;
}

/** Ajustements chiffrés ou choisis (pondérations, seuils…) en lignes lisibles. */
export function lignesAjustements(
  a: ApercuMission["methode"]["ajustements"],
  libelles?: Pick<LibellesApercu, "cible">,
): string[] {
  const rubriques: [string, Record<string, unknown>][] = [
    ["Pondération", a.ponderations],
    ["Seuil", a.seuils],
    ["Benchmark", a.benchmarks],
    ["Gabarit", a.gabarits],
    ["Formulation", a.formulations],
    ["Classe de risque relevée", a.classes_risque_relevees],
  ];
  return rubriques.flatMap(([nom, valeurs]) =>
    Object.entries(valeurs).map(
      ([cible, v]) =>
        `${nom} — ${libelles ? libelles.cible(cible) : cible} : ${formaterValeur(v, libelles !== undefined)}`,
    ),
  );
}

function formaterValeur(v: unknown, lisible = false): string {
  if (typeof v === "number") return formaterNombre(v, 4);
  return lisible && typeof v === "string" ? libelleLisible(v).toLowerCase() : String(v);
}

/** Phrase de synthèse du temps type, en tenant compte des briques sans estimation. */
export function phraseTemps(s: ApercuMission["synthese"]): string {
  const base = `Durée type totale : ${formaterJours(s.temps_type_total_jours)}.`;
  return s.briques_sans_temps.length > 0
    ? `${base} ${s.briques_sans_temps.length} brique(s) active(s) sans temps estimé ne sont pas comptées.`
    : base;
}

// --- Libellés des identifiants techniques ----------------------------------------------------

export { libelleLisible };

/** Libellés connus des données de la méthode et du standard (tous facultatifs). */
export interface SourcesLibelles {
  briques?: readonly { code: string; libelle: string }[];
  elements?: readonly { code: string; libelle: string }[];
  regles?: readonly { code: string; libelle?: string | null }[];
  facteurs?: readonly Pick<Facteur, "code" | "libelle" | "valeurs">[];
}

export interface LibellesApercu {
  regle(code: string): string;
  brique(code: string): string;
  /** Brique, élément ou facteur connu ; sinon repli lisible. */
  cible(code: string): string;
  facteur(code: string): string;
  /** Valeur lue d'un facteur : libellé de la valeur énumérée, Oui/Non, nombre à la française. */
  valeur(facteur: string | null, lu: unknown): string;
  /** Clé d'un conflit (« brique:swot ») en « Brique « SWOT » ». */
  cle(cle: string): string;
}

const TYPES_CLE: Record<string, string> = {
  brique: "Brique",
  item: "Élément",
  recommandation: "Recommandation",
  classe_risque: "Classe de risque de",
  ponderation: "Pondération de",
  seuil: "Seuil de",
  gabarit: "Gabarit de",
  formulation: "Formulation de",
  benchmark: "Benchmark de",
};

export function creerLibelles(src: SourcesLibelles = {}): LibellesApercu {
  const index = (l?: readonly { code: string; libelle?: string | null }[]) =>
    new Map((l ?? []).filter((x) => x.libelle).map((x) => [x.code, x.libelle as string]));
  const briques = index(src.briques);
  const elements = index(src.elements);
  const regles = index(src.regles);
  const facteurs = new Map((src.facteurs ?? []).map((f) => [f.code, f]));
  const connu = (m: Map<string, string>, code: string) => m.get(code) ?? libelleLisible(code);
  const cible = (code: string) =>
    briques.get(code) ?? elements.get(code) ?? facteurs.get(code)?.libelle ?? libelleLisible(code);
  return {
    regle: (code) => connu(regles, code),
    brique: (code) => connu(briques, code),
    cible,
    facteur: (code) => facteurs.get(code)?.libelle ?? libelleLisible(code),
    valeur(facteur, lu) {
      if (lu === null || lu === undefined) return "non renseigné";
      if (typeof lu === "boolean") return lu ? "Oui" : "Non";
      if (typeof lu === "number") return formaterNombre(lu, 4);
      const valeurs = facteur ? facteurs.get(facteur)?.valeurs : null;
      const un = (v: unknown) =>
        valeurs?.find((x) => x.code === v)?.libelle ?? libelleLisible(v).toLowerCase();
      return Array.isArray(lu) ? lu.map(un).join(", ") : un(lu);
    },
    cle(cle) {
      const i = cle.indexOf(":");
      if (i < 0) return libelleLisible(cle);
      const type = cle.slice(0, i);
      const reste = cle.slice(i + 1);
      const prefixe = TYPES_CLE[type] ?? libelleLisible(type);
      return `${prefixe} « ${cible(reste)} »`;
    },
  };
}
