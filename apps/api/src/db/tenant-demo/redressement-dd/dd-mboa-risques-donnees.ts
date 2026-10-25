import type { Auteur, ClePreuve } from "./dd-mboa-donnees.js";

/*
 * Données de la mission 4 (Mboa Solaire), suite : risques du dossier (rattachés à un signal de la
 * bibliothèque et à une étape de la chaîne de valeur) et constats de signaux. Jours = décalages
 * depuis le début de la mission. Un niveau différent de la gravité indicative du signal exige un
 * motif d’écart (tracé comme ajustement par l’API).
 */

export interface DefRisque {
  cle: string;
  famille: "pays" | "change" | "operationnel" | "reglementaire";
  niveau: "faible" | "modere" | "eleve" | "critique";
  libelle: string;
  etape?: string;
  signal?: string;
  motifEcart?: string;
  enonce: string;
  classe: "R2" | "R3";
  preuves: ClePreuve[];
  avis?: string;
  par: Auteur;
  j: number;
}

export const RISQUES: DefRisque[] = [
  {
    cle: "maintenance",
    famille: "operationnel",
    niveau: "eleve",
    libelle: "Coût de maintenance sous-estimé au plan d'affaires",
    etape: "exploitation",
    signal: "oper-maintenance-sous-estimee",
    motifEcart:
      "Écart de plus de 20 % entre le plan et la médiane régionale : le niveau est relevé à élevé.",
    enonce:
      "Le coût de maintenance réel se situe autour de 9 000 XOF/kWc et par an, au-dessus des 7 500 XOF du plan d'affaires, ce qui réduit la marge d'EBITDA cible de 21 %.",
    classe: "R2",
    preuves: ["p4", "p7"],
    par: "consultant",
    j: 33,
  },
  {
    cle: "tarif",
    famille: "reglementaire",
    niveau: "eleve",
    libelle: "Tarif de vente supérieur au tarif réglementé hors contrats négociés",
    etape: "vente",
    signal: "regl-tarif-reglemente",
    enonce:
      "Le tarif de 112 XOF/kWh n'est justifié que pour les contrats de vente d'énergie négociés (quatre clients sur neuf) ; ailleurs, le tarif de référence est de 98 XOF/kWh.",
    classe: "R3",
    preuves: ["p6", "p8"],
    par: "consultant2",
    j: 37,
  },
  {
    cle: "concentration",
    famille: "operationnel",
    niveau: "modere",
    libelle: "Concentration du carnet de commandes sur trois clients",
    etape: "vente",
    signal: "oper-concentration-clients",
    enonce:
      "Les trois plus importants contrats représentent 52 % des 14,6 milliards XOF de contrats signés.",
    classe: "R2",
    preuves: ["p1"],
    par: "consultant",
    j: 17,
  },
  {
    cle: "devises",
    famille: "change",
    niveau: "modere",
    libelle: "Équipements importés payés en devises",
    etape: "approvisionnement",
    signal: "change-flux-devises",
    enonce:
      "Les panneaux et onduleurs sont importés et facturés en devises hors zone franc alors que les contrats clients sont libellés en francs CFA.",
    classe: "R2",
    preuves: [],
    avis: "Information recueillie auprès du directeur financier du vendeur ; la part exacte reste à documenter.",
    par: "consultant",
    j: 19,
  },
  {
    cle: "securite",
    famille: "pays",
    niveau: "faible",
    libelle: "Activité dans des régions à déplacements restreints",
    signal: "pays-tensions-securitaires",
    motifEcart:
      "Une seule installation sur trois visités se trouve en région concernée : niveau abaissé à faible.",
    enonce:
      "Une partie des chantiers se situe dans le nord du pays, où les déplacements des équipes peuvent être restreints.",
    classe: "R2",
    preuves: ["p5"],
    par: "consultant2",
    j: 25,
  },
  {
    cle: "dirigeant",
    famille: "operationnel",
    niveau: "modere",
    libelle: "Savoir-faire concentré sur le dirigeant-fondateur",
    signal: "oper-dependance-dirigeant",
    enonce:
      "Les relations avec les trois plus gros clients et avec les fournisseurs reposent sur le dirigeant-fondateur, sans second niveau de direction formalisé.",
    classe: "R2",
    preuves: ["p3"],
    par: "consultant",
    j: 13,
  },
];

export interface DefConstat {
  signal: string;
  etat: "constate" | "ecarte" | "a_verifier";
  commentaire: string | null;
  risque?: string;
  par: Auteur;
  j: number;
}

export const CONSTATS: DefConstat[] = [
  {
    signal: "oper-concentration-clients",
    etat: "constate",
    commentaire: "Trois contrats sur quatorze représentent 52 % du montant signé.",
    risque: "concentration",
    par: "consultant",
    j: 18,
  },
  {
    signal: "change-flux-devises",
    etat: "a_verifier",
    commentaire: "Part des achats en devises à documenter auprès du directeur financier.",
    par: "consultant",
    j: 20,
  },
  {
    signal: "change-flux-devises",
    etat: "constate",
    commentaire:
      "La part des achats en devises est confirmée par les factures d'importation consultées.",
    risque: "devises",
    par: "consultant",
    j: 41,
  },
  {
    signal: "oper-maintenance-sous-estimee",
    etat: "constate",
    commentaire: "Coût du plan inférieur à la médiane régionale et aux contrats clients.",
    risque: "maintenance",
    par: "consultant",
    j: 34,
  },
  {
    signal: "regl-tarif-reglemente",
    etat: "constate",
    commentaire: "Tarif de 112 XOF/kWh supérieur au tarif de référence de 98 XOF/kWh.",
    risque: "tarif",
    par: "consultant2",
    j: 38,
  },
  {
    signal: "pays-tensions-securitaires",
    etat: "constate",
    commentaire: "Un site sur trois visités se situe dans une région concernée.",
    risque: "securite",
    par: "consultant2",
    j: 26,
  },
  {
    signal: "oper-dependance-dirigeant",
    etat: "constate",
    commentaire: "Relations clés détenues par le fondateur.",
    risque: "dirigeant",
    par: "consultant",
    j: 14,
  },
  {
    signal: "oper-dependance-fournisseur-solaire",
    etat: "ecarte",
    commentaire:
      "Trois fournisseurs d'onduleurs qualifiés ont livré Mboa en 2025 selon le directeur technique.",
    par: "consultant",
    j: 42,
  },
  {
    signal: "regl-autorisation-production",
    etat: "ecarte",
    commentaire:
      "Aucune autorisation d'exploitation n'arrive à échéance dans les douze mois selon le registre transmis.",
    par: "consultant2",
    j: 43,
  },
];
