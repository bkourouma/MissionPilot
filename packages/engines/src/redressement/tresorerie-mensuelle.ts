/**
 * Vue mensuelle de la trésorerie (RED-06, lot 2) : agrège la projection hebdomadaire par mois
 * civil. Aucune table : la vue est recalculée à chaque lecture à partir de `projeterTresorerie`.
 *
 * CONVENTION : une semaine appartient au mois civil de son LUNDI (`debut`). Une fenêtre de 13
 * semaines recouvre donc 3 ou 4 mois ; le premier et le dernier peuvent être partiels (`partiel`).
 * Les flux sont les flux RETENUS de chaque semaine (le réalisé quand il existe, sinon la
 * prévision) ; le solde de fin de mois est le solde retenu de clôture de la dernière semaine du
 * mois (il peut différer de l'ouverture + flux net quand un solde constaté ancre la série).
 * Sommes exactes en `BigInt`. Un « mois de tension » est un constat arithmétique : l'une de ses
 * semaines clôture sous le seuil choisi, jamais une situation de droit.
 */
import { type DateISO, dateISODepuisJourUTC } from "../commun/dates";
import { jourDe, versNombreSur } from "./commun";
import { ErreurRedressement } from "./erreurs";
import type { ResultatTresorerie, SemaineTresorerie } from "./tresorerie";

export interface MoisTresorerie {
  /** « AAAA-MM ». */
  readonly mois: string;
  /** Numéros de semaine (1..13) rattachés au mois. */
  readonly semaines: readonly number[];
  /** Lundi de la première semaine du mois dans la fenêtre. */
  readonly debut: DateISO;
  /** Dimanche de la dernière semaine du mois dans la fenêtre. */
  readonly fin: DateISO;
  /** La fenêtre ne couvre pas toutes les semaines (lundis) du mois civil. */
  readonly partiel: boolean;
  /** Nombre de semaines du mois dont le réalisé est connu. */
  readonly semainesRealisees: number;
  /** Flux retenus (réalisé, sinon prévu). */
  readonly encaissements: number;
  readonly decaissements: number;
  readonly fluxNet: number;
  /** Solde retenu d'ouverture de la première semaine. */
  readonly soldeOuverture: number;
  /** Solde retenu de clôture de la dernière semaine. */
  readonly soldeFin: number;
  /** Plus bas solde de clôture hebdomadaire du mois (première semaine du minimum). */
  readonly soldeMinimum: { readonly semaine: number; readonly montant: number };
  /** Au moins une semaine du mois clôture sous le seuil de tension. */
  readonly tension: boolean;
  /** Numéros des semaines en tension. */
  readonly semainesTension: readonly number[];
}

export interface ResultatTresorerieMensuelle {
  readonly mois: readonly MoisTresorerie[];
  readonly moisTension: readonly string[];
  readonly premierMoisTension: string | null;
  /** Plus bas solde de clôture hebdomadaire de toute la fenêtre, avec son mois. */
  readonly soldeMinimum: {
    readonly mois: string;
    readonly semaine: number;
    readonly montant: number;
  };
  readonly totaux: {
    readonly encaissements: number;
    readonly decaissements: number;
    readonly fluxNet: number;
  };
}

const moisDe = (semaine: SemaineTresorerie): string => semaine.debut.slice(0, 7);

/** Agrège la projection hebdomadaire (13 semaines) par mois civil du lundi. */
export function agregerTresorerieMensuelle(
  projection: ResultatTresorerie,
): ResultatTresorerieMensuelle {
  const semaines = projection.semaines;
  if (semaines.length === 0) {
    throw new ErreurRedressement("TRESORERIE_INVALIDE", "Projection vide : aucune semaine.");
  }
  const groupes = new Map<string, SemaineTresorerie[]>();
  for (const s of semaines) {
    const cle = moisDe(s);
    const groupe = groupes.get(cle);
    if (groupe) groupe.push(s);
    else groupes.set(cle, [s]);
  }
  const cles = [...groupes.keys()];
  const mois: MoisTresorerie[] = [];
  let totalEnc = 0n;
  let totalDec = 0n;
  cles.forEach((cle, index) => {
    const groupe = groupes.get(cle) as SemaineTresorerie[];
    const premiere = groupe[0] as SemaineTresorerie;
    const derniere = groupe[groupe.length - 1] as SemaineTresorerie;
    let enc = 0n;
    let dec = 0n;
    let realisees = 0;
    let minimum = premiere;
    for (const s of groupe) {
      if (s.realise !== null) {
        enc += BigInt(s.realise.encaissements);
        dec += BigInt(s.realise.decaissements);
        realisees += 1;
      } else {
        enc += BigInt(s.encaissementsPrevus);
        dec += BigInt(s.decaissementsPrevus);
      }
      if (s.soldeClotureRetenu < minimum.soldeClotureRetenu) minimum = s;
    }
    totalEnc += enc;
    totalDec += dec;
    // Partiel : le premier mois s'il commence après son premier lundi (jour > 7), le dernier si
    // la semaine suivante resterait dans le même mois.
    const jourDuPremier = Number(premiere.debut.slice(8, 10));
    const lundiSuivant = dateISODepuisJourUTC(jourDe(derniere.debut, "Lundi") + 7);
    const partiel =
      (index === 0 && jourDuPremier > 7) ||
      (index === cles.length - 1 && lundiSuivant.slice(0, 7) === cle);
    const tensions = groupe.filter((s) => s.tension).map((s) => s.semaine);
    mois.push({
      mois: cle,
      semaines: groupe.map((s) => s.semaine),
      debut: premiere.debut,
      fin: derniere.fin,
      partiel,
      semainesRealisees: realisees,
      encaissements: versNombreSur(enc),
      decaissements: versNombreSur(dec),
      fluxNet: versNombreSur(enc - dec),
      soldeOuverture: premiere.soldeOuvertureRetenu,
      soldeFin: derniere.soldeClotureRetenu,
      soldeMinimum: { semaine: minimum.semaine, montant: minimum.soldeClotureRetenu },
      tension: tensions.length > 0,
      semainesTension: tensions,
    });
  });
  const moisTension = mois.filter((m) => m.tension).map((m) => m.mois);
  const global = projection.soldeMinimum;
  const semaineMinimum = semaines.find((s) => s.semaine === global.semaine) as SemaineTresorerie;
  return {
    mois,
    moisTension,
    premierMoisTension: moisTension[0] ?? null,
    soldeMinimum: {
      mois: moisDe(semaineMinimum),
      semaine: global.semaine,
      montant: global.montant,
    },
    totaux: {
      encaissements: versNombreSur(totalEnc),
      decaissements: versNombreSur(totalDec),
      fluxNet: versNombreSur(totalEnc - totalDec),
    },
  };
}
