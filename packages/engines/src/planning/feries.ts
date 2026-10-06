/**
 * Jours fériés par défaut des 8 pays de l'UEMOA (SOC-04).
 *
 * VALEUR PAR DÉFAUT ÉDITABLE, À FAIRE VALIDER PAR LE MÉTIER : cette liste sert
 * à pré-remplir le calendrier d'un cabinet ; le cabinet la corrige et la
 * complète chaque année. Elle ne contient que les dates dont la source est
 * sûre ; les dates nationales incertaines ont été volontairement omises.
 *
 * Les fêtes musulmanes (Korité / fin du Ramadan, Tabaski, Mawlid, Tamkharit…)
 * dépendent de l'observation lunaire et sont fixées tardivement par les
 * autorités : elles NE SONT PAS calculées ici et doivent être saisies chaque
 * année par le cabinet. Les ponts et jours fériés exceptionnels décrétés
 * en cours d'année le sont aussi.
 */
import { type DateISO, ajouterJours, dateISO } from "./dates";

/** Codes ISO 3166-1 alpha-2 des pays de l'UEMOA. */
export type PaysUEMOA = "CI" | "SN" | "ML" | "BF" | "BJ" | "TG" | "NE" | "GW";

/** Liste des pays couverts par `feriesParDefaut`. */
export const PAYS_UEMOA: readonly PaysUEMOA[] = ["CI", "SN", "ML", "BF", "BJ", "TG", "NE", "GW"];

/** Jour férié daté. */
export interface JourFerie {
  readonly date: DateISO;
  readonly libelle: string;
}

/** Fête chrétienne mobile calculée à partir de Pâques. */
export type FeteMobile = "lundi_paques" | "ascension" | "lundi_pentecote";

interface FerieFixe {
  readonly mois: number;
  readonly jour: number;
  readonly libelle: string;
}

interface RegleFeriesPays {
  readonly fixes: readonly FerieFixe[];
  readonly mobiles: readonly FeteMobile[];
}

const NOUVEL_AN: FerieFixe = { mois: 1, jour: 1, libelle: "Jour de l'an" };
const TRAVAIL: FerieFixe = { mois: 5, jour: 1, libelle: "Fête du Travail" };
const ASSOMPTION: FerieFixe = { mois: 8, jour: 15, libelle: "Assomption" };
const TOUSSAINT: FerieFixe = { mois: 11, jour: 1, libelle: "Toussaint" };
const NOEL: FerieFixe = { mois: 12, jour: 25, libelle: "Noël" };
const CHRETIENNES: readonly FeteMobile[] = ["lundi_paques", "ascension", "lundi_pentecote"];

function fixe(mois: number, jour: number, libelle: string): FerieFixe {
  return { mois, jour, libelle };
}

/** Règles par pays (défauts à valider par le métier, voir l'en-tête). */
const REGLES: Readonly<Record<PaysUEMOA, RegleFeriesPays>> = {
  CI: {
    fixes: [
      NOUVEL_AN,
      TRAVAIL,
      fixe(8, 7, "Fête de l'Indépendance"),
      ASSOMPTION,
      TOUSSAINT,
      fixe(11, 15, "Journée nationale de la paix"),
      NOEL,
    ],
    mobiles: CHRETIENNES,
  },
  SN: {
    fixes: [NOUVEL_AN, fixe(4, 4, "Fête de l'Indépendance"), TRAVAIL, ASSOMPTION, TOUSSAINT, NOEL],
    mobiles: CHRETIENNES,
  },
  ML: {
    fixes: [
      NOUVEL_AN,
      fixe(1, 20, "Fête de l'Armée"),
      fixe(3, 26, "Journée des Martyrs"),
      TRAVAIL,
      fixe(5, 25, "Journée de l'Afrique"),
      fixe(9, 22, "Fête de l'Indépendance"),
      NOEL,
    ],
    mobiles: ["lundi_paques"],
  },
  BF: {
    fixes: [
      NOUVEL_AN,
      fixe(1, 3, "Anniversaire du soulèvement populaire de 1966"),
      fixe(3, 8, "Journée internationale de la femme"),
      TRAVAIL,
      fixe(8, 5, "Fête de l'Indépendance"),
      ASSOMPTION,
      TOUSSAINT,
      fixe(12, 11, "Fête nationale (proclamation de la République)"),
      NOEL,
    ],
    mobiles: ["lundi_paques", "ascension"],
  },
  BJ: {
    fixes: [
      NOUVEL_AN,
      fixe(1, 10, "Fête des religions endogènes"),
      TRAVAIL,
      fixe(8, 1, "Fête de l'Indépendance"),
      ASSOMPTION,
      TOUSSAINT,
      NOEL,
    ],
    mobiles: CHRETIENNES,
  },
  TG: {
    fixes: [NOUVEL_AN, fixe(4, 27, "Fête de l'Indépendance"), TRAVAIL, ASSOMPTION, TOUSSAINT, NOEL],
    mobiles: CHRETIENNES,
  },
  NE: {
    fixes: [
      NOUVEL_AN,
      fixe(4, 24, "Fête de la Concorde"),
      TRAVAIL,
      fixe(8, 3, "Fête de l'Indépendance"),
      fixe(12, 18, "Fête de la République"),
      NOEL,
    ],
    mobiles: ["lundi_paques"],
  },
  GW: {
    fixes: [
      NOUVEL_AN,
      fixe(1, 20, "Journée des Héros nationaux"),
      TRAVAIL,
      fixe(8, 3, "Journée des Martyrs de Pidjiguiti"),
      fixe(9, 24, "Fête de l'Indépendance"),
      NOEL,
    ],
    mobiles: [],
  },
};

/** Date de Pâques (calendrier grégorien) — algorithme de Meeus/Jones/Butcher. */
export function paques(annee: number): DateISO {
  if (!Number.isInteger(annee) || annee < 1583) {
    throw new RangeError(`Année hors calendrier grégorien : ${annee}`);
  }
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return dateISO(annee, mois, jour);
}

const DECALAGE_MOBILE: Readonly<Record<FeteMobile, { jours: number; libelle: string }>> = {
  lundi_paques: { jours: 1, libelle: "Lundi de Pâques" },
  ascension: { jours: 39, libelle: "Ascension" },
  lundi_pentecote: { jours: 50, libelle: "Lundi de Pentecôte" },
};

/** Fêtes chrétiennes mobiles d'une année. */
export function fetesMobiles(
  annee: number,
  quelles: readonly FeteMobile[] = CHRETIENNES,
): JourFerie[] {
  const p = paques(annee);
  return quelles.map((m) => ({
    date: ajouterJours(p, DECALAGE_MOBILE[m].jours),
    libelle: DECALAGE_MOBILE[m].libelle,
  }));
}

/**
 * Jours fériés par défaut d'un pays de l'UEMOA pour une année, triés par date.
 * Hors fêtes musulmanes et jours exceptionnels (à saisir par le cabinet).
 */
export function feriesParDefaut(pays: PaysUEMOA, annee: number): JourFerie[] {
  const regle = REGLES[pays];
  if (!regle) throw new RangeError(`Pays hors UEMOA : ${String(pays)}`);
  const fixes = regle.fixes.map((f) => ({
    date: dateISO(annee, f.mois, f.jour),
    libelle: f.libelle,
  }));
  return [...fixes, ...fetesMobiles(annee, regle.mobiles)].sort((x, y) =>
    x.date < y.date ? -1 : x.date > y.date ? 1 : 0,
  );
}
