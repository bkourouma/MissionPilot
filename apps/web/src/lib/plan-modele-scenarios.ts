/** Modèle financier du plan : synthèse, scénarios et alertes. */
import {
  formaterMontantMineur,
  formaterNombre,
  formaterPourcentage,
  VALEUR_ABSENTE,
  type Devise,
} from "./format";
import { formaterPoints, formaterSigne, formaterValeur } from "./plan-modele-format";
import {
  SCENARIO_LIBELLES,
  SCENARIOS,
  type AlertePlan,
  type CodeAlertePlan,
  type EcartsScenario,
  type NomScenario,
  type ResultatPlan,
  type ResultatScenarios,
  type SyntheseResultat,
  type SyntheseScenario,
} from "./plan-modele-types";

// --- Synthèse et scénarios --------------------------------------------------------------------

export interface LigneScenario {
  cle: string;
  libelle: string;
  valeurs: Record<NomScenario, string>;
}

/** Les trois scénarios côte à côte (synthèse du moteur), valeurs déjà mises en forme. */
export function lignesScenarios(
  synthese: readonly SyntheseScenario[],
  devise: Devise,
): LigneScenario[] {
  const par = (s: NomScenario) => synthese.find((x) => x.scenario === s);
  const ligne = (
    cle: string,
    libelle: string,
    lire: (s: SyntheseScenario) => string,
  ): LigneScenario => ({
    cle,
    libelle,
    valeurs: Object.fromEntries(
      SCENARIOS.map((s) => {
        const x = par(s);
        return [s, x ? lire(x) : VALEUR_ABSENTE];
      }),
    ) as Record<NomScenario, string>,
  });
  const m = (v: number) => formaterMontantMineur(v, devise);
  return [
    ligne("ca_final", "Chiffre d'affaires de la dernière année", (s) => m(s.chiffreAffairesFinal)),
    ligne("resultat_cumule", "Résultat net cumulé", (s) => m(s.resultatNetCumule)),
    ligne("tresorerie_finale", "Trésorerie nette finale", (s) => m(s.tresorerieFinale)),
    ligne("van", "Valeur actuelle nette des flux libres", (s) => m(s.valeurActuelleNette)),
    ligne("tri", "Taux de rendement interne", (s) =>
      s.tauxRendementInterne === null
        ? "Non défini"
        : formaterPourcentage(s.tauxRendementInterne, 1),
    ),
    ligne("alertes", "Alertes", (s) =>
      s.nombreAlertes === 0
        ? "Aucune"
        : `${formaterNombre(s.nombreAlertes, 0)} alerte${s.nombreAlertes > 1 ? "s" : ""}`,
    ),
  ];
}

const LIBELLES_ECARTS: Record<keyof EcartsScenario, (v: string) => string> = {
  croissanceChiffreAffaires: (v) => `croissance du chiffre d'affaires ${v} pts`,
  tauxMargeBrute: (v) => `marge brute ${v} pts`,
  tauxChargesVariables: (v) => `charges variables ${v} pts`,
  chargesFixes: (v) => `charges fixes ${v} %`,
  delaiClientsJours: (v) => `délai clients ${v} jours`,
};

/** « croissance du chiffre d'affaires +5 pts ; marge brute +2 pts ; charges fixes −5 % ». */
export function descriptionEcarts(e: EcartsScenario | undefined): string {
  const parties = (Object.keys(LIBELLES_ECARTS) as (keyof EcartsScenario)[])
    .filter((k) => typeof e?.[k] === "number" && e[k] !== 0)
    .map((k) => LIBELLES_ECARTS[k](formaterSigne(e?.[k] as number)));
  return parties.length === 0
    ? "Aucun écart : identique au scénario de base."
    : parties.join(" ; ");
}

