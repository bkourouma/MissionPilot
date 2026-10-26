import { libelleVerdict, montantXof, type FaitsDossier } from "./dd-notes-faits.js";

/*
 * Textes des notes de la due diligence Mboa Solaire (gabarit déterministe : aucune clé IA). Tous
 * les chiffres viennent de `FaitsDossier` (lus par les routes, donc issus des moteurs) ; les
 * phrases ne qualifient rien juridiquement et ne portent aucune donnée interne du cabinet
 * (coûts, taux, marges : FIN-02). Une note porte une recommandation, une synthèse (≤ 4 000
 * caractères) et des conditions (≤ 300 caractères chacune).
 */

export type Recommandation = "favorable" | "favorable_sous_conditions" | "reservee" | "defavorable";

export interface Contenu {
  recommandation: Recommandation;
  synthese: string;
  conditions: string[];
}

export interface DefNoteTheme {
  titre: string;
  /** Brouillon initial (version 1). */
  v1: Contenu;
  /** Révision de l'équipe (version 2), soumise telle quelle. */
  v2: Contenu;
  motifRevision: string;
}

const paragraphes = (...p: string[]): string => p.join("\n\n");

function resumeHypotheses(f: FaitsDossier): string {
  const n = (v: string) => f.hypotheses.filter((h) => libelleVerdict(h.verdict) === v).length;
  const lignes = f.hypotheses.map((h) => `- ${h.libelle} : ${libelleVerdict(h.verdict)}.`);
  return paragraphes(
    `Sur ${f.hypotheses.length} hypothèses de travail, ${n("infirmée")} sont infirmées, ${n("non concluante")} non concluantes et ${n("confirmée")} confirmées (verdicts validés par un tiers, indication du moteur suivie).`,
    lignes.join("\n"),
  );
}

function lectureMarche(f: FaitsDossier): string {
  const lignes = f.marche.map(
    (m) =>
      `- méthode ${m.methode === "ascendant" ? "ascendante" : "descendante"} : ${montantXof(m.base)} (de ${montantXof(m.bas)} à ${montantXof(m.haut)}), ${m.avisExpert} paramètre(s) sur ${m.total} reposant sur un avis d'expert.`,
  );
  const recoupement =
    f.ecartMarchePourcent === null
      ? "Le recoupement des méthodes n'est pas disponible."
      : `Les deux bases diffèrent de ${f.ecartMarchePourcent} %${f.alerteMarche ? ", ce qui appelle une vigilance" : " et les fourchettes se chevauchent : aucune alerte de recoupement"}.`;
  return paragraphes(
    `Marché additionnel accessible à ${f.cible} en 2026-2027, d'après le moteur de dimensionnement :`,
    lignes.join("\n"),
    recoupement,
  );
}

function lectureSources(f: FaitsDossier): string {
  const { solides, etayees, fragiles } = f.sources;
  return `Solidité des affirmations du dossier : ${solides} solides, ${etayees} étayées, ${fragiles} fragiles. Les affirmations fragiles sont des points à confirmer, non des constats.`;
}

/** Quatre notes par thème (marché, risques, environnement et social, plan des 100 jours). */
export function notesThemes(f: FaitsDossier): DefNoteTheme[] {
  const ajout = (t: string) => `Lecture de l'équipe : ${t}`;
  return [
    {
      titre: `Marché et positionnement commercial — ${f.cible}`,
      motifRevision: "Intégration des remarques de relecture sur le carnet de commandes.",
      v1: {
        recommandation: "reservee",
        synthese: paragraphes(
          lectureMarche(f),
          "Brouillon : la lecture commerciale reste à compléter.",
        ),
        conditions: [],
      },
      v2: {
        recommandation: "reservee",
        synthese: paragraphes(
          lectureMarche(f),
          ajout(
            "les volumes visés dépendent d'un carnet de commandes que les pièces reçues ne permettent pas de confirmer à ce stade ; le tarif moyen de vente n'est pas tenable sur l'ensemble du portefeuille clients.",
          ),
          resumeHypotheses(f),
        ),
        conditions: [
          "Obtenir les contrats signés correspondant au carnet de commandes présenté.",
          "Recalculer le chiffre d'affaires 2026 avec un tarif de vente différencié par catégorie de clients.",
        ],
      },
    },
    {
      titre: `Risques opérationnels, de change et de réglementation — ${f.cible}`,
      motifRevision: "Ajout des constats de signaux et de la lecture des sources.",
      v1: {
        recommandation: "reservee",
        synthese: paragraphes(
          `Le dossier recense ${f.risquesTotal} risques, dont ${f.risquesEleves} de niveau élevé.`,
          "Brouillon : les mesures d'atténuation restent à documenter.",
        ),
        conditions: [],
      },
      v2: {
        recommandation: "reservee",
        synthese: paragraphes(
          `Le dossier recense ${f.risquesTotal} risques, dont ${f.risquesEleves} de niveau élevé (familles pays, change, opérationnel et réglementaire).`,
          `Sur ${f.signauxApplicables} signaux de la bibliothèque applicables au secteur, ${f.signauxConstates} sont constatés dans le dossier.`,
          lectureSources(f),
          ajout(
            "les installations ne respectent pas la garantie de performance affichée et le coût de maintenance du plan d'affaires est sous-estimé ; ces deux points pèsent sur la marge d'exploitation de la cible.",
          ),
        ),
        conditions: [
          "Faire établir un état contradictoire des performances des installations sous garantie.",
          "Couvrir l'exposition au change sur les équipements importés avant tout engagement.",
        ],
      },
    },
    {
      titre: `Revue environnementale et sociale — ${f.cible}`,
      motifRevision: "Précision des thèmes à niveau modéré.",
      v1: {
        recommandation: "favorable_sous_conditions",
        synthese: paragraphes(
          `Le filtrage environnemental et social porte sur ${f.esThemes} thèmes ; niveau global : ${f.esNiveau ?? "non évalué"}.`,
          "Brouillon.",
        ),
        conditions: ["Suivre les thèmes à niveau modéré dans le plan des 100 jours."],
      },
      v2: {
        recommandation: "favorable_sous_conditions",
        synthese: paragraphes(
          `Le filtrage environnemental et social porte sur ${f.esThemes} thèmes ; niveau global : ${f.esNiveau ?? "non évalué"}, avec ${f.esBloquantes} correspondance bloquante avec la liste d'exclusion du cabinet.`,
          `${f.esModeres} thème(s) ressortent à un niveau au moins modéré.`,
          "Sur ce seul plan environnemental et social, l'opération n'appelle pas de réserve, sous conditions de suivi.",
        ),
        conditions: [
          "Suivre les thèmes à niveau modéré par des indicateurs dès les cent premiers jours.",
          "Obtenir un état des pratiques de collecte et de recyclage des équipements en fin de vie.",
        ],
      },
    },
    {
      titre: `Plan des 100 premiers jours — ${f.cible}`,
      motifRevision: "Mise en cohérence du plan avec les verdicts validés.",
      v1: {
        recommandation: "reservee",
        synthese: paragraphes(
          `Le plan compte ${f.actions.length} actions.`,
          "Brouillon : les responsables restent à confirmer.",
        ),
        conditions: [],
      },
      v2: {
        recommandation: "reservee",
        synthese: paragraphes(
          `Le plan compte ${f.actions.length} actions, rattachées aux points faibles relevés par les verdicts :`,
          f.actions.map((a) => `- ${a}`).join("\n"),
          ajout(
            "le plan est exécutable si la décision d'engagement est prise ; il ne lève pas à lui seul les réserves de la note au comité.",
          ),
        ),
        conditions: ["Désigner un responsable pour chaque action avant la décision d'engagement."],
      },
    },
  ];
}

