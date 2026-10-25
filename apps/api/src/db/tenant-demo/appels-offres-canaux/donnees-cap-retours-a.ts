import type { RetoursParMission } from "./donnees-cap-types.js";

/* Retours d'expérience rédigés : Plan SICAFÉ, Notation Sahel Coton, Redressement Brasseries du Wouri. */
export const RETOURS_A: RetoursParMission = {
  planSicafe: {
    auteurV2: "chef.mission",
    auteurV3: "directeur.mission",
    valideur: "associe",
    v2: {
      contexte:
        "Élaboration du plan stratégique 2025-2028 de la SICAFÉ, groupe ivoirien de transformation et d'exportation de café-cacao, à la demande de la direction générale après deux campagnes marquées par la volatilité des cours et par les nouvelles exigences de traçabilité à l'exportation. Le comité de direction a participé à trois ateliers ; les filiales Transformation et Export ont été associées au diagnostic.",
      methode:
        "Méthode « Plan stratégique » appliquée en entier : diagnostic stratégique, matrice SWOT, vision et mission, axes et objectifs, portefeuille d'initiatives, puis feuille de route recalée. La reconstitution du chiffre d'affaires n'a pas été activée : le client dispose d'une comptabilité analytique fiable par filière. Aucune dérogation n'a été demandée.",
      ecarts:
        "Le calendrier a été tenu jusqu'à la restitution, avec un décalage sur les ateliers lié à la disponibilité du comité de direction en pleine campagne. Le portefeuille d'initiatives a demandé plus de temps d'arbitrage que prévu ; le diagnostic et la restitution sont restés dans l'enveloppe. Les chiffres de charge se lisent dans les données du retour, issues des moteurs.",
      lecons:
        "À reproduire : faire valider le diagnostic en comité avant d'ouvrir l'atelier sur les initiatives. À éviter : fixer les dates d'ateliers sans tenir compte du calendrier des campagnes. À capitaliser : la grille de hiérarchisation des initiatives par impact et effort.",
    },
    v3: {
      lecons:
        "À reproduire : faire valider le diagnostic en comité avant d'ouvrir l'atelier sur les initiatives, ce qui évite de rediscuter les constats. À éviter : fixer les dates d'ateliers sans tenir compte du calendrier des campagnes ; prévoir deux créneaux de repli. À capitaliser : la grille de hiérarchisation des initiatives par impact et effort, réutilisable pour les prochains plans. Recommandation au comité méthode : ajouter au cadrage un point d'étape avec les filiales.",
    },
  },
  notationSahel: {
    auteurV2: "chef.mission",
    auteurV3: "directeur.mission",
    valideur: "associe.2",
    v2: {
      contexte:
        "Notation financière de Sahel Coton Mali, entreprise de la filière coton, demandée par son conseil d'administration en vue d'un renouvellement de lignes de crédit de campagne. Les dirigeants ont répondu au questionnaire préliminaire ; les comptes des trois derniers exercices ont été remis avec retard.",
      methode:
        "Méthode « Notation d'entreprise » : cadrage, questionnaire préliminaire, entretiens individuels, analyse financière, calcul de la note, rapport puis restitution aux dirigeants. Les ajustements motivés ont été limités à un seul axe, documenté dans le dossier. Aucune dérogation.",
      ecarts:
        "La collecte des documents a pris plus de temps que prévu à cause de la remise tardive des états financiers de la dernière campagne. L'analyse financière a absorbé la marge du budget ; le calcul de la note et le rapport sont restés dans l'enveloppe.",
      lecons:
        "À reproduire : envoyer la liste précise des pièces dès le cadrage, avec une date limite signée du directeur financier. À éviter : lancer les entretiens avant d'avoir reçu les comptes. À capitaliser : le tableau de rapprochement entre perception des dirigeants et indicateurs financiers.",
    },
    v3: {
      ecarts:
        "La collecte des documents a pris plus de temps que prévu à cause de la remise tardive des états financiers de la dernière campagne. L'analyse financière a absorbé la marge du budget ; le calcul de la note et le rapport sont restés dans l'enveloppe. Relecture du directeur : le retard est imputable au client et non à la méthode, qui n'a pas besoin d'être modifiée.",
      lecons:
        "À reproduire : envoyer la liste précise des pièces dès le cadrage, avec une date limite validée par le directeur financier du client. À éviter : lancer les entretiens avant d'avoir reçu les comptes. À capitaliser : le tableau de rapprochement entre perception des dirigeants et indicateurs financiers. Proposition : prévoir une relance automatique des pièces manquantes.",
    },
  },
  redressementWouri: {
    auteurV2: "chef.mission",
    auteurV3: "directeur.mission",
    valideur: "associe",
    v2: {
      contexte:
        "Accompagnement du redressement des Brasseries du Wouri, brasseur camerounais confronté à une tension de trésorerie après la hausse du coût des intrants importés et un allongement des délais de paiement des distributeurs. Le conseil d'administration a sollicité un plan de redressement et un suivi hebdomadaire de la trésorerie.",
      methode:
        "Aucune méthode du référentiel ne couvre encore le redressement : la mission a suivi le processus propre du module de redressement (diagnostic de défaillance, causes, trésorerie à treize semaines, plan puis suivi), sans rattachement de tâches à des briques de méthode.",
      ecarts:
        "Le plan de financement a nécessité deux itérations avec les banques créancières, ce qui a décalé la validation du plan. Le suivi de trésorerie hebdomadaire a été tenu sans interruption. Les écarts de charge sont concentrés sur la phase de négociation.",
      lecons:
        "À reproduire : ouvrir le dialogue avec les créanciers dès le diagnostic, avant que le plan soit chiffré. À éviter : promettre un calendrier de négociation avant d'avoir cartographié les garanties. À capitaliser : la trame de tableau de bord hebdomadaire de trésorerie.",
    },
    v3: {
      lecons:
        "À reproduire : ouvrir le dialogue avec les créanciers dès le diagnostic, avant que le plan soit chiffré. À éviter : promettre un calendrier de négociation avant d'avoir cartographié les garanties. À capitaliser : la trame de tableau de bord hebdomadaire de trésorerie. Recommandation au comité méthode : créer une méthode « Redressement » dans le référentiel pour que ces tâches se rattachent à des briques.",
    },
  },
};
