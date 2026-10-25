import type { RetoursParMission } from "./donnees-cap-types.js";

/* Retours d'expérience rédigés : Due diligence Mboa Solaire, Business plan Atlantique Retail. */
export const RETOURS_B: RetoursParMission = {
  ddMboa: {
    auteurV2: "chef.mission",
    auteurV3: "directeur.mission",
    valideur: "associe.2",
    v2: {
      contexte:
        "Due diligence financière et opérationnelle de Mboa Énergie Solaire, développeur camerounais de petites centrales photovoltaïques, pour le compte d'un investisseur envisageant une prise de participation minoritaire. La salle de données a été ouverte progressivement sur six semaines.",
      methode:
        "Aucune méthode du référentiel ne couvre la due diligence : la mission a suivi le module de due diligence (périmètre, hypothèses, marché, notes d'analyse, portail investisseur), sans rattachement de tâches à des briques de méthode.",
      ecarts:
        "L'ouverture tardive de la salle de données a comprimé la phase d'analyse. La revue des contrats d'achat d'électricité a demandé l'appui d'un expert externe, non prévu au budget initial.",
      lecons:
        "À reproduire : exiger une salle de données structurée selon notre liste de pièces avant le démarrage. À éviter : accepter un calendrier fixe quand l'accès aux données dépend du vendeur. À capitaliser : la grille de lecture des contrats d'achat d'électricité.",
    },
    v3: {
      lecons:
        "À reproduire : exiger une salle de données structurée selon notre liste de pièces avant le démarrage et prévoir une clause de glissement du calendrier. À éviter : accepter un calendrier fixe quand l'accès aux données dépend du vendeur. À capitaliser : la grille de lecture des contrats d'achat d'électricité, à proposer au comité méthode comme brique de la future méthode « Due diligence ».",
    },
  },
  businessPlanAtlantique: {
    auteurV2: "chef.mission",
    auteurV3: "directeur.mission",
    valideur: "associe",
    v2: {
      contexte:
        "Business plan bancable d'Atlantique Retail Group, enseigne de distribution, pour financer l'ouverture de nouveaux points de vente en Afrique de l'Ouest. Le dirigeant voulait présenter un dossier unique à deux banques et à un fonds de développement.",
      methode:
        "Méthode « Business plan bancable » : cadrage du projet, analyse financière historique, hypothèses, calcul du modèle, plan de financement, dossier bancaire puis restitution au dirigeant. La brique du BFR saisonnier n'a pas été activée, l'activité étant peu saisonnière.",
      ecarts:
        "Les hypothèses de croissance ont été reprises deux fois après les retours des banques. Le calcul du modèle et le plan de financement sont restés dans l'enveloppe ; le dossier bancaire a demandé plus de temps de mise en forme que prévu.",
      lecons:
        "À reproduire : faire valider les hypothèses par le dirigeant avant le calcul du modèle. À éviter : adapter le dossier à chaque banque séparément ; préférer un dossier unique avec annexes. À capitaliser : le gabarit de dossier bancaire et la liste des questions fréquentes des comités de crédit.",
    },
    v3: {
      ecarts:
        "Les hypothèses de croissance ont été reprises deux fois après les retours des banques. Le calcul du modèle et le plan de financement sont restés dans l'enveloppe ; le dossier bancaire a demandé plus de temps de mise en forme que prévu. Relecture du directeur : la reprise des hypothèses vient d'une validation tardive côté client.",
      lecons:
        "À reproduire : faire valider les hypothèses par le dirigeant avant le calcul du modèle, en séance et par écrit. À éviter : adapter le dossier à chaque banque séparément ; préférer un dossier unique avec annexes. À capitaliser : le gabarit de dossier bancaire et la liste des questions fréquentes des comités de crédit.",
    },
  },
};
