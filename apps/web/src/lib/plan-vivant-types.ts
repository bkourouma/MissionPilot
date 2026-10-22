/** Plan vivant (PLA-18) : types des réponses de l'API (réalisés, écarts, re-prévisions). */
import type { MethodeReprevisionPlan } from "@missionpilot/shared";

// --- Réponses de l'API -------------------------------------------------------------------------

export interface RealiseVersion {
  id: string;
  exercice: number;
  trimestre: number;
  version: number;
  chiffre_affaires: number;
  ebe: number;
  resultat_net: number | null;
  tresorerie_fin: number | null;
  commentaire: string | null;
  cree_par: string;
  auteur_nom: string;
  cree_le: string;
}

export interface GroupeRealise {
  exercice: number;
  trimestre: number;
  courant: RealiseVersion;
  /** De la version la plus récente à la plus ancienne. */
  versions: RealiseVersion[];
}

export interface ReponseRealises {
  realises: GroupeRealise[];
}

export interface EcartMesure {
  prevu: number;
  reel: number | null;
  ecart: number | null;
  ecartRelatifPointsDeBase: number | null;
  significatif: boolean;
}

export interface EcartsTrimestre {
  trimestre: number;
  chiffreAffaires: EcartMesure;
  excedentBrutExploitation: EcartMesure;
  resultatNet: EcartMesure;
  tresorerieFin: EcartMesure;
}

export interface EcartsCumules {
  trimestre: number;
  chiffreAffaires: EcartMesure;
  excedentBrutExploitation: EcartMesure;
  resultatNet: EcartMesure;
}

export interface EcartsAnnuels {
  chiffreAffaires: EcartMesure;
  excedentBrutExploitation: EcartMesure;
  resultatNet: EcartMesure;
  tresorerieCloture: EcartMesure;
}

export interface ReprevisionAnnuelle {
  chiffreAffaires: number;
  excedentBrutExploitation: number;
  resultatNet: number | null;
  tresorerieCloture: number | null;
}

export interface ExplicationEcartEbe {
  chiffreAffairesPrevu: number;
  chiffreAffairesReel: number;
  ebePrevu: number;
  ebeReel: number;
  ecartEbe: number;
  effetVolume: number;
  effetMarge: number;
  tauxMargePrevuPointsDeBase: number;
  tauxMargeReelPointsDeBase: number | null;
}

export interface FaitReprevision {
  code: string;
  libelle: string;
  montant: number;
}

export interface ResultatReprevision {
  moteur: string;
  methode: MethodeReprevisionPlan;
  seuilEcartPourMille: number;
  repartition: number[];
  trimestresRealises: number;
  facteurPourMille: number;
  prevuAnnuel: {
    chiffreAffaires: number;
    excedentBrutExploitation: number;
    resultatNet: number;
    tresorerieCloture: number;
  };
  reprevision: ReprevisionAnnuelle;
  ecartsTrimestres: EcartsTrimestre[];
  ecartsCumules: EcartsCumules[];
  ecartsAnnuels: EcartsAnnuels;
  explicationEbe: ExplicationEcartEbe | null;
  faits: FaitReprevision[];
}

export interface EntreeFigee {
  trimestre: number;
  version: number;
  chiffreAffaires: number;
  excedentBrutExploitation: number;
  resultatNet: number | null;
  tresorerieFin: number | null;
}

export interface Reprevision {
  id: string;
  plan_id: string;
  modele_version_id: string;
  modele_version: number;
  exercice: number;
  version: number;
  dernier_trimestre: number;
  methode: MethodeReprevisionPlan;
  repartition: number[];
  seuil_pour_mille: number;
  moteur: string;
  cree_par: string;
  auteur_nom: string;
  cree_le: string;
  entrees: EntreeFigee[];
  resultat: ResultatReprevision;
}

export interface ResumeReprevision {
  id: string;
  modele_version: number;
  exercice: number;
  version: number;
  dernier_trimestre: number;
  methode: MethodeReprevisionPlan;
  seuil_pour_mille: number;
  auteur_nom: string;
  cree_le: string;
  reprevision: ReprevisionAnnuelle;
  ecarts_annuels: EcartsAnnuels;
}

export interface PageReprevisions {
  elements: ResumeReprevision[];
  curseur_suivant: string | null;
}

/** Version du modèle proposée au choix : seules les versions validées servent à re-prévoir. */
export interface VersionRetenue {
  version: number;
  validee: boolean;
}
