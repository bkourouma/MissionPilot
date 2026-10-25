import type { CleActeurDd } from "./dd-referentiel-donnees.js";

/*
 * Bibliothèque de signaux d’alerte du cabinet (DD-11) : libellés et questions rédigés comme des
 * rappels pour l’expert, sans qualification juridique. Constituée au premier semestre 2025
 * (jours depuis le début de l’activité, 2024-10-01).
 */

export type Famille = "pays" | "change" | "operationnel" | "reglementaire";
export type Niveau = "faible" | "modere" | "eleve" | "critique";

export interface DefSignal {
  code: string;
  libelle: string;
  description: string;
  famille: Famille;
  secteur_code: string | null;
  pays_code: string | null;
  gravite: Niveau;
  question: string;
  reference_publique: string | null;
  par: CleActeurDd;
  j: number;
  revision?: { j: number; par: CleActeurDd; motif: string; gravite?: Niveau; question?: string };
}

export const SIGNAUX: DefSignal[] = [
  {
    code: "oper-concentration-clients",
    libelle: "Carnet de commandes concentré sur très peu de clients",
    description:
      "Trois clients ou moins représentent plus de la moitié du carnet de commandes ou du chiffre d'affaires.",
    famille: "operationnel",
    secteur_code: null,
    pays_code: null,
    gravite: "modere",
    question:
      "Quelle part du carnet représentent les trois premiers clients, et pour quelle durée ?",
    reference_publique: null,
    par: "expert",
    j: 118,
  },
  {
    code: "oper-dependance-dirigeant",
    libelle: "Savoir-faire et relations concentrés sur le dirigeant-fondateur",
    description:
      "Les contrats clés et les relations avec les fournisseurs reposent sur une seule personne.",
    famille: "operationnel",
    secteur_code: null,
    pays_code: null,
    gravite: "modere",
    question: "Existe-t-il un second niveau de direction capable d'assurer la continuité ?",
    reference_publique: null,
    par: "expert",
    j: 120,
  },
  {
    code: "change-flux-devises",
    libelle: "Achats d'équipements majoritairement payés en devises hors zone franc",
    description:
      "Une part importante des achats est facturée en dollars ou en monnaie d'un pays hors zone franc.",
    famille: "change",
    secteur_code: null,
    pays_code: null,
    gravite: "modere",
    question: "Quelle part des achats est libellée hors zone franc, et quelle couverture existe ?",
    reference_publique: null,
    par: "associe",
    j: 124,
    revision: {
      j: 190,
      par: "directeur",
      motif: "Question reformulée pour demander explicitement la politique de couverture.",
      question:
        "Quelle part des achats est libellée hors zone franc, et quelle politique de couverture est appliquée ?",
    },
  },
  {
    code: "oper-dependance-fournisseur-solaire",
    libelle: "Dépendance à un fournisseur unique de panneaux ou d'onduleurs",
    description:
      "Un seul fournisseur couvre l'essentiel des équipements ; un retard de livraison bloque les chantiers.",
    famille: "operationnel",
    secteur_code: "citi_d",
    pays_code: null,
    gravite: "eleve",
    question:
      "Quels sont les fournisseurs alternatifs qualifiés et les délais de livraison constatés ?",
    reference_publique: null,
    par: "expert",
    j: 131,
  },
  {
    code: "oper-maintenance-sous-estimee",
    libelle: "Coût de maintenance du plan inférieur aux références du secteur",
    description:
      "Le coût annuel de maintenance par kWc retenu au plan d'affaires est nettement inférieur aux références disponibles.",
    famille: "operationnel",
    secteur_code: "citi_d",
    pays_code: null,
    gravite: "modere",
    question:
      "Le coût retenu est-il confirmé par les contrats clients et par des références indépendantes ?",
    reference_publique: "Études publiques sur les coûts d'exploitation du solaire commercial",
    par: "expert",
    j: 135,
    revision: {
      j: 200,
      par: "expert2",
      motif: "Ajout d'une référence publique après la revue des études régionales.",
    },
  },
  {
    code: "regl-tarif-reglemente",
    libelle: "Tarif de vente supérieur au tarif réglementé en basse tension",
    description:
      "Le prix de vente de l'électricité retenu dépasse le tarif de référence du régulateur pour la majorité des clients.",
    famille: "reglementaire",
    secteur_code: "citi_d",
    pays_code: "cm",
    gravite: "eleve",
    question: "Pour quels contrats le tarif supérieur est-il négocié et sur quelle durée ?",
    reference_publique: "Arrêté tarifaire annuel de la régie nationale d'électricité",
    par: "associe",
    j: 140,
  },
  {
    code: "regl-autorisation-production",
    libelle: "Autorisations d'exploitation en cours de renouvellement",
    description:
      "Des sites de production fonctionnent avec une autorisation dont l'échéance est proche.",
    famille: "reglementaire",
    secteur_code: "citi_d",
    pays_code: "cm",
    gravite: "modere",
    question: "Quelles autorisations arrivent à échéance dans les douze mois ?",
    reference_publique: null,
    par: "directeur",
    j: 146,
  },
  {
    code: "pays-tensions-securitaires",
    libelle: "Sites situés dans une région exposée à des tensions sécuritaires",
    description:
      "Des chantiers ou des clients se trouvent dans une zone où les déplacements sont restreints.",
    famille: "pays",
    secteur_code: null,
    pays_code: "cm",
    gravite: "modere",
    question: "Quelle part du chiffre d'affaires est réalisée dans les régions concernées ?",
    reference_publique: null,
    par: "expert2",
    j: 150,
  },
  {
    code: "oper-rotation-stocks",
    libelle: "Rotation lente des stocks de marchandises",
    description:
      "Les stocks représentent plus de quatre-vingt-dix jours de ventes de façon durable.",
    famille: "operationnel",
    secteur_code: "citi_g",
    pays_code: null,
    gravite: "modere",
    question: "Quelle est la part de stocks sans mouvement depuis plus de six mois ?",
    reference_publique: null,
    par: "expert2",
    j: 156,
  },
  {
    code: "oper-creances-distributeurs",
    libelle: "Délais de paiement longs accordés aux revendeurs",
    description: "Les créances sur les revendeurs dépassent soixante jours de ventes.",
    famille: "operationnel",
    secteur_code: "citi_g",
    pays_code: null,
    gravite: "eleve",
    question: "Quelle est l'ancienneté des créances et la politique de relance appliquée ?",
    reference_publique: null,
    par: "expert",
    j: 160,
  },
  {
    code: "change-importations-distribution",
    libelle: "Marchandises importées avec prix de vente figés en francs CFA",
    description:
      "Le coût d'achat suit les devises alors que les prix de vente sont rarement révisés.",
    famille: "change",
    secteur_code: "citi_g",
    pays_code: null,
    gravite: "modere",
    question: "À quelle fréquence les prix de vente sont-ils révisés ?",
    reference_publique: null,
    par: "associe",
    j: 163,
  },
];
