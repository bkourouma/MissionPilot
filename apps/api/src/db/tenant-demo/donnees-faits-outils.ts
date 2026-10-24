import type {
  CategorieFaitDossier,
  FiabilitePreuve,
  SourceDossier,
  ValeurFaitDossier,
} from "@missionpilot/shared";

/*
 * Faits des dossiers client du cabinet « Tenant démo » (DOS-01, DOS-02) : 4 à 6 faits par client,
 * datés (2024 à 2026), sourcés et notés en fiabilité. La plupart sont « confirmés » ; un ou deux
 * par dossier restent « proposés » (à confirmer par un autre membre). Chiffres de démonstration.
 */
export interface DefFait {
  categorie: CategorieFaitDossier;
  cle: string;
  valeur: ValeurFaitDossier;
  date_effet: string;
  source: SourceDossier;
  fiabilite: FiabilitePreuve;
  statut: "propose" | "confirme";
}

export const txt = (texte: string): ValeurFaitDossier => ({ type: "texte", texte });
export const nb = (nombre: number): ValeurFaitDossier => ({ type: "nombre", nombre });
export const xof = (montant: number): ValeurFaitDossier => ({
  type: "montant",
  montant,
  devise: "XOF",
});
export const xaf = (montant: number): ValeurFaitDossier => ({
  type: "montant",
  montant,
  devise: "XAF",
});
export const eur = (montant: number): ValeurFaitDossier => ({
  type: "montant",
  montant,
  devise: "EUR",
});
export const usd = (montant: number): ValeurFaitDossier => ({
  type: "montant",
  montant,
  devise: "USD",
});
export const oui = (booleen: boolean): ValeurFaitDossier => ({ type: "booleen", booleen });
export const date = (d: string): ValeurFaitDossier => ({ type: "date", date: d });

export const doc = (libelle: string): SourceDossier => ({ type: "document", libelle });
export const entretien = (libelle: string): SourceDossier => ({ type: "entretien", libelle });
export const observation = (libelle: string): SourceDossier => ({ type: "observation", libelle });
export const externe = (libelle: string): SourceDossier => ({ type: "donnee_externe", libelle });

export function f(
  categorie: CategorieFaitDossier,
  cle: string,
  valeur: ValeurFaitDossier,
  date_effet: string,
  source: SourceDossier,
  fiabilite: FiabilitePreuve,
  statut: "propose" | "confirme" = "confirme",
): DefFait {
  return { categorie, cle, valeur, date_effet, source, fiabilite, statut };
}