/** Conditions de la note au comité (première publication : portée de deux conditions imprécise). */
const CONDITIONS_V1 = [
  "Réviser le modèle financier avec un coût de maintenance revu à la hausse.",
  "Obtenir un état des installations sous garantie de performance.",
  "Soumettre le tarif de vente à une revue contrat par contrat auprès des principaux clients.",
  "Confirmer le renouvellement des contrats de maintenance par des échanges directs avec les clients.",
];
const CONDITIONS_V2 = [
  CONDITIONS_V1[0] ?? "",
  "Obtenir, pour chaque site concerné, un état contradictoire des installations sous garantie de performance et les mesures correctives engagées.",
  "Soumettre le tarif de vente du plan d'affaires à une revue contrat par contrat auprès des principaux clients, en priorité les clients commerciaux.",
  CONDITIONS_V1[3] ?? "",
];

function corpsComite(f: FaitsDossier, avecSources: boolean): string {
  const date = f.dateOperation ?? "la date prévue";
  return paragraphes(
    `Opération examinée : ${f.titre} (date de l'opération retenue pour le plan des 100 jours : ${date}).`,
    `Recommandation : réservée. L'équipe ne recommande pas l'engagement dans les conditions du plan d'affaires présenté par le vendeur.`,
    resumeHypotheses(f),
    lectureMarche(f),
    `Risques : ${f.risquesTotal} risques recensés, dont ${f.risquesEleves} de niveau élevé. Environnement et social : niveau global ${f.esNiveau ?? "non évalué"}, ${f.esBloquantes} correspondance bloquante.`,
    `Plan des 100 jours : ${f.actions.length} actions suivies jusqu'à leur achèvement pour sécuriser la reprise.`,
    ...(avecSources
      ? [
          lectureSources(f),
          "Les deux avis d'expert qui n'étaient pas signés ont été relus et signés par un associé avant la présentation de cette note.",
        ]
      : []),
    "Cette note est établie à partir des seules pièces transmises à la date de rédaction ; elle ne vaut ni garantie ni qualification juridique.",
  );
}

export function contenuComite(f: FaitsDossier, version: "initiale" | "corrigee"): Contenu {
  return {
    recommandation: "reservee",
    synthese: corpsComite(f, version === "corrigee"),
    conditions: version === "corrigee" ? CONDITIONS_V2 : CONDITIONS_V1,
  };
}

/** Brouillon de la note au comité (version 1) : synthèse courte avant la relecture. */
export function brouillonComite(f: FaitsDossier): Contenu {
  return {
    recommandation: "reservee",
    synthese: paragraphes(
      `Opération examinée : ${f.titre}.`,
      resumeHypotheses(f),
      "Brouillon : marché, risques et plan à intégrer.",
    ),
    conditions: [],
  };
}

/** Reprise de la note environnementale et sociale après rejet : précision des thèmes modérés. */
export function precisionEs(f: FaitsDossier): string {
  return `Précision : ${f.esModeres} thème(s) sur ${f.esThemes} ressortent à un niveau au moins modéré et font l'objet d'un suivi dédié ; les autres thèmes sont non concernés ou à niveau faible, sans enjeu pour la décision.`;
}

export const TITRE_COMITE = (cible: string): string => `Note au comité d'investissement — ${cible}`;
export const MOTIF_REVISION_COMITE = "Intégration des notes par thème et des conditions.";
export const MOTIF_CORRECTION_COMITE =
  "Précision de la portée de deux conditions et ajout de la couverture des sources, constatées après la première publication.";
export const MOTIF_REJET_ES =
  "La synthèse ne distingue pas les thèmes à niveau modéré de ceux sans enjeu : à préciser avant validation.";