/** Indicateurs clés du scénario de base (synthèse du moteur), libellé et valeur mise en forme. */
export function indicateursCles(s: SyntheseResultat, devise: Devise): [string, string][] {
  const m = (v: number) => formaterValeur("montant", v, devise);
  return [
    ["Chiffre d'affaires de la dernière année", m(s.chiffreAffairesFinal)],
    ["Résultat net cumulé", m(s.resultatNetCumule)],
    ["Capacité d'autofinancement cumulée", m(s.capaciteAutofinancementCumulee)],
    ["Trésorerie nette finale", m(s.tresorerieFinale)],
    [
      `Valeur actuelle nette des flux libres (taux ${formaterPoints(s.tauxActualisation)})`,
      m(s.valeurActuelleNette),
    ],
    [
      "Taux de rendement interne des flux libres",
      s.tauxRendementInterne === null
        ? "Non défini"
        : formaterValeur("pourcentage", s.tauxRendementInterne, devise),
    ],
  ];
}

// --- Alertes ----------------------------------------------------------------------------------

export const ALERTES_PLAN: Record<CodeAlertePlan, { libelle: string; explication: string }> = {
  TRESORERIE_NEGATIVE: {
    libelle: "Trésorerie négative",
    explication:
      "La trésorerie nette de clôture est négative : un financement complémentaire (apport, emprunt, découvert négocié) est à prévoir.",
  },
  CAPITAUX_PROPRES_NEGATIFS: {
    libelle: "Capitaux propres négatifs",
    explication: "Les pertes cumulées dépassent les apports : la situation nette est négative.",
  },
  CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL: {
    libelle: "Capitaux propres inférieurs à la moitié du capital social",
    explication:
      "Seuil de l'Acte uniforme OHADA : les associés doivent être consultés sur la poursuite de l'activité.",
  },
  BILAN_DESEQUILIBRE: {
    libelle: "Bilan déséquilibré",
    explication:
      "Actif et passif diffèrent : anomalie du moteur. Ne diffusez pas ce résultat et prévenez le support.",
  },
};

export const GRAVITE_LIBELLES: Record<AlertePlan["gravite"], string> = {
  critique: "Critique",
  attention: "Attention",
};

export function libelleAlerte(code: string): string {
  return ALERTES_PLAN[code as CodeAlertePlan]?.libelle ?? "Alerte du modèle";
}

/** « Critique — Trésorerie négative en 2028 (année 2) : −1 200 000 FCFA, seuil 0 FCFA. » */
export function texteAlerte(a: AlertePlan, devise: Devise): string {
  const gravite = GRAVITE_LIBELLES[a.gravite] ?? "Alerte";
  return `${gravite} — ${libelleAlerte(a.code)} en ${a.exercice} (année ${a.annee}) : ${formaterMontantMineur(a.montant, devise)}, seuil ${formaterMontantMineur(a.seuil, devise)}.`;
}

/** Alertes de chaque scénario, base d'abord (les scénarios sans alerte sont omis). */
export function alertesParScenario(
  r: Pick<ResultatScenarios, NomScenario>,
): { scenario: NomScenario; alertes: AlertePlan[] }[] {
  return SCENARIOS.map((s) => ({ scenario: s, alertes: r[s]?.alertes ?? [] })).filter(
    (x) => x.alertes.length > 0,
  );
}

/** « Scénario base : 2 alertes, dont des alertes critiques ». */
export function titreAlertesScenario(
  scenario: NomScenario,
  alertes: readonly AlertePlan[],
): string {
  const n = alertes.length;
  const critique = alertes.some((a) => a.gravite === "critique");
  return `Scénario ${SCENARIO_LIBELLES[scenario].toLowerCase()} : ${n} alerte${n > 1 ? "s" : ""}${critique ? ", dont des alertes critiques" : ""}`;
}

/** Années de trésorerie négative d'un scénario (d'après ses alertes, pas d'un calcul). */
export function exercicesTresorerieNegative(r: Pick<ResultatPlan, "alertes">): number[] {
  return r.alertes.filter((a) => a.code === "TRESORERIE_NEGATIVE").map((a) => a.exercice);
}

/** Résumé annoncé après une simulation ou affiché sur une version. */
export function resumeAlertes(r: Pick<ResultatScenarios, NomScenario>): string {
  const base = r.base.alertes.length;
  const critiques = r.base.alertes.filter((a) => a.gravite === "critique").length;
  if (base === 0) return "Aucune alerte dans le scénario de base.";
  const s = base > 1 ? "s" : "";
  return `${base} alerte${s} dans le scénario de base, dont ${critiques} critique${critiques > 1 ? "s" : ""}.`;
}
