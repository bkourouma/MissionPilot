/**
 * Jeu de règles d'exemple tiré du PRD complémentaire (§4.4) : petite
 * entreprise, comptes fragiles, actionnariat familial, filière agricole.
 * Données de test seulement.
 */
import type {
  ContexteModulation,
  DefinitionFacteurContexte,
  ReferentielModulation,
  RegleModulation,
} from "./types";

export const FACTEURS: readonly DefinitionFacteurContexte[] = [
  { code: "effectif", type: "nombre", min: 0 },
  {
    code: "fiabilite_comptes",
    type: "enumeration",
    valeurs: ["certifies", "non_certifies", "reconstitues"],
  },
  { code: "part_especes", type: "enumeration", valeurs: ["faible", "moyenne", "forte"] },
  { code: "actionnariat", type: "enumeration", valeurs: ["familial", "etat", "groupe"] },
  { code: "filieres", type: "liste", valeurs: ["cacao", "anacarde", "btp", "banque"] },
  { code: "agricole", type: "booleen" },
];

export const REGLES: readonly RegleModulation[] = [
  {
    code: "petite_entreprise",
    libelle: "Effectif inférieur à 20",
    priorite: 10,
    condition: { type: "comparaison", facteur: "effectif", comparateur: "inferieur", valeur: 20 },
    effets: [
      { type: "activer_brique", brique: "atelier_unique" },
      { type: "retirer_brique", brique: "entretiens_individuels" },
      { type: "gabarit", cible: "questionnaire", choix: "essentiel" },
    ],
  },
  {
    code: "comptes_fragiles",
    priorite: 20,
    condition: {
      type: "tous",
      conditions: [
        {
          type: "comparaison",
          facteur: "fiabilite_comptes",
          comparateur: "egal",
          valeur: "non_certifies",
        },
        { type: "comparaison", facteur: "part_especes", comparateur: "egal", valeur: "forte" },
      ],
    },
    effets: [
      { type: "formulation", cible: "analyse_financiere", choix: "indicative" },
      { type: "activer_brique", brique: "reconstitution_ca" },
      { type: "relever_classe_risque", cible: "rapport_financier", classe: "R3" },
    ],
  },
  {
    code: "gouvernance_familiale",
    priorite: 10,
    condition: {
      type: "comparaison",
      facteur: "actionnariat",
      comparateur: "egal",
      valeur: "familial",
    },
    effets: [{ type: "activer_brique", brique: "gouvernance_familiale" }],
  },
  {
    code: "filiere_agricole",
    priorite: 10,
    condition: {
      type: "au_moins_un",
      conditions: [
        { type: "comparaison", facteur: "filieres", comparateur: "contient", valeur: "cacao" },
        { type: "comparaison", facteur: "filieres", comparateur: "dans", valeur: ["anacarde"] },
        { type: "comparaison", facteur: "agricole", comparateur: "egal", valeur: true },
      ],
    },
    effets: [
      { type: "recommandation_candidate", recommandation: "kpi_pertes_post_recolte" },
      { type: "ponderation", cible: "dim_operations", valeur: 1.5 },
      { type: "relever_classe_risque", cible: "rapport_financier", classe: "R2" },
    ],
  },
  {
    code: "succession",
    priorite: 5,
    condition: { type: "brique_active", brique: "gouvernance_familiale" },
    effets: [{ type: "activer_item", item: "item_succession" }],
  },
];

export const REFERENTIEL: ReferentielModulation = {
  facteurs: FACTEURS,
  briques: [
    "atelier_unique",
    "entretiens_individuels",
    "reconstitution_ca",
    "gouvernance_familiale",
  ],
  items: ["item_succession"],
  cibles: ["questionnaire", "analyse_financiere", "rapport_financier", "dim_operations"],
  choix: ["essentiel", "indicative"],
  recommandations: ["kpi_pertes_post_recolte"],
};

export const PME_FAMILIALE_CACAO: ContexteModulation = {
  effectif: 12,
  fiabilite_comptes: "non_certifies",
  part_especes: "forte",
  actionnariat: "familial",
  filieres: ["cacao"],
  agricole: true,
};

export const GRANDE_BANQUE: ContexteModulation = {
  effectif: 800,
  fiabilite_comptes: "certifies",
  part_especes: "faible",
  actionnariat: "groupe",
  filieres: ["banque"],
  agricole: false,
};
