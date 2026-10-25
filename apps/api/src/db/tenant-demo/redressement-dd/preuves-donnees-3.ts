import { MISSIONS } from "./commun.js";
import type { DefMissionPreuves } from "./preuves-ecriture.js";

/*
 * Registre des preuves de la mission 4 du casting, « Due diligence — Mboa Solaire »
 * (1er septembre au 19 décembre 2025). Constats FICTIFS de consultants, chiffres cohérents.
 *
 * Les assertions d'hypothèses de marché et financières portent toutes l'intitulé
 * « Mboa Solaire : … » : le lot de la due diligence les lit (liste du registre) pour y rattacher
 * les hypothèses du dossier. Elles sont « retenues » et toutes les contradictions sont arbitrées
 * (aucune preuve contraire en attente d'arbitrage). L'hypothèse financière de croissance est un
 * avis d'expert signé par un associé (assertion sans preuve propre).
 */

export const REGISTRE_MBOA: DefMissionPreuves = {
  mission: MISSIONS.ddTerminee,
  equipe: ["consultant", "consultant2", "junior", "chef2", "directeur2"],
  dimensions: [
    { code: "carnet_commandes", libelle: "Carnet de commandes" },
    { code: "maintenance_exploitation", libelle: "Maintenance et exploitation" },
    { code: "tarifs_marche", libelle: "Tarifs et marché" },
    { code: "relation_clients", libelle: "Relation clients" },
  ],
  preuves: [
    {
      cle: "p1",
      type: "document",
      source: "Carnet de commandes de Mboa Énergie Solaire au 15 septembre 2025 (contrats signés)",
      j: 14,
      fiabilite: "B",
      extrait:
        "Contrats signés pour la livraison 2026 : 14,6 milliards XOF, soit 60 % du chiffre d'affaires 2026 prévu au plan d'affaires (24,3 milliards XOF). Quatorze contrats, dont les trois plus importants représentent 52 % du montant.",
      dims: ["carnet_commandes"],
      par: "consultant",
      revision: {
        j: 50,
        par: "consultant2",
        motif: "Contrôle sur copies signées des quatorze contrats.",
        fiabilite: "A",
        extrait:
          "Contrats signés pour la livraison 2026 : 14,6 milliards XOF, soit 60 % du chiffre d'affaires 2026 prévu au plan d'affaires (24,3 milliards XOF). Quatorze contrats, dont les trois plus importants représentent 52 % du montant. Montant total confirmé sur copies signées.",
      },
    },
    {
      cle: "p2",
      type: "document",
      source: "Plan d'affaires 2026-2030 de Mboa Énergie Solaire (version du vendeur)",
      j: 12,
      fiabilite: "C",
      extrait:
        "Chiffre d'affaires 2026 de 24,3 milliards XOF puis croissance de 18 % par an ; marge d'EBITDA cible de 21 % ; tarif de vente de l'électricité retenu de 112 XOF/kWh ; coût de maintenance de 7 500 XOF par kWc et par an.",
      dims: ["tarifs_marche", "carnet_commandes"],
      par: "consultant",
    },
    {
      cle: "p3",
      type: "entretien",
      source: "Entretien avec le directeur technique, M. Serge Biyik, 9 septembre 2025",
      j: 8,
      fiabilite: "B",
      extrait:
        "« Notre coût de maintenance est de 7 500 XOF par kWc et par an, pièces comprises ; les onduleurs sont remplacés à dix ans. »",
      dims: ["maintenance_exploitation"],
      par: "chef",
      accord: true,
    },
    {
      cle: "p4",
      type: "donnee_externe",
      source:
        "Étude de la Banque africaine de développement sur les coûts d'exploitation du solaire commercial en Afrique centrale, 2024",
      j: 20,
      fiabilite: "A",
      extrait:
        "Coût de maintenance annuel médian des centrales solaires commerciales de 9 800 XOF par kWc, avec une fourchette de 7 000 à 14 000 XOF.",
      dims: ["maintenance_exploitation"],
      par: "junior",
    },
    {
      cle: "p5",
      type: "observation",
      source:
        "Visite de trois installations clientes (Douala, Bafoussam, Garoua), 22 au 24 septembre 2025",
      j: 22,
      fiabilite: "B",
      extrait:
        "Production mesurée à 87 % du productible théorique en moyenne ; encrassement des panneaux non traité depuis plus de deux mois sur deux sites sur trois.",
      dims: ["maintenance_exploitation"],
      par: "consultant2",
    },
    {
      cle: "p6",
      type: "donnee_externe",
      source: "Arrêté tarifaire 2025 de la régie nationale d'électricité",
      j: 26,
      fiabilite: "A",
      extrait:
        "Tarif moyen en basse tension de 98 XOF/kWh ; hausse de 4 % annoncée au 1er janvier 2026.",
      dims: ["tarifs_marche"],
      par: "junior",
    },
    {
      cle: "p7",
      type: "document",
      source: "Échantillon de dix contrats de maintenance conclus avec des clients",
      j: 30,
      fiabilite: "B",
      extrait:
        "Maintenance facturée aux clients : 8 200 XOF par kWc et par an en moyenne ; garantie de performance de 92 % du productible théorique, avec pénalités en deçà.",
      dims: ["maintenance_exploitation", "relation_clients"],
      par: "consultant2",
    },
    {
      cle: "p8",
      type: "questionnaire",
      source: "Enquête auprès de douze clients de Mboa (neuf réponses), octobre 2025",
      j: 35,
      fiabilite: "B",
      extrait:
        "Sept clients sur neuf renouvelleraient leur contrat de maintenance ; trois signalent des retards d'intervention de plus de cinq jours ; quatre clients commerciaux déclarent payer l'électricité 112 XOF/kWh dans le cadre d'un contrat de vente d'énergie négocié.",
      dims: ["relation_clients", "tarifs_marche"],
      par: "chef",
      nominatif: false,
    },
  ],
  assertions: [
    {
      cle: "h1",
      enonce:
        "Mboa Solaire : le carnet de commandes couvre 60 % du chiffre d'affaires 2026 prévu (14,6 milliards XOF de contrats signés pour 24,3 milliards XOF).",
      classe: "R2",
      livrable: "Due diligence — hypothèses du modèle financier",
      dim: "carnet_commandes",
      j: 52,
      par: "chef",
      statut: "retenue",
      liens: [
        { preuve: "p1", sens: "pour", j: 52, par: "chef" },
        { preuve: "p2", sens: "pour", j: 52, par: "chef" },
      ],
    },
    {
      cle: "h2",
      enonce:
        "Mboa Solaire : le coût de maintenance annuel réel est supérieur aux 7 500 XOF/kWc du plan d'affaires et se situe autour de 9 000 XOF/kWc.",
      classe: "R2",
      livrable: "Due diligence — hypothèses du modèle financier",
      dim: "maintenance_exploitation",
      j: 40,
      par: "consultant",
      statut: "retenue",
      liens: [
        { preuve: "p4", sens: "pour", j: 40, par: "consultant" },
        { preuve: "p7", sens: "pour", j: 40, par: "consultant" },
        { preuve: "p3", sens: "contre", j: 41, par: "consultant" },
      ],
      arbitrage: {
        preuve: "p3",
        decision: "contradiction_levee",
        par: "directeur2",
        j: 44,
        motif:
          "La déclaration du directeur technique (7 500 XOF/kWc) n'est étayée ni par les contrats clients (8 200 facturés) ni par la médiane régionale (9 800). Elle est écartée ; le modèle financier retient 9 000 XOF/kWc.",
      },
    },
    {
      cle: "h3",
      enonce:
        "Mboa Solaire : le tarif de vente retenu au plan d'affaires (112 XOF/kWh) dépasse de 14 % le tarif réglementé en basse tension (98 XOF/kWh).",
      classe: "R3",
      livrable: "Due diligence — hypothèses de marché",
      dim: "tarifs_marche",
      j: 46,
      par: "consultant2",
      statut: "retenue",
      liens: [
        { preuve: "p6", sens: "pour", j: 46, par: "consultant2" },
        { preuve: "p2", sens: "pour", j: 46, par: "consultant2" },
        { preuve: "p8", sens: "contre", j: 47, par: "consultant2" },
      ],
      arbitrage: {
        preuve: "p8",
        decision: "contradiction_maintenue",
        par: "chef2",
        j: 56,
        motif:
          "Quatre clients commerciaux sur neuf paient bien 112 XOF/kWh par contrat négocié, mais le reste du portefeuille est au tarif réglementé. Contradiction maintenue : l'hypothèse est conservée avec une nuance.",
      },
      correction: {
        j: 60,
        par: "consultant2",
        motif: "Nuance après arbitrage : tarif justifié pour les contrats négociés seulement.",
        statut: "retenue",
        enonce:
          "Mboa Solaire : le tarif de vente retenu au plan d'affaires (112 XOF/kWh) dépasse de 14 % le tarif réglementé en basse tension (98 XOF/kWh) ; il n'est justifié que pour les contrats de vente d'énergie négociés (quatre clients sur neuf).",
      },
    },
    {
      cle: "h4",
      enonce:
        "Mboa Solaire : la production réelle atteint 87 % du productible théorique sur les sites visités, en deçà de la garantie de 92 % accordée aux clients.",
      classe: "R2",
      livrable: "Due diligence — hypothèses d'exploitation",
      dim: "maintenance_exploitation",
      j: 58,
      par: "consultant",
      statut: "retenue",
      liens: [
        { preuve: "p5", sens: "pour", j: 58, par: "consultant" },
        { preuve: "p7", sens: "pour", j: 58, par: "consultant" },
      ],
    },
    {
      cle: "h5",
      enonce:
        "Mboa Solaire : sept clients sur neuf renouvelleraient leur contrat de maintenance, mais trois signalent des retards d'intervention supérieurs à cinq jours.",
      classe: "R1",
      livrable: "Due diligence — hypothèses de marché",
      dim: "relation_clients",
      j: 64,
      par: "chef",
      statut: "retenue",
      liens: [{ preuve: "p8", sens: "pour", j: 64, par: "chef" }],
    },
    {
      cle: "h6",
      enonce:
        "Mboa Solaire : la croissance annuelle de 18 % du chiffre d'affaires prévue au plan reste soutenable si au moins 85 % du carnet de commandes est converti en facturation sur 2026.",
      classe: "R3",
      livrable: "Due diligence — hypothèses du modèle financier",
      dim: "carnet_commandes",
      j: 70,
      par: "associe",
      statut: "retenue",
      avis: "Avis de l'associé fondé sur quatre transactions comparables du solaire commercial en Afrique centrale ; la sensibilité reste à confirmer dans le modèle financier.",
      liens: [{ preuve: "p1", sens: "pour", j: 71, par: "associe" }],
    },
  ],
};
