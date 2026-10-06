/** Paramètres du cabinet et jours fériés (SOC-04) : logique pure, testée dans `cabinet.test.ts`. */
import type { CabinetModification, FerieCreation, UniteSaisieTemps } from "@missionpilot/shared";
import { DEVISES, type Devise } from "./format";
import { lireNombre, type Resultat } from "./saisie";

export interface Cabinet {
  id: string;
  nom: string;
  pays: string;
  devise_base: Devise;
  unite_saisie_temps: UniteSaisieTemps;
  heures_par_jour: number;
  jours_travailles: number[];
}

export interface Ferie {
  id: string;
  date: string;
  libelle: string;
  nationale: boolean;
  /** Proposé par « jours fériés par défaut » : à vérifier par le cabinet. */
  a_valider?: boolean;
}

/** Pays proposés : Afrique francophone d'abord, puis pays des clients européens. */
export const PAYS: readonly { code: string; nom: string }[] = [
  { code: "BJ", nom: "Bénin" },
  { code: "BF", nom: "Burkina Faso" },
  { code: "BI", nom: "Burundi" },
  { code: "CM", nom: "Cameroun" },
  { code: "CF", nom: "Centrafrique" },
  { code: "KM", nom: "Comores" },
  { code: "CG", nom: "Congo" },
  { code: "CD", nom: "Congo (RDC)" },
  { code: "CI", nom: "Côte d'Ivoire" },
  { code: "DJ", nom: "Djibouti" },
  { code: "GA", nom: "Gabon" },
  { code: "GN", nom: "Guinée" },
  { code: "GW", nom: "Guinée-Bissau" },
  { code: "GQ", nom: "Guinée équatoriale" },
  { code: "MG", nom: "Madagascar" },
  { code: "ML", nom: "Mali" },
  { code: "MA", nom: "Maroc" },
  { code: "MR", nom: "Mauritanie" },
  { code: "NE", nom: "Niger" },
  { code: "RW", nom: "Rwanda" },
  { code: "SN", nom: "Sénégal" },
  { code: "TD", nom: "Tchad" },
  { code: "TG", nom: "Togo" },
  { code: "TN", nom: "Tunisie" },
  { code: "DZ", nom: "Algérie" },
  { code: "BE", nom: "Belgique" },
  { code: "CA", nom: "Canada" },
  { code: "FR", nom: "France" },
  { code: "CH", nom: "Suisse" },
];

/** Nom d'un pays à partir de son code ISO ; le code lui-même s'il est inconnu. */
export function nomPays(code: string | null | undefined): string {
  if (!code) return "—";
  return PAYS.find((p) => p.code === code)?.nom ?? code;
}

export const DEVISE_LIBELLES: Record<Devise, string> = {
  XOF: "Franc CFA de l'Afrique de l'Ouest (XOF)",
  XAF: "Franc CFA de l'Afrique centrale (XAF)",
  EUR: "Euro (EUR)",
  USD: "Dollar américain (USD)",
};

export const OPTIONS_DEVISES = DEVISES.map((d) => ({ valeur: d, libelle: DEVISE_LIBELLES[d] }));

export const UNITE_LIBELLES: Record<UniteSaisieTemps, string> = {
  demi_journee: "Demi-journée",
  heure: "Heure",
};

/** Numérotation ISO : 1 = lundi … 7 = dimanche. */
export const JOURS_SEMAINE: readonly { numero: number; nom: string }[] = [
  { numero: 1, nom: "Lundi" },
  { numero: 2, nom: "Mardi" },
  { numero: 3, nom: "Mercredi" },
  { numero: 4, nom: "Jeudi" },
  { numero: 5, nom: "Vendredi" },
  { numero: 6, nom: "Samedi" },
  { numero: 7, nom: "Dimanche" },
];

export interface SaisieCabinet {
  nom: string;
  pays: string;
  devise_base: string;
  unite_saisie_temps: string;
  heures_par_jour: string;
  jours_travailles: number[];
}

export type ChampCabinet = keyof SaisieCabinet;

export function saisieDepuisCabinet(c: Cabinet): SaisieCabinet {
  return {
    nom: c.nom,
    pays: c.pays,
    devise_base: c.devise_base,
    unite_saisie_temps: c.unite_saisie_temps,
    heures_par_jour: String(c.heures_par_jour).replace(".", ","),
    jours_travailles: [...c.jours_travailles],
  };
}

export function validerCabinet(s: SaisieCabinet): Resultat<CabinetModification, ChampCabinet> {
  const erreurs: Partial<Record<ChampCabinet, string>> = {};
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = "Saisissez le nom du cabinet.";
  else if (nom.length > 200) erreurs.nom = "Le nom ne doit pas dépasser 200 caractères.";
  if (!/^[A-Z]{2}$/.test(s.pays)) erreurs.pays = "Choisissez un pays.";
  if (!(DEVISES as readonly string[]).includes(s.devise_base))
    erreurs.devise_base = "Choisissez une devise.";
  if (s.unite_saisie_temps !== "demi_journee" && s.unite_saisie_temps !== "heure")
    erreurs.unite_saisie_temps = "Choisissez une unité de saisie.";
  const heures = lireNombre(s.heures_par_jour);
  if (heures === null) erreurs.heures_par_jour = "Saisissez le nombre d'heures par jour.";
  else if (Number.isNaN(heures) || heures < 1 || heures > 24)
    erreurs.heures_par_jour = "Saisissez un nombre entre 1 et 24 (ex. 8 ou 7,5).";
  else if (Math.abs(heures * 100 - Math.round(heures * 100)) > 1e-9)
    erreurs.heures_par_jour = "Deux décimales au plus.";
  const jours = [...new Set(s.jours_travailles)].filter((j) => j >= 1 && j <= 7);
  if (jours.length === 0) erreurs.jours_travailles = "Cochez au moins un jour travaillé.";

  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      nom,
      pays: s.pays,
      devise_base: s.devise_base as Devise,
      unite_saisie_temps: s.unite_saisie_temps as UniteSaisieTemps,
      heures_par_jour: heures as number,
      jours_travailles: jours.sort((a, b) => a - b),
    },
  };
}

export interface SaisieFerie {
  date: string;
  libelle: string;
  nationale: boolean;
}

export function validerFerie(
  s: SaisieFerie,
): Resultat<FerieCreation, "date" | "libelle" | "nationale"> {
  const erreurs: Partial<Record<"date" | "libelle", string>> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) erreurs.date = "Choisissez une date.";
  const libelle = s.libelle.trim();
  if (libelle === "")
    erreurs.libelle = "Saisissez le nom du jour férié (ex. Fête de l'Indépendance).";
  else if (libelle.length > 120) erreurs.libelle = "120 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { date: s.date, libelle, nationale: s.nationale } };
}

/** Année demandée dans l'URL, bornée ; l'année courante sinon. */
export function anneeDemandee(v: string | string[] | undefined, courante: number): number {
  const brut = Array.isArray(v) ? v[0] : v;
  const n = Number(brut);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : courante;
}
