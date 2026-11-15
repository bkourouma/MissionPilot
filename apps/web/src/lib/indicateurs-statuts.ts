/** Indicateurs : seuils de lecture et statut d'affichage d'une valeur servie par l'API. */
import { creerTraduire, type Langue } from "@missionpilot/shared";
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

const sansValeur = (langue: Langue): StatutAffiche => ({
  tonalite: "neutre",
  libelle: creerTraduire(langue)("Pas de donnée sur la période", "No data for the period"),
});

function parPalier(
  v: number | null | undefined,
  bon: number,
  faible: number,
  libelles: [string, string, string],
  langue: Langue,
): StatutAffiche {
  if (!estNombre(v)) return sansValeur(langue);
  if (v >= bon) return { tonalite: "succes", libelle: libelles[0] };
  if (v >= faible) return { tonalite: "attention", libelle: libelles[1] };
  return { tonalite: "danger", libelle: libelles[2] };
}

export function statutOccupation(
  v: number | null | undefined,
  langue: Langue = "fr",
): StatutAffiche {
  const t = creerTraduire(langue);
  if (!estNombre(v)) return sansValeur(langue);
  if (v > SEUILS.occupation.surcharge) {
    return { tonalite: "danger", libelle: t("Surcharge", "Overload") };
  }
  if (v < SEUILS.occupation.sousOccupation) {
    return { tonalite: "attention", libelle: t("Sous-occupation", "Underutilization") };
  }
  return { tonalite: "succes", libelle: t("Charge normale", "Normal workload") };
}

export function statutConsommation(
  v: number | null | undefined,
  langue: Langue = "fr",
): StatutAffiche {
  const t = creerTraduire(langue);
  if (!estNombre(v)) return sansValeur(langue);
  if (v > SEUILS.consommation.depasse) {
    return { tonalite: "danger", libelle: t("Budget dépassé", "Over budget") };
  }
  if (v >= SEUILS.consommation.vigilance) {
    return { tonalite: "attention", libelle: t("Proche du budget", "Close to budget") };
  }
  return { tonalite: "succes", libelle: t("Dans le budget", "Within budget") };
}

/** Écart relatif (atterrissage − budget) / budget : positif = dépassement. */
export function statutEcart(
  relatif: number | null | undefined,
  jours?: number,
  langue: Langue = "fr",
): StatutAffiche {
  const t = creerTraduire(langue);
  if (!estNombre(relatif)) {
    if (estNombre(jours) && jours > 0) {
      return { tonalite: "danger", libelle: t("Dépassement", "Overrun") };
    }
    return sansValeur(langue);
  }
  if (relatif > SEUILS.ecart.alerte) {
    return { tonalite: "danger", libelle: t("Dérive au-delà de 5 %", "Drift beyond 5%") };
  }
  if (relatif > 0)
    return { tonalite: "attention", libelle: t("Léger dépassement", "Slight overrun") };
  return { tonalite: "succes", libelle: t("Dans le budget", "Within budget") };
}

/**
 * `marge` (montant servi par l'API) départage un taux absent : sans honoraires facturés, des
 * coûts engagés donnent une marge négative, pas une absence de donnée.
 */
export function statutMarge(
  taux: number | null | undefined,
  marge?: number,
  langue: Langue = "fr",
): StatutAffiche {
  const t = creerTraduire(langue);
  if (!estNombre(taux)) {
    if (estNombre(marge) && marge < 0) {
      return {
        tonalite: "danger",
        libelle: t("Coûts sans honoraires facturés", "Costs without invoiced fees"),
      };
    }
    return sansValeur(langue);
  }
  if (taux < 0) return { tonalite: "danger", libelle: t("Marge négative", "Negative margin") };
  if (taux < SEUILS.marge.bonne) {
    return { tonalite: "attention", libelle: t("Marge faible", "Low margin") };
  }
  return { tonalite: "succes", libelle: t("Marge satisfaisante", "Satisfactory margin") };
}

export function statutDelai(
  jours: number | null | undefined,
  langue: Langue = "fr",
): StatutAffiche {
  const t = creerTraduire(langue);
  if (!estNombre(jours)) return sansValeur(langue);
  if (jours <= SEUILS.delai.bon) {
    return { tonalite: "succes", libelle: t("Encaissement rapide", "Fast collection") };
  }
  if (jours <= SEUILS.delai.long) {
    return { tonalite: "attention", libelle: t("Encaissement lent", "Slow collection") };
  }
  return { tonalite: "danger", libelle: t("Encaissement très lent", "Very slow collection") };
}

export const statutFacturabilite = (v: number | null | undefined, langue: Langue = "fr") => {
  const t = creerTraduire(langue);
  return parPalier(
    v,
    SEUILS.facturabilite.bon,
    SEUILS.facturabilite.faible,
    [
      t("Bonne facturabilité", "Good billability"),
      t("Facturabilité moyenne", "Average billability"),
      t("Facturabilité faible", "Low billability"),
    ],
    langue,
  );
};

export const statutRealisation = (v: number | null | undefined, langue: Langue = "fr") => {
  const t = creerTraduire(langue);
  return parPalier(
    v,
    SEUILS.realisation.bon,
    SEUILS.realisation.faible,
    [
      t("Bonne réalisation", "Good realization"),
      t("Réalisation à surveiller", "Realization to watch"),
      t("Réalisation faible", "Low realization"),
    ],
    langue,
  );
};

export const statutRatio = (r: Ratio | undefined, langue: Langue = "fr") => {
  const t = creerTraduire(langue);
  return parPalier(
    r?.taux,
    SEUILS.ratio.bon,
    SEUILS.ratio.faible,
    [
      t("Bon niveau", "Good level"),
      t("À surveiller", "To watch"),
      t("Insuffisant", "Insufficient"),
    ],
    langue,
  );
};
