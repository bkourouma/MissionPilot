/**
 * Prévisions du cabinet (AUT-12) : chiffre d'affaires et charge par mois sur
 * 12 mois, du carnet signé et du pipeline pondéré.
 *
 * Fonctions pures, sans base ni horloge (la date de référence est un
 * paramètre). Tous les montants sont des entiers d'unités mineures de la
 * devise du cabinet (aucune conversion ici : l'appelant convertit chaque
 * montant au taux figé de sa mission) ; tous les jours sont calculés en
 * centièmes entiers.
 *
 * RÈGLES (à valider par le métier, voir docs/DECISIONS.md)
 * - Carnet signé : chaque échéance de facturation NON facturée tombe dans le
 *   mois de sa date prévue ; une échéance dont la date est antérieure au
 *   premier mois est comptée dans le premier mois et signalée « en retard » ;
 *   au-delà du dernier mois, elle va dans « au-delà de l'horizon ».
 * - Pipeline pondéré : montant estimé × probabilité (celle de l'opportunité ;
 *   à défaut, probabilité par défaut de son étape), réparti en parts égales sur
 *   `dureeMois` mois à partir du mois qui suit la clôture prévue (décalé de
 *   `delaiSignatureMois`). Sans date de clôture prévue : `delaiSansDateMois`
 *   après le premier mois. Une clôture déjà dépassée démarre au premier mois.
 * - Charge du carnet : jours des affectations (nominatives et profils à
 *   pourvoir) au prorata des jours ouvrés, comme le plan de charge. Charge du
 *   pipeline : jours de la dernière proposition × probabilité, répartis comme
 *   le chiffre d'affaires.
 * - Capacité : jours ouvrés du calendrier du cabinet − absences validées, ×
 *   temps de travail, des collaborateurs fournis (internes actifs).
 */
import { analyserDateISO } from "../commun/dates";
import { diviserArrondi } from "../finance/calcul-exact";
import {
  additionner,
  appliquerPourcentage,
  zero,
  type Devise,
  type Montant,
} from "../finance/monnaie";
import type { ParametresCalendrier } from "../planning/calendrier";
import {
  etatCharge,
  joursAffectesPrepares,
  preparerAffectation,
  capacite,
  tauxOccupation,
  SEUILS_CHARGE_DEFAUT,
  type Absence,
  type Affectation,
  type EtatCharge,
  type SeuilsCharge,
} from "../planning/capacite";
import { periodeDuMois, type DateISO, type Periode } from "../planning/dates";
import { depuisCentiemes, versCentiemes } from "../planning/unites";

export type CodeErreurPrevision =
  | "MOIS_INVALIDE"
  | "NOMBRE_MOIS_INVALIDE"
  | "DEVISE_DIFFERENTE"
  | "PROBABILITE_INVALIDE"
  | "JOURS_INVALIDES"
  | "PARAMETRE_INVALIDE";

export class ErreurPrevision extends Error {
  constructor(
    readonly code: CodeErreurPrevision,
    message: string,
  ) {
    super(message);
    this.name = "ErreurPrevision";
  }
}

export const ETAPES_PIPELINE = [
  "prospection",
  "qualification",
  "proposition",
  "negociation",
] as const;
export type EtapePipeline = (typeof ETAPES_PIPELINE)[number];

/** Probabilité de succès par défaut d'une étape, en % (à valider par le métier). */
export const PROBABILITE_ETAPE_DEFAUT: Readonly<Record<EtapePipeline, number>> = {
  prospection: 10,
  qualification: 25,
  proposition: 50,
  negociation: 75,
};

export const NB_MOIS_PREVISION = 12;
export const DELAI_SIGNATURE_MOIS_DEFAUT = 1;
export const DUREE_MOIS_DEFAUT = 3;
export const DELAI_SANS_DATE_MOIS_DEFAUT = 3;
/** Bornes des paramètres (une durée ou un délai déraisonnables sont refusés). */
const DUREE_MOIS_MAX = 60;
const DELAI_MOIS_MAX = 60;
const NB_MOIS_MAX = 36;

/** Échéance de facturation non facturée, dans la devise du cabinet. */
export interface EcheanceCarnet {
  readonly missionId: string;
  readonly date: DateISO;
  readonly montant: Montant;
}

/** Opportunité ouverte du pipeline. */
export interface OpportunitePrevision {
  readonly id: string;
  readonly etape: EtapePipeline;
  /** Probabilité en % (entier de 0 à 100), ou `null` : défaut de l'étape. */
  readonly probabilitePct: number | null;
  readonly montant: Montant;
  readonly dateCloturePrevue: DateISO | null;
  /** Jours de la dernière proposition, en centièmes (entier), ou `null` si aucune. */
  readonly joursCentiemes: number | null;
}

