import type { Ajouts } from "./standard-aide.js";
import { b, type DefMethodeCabinet } from "./standard-methodes-donnees.js";

/* Méthode en brouillon et ajouts des variantes du standard (voir standard-methodes-donnees.ts). */

export const METHODE_KPI_BROUILLON: DefMethodeCabinet = {
  code: "pilotage_kpi_cabinet",
  libelle: "Pilotage des KPI — démarche du cabinet (en rédaction)",
  description: "Tableau de bord et revues de performance : version de travail, non publiée.",
  service: "pilotage_kpi",
  contenu: {
    etapes: [
      {
        code: "cadrage_kpi",
        libelle: "Cadrage des indicateurs",
        description: "Choix des indicateurs et des seuils.",
      },
    ],
    briques: [
      b(
        "cadrage_kpi",
        "choix_indicateurs",
        "Choix des indicateurs",
        "Retenir les indicateurs avec le dirigeant.",
        "R2",
        "N1",
        { jours: 1, profil: "Chef de mission" },
      ),
      b(
        "cadrage_kpi",
        "seuils_alerte",
        "Seuils d'alerte",
        "Fixer les seuils d'alerte par indicateur.",
        "R2",
        "N1",
        { moteur: "kpi.evaluation", jours: 0.5, profil: "Consultant senior" },
      ),
    ],
    elements: [
      {
        type: "kpi_type",
        code: "marge_brute_mensuelle",
        libelle: "Marge brute mensuelle",
        brique: "choix_indicateurs",
      },
    ],
  },
};

const REGLE_BAILLEUR = {
  code: "exigence_bailleur_ifc",
  libelle: "Bailleur exigeant les normes de performance IFC",
  priorite: 10,
  condition: {
    type: "comparaison",
    facteur: "exigence_bailleur",
    comparateur: "egal",
    valeur: "ifc",
  },
  effets: [{ type: "activer_brique", brique: "volet_conformite_ifc" }],
};

/** Ajouts de la variante du plan stratégique : v1 (PESTEL, volet IFC) puis v2 (revue par un pair). */
export const PLAN_V1: Ajouts = {
  briques: [
    {
      apres: "diagnostic_strategique",
      code: "analyse_pestel",
      libelle: "Analyse PESTEL du contexte",
      objet:
        "Lire le contexte politique, économique, social, technologique, environnemental et légal.",
      classe: "R1",
      autonomie: "N2",
      active: true,
      agent: "analyste",
      jours: 0.75,
      profil: "Consultant",
      garde: "Contrôle humain avant intégration au diagnostic",
    },
    {
      apres: "diagnostic_strategique",
      code: "volet_conformite_ifc",
      libelle: "Volet conformité aux normes IFC",
      objet: "Vérifier le plan au regard des normes de performance exigées par le bailleur.",
      classe: "R2",
      autonomie: "N1",
      active: false,
      jours: 1,
      profil: "Consultant senior",
    },
  ],
  elements: [
    { type: "gabarit", code: "pestel_gabarit", libelle: "Grille PESTEL", brique: "analyse_pestel" },
  ],
  regles: [REGLE_BAILLEUR],
};
export const PLAN_V2: Ajouts = {
  briques: [
    {
      apres: "restitution_plan",
      code: "revue_par_pair",
      libelle: "Revue du plan par un pair",
      objet: "Faire relire le plan par un directeur de mission étranger à la mission.",
      classe: "R2",
      autonomie: "N1",
      active: true,
      jours: 0.5,
      profil: "Directeur de mission",
    },
  ],
};

/** Variante du diagnostic flash : volet change, activé par l'exposition au change. */
export const FLASH_V1: Ajouts = {
  briques: [
    {
      apres: "analyse_flash",
      code: "volet_change",
      libelle: "Volet risque de change",
      objet: "Mesurer l'exposition du dirigeant aux variations de change sur ses achats importés.",
      classe: "R1",
      autonomie: "N2",
      active: false,
      agent: "analyste",
      jours: 0.5,
      profil: "Consultant",
      garde: "Contrôle humain avant diffusion",
    },
  ],
  regles: [
    {
      code: "exposition_change_volet",
      libelle: "Exposition au change : volet dédié",
      priorite: 10,
      condition: {
        type: "comparaison",
        facteur: "commerce_exterieur",
        comparateur: "contient",
        valeur: "change",
      },
      effets: [{ type: "activer_brique", brique: "volet_change" }],
    },
  ],
};

/** Variante de la notation laissée en BROUILLON (entretien de gouvernance OHADA à valider). */
export const NOTATION_BROUILLON: Ajouts = {
  briques: [
    {
      apres: "entretiens_individuels",
      code: "entretien_gouvernance_ohada",
      libelle: "Entretien sur la gouvernance (acte uniforme OHADA)",
      objet:
        "Vérifier les organes sociaux et la tenue des assemblées au regard de l'acte uniforme OHADA.",
      classe: "R1",
      autonomie: "N1",
      active: false,
      jours: 0.5,
      profil: "Consultant senior",
    },
  ],
};
