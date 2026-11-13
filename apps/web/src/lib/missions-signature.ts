/** Missions : signature de la lettre de mission (MIS-07). */
import { aPermission, creerTraduire, type Langue, type Role } from "@missionpilot/shared";
import type { Devise } from "./format";
import { DATE } from "./missions-motifs";
import { lireMontant, lireNombre, type Resultat } from "./saisie";

// --- Signature de la lettre de mission (MIS-07) -----------------------------------------

export type NatureSupplementaire = "debours" | "sous_traitance";

export interface SaisieLigneSupplementaire {
  nature: NatureSupplementaire;
  libelle: string;
  montant: string;
  refacturable: boolean;
}

export interface SaisieSignature {
  date_signature: string;
  taux_change: string;
  lignes: SaisieLigneSupplementaire[];
}

export interface ChargeSignature {
  date_signature: string;
  taux_change?: number;
  lignes_supplementaires: {
    nature: NatureSupplementaire;
    libelle: string;
    montant: number;
    refacturable: boolean;
  }[];
}

/** Natures de lignes saisissables à la signature selon les droits (FIN-02). */
export function naturesSupplementaires(roles: readonly Role[]): NatureSupplementaire[] {
  const natures: NatureSupplementaire[] = [];
  if (aPermission(roles, "budget.lire_montants") || aPermission(roles, "finance.lire"))
    natures.push("debours");
  if (aPermission(roles, "finance.lire")) natures.push("sous_traitance");
  return natures;
}

/**
 * Devise à cours flottant (USD) : seule à exiger un taux de change saisi à la signature ; FCFA
 * et euro ont une parité légale fixe que l'API impose (tout autre taux est refusé).
 */
export const deviseFlottante = (devise: Devise) => devise === "USD";

export function validerSignature(
  s: SaisieSignature,
  devise: Devise,
  naturesPermises: readonly NatureSupplementaire[],
  langue: Langue = "fr",
): Resultat<ChargeSignature, string> {
  const t = creerTraduire(langue);
  const erreurs: Record<string, string> = {};
  if (!DATE.test(s.date_signature))
    erreurs.date_signature = t("Indiquez la date de signature.", "Enter the signing date.");
  const taux = deviseFlottante(devise) ? lireNombre(s.taux_change) : null;
  if (deviseFlottante(devise) && taux === null)
    erreurs.taux_change = t(
      `Indiquez le taux de change de la devise ${devise}.`,
      `Enter the exchange rate for currency ${devise}.`,
    );
  else if (taux !== null && (Number.isNaN(taux) || taux < 0.000001 || taux > 1_000_000))
    erreurs.taux_change = t(
      "Nombre positif entre 0,000001 et 1 000 000 (ex. 605,25).",
      "Positive number between 0.000001 and 1,000,000 (e.g. 605.25).",
    );
  const lignes: ChargeSignature["lignes_supplementaires"] = [];
  s.lignes.forEach((l, i) => {
    if (!naturesPermises.includes(l.nature)) {
      erreurs[`lignes.${i}.nature`] = t(
        "Nature non autorisée pour votre rôle.",
        "Type not allowed for your role.",
      );
      return;
    }
    const libelle = l.libelle.trim();
    if (libelle === "" || libelle.length > 200)
      erreurs[`lignes.${i}.libelle`] = t(
        "Libellé de 1 à 200 caractères.",
        "Label of 1 to 200 characters.",
      );
    const montant = lireMontant(l.montant, devise);
    if (montant === null || Number.isNaN(montant))
      erreurs[`lignes.${i}.montant`] = t(
        "Montant positif dans la devise de la mission.",
        "Positive amount in the engagement currency.",
      );
    lignes.push({
      nature: l.nature,
      libelle,
      montant: montant ?? 0,
      refacturable: l.nature === "debours" && l.refacturable,
    });
  });
  if (s.lignes.length > 50) erreurs.lignes = t("50 lignes au plus.", "50 lines at most.");
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      date_signature: s.date_signature,
      ...(taux === null ? {} : { taux_change: taux }),
      lignes_supplementaires: lignes,
    },
  };
}