export interface CollaborateurPrevision {
  readonly id: string;
  readonly tempsTravailPct?: number;
  readonly absences?: readonly Absence[];
}

export interface ParametresPrevision {
  readonly nbMois?: number;
  readonly delaiSignatureMois?: number;
  readonly dureeMois?: number;
  readonly delaiSansDateMois?: number;
}

export interface EntreePrevision {
  readonly devise: Devise;
  /** Le premier mois de la prévision est celui de cette date. */
  readonly dateReference: DateISO;
  readonly echeances: readonly EcheanceCarnet[];
  readonly opportunites: readonly OpportunitePrevision[];
  readonly collaborateurs: readonly CollaborateurPrevision[];
  /** Affectations nominatives des collaborateurs fournis. */
  readonly affectations: readonly Affectation[];
  /** Affectations de profil (grade) pas encore pourvues : charge sans capacité nominative. */
  readonly affectationsAPourvoir: readonly Affectation[];
  readonly calendrier?: ParametresCalendrier;
  readonly seuils?: SeuilsCharge;
  readonly parametres?: ParametresPrevision;
}

export interface LignePrevisionMois {
  readonly mois: string;
  readonly periode: Periode;
  readonly caCarnet: number;
  readonly caPipeline: number;
  readonly caTotal: number;
  readonly capaciteJours: number;
  readonly chargeCarnetJours: number;
  readonly chargeAPourvoirJours: number;
  readonly chargePipelineJours: number;
  readonly chargeTotaleJours: number;
  /** Capacité − charge totale (négatif : manque de capacité). */
  readonly ecartJours: number;
  readonly tauxOccupation: number | null;
  readonly etat: EtatCharge;
}

export interface SyntheseEtape {
  readonly etape: EtapePipeline;
  readonly nombre: number;
  readonly montant: number;
  readonly montantPondere: number;
}

export interface PrevisionCabinet {
  readonly devise: Devise;
  readonly mois: readonly LignePrevisionMois[];
  readonly totaux: {
    readonly caCarnet: number;
    readonly caPipeline: number;
    readonly caTotal: number;
    readonly chargeCarnetJours: number;
    readonly chargeAPourvoirJours: number;
    readonly chargePipelineJours: number;
    readonly chargeTotaleJours: number;
    readonly capaciteJours: number;
  };
  /** Hors horizon : échéances et pipeline pondéré après le dernier mois. */
  readonly auDela: { readonly caCarnet: number; readonly caPipeline: number };
  /** Échéances (dont la date précède le premier mois) ramenées au premier mois. */
  readonly enRetard: { readonly nombre: number; readonly montant: number };
  readonly parEtape: readonly SyntheseEtape[];
  readonly nombreEcheances: number;
  readonly nombreOpportunites: number;
  /** Opportunités sans date de clôture prévue (date supposée). */
  readonly opportunitesSansDate: number;
  /** Opportunités sans proposition chiffrée en jours (aucune charge estimée). */
  readonly opportunitesSansCharge: number;
  /** Opportunités dont la clôture prévue est dépassée (démarrage au premier mois). */
  readonly opportunitesEnRetard: number;
}

/* ----- Mois ----- */

const FORMAT_MOIS = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Mois `AAAA-MM` d'une date `AAAA-MM-JJ`. La date entière est validée (jour existant :
 * « 2026-05-99 » et « 2026-02-30 » sont refusés, pas seulement le mois).
 */
export function moisDeDate(date: DateISO): string {
  if (typeof date !== "string" || !analyserDateISO(date).valide) {
    throw new ErreurPrevision("MOIS_INVALIDE", `Date invalide : « ${String(date)} ».`);
  }
  return date.slice(0, 7);
}

