/** Paramètres du cabinet et jours fériés (SOC-04) : logique pure, testée dans `cabinet.test.ts`. */
import {
  creerTraduire,
  LOCALES_INTL,
  type CabinetModification,
  type FerieCreation,
  type Langue,
  type UniteSaisieTemps,
} from "@missionpilot/shared";
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
export function nomPays(code: string | null | undefined, langue: Langue = "fr"): string {
  if (!code) return "—";
  const fr = PAYS.find((p) => p.code === code)?.nom ?? code;
  if (langue !== "en") return fr;
  try {
    return new Intl.DisplayNames([LOCALES_INTL[langue]], { type: "region" }).of(code) ?? fr;
  } catch {
    return fr;
  }
}

/** Pays proposés, libellés dans la langue de l'interface. */
export function optionsPays(langue: Langue = "fr"): { valeur: string; libelle: string }[] {
  return PAYS.map((p) => ({ valeur: p.code, libelle: nomPays(p.code, langue) }));
}

export const DEVISE_LIBELLES: Record<Devise, string> = {
  XOF: "Franc CFA de l'Afrique de l'Ouest (XOF)",
  XAF: "Franc CFA de l'Afrique centrale (XAF)",
  EUR: "Euro (EUR)",
  USD: "Dollar américain (USD)",
};

export const OPTIONS_DEVISES = DEVISES.map((d) => ({ valeur: d, libelle: DEVISE_LIBELLES[d] }));

const DEVISE_LIBELLES_EN: Record<Devise, string> = {
  XOF: "West African CFA franc (XOF)",
  XAF: "Central African CFA franc (XAF)",
  EUR: "Euro (EUR)",
  USD: "US dollar (USD)",
};

/** Devises proposées, libellées dans la langue de l'interface. */
export function optionsDevises(langue: Langue = "fr"): { valeur: Devise; libelle: string }[] {
  return DEVISES.map((d) => ({
    valeur: d,
    libelle: langue === "en" ? DEVISE_LIBELLES_EN[d] : DEVISE_LIBELLES[d],
  }));
}

export const UNITE_LIBELLES: Record<UniteSaisieTemps, string> = {
  demi_journee: "Demi-journée",
  heure: "Heure",
};

const UNITE_LIBELLES_EN: Record<UniteSaisieTemps, string> = {
  demi_journee: "Half-day",
  heure: "Hour",
};

/** Unités de saisie proposées, libellées dans la langue de l'interface. */
export function optionsUnites(langue: Langue = "fr"): { valeur: string; libelle: string }[] {
  const table = langue === "en" ? UNITE_LIBELLES_EN : UNITE_LIBELLES;
  return Object.entries(table).map(([valeur, libelle]) => ({ valeur, libelle }));
}

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

const JOURS_SEMAINE_EN = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Jours de la semaine proposés, libellés dans la langue de l'interface. */
export function optionsJours(langue: Langue = "fr"): { valeur: string; libelle: string }[] {
  return JOURS_SEMAINE.map((j) => ({
    valeur: String(j.numero),
    libelle: langue === "en" ? (JOURS_SEMAINE_EN[j.numero - 1] ?? j.nom) : j.nom,
  }));
}

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

export function validerCabinet(
  s: SaisieCabinet,
  langue: Langue = "fr",
): Resultat<CabinetModification, ChampCabinet> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampCabinet, string>> = {};
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = t("Saisissez le nom du cabinet.", "Enter the firm name.");
  else if (nom.length > 200)
    erreurs.nom = t(
      "Le nom ne doit pas dépasser 200 caractères.",
      "The name must not exceed 200 characters.",
    );
  if (!/^[A-Z]{2}$/.test(s.pays)) erreurs.pays = t("Choisissez un pays.", "Choose a country.");
  if (!(DEVISES as readonly string[]).includes(s.devise_base))
    erreurs.devise_base = t("Choisissez une devise.", "Choose a currency.");
  if (s.unite_saisie_temps !== "demi_journee" && s.unite_saisie_temps !== "heure")
    erreurs.unite_saisie_temps = t("Choisissez une unité de saisie.", "Choose an entry unit.");
  const heures = lireNombre(s.heures_par_jour);
  if (heures === null)
    erreurs.heures_par_jour = t(
      "Saisissez le nombre d'heures par jour.",
      "Enter the number of hours per day.",
    );
  else if (Number.isNaN(heures) || heures < 1 || heures > 24)
    erreurs.heures_par_jour = t(
      "Saisissez un nombre entre 1 et 24 (ex. 8 ou 7,5).",
      "Enter a number between 1 and 24 (e.g. 8 or 7.5).",
    );
  else if (Math.abs(heures * 100 - Math.round(heures * 100)) > 1e-9)
    erreurs.heures_par_jour = t("Deux décimales au plus.", "At most two decimals.");
  const jours = [...new Set(s.jours_travailles)].filter((j) => j >= 1 && j <= 7);
  if (jours.length === 0)
    erreurs.jours_travailles = t(
      "Cochez au moins un jour travaillé.",
      "Check at least one working day.",
    );

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
  langue: Langue = "fr",
): Resultat<FerieCreation, "date" | "libelle" | "nationale"> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"date" | "libelle", string>> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date))
    erreurs.date = t("Choisissez une date.", "Choose a date.");
  const libelle = s.libelle.trim();
  if (libelle === "")
    erreurs.libelle = t(
      "Saisissez le nom du jour férié (ex. Fête de l'Indépendance).",
      "Enter the name of the public holiday (e.g. Independence Day).",
    );
  else if (libelle.length > 120)
    erreurs.libelle = t("120 caractères au plus.", "120 characters at most.");
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { date: s.date, libelle, nationale: s.nationale } };
}

/** Année demandée dans l'URL, bornée ; l'année courante sinon. */
export function anneeDemandee(v: string | string[] | undefined, courante: number): number {
  const brut = Array.isArray(v) ? v[0] : v;
  const n = Number(brut);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : courante;
}
