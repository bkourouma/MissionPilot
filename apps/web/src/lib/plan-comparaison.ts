/**
 * Comparaison de deux versions du modèle financier (PLA-09) : mise en forme des écarts
 * calculés par le moteur de l'API (séries clés du scénario de base, synthèse des trois
 * scénarios, hypothèses modifiées avec leurs valeurs). Logique pure, testée dans
 * `plan-comparaison.test.ts`.
 *
 * RÈGLE : aucun écart n'est calculé ici. `ecart` (arrivée − départ, exact) et
 * `ecart_relatif` (fraction à 4 décimales) viennent TELS QUELS de l'API ; ce module choisit le
 * signe affiché, l'unité (devise, points, nombre) et le sens de l'évolution.
 */
import type { Langue } from "@missionpilot/shared";
import {
  formaterMontantMineur,
  formaterNombre,
  formaterPourcentage,
  VALEUR_ABSENTE,
  type Devise,
} from "./format";
import {
  libelleChemin,
  libelleScenario,
  type ComparaisonModeles,
  type EcartCompare,
  type IndicateurCompare,
  type SerieComparee,
} from "./plan-modele";

const NBSP = " ";
const MOINS = "−";

export type NatureEcart = IndicateurCompare["nature"];
export type SensEcart = "hausse" | "baisse" | "stable" | "indetermine";

/** Sens de l'évolution d'après l'écart du moteur (aucune soustraction ici). */
export function sensEcart(ecart: number | null | undefined): SensEcart {
  if (typeof ecart !== "number" || !Number.isFinite(ecart)) return "indetermine";
  return ecart > 0 ? "hausse" : ecart < 0 ? "baisse" : "stable";
}

export const LIBELLES_SENS: Record<SensEcart, string> = {
  hausse: "en hausse",
  baisse: "en baisse",
  stable: "inchangé",
  indetermine: "non comparable",
};

export const LIBELLES_SENS_EN: Record<SensEcart, string> = {
  hausse: "up",
  baisse: "down",
  stable: "unchanged",
  indetermine: "not comparable",
};

export const libelleSens = (s: SensEcart, langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_SENS_EN : LIBELLES_SENS)[s];

function signe(ecart: number, texte: string): string {
  if (ecart > 0) return `+${texte}`;
  if (ecart < 0) return `${MOINS}${texte}`;
  return texte;
}

/** Valeur d'un indicateur selon sa nature (montant dans la devise, taux en %, nombre). */
export function formaterValeurComparee(
  nature: NatureEcart,
  v: number | null | undefined,
  devise: Devise,
  langue: Langue = "fr",
): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return VALEUR_ABSENTE;
  switch (nature) {
    case "montant":
      return formaterMontantMineur(v, devise, langue);
    case "taux":
      return formaterPourcentage(v, 2, langue);
    case "nombre":
      return formaterNombre(v, 0, langue);
  }
}

/** Écart signé : « +2 000 000 FCFA », « −1,5 pt », « +2 » ; « — » s'il manque. */
export function formaterEcart(
  nature: NatureEcart,
  ecart: number | null | undefined,
  devise: Devise,
  langue: Langue = "fr",
): string {
  if (typeof ecart !== "number" || !Number.isFinite(ecart)) return VALEUR_ABSENTE;
  const absolu = Math.abs(ecart);
  switch (nature) {
    case "montant":
      return signe(ecart, formaterMontantMineur(absolu, devise, langue));
    case "taux": {
      // Fraction → points de pourcentage (0,015 → 1,5 pt), écriture décimale exacte du moteur.
      const points = formaterNombre(absolu * 100, 2, langue);
      return signe(ecart, `${points}${NBSP}${langue === "en" ? "pt" : "pt"}`);
    }
    case "nombre":
      return signe(ecart, formaterNombre(absolu, 0, langue));
  }
}

/** Écart relatif signé (« +1,8 % ») ; « — » s'il n'est pas défini (départ nul, taux). */
export function formaterEcartRelatif(r: number | null | undefined, langue: Langue = "fr"): string {
  if (typeof r !== "number" || !Number.isFinite(r)) return VALEUR_ABSENTE;
  return signe(r, formaterPourcentage(Math.abs(r), 1, langue));
}

export interface LigneEcart {
  cle: string;
  libelle: string;
  de: string;
  a: string;
  ecart: string;
  relatif: string;
  sens: SensEcart;
}

function ligne(
  cle: string,
  libelle: string,
  e: EcartCompare,
  nature: NatureEcart,
  devise: Devise,
  langue: Langue = "fr",
): LigneEcart {
  return {
    cle,
    libelle,
    de: formaterValeurComparee(nature, e.de, devise, langue),
    a: formaterValeurComparee(nature, e.a, devise, langue),
    ecart: formaterEcart(nature, e.ecart, devise, langue),
    relatif: formaterEcartRelatif(e.ecart_relatif, langue),
    sens: sensEcart(e.ecart),
  };
}

/** Lignes d'une série clé (un exercice par ligne), à partir des points du moteur. */
export function lignesEcartsSerie(
  s: SerieComparee,
  devise: Devise,
  langue: Langue = "fr",
): LigneEcart[] {
  return (s.points ?? []).map((p) =>
    ligne(String(p.exercice), String(p.exercice), p, "montant", devise, langue),
  );
}

/** Tableaux de synthèse par scénario (titre et lignes). */
export function tableauxSynthese(
  c: Pick<ComparaisonModeles, "synthese">,
  devise: Devise,
  langue: Langue = "fr",
): { scenario: string; titre: string; lignes: LigneEcart[] }[] {
  return (c.synthese ?? []).map((s) => ({
    scenario: s.scenario,
    titre:
      langue === "en"
        ? `${libelleScenario(s.scenario, langue)} scenario`
        : `Scénario ${libelleScenario(s.scenario).toLowerCase()}`,
    lignes: s.indicateurs.map((i) => ligne(i.cle, i.libelle, i, i.nature, devise, langue)),
  }));
}

/** Valeur brute d'une hypothèse, lisible (nombre, liste par année, objet modifié). */
export function formaterHypothese(v: unknown, langue: Langue = "fr"): string {
  const en = langue === "en";
  if (v === null || v === undefined) return en ? "not provided" : "non renseignée";
  if (typeof v === "number") return formaterNombre(v, 4, langue);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "number")) {
      return v.map((x) => formaterNombre(x as number, 4, langue)).join(" / ");
    }
    return en
      ? `${v.length} item${v.length > 1 ? "s" : ""}`
      : `${v.length} élément${v.length > 1 ? "s" : ""}`;
  }
  return en ? "detailed values" : "valeurs détaillées";
}

/** Hypothèses modifiées : libellé français, valeur de départ et d'arrivée. */
export function lignesHypotheses(
  c: Pick<ComparaisonModeles, "hypotheses_modifiees" | "hypotheses_detail">,
  langue: Langue = "fr",
): { chemin: string; libelle: string; de: string | null; a: string | null }[] {
  const detail = new Map((c.hypotheses_detail ?? []).map((d) => [d.chemin, d]));
  return c.hypotheses_modifiees.map((chemin) => {
    const d = detail.get(chemin);
    return {
      chemin,
      libelle: libelleChemin(chemin, langue),
      de: d ? formaterHypothese(d.de, langue) : null,
      a: d ? formaterHypothese(d.a, langue) : null,
    };
  });
}