function indexDuMois(mois: string): number {
  const m = FORMAT_MOIS.exec(mois);
  if (!m) throw new ErreurPrevision("MOIS_INVALIDE", `Mois invalide : « ${mois} ».`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

/**
 * Mois `AAAA-MM` situé `n` mois après `mois` (`n` entier, éventuellement négatif). Hors des
 * années 0001 à 9999 (format à quatre chiffres) : `MOIS_INVALIDE`, jamais une erreur interne.
 */
export function moisApres(mois: string, n: number): string {
  const index = indexDuMois(mois) + n;
  const annee = Math.floor(index / 12);
  if (!Number.isInteger(n) || annee < 1 || annee > 9999) {
    throw new ErreurPrevision(
      "MOIS_INVALIDE",
      `Mois hors des années 0001 à 9999 : « ${mois} » + ${n}.`,
    );
  }
  return `${String(annee).padStart(4, "0")}-${String(index - annee * 12 + 1).padStart(2, "0")}`;
}

/** Les `nb` mois consécutifs à partir du mois de `dateReference`. */
export function genererMois(dateReference: DateISO, nb: number = NB_MOIS_PREVISION): string[] {
  if (!Number.isInteger(nb) || nb < 1 || nb > NB_MOIS_MAX) {
    throw new ErreurPrevision(
      "NOMBRE_MOIS_INVALIDE",
      `Nombre de mois invalide : ${nb} (attendu 1 à ${NB_MOIS_MAX}).`,
    );
  }
  const premier = moisDeDate(dateReference);
  return Array.from({ length: nb }, (_, i) => moisApres(premier, i));
}

/* ----- Répartition ----- */

/**
 * Répartit un entier en `n` parts égales : le reste est donné d'une unité aux
 * premières parts (la somme des parts égale toujours le total).
 */
export function repartirEntier(total: number, n: number): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isInteger(n) || n < 1) {
    throw new ErreurPrevision("PARAMETRE_INVALIDE", "Répartition invalide.");
  }
  const base = Math.floor(total / n);
  const reste = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < reste ? 1 : 0));
}

/** Pose des parts à partir de l'indice `debut` ; ce qui dépasse l'horizon va dans `apres`. */
function poser(cible: number[], parts: readonly number[], debut: number): { apres: number } {
  let apres = 0;
  parts.forEach((p, k) => {
    const i = debut + k;
    if (i < cible.length) cible[i] = (cible[i] as number) + p;
    else apres += p;
  });
  return { apres };
}

/** Probabilité retenue (entier 0 à 100) pour une opportunité. */
export function probabiliteRetenue(
  o: Pick<OpportunitePrevision, "etape" | "probabilitePct">,
): number {
  const p = o.probabilitePct ?? PROBABILITE_ETAPE_DEFAUT[o.etape];
  if (p === undefined || !Number.isInteger(p) || p < 0 || p > 100) {
    throw new ErreurPrevision("PROBABILITE_INVALIDE", `Probabilité invalide : ${String(p)} %.`);
  }
  return p;
}

function entierParametre(
  valeur: number | undefined,
  defaut: number,
  nom: string,
  min: number,
  max: number,
): number {
  const v = valeur ?? defaut;
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new ErreurPrevision(
      "PARAMETRE_INVALIDE",
      `${nom} invalide : ${v} (attendu ${min} à ${max}).`,
    );
  }
  return v;
}

function verifierDevise(m: Montant, devise: Devise, quoi: string): void {
  if (m.devise !== devise) {
    throw new ErreurPrevision(
      "DEVISE_DIFFERENTE",
      `${quoi} en ${m.devise} : convertir en ${devise} avant la prévision.`,
    );
  }
}

/** Somme de montants entiers (devise unique). */
function somme(montants: readonly Montant[], devise: Devise): number {
  return montants.reduce((t, m) => additionner(t, m), zero(devise)).valeur;
}

/* ----- Prévision ----- */

interface ParametresRetenus {
  readonly nbMois: number;
  readonly delaiSignature: number;
  readonly duree: number;
  readonly delaiSansDate: number;
}

function lireParametres(p: ParametresPrevision): ParametresRetenus {
  return {
    nbMois: entierParametre(p.nbMois, NB_MOIS_PREVISION, "Nombre de mois", 1, NB_MOIS_MAX),
    delaiSignature: entierParametre(
      p.delaiSignatureMois,
      DELAI_SIGNATURE_MOIS_DEFAUT,
      "Délai de signature",
      0,
      DELAI_MOIS_MAX,
    ),
    duree: entierParametre(p.dureeMois, DUREE_MOIS_DEFAUT, "Durée", 1, DUREE_MOIS_MAX),
    delaiSansDate: entierParametre(
      p.delaiSansDateMois,
      DELAI_SANS_DATE_MOIS_DEFAUT,
      "Délai sans date",
      0,
      DELAI_MOIS_MAX,
    ),
  };
}

interface Horizon {
  readonly devise: Devise;
  readonly nbMois: number;
  /** Indice absolu du premier mois de la prévision. */
  readonly premierIndex: number;
}

