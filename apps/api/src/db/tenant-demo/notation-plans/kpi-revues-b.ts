import type { SpecAction, SpecRevue } from "./kpi-types.js";

/* Revues et actions des missions 6 (Baobab Assurances), 9 (Banque du Sahel) et 10 (Sicafe Export). */

export const REVUES_BAOBAB: SpecRevue[] = [
  {
    titre: "Revue de performance — lancement du plan 2026-2030",
    date: "2026-08-21",
    etat: "cloturee",
    compteRendu:
      "Les primes progressent, mais le délai de règlement des sinistres se dégrade depuis mai et le taux de résiliation reste au-dessus de la cible. Le comité retient deux chantiers prioritaires et écarte l'extension de l'enquête de satisfaction.",
    decisions: [
      {
        libelle: "Réduire le délai moyen de règlement des sinistres sous 30 jours",
        kpi: "bao.reglement",
        responsable: "chef",
        echeance: "2026-09-25",
        fin: "executee",
        commentaire:
          "Circuit court de règlement en place pour les petits sinistres ; objectif intermédiaire atteint.",
        actions: [
          {
            titre: "Instaurer un circuit court pour les sinistres de moins de 500 000 FCFA",
            description:
              "Règlement sans expertise pour les sinistres automobiles de faible montant.",
            kpi: "bao.reglement",
            responsable: "membre",
            echeance: "2026-09-15",
            fin: "terminee",
            dateEffet: "2026-09-01",
            commentaire: "Date d'effet : ouverture du circuit court le 1er septembre 2026.",
            alerte: "DEGRADATION_CONSECUTIVE",
            commentaires: ["Seuil de 500 000 FCFA validé par la direction technique."],
          },
        ],
      },
      {
        libelle: "Contenir le taux de résiliation sous 0,8 % par un programme de fidélisation",
        kpi: "bao.resiliation",
        responsable: "directeur",
        echeance: "2026-09-18",
        fin: "executee",
        commentaire:
          "Programme de rappel des assurés démissionnaires déployé dans les douze agences.",
        actions: [
          {
            titre: "Rappeler les assurés ayant demandé une résiliation",
            description: "Appel sous 48 heures par l'agence avec une offre de maintien du contrat.",
            kpi: "bao.resiliation",
            responsable: "chef",
            echeance: "2026-07-31",
            fin: "terminee",
            dateEffet: "2026-07-20",
            commentaire:
              "Date d'effet : premier cycle d'appels réalisé la semaine du 20 juillet 2026.",
          },
        ],
      },
      {
        libelle: "Étendre l'enquête de satisfaction aux assurés de la branche santé",
        kpi: "bao.nps",
        responsable: "membre",
        echeance: "2026-09-30",
        fin: "abandonnee",
        motif:
          "Budget d'enquête non retenu pour 2026 : le sujet est reporté au plan de l'an prochain.",
        actions: [],
      },
    ],
  },
  {
    titre: "Revue exceptionnelle — sinistralité de la branche santé",
    date: "2026-09-04",
    etat: "annulee",
    decisions: [],
  },
  {
    titre: "Revue de performance — point d'étape de fin d'année",
    date: "2026-11-13",
    etat: "planifiee",
    compteRendu:
      "Ordre du jour proposé par le moteur à partir des KPI en alerte ; à compléter avant la séance.",
    decisions: [],
  },
];

export const ACTIONS_BAOBAB: SpecAction[] = [
  {
    titre: "Relancer les experts dont le rapport dépasse dix jours",
    description:
      "Suivi hebdomadaire des dossiers en attente d'expertise et relance automatique des experts.",
    kpi: "bao.reglement",
    responsable: "membre",
    echeance: "2026-09-30",
    fin: "en_cours",
    commentaires: [
      "Liste des dossiers en attente extraite ; relances en cours avec les cinq experts principaux.",
    ],
  },
  {
    titre: "Revoir la tarification de la branche automobile",
    description:
      "Réévaluer les tarifs pour ramener le ratio sinistres / primes vers la cible de 62 %.",
    kpi: "bao.sp",
    responsable: "directeur",
    echeance: "2026-09-30",
    fin: "a_faire",
  },
  {
    titre: "Enquête de satisfaction sur le délai de règlement",
    description:
      "Mesurer le ressenti des assurés avant et après la mise en place du circuit court.",
    kpi: "bao.nps",
    responsable: "membre",
    echeance: "2026-09-30",
    fin: "abandonnee",
    motif: "Remplacée par la décision de la revue d'août : le NPS suit déjà la même population.",
  },
];

