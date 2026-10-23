/** Contenus du plan stratégique : bornes, état des formulaires et préremplissage depuis une version. */
import type { Devise } from "./format";
import { lireListe, lireTexte } from "./plan-strategique";
import { montantVersSaisie } from "./saisie";

/** Bornes des schémas partagés (`DONNEES_ELEMENT_PLAN`). */
export const BORNES_ELEMENT = {
  synthese: 20_000,
  constat: 500,
  constats: 30,
  visionMission: 2_000,
  valeur: 200,
  valeurs: 20,
  titre: 200,
  description: 5_000,
  court: 200,
} as const;

export type ChampElement =
  | "synthese"
  | "forces"
  | "faiblesses"
  | "opportunites"
  | "menaces"
  | "swot"
  | "vision"
  | "mission"
  | "valeurs"
  | "titre"
  | "description"
  | "perspective"
  | "indicateur"
  | "cible"
  | "echeance"
  | "responsable_id"
  | "debut"
  | "budget"
  | "statut"
  | "gains"
  | "dependances";

/** Saisie d'un formulaire de contenu : textes bruts ; seuls les champs du type servent. */
export interface SaisieElement {
  synthese: string;
  forces: string;
  faiblesses: string;
  opportunites: string;
  menaces: string;
  vision: string;
  mission: string;
  valeurs: string;
  titre: string;
  description: string;
  perspective: string;
  indicateur: string;
  cible: string;
  echeance: string;
  responsable_id: string;
  debut: string;
  budget: string;
  statut: string;
  /** Gains nets annuels : exactement « horizon » cases. */
  gains: string[];
  /** Initiatives du plan qui doivent se terminer avant celle-ci (PLA-05). */
  dependances: string[];
}

export function saisieElementVide(horizon: number): SaisieElement {
  return {
    synthese: "",
    forces: "",
    faiblesses: "",
    opportunites: "",
    menaces: "",
    vision: "",
    mission: "",
    valeurs: "",
    titre: "",
    description: "",
    perspective: "",
    indicateur: "",
    cible: "",
    echeance: "",
    responsable_id: "",
    debut: "",
    budget: "",
    statut: "a_lancer",
    gains: Array.from({ length: horizon }, () => ""),
    dependances: [],
  };
}

const lignes = (l: readonly string[]) => l.join("\n");
const texteOuVide = (d: Record<string, unknown>, cle: string) => lireTexte(d, cle) ?? "";

/** Formulaire prérempli avec la version courante (une version reprend tout le contenu). */
export function saisieDepuisDonnees(
  donnees: Record<string, unknown>,
  devise: Devise,
  horizon: number,
): SaisieElement {
  const gains = Array.isArray(donnees.gains_annuels) ? (donnees.gains_annuels as unknown[]) : [];
  const budget = typeof donnees.budget === "number" ? donnees.budget : null;
  return {
    ...saisieElementVide(horizon),
    synthese: texteOuVide(donnees, "synthese"),
    forces: lignes(lireListe(donnees, "forces")),
    faiblesses: lignes(lireListe(donnees, "faiblesses")),
    opportunites: lignes(lireListe(donnees, "opportunites")),
    menaces: lignes(lireListe(donnees, "menaces")),
    vision: texteOuVide(donnees, "vision"),
    mission: texteOuVide(donnees, "mission"),
    valeurs: lignes(lireListe(donnees, "valeurs")),
    titre: texteOuVide(donnees, "titre"),
    description: texteOuVide(donnees, "description"),
    perspective: texteOuVide(donnees, "perspective"),
    indicateur: texteOuVide(donnees, "indicateur"),
    cible: texteOuVide(donnees, "cible"),
    echeance: texteOuVide(donnees, "echeance"),
    responsable_id: texteOuVide(donnees, "responsable_id"),
    debut: texteOuVide(donnees, "debut"),
    budget: budget === null ? "" : montantVersSaisie(budget, devise),
    statut: lireTexte(donnees, "statut") ?? "a_lancer",
    gains: Array.from({ length: horizon }, (_, i) =>
      typeof gains[i] === "number" ? montantVersSaisie(gains[i] as number, devise) : "",
    ),
    dependances: lireListe(donnees, "dependances"),
  };
}