/** Carnet signé : échéances non facturées, par mois, en retard ou au-delà de l'horizon. */
function ventilerCarnet(echeances: readonly EcheanceCarnet[], h: Horizon) {
  const ca = new Array<number>(h.nbMois).fill(0);
  let apres: Montant = zero(h.devise);
  let retardMontant: Montant = zero(h.devise);
  let retardNombre = 0;
  for (const e of echeances) {
    verifierDevise(e.montant, h.devise, "Échéance");
    const i = indexDuMois(moisDeDate(e.date)) - h.premierIndex;
    if (i < 0) {
      retardNombre += 1;
      retardMontant = additionner(retardMontant, e.montant);
      ca[0] = (ca[0] as number) + e.montant.valeur;
    } else if (i >= h.nbMois) {
      apres = additionner(apres, e.montant);
    } else {
      ca[i] = (ca[i] as number) + e.montant.valeur;
    }
  }
  return { ca, apres: apres.valeur, retardNombre, retardMontant: retardMontant.valeur };
}

interface GroupeEtape {
  nombre: number;
  montants: Montant[];
  ponderes: Montant[];
}

/** Mois de départ (indice dans l'horizon) d'une opportunité, et son statut de date. */
function debutOpportunite(
  o: OpportunitePrevision,
  h: Horizon,
  p: ParametresRetenus,
): { debut: number; sansDate: boolean; enRetard: boolean } {
  if (o.dateCloturePrevue === null) {
    return { debut: p.delaiSansDate, sansDate: true, enRetard: false };
  }
  const cloture = indexDuMois(moisDeDate(o.dateCloturePrevue)) - h.premierIndex;
  return cloture < 0
    ? { debut: 0, sansDate: false, enRetard: true }
    : { debut: cloture + p.delaiSignature, sansDate: false, enRetard: false };
}

/** Jours de la proposition × probabilité, en centièmes entiers (arrondi moitié au-dessus). */
function chargePonderee(joursCentiemes: number, pct: number): number {
  if (!Number.isSafeInteger(joursCentiemes) || joursCentiemes < 0) {
    throw new ErreurPrevision("JOURS_INVALIDES", `Jours invalides : ${joursCentiemes}.`);
  }
  return Number(diviserArrondi(BigInt(joursCentiemes) * BigInt(pct), 100n));
}

/** Pipeline pondéré : chiffre d'affaires et charge répartis, synthèse par étape. */
function ventilerPipeline(
  opportunites: readonly OpportunitePrevision[],
  h: Horizon,
  p: ParametresRetenus,
) {
  const ca = new Array<number>(h.nbMois).fill(0);
  const charge = new Array<number>(h.nbMois).fill(0);
  let apres = 0;
  let sansDate = 0;
  let sansCharge = 0;
  let enRetard = 0;
  const etapes = new Map<EtapePipeline, GroupeEtape>();
  for (const etape of ETAPES_PIPELINE) etapes.set(etape, { nombre: 0, montants: [], ponderes: [] });
  for (const o of opportunites) {
    verifierDevise(o.montant, h.devise, "Opportunité");
    // L'étape inconnue est signalée AVANT la probabilité (qui en dépend à défaut de valeur).
    const groupe = etapes.get(o.etape);
    if (!groupe) {
      throw new ErreurPrevision("PARAMETRE_INVALIDE", `Étape inconnue : « ${String(o.etape)} ».`);
    }
    const pct = probabiliteRetenue(o);
    const pondere = appliquerPourcentage(o.montant, pct);
    groupe.nombre += 1;
    groupe.montants.push(o.montant);
    groupe.ponderes.push(pondere);

    const d = debutOpportunite(o, h, p);
    if (d.sansDate) sansDate += 1;
    if (d.enRetard) enRetard += 1;
    apres += poser(ca, repartirEntier(pondere.valeur, p.duree), d.debut).apres;

    if (o.joursCentiemes === null) {
      sansCharge += 1;
    } else {
      poser(charge, repartirEntier(chargePonderee(o.joursCentiemes, pct), p.duree), d.debut);
    }
  }
  return { ca, charge, apres, sansDate, sansCharge, enRetard, etapes };
}

