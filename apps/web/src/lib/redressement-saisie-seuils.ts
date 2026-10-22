/** Redressement (saisie) : seuils d'alerte par secteur. */
import {
  RED_CRITERES_ALERTE,
  type RedCritereAlerte,
  type RedSeuils,
  type RedSeuilsCreation,
} from "@missionpilot/shared";
import { FORME_CRITERE } from "./redressement";
import { lireNombre, texteOuNull, type Resultat } from "./saisie";
import { type Erreurs, lireEntier } from "./redressement-saisie-base";

// --- Seuils d'alerte (par secteur) ---------------------------------------------------------------------------

/** Facteur entre la valeur saisie et la valeur de l'API : rapport ×10 000, pourcentage ×100. */
export function facteurCritere(critere: RedCritereAlerte): number {
  const forme = FORME_CRITERE[critere];
  if (forme === "ratio") return 10_000;
  if (forme === "pourcentage" || forme === "points") return 100;
  return 1;
}

export interface SaisieSeuilCritere {
  orange: string;
  rouge: string;
  poids: string;
}
export interface SaisieSeuils {
  criteres: Record<RedCritereAlerte, SaisieSeuilCritere>;
  niveaux: { modere: string; eleve: string; critique: string };
  part_minimale_evaluee_pct: string;
  motif: string;
}
export type ChampSeuils =
  "poids" | "niveaux" | "part" | "motif" | `${RedCritereAlerte}.${"orange" | "rouge" | "poids"}`;

/** Valeur de l'API → texte d'un champ (« 12000 » → « 1,2 » pour un rapport). */
export function valeurVersSaisie(critere: RedCritereAlerte, valeur: number): string {
  const f = facteurCritere(critere);
  return String(f === 1 ? valeur : valeur / f).replace(".", ",");
}

export function saisieSeuilsDepuis(seuils: RedSeuils): SaisieSeuils {
  const criteres = {} as SaisieSeuils["criteres"];
  for (const c of RED_CRITERES_ALERTE) {
    const s = seuils.criteres[c];
    criteres[c] = {
      orange: valeurVersSaisie(c, s.orange),
      rouge: valeurVersSaisie(c, s.rouge),
      poids: String(s.poids),
    };
  }
  return {
    criteres,
    niveaux: {
      modere: String(seuils.niveaux.modere),
      eleve: String(seuils.niveaux.eleve),
      critique: String(seuils.niveaux.critique),
    },
    part_minimale_evaluee_pct: String(seuils.part_minimale_evaluee_pct),
    motif: "",
  };
}

/** Texte saisi → valeur de l'API (entier) ; `NaN` si illisible ou trop précis. */
function lireValeurCritere(critere: RedCritereAlerte, texte: string): number {
  const n = lireNombre(texte);
  if (n === null || Number.isNaN(n)) return Number.NaN;
  const brut = n * facteurCritere(critere);
  const entier = Math.round(brut);
  if (Math.abs(brut - entier) > 1e-6 || Math.abs(entier) > 1_000_000) return Number.NaN;
  return entier;
}

/**
 * Contrôle de saisie : somme des poids saisis (entiers lisibles). Le moteur impose 100 ; ce
 * total n'alimente aucun résultat, il évite seulement un aller-retour inutile.
 */
export function sommeDesPoids(criteres: Record<RedCritereAlerte, { poids: string }>): number {
  let somme = 0;
  for (const c of RED_CRITERES_ALERTE) {
    const n = lireEntier(criteres[c].poids, 0, 1000);
    if (n !== null && !Number.isNaN(n)) somme += n;
  }
  return somme;
}

export function corpsSeuilsDepuisFormulaire(
  secteur: RedSeuilsCreation["secteur"],
  s: SaisieSeuils,
): Resultat<RedSeuilsCreation, ChampSeuils> {
  const erreurs: Erreurs<ChampSeuils> = {};
  const criteres = {} as RedSeuils["criteres"];
  for (const c of RED_CRITERES_ALERTE) {
    const orange = lireValeurCritere(c, s.criteres[c].orange);
    const rouge = lireValeurCritere(c, s.criteres[c].rouge);
    const poids = lireEntier(s.criteres[c].poids, 0, 1000);
    if (Number.isNaN(orange)) erreurs[`${c}.orange`] = "Valeur illisible.";
    if (Number.isNaN(rouge)) erreurs[`${c}.rouge`] = "Valeur illisible.";
    if (poids === null || Number.isNaN(poids))
      erreurs[`${c}.poids`] = "Poids : entier de 0 à 1 000.";
    criteres[c] = { orange, rouge, poids: poids ?? Number.NaN };
  }
  const modere = lireEntier(s.niveaux.modere, 0, 100);
  const eleve = lireEntier(s.niveaux.eleve, 0, 100);
  const critique = lireEntier(s.niveaux.critique, 0, 100);
  if ([modere, eleve, critique].some((n) => n === null || Number.isNaN(n))) {
    erreurs.niveaux = "Les trois niveaux sont des entiers de 0 à 100.";
  }
  const part = lireEntier(s.part_minimale_evaluee_pct, 0, 100);
  if (part === null || Number.isNaN(part)) erreurs.part = "Part minimale : entier de 0 à 100.";
  if (!erreurs.poids && Object.keys(erreurs).every((k) => !k.endsWith(".poids"))) {
    const somme = sommeDesPoids(s.criteres);
    if (somme !== 100) {
      erreurs.poids = `La somme des poids doit être égale à 100 (actuellement ${somme}).`;
    }
  }
  const motif = texteOuNull(s.motif);
  if (motif !== null && motif.length > 500)
    erreurs.motif = "Le motif compte 500 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: RedSeuilsCreation = {
    secteur,
    seuils: {
      criteres,
      niveaux: { modere: modere as number, eleve: eleve as number, critique: critique as number },
      part_minimale_evaluee_pct: part as number,
    },
  };
  if (motif !== null) charge.motif = motif;
  return { ok: true, charge };
}
