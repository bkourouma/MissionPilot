import type { CritereRevueFroide, GraviteConstatFroid } from "@missionpilot/shared";
import type { CleCompte } from "../cles.js";
import type { CleMission } from "./commun.js";

/*
 * Données de la revue à froid (QUA-05) : grille évaluée, constats, synthèses et plan
 * d'amélioration, par mission clôturée. Notes de 1 à 5 dans l'ordre de la grille (version 1) ;
 * `null` : critère sans objet, justifié par un commentaire. Le score et la conclusion NE SONT PAS
 * écrits ici : ils sortent du moteur `calculerRevueFroide`. Textes fictifs.
 */

export const ORDRE_CRITERES: readonly CritereRevueFroide[] = [
  "conformite_methode",
  "solidite_preuves",
  "relecture_signature",
  "acceptation_independance",
  "satisfaction_client",
  "budget_delais",
  "dossier_complet",
  "usage_ia",
];

export interface ConstatModele {
  critere: CritereRevueFroide;
  gravite: GraviteConstatFroid;
  description: string;
  recommandation: string;
}

export interface RevueModele {
  notes: (number | null)[];
  commentaires: Partial<Record<CritereRevueFroide, string>>;
  constats: ConstatModele[];
  synthese: string;
}

export const REVUES: Record<
  Exclude<
    CleMission,
    | "plan-baobab"
    | "redressement-gabon"
    | "flash-teranga"
    | "notation-banque-sahel"
    | "plan-sicafe-export"
    | "dd-wouri-distribution"
  >,
  RevueModele
> = {
  "plan-sicafe": {
    notes: [5, 4, 5, 4, 5, 4, 4, null],
    commentaires: {
      conformite_methode:
        "Méthode du plan stratégique suivie à chaque étape, gardes de qualité respectées.",
      relecture_signature: "Quatre yeux et signature du directeur de mission tracés.",
      usage_ia: "Mission antérieure à l'usage encadré de l'IA : critère sans objet.",
    },
    constats: [
      {
        critere: "dossier_complet",
        gravite: "mineur",
        description: "Deux comptes rendus d'ateliers de vision manquent au dossier de la mission.",
        recommandation: "Verser les comptes rendus au dossier avant la clôture de chaque mission.",
      },
    ],
    synthese:
      "Mission bien conduite, dossier solide et client très satisfait. Un seul écart de complétude du dossier, sans incidence sur les conclusions.",
  },
  "notation-sahel-coton": {
    notes: [4, 3, 4, 3, 4, 3, 3, 4],
    commentaires: {
      solidite_preuves: "Trois ajustements qualitatifs ne renvoient à aucune preuve du registre.",
      acceptation_independance:
        "Évaluation d'acceptation faite, motif du secteur réglementé peu détaillé.",
      budget_delais: "Dépassement modéré du budget de jours sur la collecte des états financiers.",
    },
    constats: [
      {
        critere: "solidite_preuves",
        gravite: "majeur",
        description:
          "Trois ajustements qualitatifs de la notation ne sont rattachés à aucune preuve du registre des preuves.",
        recommandation:
          "Exiger une preuve ou un avis d'expert daté pour tout ajustement qualitatif avant publication.",
      },
      {
        critere: "budget_delais",
        gravite: "mineur",
        description: "La collecte des états financiers a consommé 14 % de jours en plus que prévu.",
        recommandation: "Prévoir une marge sur la phase de collecte dans le budget initial.",
      },
    ],
    synthese:
      "Notation correctement calculée par le moteur et bien expliquée au client. Réserve sur la traçabilité de certains ajustements qualitatifs, à corriger dans la méthode.",
  },
  "redressement-wouri": {
    notes: [4, 4, 3, 4, 3, 2, 4, 4],
    commentaires: {
      relecture_signature: "Étapes de relecture franchies mais revue du second expert tardive.",
      budget_delais:
        "Dépassement de 18 % du budget de jours pendant la négociation avec les créanciers.",
      satisfaction_client:
        "Note de milieu de mission faible (5) puis redressée par le suivi du directeur.",
    },
    constats: [
      {
        critere: "budget_delais",
        gravite: "majeur",
        description:
          "Le budget de jours a été dépassé de 18 % sans révision validée par le directeur de mission.",
        recommandation: "Déclencher une révision de budget dès qu'un seuil de 10 % est franchi.",
      },
      {
        critere: "satisfaction_client",
        gravite: "mineur",
        description:
          "Une note de satisfaction basse (5) n'a pas donné lieu à un échange formalisé avec le client.",
        recommandation: "Tracer l'échange avec le client après toute note inférieure ou égale à 6.",
      },
    ],
    synthese:
      "Mission de redressement bien menée sur le fond (plan de trésorerie et accord des créanciers). Réserves sur la maîtrise du budget et la formalisation du suivi client.",
  },
  "dd-mboa": {
    notes: [5, 5, 4, 5, 5, 4, 5, 4],
    commentaires: {
      acceptation_independance:
        "Lien d'investisseur avec Baobab Assurances déclaré, motivé et suivi.",
      usage_ia: "Usage de l'IA limité aux brouillons, mention portée sur le rapport.",
    },
    constats: [
      {
        critere: "usage_ia",
        gravite: "mineur",
        description:
          "La synthèse exécutive ne reprend pas la mention de contribution de l'IA du rapport principal.",
        recommandation: "Reprendre la mention de l'IA dans tous les documents remis au client.",
      },
    ],
    synthese:
      "Due diligence exemplaire : preuves solides, conflit d'intérêts traité et client très satisfait. Un écart de forme sur la mention de l'IA.",
  },
  "bp-atlantique": {
    notes: [4, 4, 5, 4, 5, 4, 4, 5],
    commentaires: {
      relecture_signature:
        "Signature du directeur et revue du second expert tracées avant la remise aux banques.",
    },
    constats: [
      {
        critere: "solidite_preuves",
        gravite: "mineur",
        description:
          "Une hypothèse de croissance du marché cite une étude sans date de publication.",
        recommandation: "Dater systématiquement les sources des hypothèses macroéconomiques.",
      },
    ],
    synthese:
      "Business plan solide et bien reçu par les banques. Un écart mineur sur la datation d'une source.",
  },
};

