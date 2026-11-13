/** Modèle financier du plan : synthèse, scénarios et alertes. */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import {
  formaterMontantMineur,
  formaterNombre,
  formaterPourcentage,
  VALEUR_ABSENTE,
  type Devise,
} from "./format";
import { formaterPoints, formaterSigne, formaterValeur } from "./plan-modele-format";
import {
  libelleScenario,
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
  langue: Langue = "fr",
): LigneScenario[] {
  const t = creerTraduire(langue);
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
  const m = (v: number) => formaterMontantMineur(v, devise, langue);
  return [
    ligne(
      "ca_final",
      t("Chiffre d'affaires de la dernière année", "Revenue in the final year"),
      (s) => m(s.chiffreAffairesFinal),
    ),
    ligne("resultat_cumule", t("Résultat net cumulé", "Cumulative net income"), (s) =>
      m(s.resultatNetCumule),
    ),
    ligne("tresorerie_finale", t("Trésorerie nette finale", "Final net cash"), (s) =>
      m(s.tresorerieFinale),
    ),
    ligne(
      "van",
      t("Valeur actuelle nette des flux libres", "Net present value of free cash flows"),
      (s) => m(s.valeurActuelleNette),
    ),
    ligne("tri", t("Taux de rendement interne", "Internal rate of return"), (s) =>
      s.tauxRendementInterne === null
        ? t("Non défini", "Undefined")
        : formaterPourcentage(s.tauxRendementInterne, 1, langue),
    ),
    ligne("alertes", t("Alertes", "Alerts"), (s) =>
      s.nombreAlertes === 0
        ? t("Aucune", "None")
        : `${formaterNombre(s.nombreAlertes, 0, langue)} ${t(`alerte${s.nombreAlertes > 1 ? "s" : ""}`, `alert${s.nombreAlertes > 1 ? "s" : ""}`)}`,
    ),
  ];
}

const LIBELLES_ECARTS_EN: Record<keyof EcartsScenario, (v: string) => string> = {
  croissanceChiffreAffaires: (v) => `revenue growth ${v} pts`,
  tauxMargeBrute: (v) => `gross margin ${v} pts`,
  tauxChargesVariables: (v) => `variable expenses ${v} pts`,
  chargesFixes: (v) => `fixed expenses ${v} %`,
  delaiClientsJours: (v) => `customer payment terms ${v} days`,
};

const LIBELLES_ECARTS: Record<keyof EcartsScenario, (v: string) => string> = {
  croissanceChiffreAffaires: (v) => `croissance du chiffre d'affaires ${v} pts`,
  tauxMargeBrute: (v) => `marge brute ${v} pts`,
  tauxChargesVariables: (v) => `charges variables ${v} pts`,
  chargesFixes: (v) => `charges fixes ${v} %`,
  delaiClientsJours: (v) => `délai clients ${v} jours`,
};

/** « croissance du chiffre d'affaires +5 pts ; marge brute +2 pts ; charges fixes −5 % ». */
export function descriptionEcarts(e: EcartsScenario | undefined, langue: Langue = "fr"): string {
  const table = langue === "en" ? LIBELLES_ECARTS_EN : LIBELLES_ECARTS;
  const parties = (Object.keys(LIBELLES_ECARTS) as (keyof EcartsScenario)[])
    .filter((k) => typeof e?.[k] === "number" && e[k] !== 0)
    .map((k) => table[k](formaterSigne(e?.[k] as number, langue)));
  return parties.length === 0
    ? langue === "en"
      ? "No deviation: identical to the base scenario."
      : "Aucun écart : identique au scénario de base."
    : parties.join(" ; ");
}