/** Une ligne par mois : chiffre d'affaires, charge contre capacité, taux et état. */
function lignesMois(
  entree: EntreePrevision,
  mois: readonly string[],
  caCarnet: readonly number[],
  caPipeline: readonly number[],
  chargePipeline: readonly number[],
): LignePrevisionMois[] {
  const calendrier = entree.calendrier ?? {};
  const seuils = entree.seuils ?? SEUILS_CHARGE_DEFAUT;
  const prepNominatives = entree.affectations.map((a) => preparerAffectation(a, calendrier));
  const prepAPourvoir = entree.affectationsAPourvoir.map((a) => preparerAffectation(a, calendrier));
  const centiemesAffectes = (preps: typeof prepNominatives, periode: Periode): number =>
    preps.reduce((t, prep) => t + versCentiemes(joursAffectesPrepares(prep, periode)), 0);

  return mois.map((m, i) => {
    const periode = periodeDuMois(m);
    const capaciteC = entree.collaborateurs.reduce(
      (t, c) =>
        t +
        versCentiemes(capacite(periode, calendrier, c.absences ?? [], c.tempsTravailPct ?? 100)),
      0,
    );
    const carnetC = centiemesAffectes(prepNominatives, periode);
    const aPourvoirC = centiemesAffectes(prepAPourvoir, periode);
    const pipelineC = chargePipeline[i] as number;
    const totalC = carnetC + aPourvoirC + pipelineC;
    const capaciteJours = depuisCentiemes(capaciteC);
    const totalJours = depuisCentiemes(totalC);
    return {
      mois: m,
      periode,
      caCarnet: caCarnet[i] as number,
      caPipeline: caPipeline[i] as number,
      caTotal: (caCarnet[i] as number) + (caPipeline[i] as number),
      capaciteJours,
      chargeCarnetJours: depuisCentiemes(carnetC),
      chargeAPourvoirJours: depuisCentiemes(aPourvoirC),
      chargePipelineJours: depuisCentiemes(pipelineC),
      chargeTotaleJours: totalJours,
      ecartJours: depuisCentiemes(capaciteC - totalC),
      tauxOccupation: tauxOccupation(totalJours, capaciteJours),
      etat: etatCharge(totalJours, capaciteJours, seuils),
    };
  });
}

/** Totaux de l'horizon : sommes des lignes (jours sommés en centièmes entiers). */
function totauxPrevision(lignes: readonly LignePrevisionMois[]): PrevisionCabinet["totaux"] {
  const total = (f: (l: LignePrevisionMois) => number): number =>
    lignes.reduce((t, l) => t + f(l), 0);
  const totalJours = (f: (l: LignePrevisionMois) => number): number =>
    depuisCentiemes(lignes.reduce((t, l) => t + versCentiemes(f(l)), 0));
  return {
    caCarnet: total((l) => l.caCarnet),
    caPipeline: total((l) => l.caPipeline),
    caTotal: total((l) => l.caTotal),
    chargeCarnetJours: totalJours((l) => l.chargeCarnetJours),
    chargeAPourvoirJours: totalJours((l) => l.chargeAPourvoirJours),
    chargePipelineJours: totalJours((l) => l.chargePipelineJours),
    chargeTotaleJours: totalJours((l) => l.chargeTotaleJours),
    capaciteJours: totalJours((l) => l.capaciteJours),
  };
}

function syntheseEtapes(etapes: ReadonlyMap<EtapePipeline, GroupeEtape>, devise: Devise) {
  return ETAPES_PIPELINE.map((etape) => {
    const g = etapes.get(etape) as GroupeEtape;
    return {
      etape,
      nombre: g.nombre,
      montant: somme(g.montants, devise),
      montantPondere: somme(g.ponderes, devise),
    };
  });
}

/** Prévision de chiffre d'affaires et de charge sur l'horizon (12 mois par défaut). */
export function prevoirCabinet(entree: EntreePrevision): PrevisionCabinet {
  const p = lireParametres(entree.parametres ?? {});
  const devise = entree.devise;
  const mois = genererMois(entree.dateReference, p.nbMois);
  const h: Horizon = { devise, nbMois: p.nbMois, premierIndex: indexDuMois(mois[0] as string) };
  const carnet = ventilerCarnet(entree.echeances, h);
  const pipeline = ventilerPipeline(entree.opportunites, h, p);
  const lignes = lignesMois(entree, mois, carnet.ca, pipeline.ca, pipeline.charge);
  return {
    devise,
    mois: lignes,
    totaux: totauxPrevision(lignes),
    auDela: { caCarnet: carnet.apres, caPipeline: pipeline.apres },
    enRetard: { nombre: carnet.retardNombre, montant: carnet.retardMontant },
    parEtape: syntheseEtapes(pipeline.etapes, devise),
    nombreEcheances: entree.echeances.length,
    nombreOpportunites: entree.opportunites.length,
    opportunitesSansDate: pipeline.sansDate,
    opportunitesSansCharge: pipeline.sansCharge,
    opportunitesEnRetard: pipeline.enRetard,
  };
}