export interface ActionModele {
  titre: string;
  description: string;
  responsable: CleCompte;
  /** Échéance en jours après la création de l'action. */
  delai: number;
  /** Constat visé : mission (si elle est dans l'échantillon) et rang du constat dans `REVUES`. */
  constat?: { mission: keyof typeof REVUES; rang: number };
  /** Parcours de statuts après la création, avec le commentaire de la dernière étape. */
  parcours: { vers: "en_cours" | "faite" | "abandonnee"; jours: number; commentaire?: string }[];
}

export interface CampagneModele {
  intitule: string;
  graine: string;
  taille: number;
  /** Indices (dans l'ordre chronologique des clôtures) des missions couvertes par la période. */
  missions: [number, number];
  /** Jours entre la dernière clôture de la période et la création de la campagne. */
  decalage: number;
  creePar: CleCompte;
  actions: ActionModele[];
}

export const CAMPAGNES: readonly CampagneModele[] = [
  {
    intitule: "Revue à froid — missions clôturées au premier semestre 2025",
    graine: "froide-s1-2025",
    taille: 2,
    missions: [0, 1],
    decalage: 24,
    creePar: "associe",
    actions: [
      {
        titre: "Rattacher chaque ajustement qualitatif à une preuve du registre",
        description: "Ajouter un contrôle dans la check-list de relecture des notations.",
        responsable: "chef.mission",
        delai: 60,
        constat: { mission: "notation-sahel-coton", rang: 0 },
        parcours: [
          { vers: "en_cours", jours: 7 },
          {
            vers: "faite",
            jours: 38,
            commentaire:
              "Contrôle ajouté à la check-list de relecture ; vérifié sur trois notations.",
          },
        ],
      },
      {
        titre: "Verser les comptes rendus d'ateliers au dossier avant clôture",
        description: "Compléter la liste de contrôle de clôture du dossier de mission.",
        responsable: "directeur.mission",
        delai: 45,
        constat: { mission: "plan-sicafe", rang: 0 },
        parcours: [
          {
            vers: "faite",
            jours: 30,
            commentaire:
              "Point ajouté à la liste de contrôle de clôture, appliqué aux missions en cours.",
          },
        ],
      },
      {
        titre: "Former les chefs de mission à la revue guidée",
        description: "Deux ateliers pratiques sur la revue guidée et la définition de terminé.",
        responsable: "associe.2",
        delai: 90,
        parcours: [{ vers: "en_cours", jours: 20 }],
      },
      {
        titre: "Étudier un modèle unique de dossier de clôture",
        description: "Comparer les pratiques des directeurs de mission.",
        responsable: "directeur.mission.2",
        delai: 120,
        parcours: [
          {
            vers: "abandonnee",
            jours: 50,
            commentaire: "Remplacé par le contrôle automatique de la définition de terminé.",
          },
        ],
      },
    ],
  },
  {
    intitule: "Revue à froid — missions clôturées au second semestre 2025",
    graine: "froide-s2-2025",
    taille: 1,
    missions: [2, 3],
    decalage: 31,
    creePar: "associe.2",
    actions: [
      {
        titre: "Déclencher une révision de budget au franchissement de 10 % de dépassement",
        description: "Paramétrer l'alerte de budget et rappeler la règle aux chefs de mission.",
        responsable: "chef.mission",
        delai: 40,
        constat: { mission: "redressement-wouri", rang: 0 },
        parcours: [
          { vers: "en_cours", jours: 5 },
          {
            vers: "faite",
            jours: 33,
            commentaire: "Alerte activée et règle rappelée lors du comité qualité de mars.",
          },
        ],
      },
      {
        titre: "Reprendre la mention de l'IA dans tous les documents remis",
        description: "Ajouter la mention aux modèles de synthèse et de présentation.",
        responsable: "consultant",
        delai: 30,
        constat: { mission: "dd-mboa", rang: 0 },
        parcours: [
          {
            vers: "faite",
            jours: 21,
            commentaire: "Modèles de synthèse et de présentation mis à jour.",
          },
        ],
      },
      {
        titre: "Tracer l'échange avec le client après une note de satisfaction basse",
        description: "Définir le seuil et le modèle de compte rendu d'échange.",
        responsable: "directeur.mission",
        delai: 75,
        parcours: [{ vers: "en_cours", jours: 14 }],
      },
    ],
  },
];