/** Indicateurs clés du scénario de base (synthèse du moteur), libellé et valeur mise en forme. */
export function indicateursCles(
  s: SyntheseResultat,
  devise: Devise,
  langue: Langue = "fr",
): [string, string][] {
  const t = creerTraduire(langue);
  const m = (v: number) => formaterValeur("montant", v, devise, langue);
  const taux = formaterPoints(s.tauxActualisation, langue);
  return [
    [
      t("Chiffre d'affaires de la dernière année", "Revenue in the final year"),
      m(s.chiffreAffairesFinal),
    ],
    [t("Résultat net cumulé", "Cumulative net income"), m(s.resultatNetCumule)],
    [
      t("Capacité d'autofinancement cumulée", "Cumulative cash flow from operations (CAF)"),
      m(s.capaciteAutofinancementCumulee),
    ],
    [t("Trésorerie nette finale", "Final net cash"), m(s.tresorerieFinale)],
    [
      t(
        `Valeur actuelle nette des flux libres (taux ${taux})`,
        `Net present value of free cash flows (rate ${taux})`,
      ),
      m(s.valeurActuelleNette),
    ],
    [
      t("Taux de rendement interne des flux libres", "Internal rate of return of free cash flows"),
      s.tauxRendementInterne === null
        ? t("Non défini", "Undefined")
        : formaterValeur("pourcentage", s.tauxRendementInterne, devise, langue),
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

export const ALERTES_PLAN_EN: Record<CodeAlertePlan, { libelle: string; explication: string }> = {
  TRESORERIE_NEGATIVE: {
    libelle: "Negative cash",
    explication:
      "Closing net cash is negative: additional financing (equity, loan, negotiated overdraft) should be planned.",
  },
  CAPITAUX_PROPRES_NEGATIFS: {
    libelle: "Negative equity",
    explication: "Cumulative losses exceed contributions: net position is negative.",
  },
  CAPITAUX_PROPRES_INFERIEURS_MOITIE_CAPITAL: {
    libelle: "Equity below half of share capital",
    explication:
      "OHADA Uniform Act threshold: partners must be consulted on whether to continue the business.",
  },
  BILAN_DESEQUILIBRE: {
    libelle: "Unbalanced balance sheet",
    explication:
      "Assets and liabilities differ: engine anomaly. Do not circulate this result and notify support.",
  },
};

export const alertePlan = (code: CodeAlertePlan, langue: Langue = "fr") =>
  (langue === "en" ? ALERTES_PLAN_EN : ALERTES_PLAN)[code];

export const GRAVITE_LIBELLES_EN: Record<AlertePlan["gravite"], string> = {
  critique: "Critical",
  attention: "Warning",
};

export const libelleGravite = (g: AlertePlan["gravite"], langue: Langue = "fr") =>
  (langue === "en" ? GRAVITE_LIBELLES_EN : GRAVITE_LIBELLES)[g];

export const GRAVITE_LIBELLES: Record<AlertePlan["gravite"], string> = {
  critique: "Critique",
  attention: "Attention",
};

export function libelleAlerte(code: string, langue: Langue = "fr"): string {
  return (
    (langue === "en" ? ALERTES_PLAN_EN : ALERTES_PLAN)[code as CodeAlertePlan]?.libelle ??
    (langue === "en" ? "Model alert" : "Alerte du modèle")
  );
}

/** « Critique — Trésorerie négative en 2028 (année 2) : −1 200 000 FCFA, seuil 0 FCFA. » */
export function texteAlerte(a: AlertePlan, devise: Devise, langue: Langue = "fr"): string {
  if (langue === "en") {
    const graviteEn = GRAVITE_LIBELLES_EN[a.gravite] ?? "Alert";
    return `${graviteEn} — ${libelleAlerte(a.code, langue)} in ${a.exercice} (year ${a.annee}): ${formaterMontantMineur(a.montant, devise, langue)}, threshold ${formaterMontantMineur(a.seuil, devise, langue)}.`;
  }
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
  langue: Langue = "fr",
): string {
  const n = alertes.length;
  const critique = alertes.some((a) => a.gravite === "critique");
  if (langue === "en") {
    return `${libelleScenario(scenario, langue)} scenario: ${n} alert${n > 1 ? "s" : ""}${critique ? ", including critical alerts" : ""}`;
  }
  return `Scénario ${libelleScenario(scenario).toLowerCase()} : ${n} alerte${n > 1 ? "s" : ""}${critique ? ", dont des alertes critiques" : ""}`;
}

/** Années de trésorerie négative d'un scénario (d'après ses alertes, pas d'un calcul). */
export function exercicesTresorerieNegative(r: Pick<ResultatPlan, "alertes">): number[] {
  return r.alertes.filter((a) => a.code === "TRESORERIE_NEGATIVE").map((a) => a.exercice);
}

/** Résumé annoncé après une simulation ou affiché sur une version. */
export function resumeAlertes(
  r: Pick<ResultatScenarios, NomScenario>,
  langue: Langue = "fr",
): string {
  const base = r.base.alertes.length;
  const critiques = r.base.alertes.filter((a) => a.gravite === "critique").length;
  if (langue === "en") {
    if (base === 0) return "No alerts in the base scenario.";
    return `${base} alert${base > 1 ? "s" : ""} in the base scenario, including ${critiques} critical.`;
  }
  if (base === 0) return "Aucune alerte dans le scénario de base.";
  const s = base > 1 ? "s" : "";
  return `${base} alerte${s} dans le scénario de base, dont ${critiques} critique${critiques > 1 ? "s" : ""}.`;
}
