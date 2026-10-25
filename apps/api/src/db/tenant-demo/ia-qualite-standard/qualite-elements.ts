import type { KindElementRevue } from "@missionpilot/shared";

/*
 * Éléments de revue guidée (assertions fragiles, chiffres, recommandations) par thème de livrable
 * (QUA-03). Un chiffre porte la source résolue par le moteur de calcul quand il est tracé. Textes
 * fictifs, en français.
 */

export interface ElementModele {
  kind: KindElementRevue;
  libelle: string;
  /** Présent : la source est résolue par le moteur de calcul (chiffre tracé). */
  source?: string;
}

export type Theme =
  "projections" | "retraitement" | "tresorerie" | "plan" | "rapport" | "notation" | "note";

export const ELEMENTS: Record<Theme, ElementModele[]> = {
  projections: [
    {
      kind: "assertion_fragile",
      libelle:
        "L'hypothèse de croissance du marché régional repose sur une seule étude sectorielle.",
    },
    {
      kind: "chiffre",
      libelle: "Chiffre d'affaires projeté à l'horizon du plan (taux de croissance annuel moyen).",
      source: "Moteur de projection financière : compte de résultat prévisionnel",
    },
    {
      kind: "chiffre",
      libelle: "Besoin en fonds de roulement normatif en jours de chiffre d'affaires.",
      source: "Moteur de projection financière : besoin en fonds de roulement",
    },
    {
      kind: "recommandation",
      libelle: "Réviser les hypothèses de prix chaque semestre avec la direction financière.",
    },
    {
      kind: "assertion_fragile",
      libelle:
        "Aucune prise en compte d'une variation du taux de change FCFA / USD sur les achats importés.",
    },
  ],
  retraitement: [
    {
      kind: "chiffre",
      libelle: "Résultat d'exploitation retraité des éléments non récurrents.",
      source: "Moteur de retraitement des états financiers (SYSCOHADA révisé)",
    },
    {
      kind: "chiffre",
      libelle: "Endettement net ajusté des engagements hors bilan.",
      source: "Moteur de retraitement des états financiers (SYSCOHADA révisé)",
    },
    {
      kind: "assertion_fragile",
      libelle: "Les stocks de fin d'exercice ne sont pas confirmés par un inventaire physique.",
    },
    {
      kind: "assertion_fragile",
      libelle:
        "Des créances clients anciennes de plus d'un an sont maintenues à leur valeur d'origine.",
    },
    {
      kind: "recommandation",
      libelle: "Demander la balance âgée des créances au 31 décembre avant la restitution.",
    },
  ],
  tresorerie: [
    {
      kind: "chiffre",
      libelle: "Position de trésorerie nette de départ à la semaine 1.",
      source: "Moteur de trésorerie : position initiale",
    },
    {
      kind: "chiffre",
      libelle: "Besoin de financement cumulé maximal sur 13 semaines.",
      source: "Moteur de trésorerie : plan à 13 semaines",
    },
    {
      kind: "assertion_fragile",
      libelle:
        "Les encaissements des distributeurs supposent le respect des délais contractuels de 45 jours.",
    },
    {
      kind: "recommandation",
      libelle: "Négocier un échelonnement des dettes fiscales avant la semaine 4.",
    },
  ],
  plan: [
    {
      kind: "assertion_fragile",
      libelle: "Le diagnostic externe s'appuie sur des données de parts de marché non datées.",
    },
    {
      kind: "recommandation",
      libelle: "Concentrer les investissements sur les deux axes stratégiques prioritaires.",
    },
    {
      kind: "recommandation",
      libelle: "Désigner un responsable de la mise en œuvre pour chaque initiative du plan.",
    },
    {
      kind: "assertion_fragile",
      libelle: "L'objectif de marge à trois ans n'est pas rapproché de la capacité de production.",
    },
  ],
  rapport: [
    {
      kind: "assertion_fragile",
      libelle:
        "La conclusion sur la qualité de l'information financière repose sur un échantillon restreint de pièces.",
    },
    {
      kind: "chiffre",
      libelle: "Valeur d'entreprise indicative retenue dans la synthèse.",
      source: "Moteur de valorisation : fourchette indicative",
    },
    {
      kind: "recommandation",
      libelle:
        "Subordonner la conclusion de l'opération à la levée des réserves sur le fonds de roulement.",
    },
    {
      kind: "assertion_fragile",
      libelle:
        "Les engagements de garantie de passif ne sont pas encore documentés par le vendeur.",
    },
  ],
  notation: [
    {
      kind: "chiffre",
      libelle: "Score de notation global du dossier.",
      source: "Moteur de notation financière : score global",
    },
    {
      kind: "chiffre",
      libelle: "Ratio de couverture du service de la dette retenu dans la grille.",
      source: "Moteur de notation financière : ratios",
    },
    {
      kind: "assertion_fragile",
      libelle: "Le jugement qualitatif sur la gouvernance repose sur deux entretiens seulement.",
    },
    {
      kind: "recommandation",
      libelle: "Confirmer l'ajustement qualitatif auprès d'un second expert avant diffusion.",
    },
  ],
  note: [
    {
      kind: "assertion_fragile",
      libelle: "La synthèse reprend des déclarations de la direction sans pièce justificative.",
    },
    {
      kind: "recommandation",
      libelle: "Joindre les pièces justificatives au dossier de la mission avant la remise.",
    },
  ],
};
