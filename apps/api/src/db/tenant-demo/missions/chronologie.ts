import { ajouterJours } from "@missionpilot/engines";
import { ecartJours } from "../horloge.js";

/*
 * Chronologie commerciale d'une mission du casting (fonction pure) : opportunité -> proposition
 * créée -> validée -> envoyée -> acceptée -> mission créée. Les trois jalons intermédiaires sont
 * des fractions croissantes (25 %, 50 %, 75 %) de l'intervalle opportunité -> réponse du client,
 * donc strictement croissants et toujours avant la réponse, elle-même avant la création de la
 * mission (l'intervalle fait au moins 10 jours dans le casting).
 */

export interface ChronologieCommerciale {
  /** Création de l'opportunité. */
  opportunite: string;
  proposition: string;
  validee: string;
  envoyee: string;
  /** Réponse du client (proposition acceptée). */
  repondue: string;
  /** Création de la mission (lendemain de la réponse). */
  mission: string;
}

export function chronologieCommerciale(def: {
  opp: string;
  signature?: string;
}): ChronologieCommerciale {
  const repondue = def.signature ? ajouterJours(def.signature, -4) : ajouterJours(def.opp, 18);
  const longueur = ecartJours(def.opp, repondue);
  if (longueur < 4) {
    throw new Error(`Chronologie commerciale impossible : ${longueur} jour(s) avant la réponse.`);
  }
  const jour = (fraction: number): string => ajouterJours(def.opp, Math.round(longueur * fraction));
  return {
    opportunite: def.opp,
    proposition: jour(0.25),
    validee: jour(0.5),
    envoyee: jour(0.75),
    repondue,
    mission: ajouterJours(repondue, 1),
  };
}
