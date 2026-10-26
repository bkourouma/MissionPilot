import {
  ECHELLE_ACCORD,
  ECHELLE_MATURITE,
  type DefinitionQuestionnaireDonnees,
  type QuestionQuestionnaire,
} from "@missionpilot/shared";

/*
 * Définitions de questionnaires propres au Tenant démo (en plus des deux gabarits génériques de
 * MissionPilot : « notation_generique » et « preliminaire_dirigeants »). Les options des choix
 * sont rangées de la moins favorable à la plus favorable.
 */

const accord = (id: string, libelle: string): QuestionQuestionnaire => ({
  id,
  type: "likert",
  libelle,
  obligatoire: true,
  points: 5,
  libelles: [...ECHELLE_ACCORD],
});

const maturite = (id: string, libelle: string): QuestionQuestionnaire => ({
  id,
  type: "likert",
  libelle,
  obligatoire: true,
  points: 5,
  libelles: [...ECHELLE_MATURITE],
});

const commentaire = (id: string, libelle: string): QuestionQuestionnaire => ({
  id,
  type: "texte",
  libelle,
  obligatoire: false,
  longueurMax: 1500,
});

export const SATISFACTION_CLIENT: DefinitionQuestionnaireDonnees = {
  id: "satisfaction-client",
  version: 1,
  titre: "Satisfaction du client en fin de mission",
  sections: [
    {
      id: "relation",
      titre: "La relation avec l'équipe du cabinet",
      questions: [
        accord("sat.ecoute", "L'équipe a bien compris nos enjeux et nos contraintes."),
        accord(
          "sat.disponibilite",
          "L'équipe a été disponible et réactive tout au long de la mission.",
        ),
        accord(
          "sat.competence",
          "Les consultants ont apporté une expertise utile à notre contexte.",
        ),
      ],
    },
    {
      id: "resultats",
      titre: "Les résultats de la mission",
      questions: [
        accord("sat.livrables", "Les livrables sont clairs et utilisables par nos équipes."),
        {
          id: "sat.objectifs",
          type: "oui_non",
          libelle: "Les objectifs de la mission ont-ils été atteints ?",
          obligatoire: true,
        },
        {
          id: "sat.delais",
          type: "choix_unique",
          libelle: "Comment jugez-vous le respect des délais convenus ?",
          obligatoire: true,
          options: [
            { code: "retards_importants", libelle: "Retards importants" },
            { code: "retards_limites", libelle: "Quelques retards limités" },
            { code: "respectes", libelle: "Délais respectés" },
            { code: "devances", libelle: "Délais devancés" },
          ],
        },
      ],
    },
    {
      id: "recommandation",
      titre: "Votre recommandation",
      questions: [
        {
          id: "sat.recommandation",
          type: "numerique",
          libelle: "Sur une échelle de 0 à 10, recommanderiez-vous le cabinet à un confrère ?",
          obligatoire: true,
          min: 0,
          max: 10,
          entier: true,
          unite: "points",
        },
        commentaire(
          "sat.commentaire",
          "Un commentaire ou une suggestion pour améliorer notre accompagnement ?",
        ),
      ],
    },
  ],
};

export const CLIMAT_SOCIAL: DefinitionQuestionnaireDonnees = {
  id: "climat-social",
  version: 1,
  titre: "Baromètre du climat social de la direction",
  sections: [
    {
      id: "communication",
      titre: "Communication et confiance",
      questions: [
        accord("clim.information", "Je reçois à temps les informations utiles à mon travail."),
        accord("clim.confiance", "La confiance règne entre les membres de l'équipe de direction."),
        accord("clim.expression", "Je peux exprimer un désaccord sans crainte de conséquences."),
      ],
    },
    {
      id: "charge",
      titre: "Charge de travail et reconnaissance",
      questions: [
        {
          id: "clim.charge",
          type: "choix_unique",
          libelle: "Comment décririez-vous votre charge de travail actuelle ?",
          obligatoire: true,
          options: [
            { code: "excessive", libelle: "Excessive, de façon durable" },
            { code: "forte", libelle: "Forte, avec des pics" },
            { code: "equilibree", libelle: "Équilibrée" },
          ],
        },
        accord("clim.reconnaissance", "Mon travail est reconnu à sa juste valeur."),
        {
          id: "clim.sujets",
          type: "choix_multiple",
          libelle: "Quels sujets méritent le plus d'attention dans les six prochains mois ?",
          obligatoire: false,
          options: [
            { code: "organisation", libelle: "Organisation du travail" },
            { code: "competences", libelle: "Développement des compétences" },
            { code: "remuneration", libelle: "Rémunération et avantages" },
            { code: "communication", libelle: "Communication interne" },
          ],
          minSelections: 1,
          maxSelections: 3,
        },
        commentaire("clim.commentaire", "Que changeriez-vous en priorité ?"),
      ],
    },
  ],
};

export const DIAGNOSTIC_FINANCIER: DefinitionQuestionnaireDonnees = {
  id: "diagnostic-financier",
  version: 1,
  titre: "Auto-diagnostic de la gestion financière",
  sections: [
    {
      id: "chiffres",
      titre: "Repères chiffrés",
      questions: [
        {
          id: "fin.delai_clients",
          type: "numerique",
          libelle: "Délai moyen de paiement de vos clients",
          obligatoire: true,
          min: 0,
          max: 365,
          entier: true,
          unite: "jours",
        },
        {
          id: "fin.delai_fournisseurs",
          type: "numerique",
          libelle: "Délai moyen de paiement de vos fournisseurs",
          obligatoire: true,
          min: 0,
          max: 365,
          entier: true,
          unite: "jours",
        },
        {
          id: "fin.part_export",
          type: "numerique",
          libelle: "Part du chiffre d'affaires réalisée hors de la zone d'implantation",
          obligatoire: false,
          min: 0,
          max: 100,
          unite: "%",
        },
      ],
    },
    {
      id: "pratiques",
      titre: "Pratiques de gestion",
      questions: [
        maturite("fin.budget", "L'entreprise établit un budget annuel suivi chaque mois."),
        maturite("fin.tresorerie", "La trésorerie est prévue et suivie à intervalles réguliers."),
        {
          id: "fin.covenants",
          type: "oui_non",
          libelle: "Des engagements financiers (covenants) encadrent-ils vos crédits ?",
          obligatoire: true,
        },
        {
          id: "fin.audit",
          type: "choix_unique",
          libelle: "Vos comptes sont-ils audités ?",
          obligatoire: true,
          options: [
            { code: "non", libelle: "Non, comptes établis en interne" },
            { code: "examen", libelle: "Examen limité par un expert-comptable" },
            { code: "commissaire", libelle: "Audit légal par un commissaire aux comptes" },
          ],
        },
        commentaire(
          "fin.commentaire",
          "Un point particulier sur lequel vous souhaitez un avis du cabinet ?",
        ),
      ],
    },
  ],
};
