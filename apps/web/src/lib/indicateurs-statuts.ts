/** Indicateurs : seuils de lecture et statut d'affichage d'une valeur servie par l'API. */
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { estNombre } from "./indicateurs-nombre";
import type { Ratio } from "./indicateurs-types";

// --- Seuils de lecture ---------------------------------------------------------------------

/**
 * Seuils d'AFFICHAGE (valeurs de départ, à valider par le cabinet) : ils classent une valeur
 * servie par l'API, ils ne la calculent pas. Occupation : seuils du plan de charge (moteur,
 * surcharge > 100 %, sous-occupation < 50 %) ; écart à terminaison : alerte du parcours C
 * (atterrissage au-delà du budget de 5 %).
 */
export const SEUILS = {
  occupation: { surcharge: 1, sousOccupation: 0.5 },
  facturabilite: { bon: 0.7, faible: 0.5 },
  consommation: { vigilance: 0.9, depasse: 1 },
  ecart: { alerte: 0.05 },
  marge: { bonne: 0.2 },
  realisation: { bon: 0.95, faible: 0.85 },
  delai: { bon: 45, long: 90 },
  ratio: { bon: 0.9, faible: 0.75 },
} as const;

export interface StatutAffiche {
  tonalite: TonaliteStatut;
  libelle: string;
}

const SANS_VALEUR: StatutAffiche = { tonalite: "neutre", libelle: "Pas de donnée sur la période" };

function parPalier(
  v: number | null | undefined,
  bon: number,
  faible: number,
  libelles: [string, string, string],
): StatutAffiche {
  if (!estNombre(v)) return SANS_VALEUR;
  if (v >= bon) return { tonalite: "succes", libelle: libelles[0] };
  if (v >= faible) return { tonalite: "attention", libelle: libelles[1] };
  return { tonalite: "danger", libelle: libelles[2] };
}

export function statutOccupation(v: number | null | undefined): StatutAffiche {
  if (!estNombre(v)) return SANS_VALEUR;
  if (v > SEUILS.occupation.surcharge) return { tonalite: "danger", libelle: "Surcharge" };
  if (v < SEUILS.occupation.sousOccupation)
    return { tonalite: "attention", libelle: "Sous-occupation" };
  return { tonalite: "succes", libelle: "Charge normale" };
}

export function statutConsommation(v: number | null | undefined): StatutAffiche {
  if (!estNombre(v)) return SANS_VALEUR;
  if (v > SEUILS.consommation.depasse) return { tonalite: "danger", libelle: "Budget dépassé" };
  if (v >= SEUILS.consommation.vigilance)
    return { tonalite: "attention", libelle: "Proche du budget" };
  return { tonalite: "succes", libelle: "Dans le budget" };
}

/** Écart relatif (atterrissage − budget) / budget : positif = dépassement. */
export function statutEcart(relatif: number | null | undefined, jours?: number): StatutAffiche {
  if (!estNombre(relatif)) {
    if (estNombre(jours) && jours > 0) return { tonalite: "danger", libelle: "Dépassement" };
    return SANS_VALEUR;
  }
  if (relatif > SEUILS.ecart.alerte)
    return { tonalite: "danger", libelle: "Dérive au-delà de 5 %" };
  if (relatif > 0) return { tonalite: "attention", libelle: "Léger dépassement" };
  return { tonalite: "succes", libelle: "Dans le budget" };
}

/**
 * `marge` (montant servi par l'API) départage un taux absent : sans honoraires facturés, des
 * coûts engagés donnent une marge négative, pas une absence de donnée.
 */
export function statutMarge(taux: number | null | undefined, marge?: number): StatutAffiche {
  if (!estNombre(taux)) {
    if (estNombre(marge) && marge < 0)
      return { tonalite: "danger", libelle: "Coûts sans honoraires facturés" };
    return SANS_VALEUR;
  }
  if (taux < 0) return { tonalite: "danger", libelle: "Marge négative" };
  if (taux < SEUILS.marge.bonne) return { tonalite: "attention", libelle: "Marge faible" };
  return { tonalite: "succes", libelle: "Marge satisfaisante" };
}

export function statutDelai(jours: number | null | undefined): StatutAffiche {
  if (!estNombre(jours)) return SANS_VALEUR;
  if (jours <= SEUILS.delai.bon) return { tonalite: "succes", libelle: "Encaissement rapide" };
  if (jours <= SEUILS.delai.long) return { tonalite: "attention", libelle: "Encaissement lent" };
  return { tonalite: "danger", libelle: "Encaissement très lent" };
}

export const statutFacturabilite = (v: number | null | undefined) =>
  parPalier(v, SEUILS.facturabilite.bon, SEUILS.facturabilite.faible, [
    "Bonne facturabilité",
    "Facturabilité moyenne",
    "Facturabilité faible",
  ]);

export const statutRealisation = (v: number | null | undefined) =>
  parPalier(v, SEUILS.realisation.bon, SEUILS.realisation.faible, [
    "Bonne réalisation",
    "Réalisation à surveiller",
    "Réalisation faible",
  ]);

export const statutRatio = (r: Ratio | undefined) =>
  parPalier(r?.taux, SEUILS.ratio.bon, SEUILS.ratio.faible, [
    "Bon niveau",
    "À surveiller",
    "Insuffisant",
  ]);