export const REVUES_BANQUE: SpecRevue[] = [
  {
    titre: "Revue de performance — cadrage de la notation du portefeuille PME",
    date: "2026-09-18",
    etat: "tenue",
    compteRendu:
      "Le taux de créances douteuses a franchi 8,5 % en août et continue de monter. L'encours du mois arrive tard de la direction des engagements. Le délai de traitement des dossiers doit être réduit avant la restitution de la notation.",
    decisions: [
      {
        libelle:
          "Isoler les dossiers PME à créances douteuses de plus de 90 jours pour la notation",
        kpi: "ban.douteuses",
        responsable: "membre",
        echeance: "2026-09-30",
        fin: "en_cours",
        actions: [
          {
            titre: "Extraire la liste des dossiers douteux de plus de 90 jours",
            description: "Extraction du système de crédit, avec ancienneté et garanties associées.",
            kpi: "ban.douteuses",
            responsable: "membre",
            echeance: "2026-09-28",
            fin: "en_cours",
            alerte: "SEUIL_HAUT",
          },
        ],
      },
      {
        libelle: "Fiabiliser la remontée mensuelle de l'encours par la direction des engagements",
        kpi: "ban.encours",
        responsable: "chef",
        echeance: "2026-09-30",
        fin: "ouverte",
        actions: [
          {
            titre:
              "Formaliser le calendrier de clôture mensuelle avec la direction des engagements",
            description: "Date butoir de transmission de l'encours fixée au cinquième jour ouvré.",
            kpi: "ban.encours",
            responsable: "chef",
            echeance: "2026-09-30",
            fin: "a_faire",
          },
        ],
      },
      {
        libelle: "Réduire le délai de traitement des dossiers de crédit PME",
        kpi: "ban.delai",
        responsable: "chef",
        echeance: "2026-09-30",
        fin: "executee",
        commentaire: "Circuit de validation à deux niveaux en place depuis le 22 septembre 2026.",
        actions: [
          {
            titre: "Supprimer la contre-signature pour les dossiers de moins de 20 MFCFA",
            description:
              "Délégation de signature aux responsables d'agence pour les petits dossiers.",
            kpi: "ban.delai",
            responsable: "membre",
            echeance: "2026-09-25",
            fin: "terminee",
            dateEffet: "2026-09-22",
            commentaire: "Date d'effet : note de service du 22 septembre 2026.",
          },
        ],
      },
    ],
  },
  {
    titre: "Revue de performance — restitution de la notation",
    date: "2026-11-13",
    etat: "planifiee",
    decisions: [],
  },
];

export const ACTIONS_BANQUE: SpecAction[] = [
  {
    titre: "Relancer l'enquête de satisfaction auprès des PME sans réponse",
    description: "Deuxième vague par appel téléphonique pour les clients qui n'ont pas répondu.",
    kpi: "ban.nps",
    responsable: "membre",
    echeance: "2026-09-30",
    fin: "en_cours",
  },
  {
    titre: "Revoir le seuil d'alerte du taux de créances douteuses",
    description:
      "Faire valider par la direction des risques un seuil d'alerte cohérent avec la politique de crédit.",
    kpi: "ban.douteuses",
    responsable: "directeur",
    echeance: "2026-09-18",
    fin: "terminee",
    dateEffet: "2026-09-21",
    commentaire: "Seuil de 8,5 % confirmé par la direction des risques.",
    alerte: "SEUIL_HAUT",
  },
];

/** Mission 10 (signée, non démarrée) : ni revue ni action, la fenêtre de ses données est vide. */
export const REVUES_EXPORT: SpecRevue[] = [];

export const ACTIONS_EXPORT: SpecAction[] = [];
