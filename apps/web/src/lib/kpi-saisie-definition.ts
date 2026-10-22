/**
 * Saisie de la définition d'un KPI (création et modification). Voir `kpi-saisie.ts`, point
 * d'entrée du module.
 */
import {
  DATE_SUIVI_KPI_MIN,
  FREQUENCES_KPI,
  NATURES_KPI,
  PERSPECTIVES_KPI,
  SENS_LECTURE_KPI,
  type FrequenceKpiApi,
  type NatureKpiApi,
  type PerspectiveKpi,
  type SensLectureKpiApi,
} from "@missionpilot/shared";
import { formaterDate } from "./format";
import type { DefinitionKpi } from "./kpi";
import {
  DESCRIPTION_MAX,
  LIBELLE_MAX,
  lirePonderation,
  lirePourcentage,
  lireValeurKpi,
  fractionVersPourcentage,
  texteFacultatif,
  texteObligatoire,
  UNITE_MAX,
  valeurVersSaisie,
  type Lecture,
} from "./kpi-saisie-nombres";
import { dateValide } from "./periode";
import type { Resultat } from "./saisie";

// --- Définition d'un KPI --------------------------------------------------------------------

export interface SaisieKpi {
  libelle: string;
  description: string;
  unite: string;
  perspective: string;
  sens: string;
  nature: string;
  frequence: string;
  debut_suivi: string;
  fin_suivi: string;
  /** Cible initiale (création seulement) ; vide : sans cible. */
  cible: string;
  ponderation: string;
  /** Seuils de statut en POURCENTAGE de la cible (« 95 »). */
  seuil_vert: string;
  seuil_orange: string;
  alerte_haut: string;
  alerte_bas: string;
  /** Variation relative maximale en POURCENTAGE (« 20 »). */
  alerte_variation: string;
  proprietaire_id: string;
  rappels_actifs: boolean;
}

export type ChampKpi = keyof SaisieKpi;

export const SAISIE_KPI_VIDE: SaisieKpi = {
  libelle: "",
  description: "",
  unite: "",
  perspective: "",
  sens: "plus_haut_mieux",
  nature: "flux",
  frequence: "mensuelle",
  debut_suivi: "",
  fin_suivi: "",
  cible: "",
  ponderation: "1",
  seuil_vert: "",
  seuil_orange: "",
  alerte_haut: "",
  alerte_bas: "",
  alerte_variation: "",
  proprietaire_id: "",
  rappels_actifs: true,
};

/** Définition de l'API → champs modifiables. */
export function saisieDepuisKpi(d: DefinitionKpi): SaisieKpi {
  return {
    libelle: d.libelle,
    description: d.description ?? "",
    unite: d.unite,
    perspective: d.perspective ?? "",
    sens: d.sens,
    nature: d.nature,
    frequence: d.frequence,
    debut_suivi: d.debut_suivi,
    fin_suivi: d.fin_suivi ?? "",
    cible: "",
    ponderation: valeurVersSaisie(d.ponderation),
    seuil_vert: fractionVersPourcentage(d.seuil_vert),
    seuil_orange: fractionVersPourcentage(d.seuil_orange),
    alerte_haut: valeurVersSaisie(d.alerte_haut),
    alerte_bas: valeurVersSaisie(d.alerte_bas),
    alerte_variation: fractionVersPourcentage(d.alerte_variation),
    proprietaire_id: d.proprietaire_id ?? "",
    rappels_actifs: d.rappels_actifs,
  };
}

/** Champs communs à la création et à la modification, prêts pour l'API. */
export interface ChampsKpi {
  libelle: string;
  description: string | null;
  unite: string;
  perspective: PerspectiveKpi | null;
  ponderation: number;
  seuil_vert: number | null;
  seuil_orange: number | null;
  alerte_haut: number | null;
  alerte_bas: number | null;
  alerte_variation: number | null;
  proprietaire_id: string | null;
  fin_suivi: string | null;
  rappels_actifs: boolean;
}

export interface ChargeCreationKpi extends Partial<ChampsKpi> {
  libelle: string;
  unite: string;
  sens: SensLectureKpiApi;
  nature: NatureKpiApi;
  frequence: FrequenceKpiApi;
  debut_suivi: string;
  cible?: number;
}

export type ChargeModificationKpi = Partial<ChampsKpi>;

export interface ContexteKpi {
  aujourdhui: string;
  /** Identifiants des propriétaires proposés (directeur, chef, équipe). */
  proprietaires: readonly string[];
  /** Début de suivi déjà fixé (modification) : borne de la fin de suivi. */
  debutFixe?: string;
}

/** Il y a dix ans (le suivi commence au plus 10 ans avant la création, contrainte 0160). */
export function ilYaDixAns(aujourdhui: string): string {
  const annee = Number(aujourdhui.slice(0, 4)) - 10;
  const suite = aujourdhui.slice(4) === "-02-29" ? "-02-28" : aujourdhui.slice(4);
  return `${annee}${suite}`;
}

const dansListe = <T extends string>(liste: readonly T[], v: string): v is T =>
  (liste as readonly string[]).includes(v);

function lireChamps(s: SaisieKpi, ctx: ContexteKpi, erreurs: Record<string, string>): ChampsKpi {
  const lire = <T>(champ: ChampKpi, l: Lecture<T>) => {
    if (l.erreur) erreurs[champ] = l.erreur;
    return l.valeur;
  };
  const perspective = s.perspective === "" ? null : s.perspective;
  if (perspective !== null && !dansListe(PERSPECTIVES_KPI, perspective)) {
    erreurs.perspective = "Choisissez une perspective de la liste.";
  }
  const seuilVert = lire("seuil_vert", lirePourcentage(s.seuil_vert, 100));
  const seuilOrange = lire("seuil_orange", lirePourcentage(s.seuil_orange, 100));
  if (!erreurs.seuil_vert && !erreurs.seuil_orange) {
    if ((seuilVert === null) !== (seuilOrange === null)) {
      const vide = seuilVert === null ? "seuil_vert" : "seuil_orange";
      erreurs[vide] = "Renseignez les deux seuils, ou aucun (seuils par défaut : 95 % et 80 %).";
    } else if (seuilVert !== null && seuilOrange !== null && seuilOrange >= seuilVert) {
      erreurs.seuil_orange = "Le seuil orange doit être inférieur au seuil vert.";
    }
  }
  const haut = lire("alerte_haut", lireValeurKpi(s.alerte_haut));
  const bas = lire("alerte_bas", lireValeurKpi(s.alerte_bas));
  if (haut !== null && bas !== null && bas > haut) {
    erreurs.alerte_bas = "Le seuil d'alerte bas doit être inférieur ou égal au seuil haut.";
  }
  const proprietaire = s.proprietaire_id === "" ? null : s.proprietaire_id;
  if (proprietaire !== null && !ctx.proprietaires.includes(proprietaire)) {
    erreurs.proprietaire_id = "Choisissez le propriétaire parmi les responsables et l'équipe.";
  }
  const debut = ctx.debutFixe ?? s.debut_suivi;
  const fin = s.fin_suivi === "" ? null : s.fin_suivi;
  if (fin !== null && !dateValide(fin)) erreurs.fin_suivi = "Date de fin de suivi invalide.";
  else if (fin !== null && dateValide(debut) && fin < debut) {
    erreurs.fin_suivi = "La fin du suivi ne peut pas précéder son début.";
  }
  return {
    libelle: texteObligatoire(
      s.libelle,
      LIBELLE_MAX,
      erreurs,
      "libelle",
      "Le libellé est obligatoire.",
    ),
    description: texteFacultatif(s.description, DESCRIPTION_MAX, erreurs, "description"),
    unite: texteObligatoire(
      s.unite,
      UNITE_MAX,
      erreurs,
      "unite",
      "L'unité est obligatoire (ex. FCFA, %, jours, clients).",
    ),
    perspective: perspective as PerspectiveKpi | null,
    ponderation: lire("ponderation", lirePonderation(s.ponderation)) ?? 1,
    seuil_vert: seuilVert,
    seuil_orange: seuilOrange,
    alerte_haut: haut,
    alerte_bas: bas,
    alerte_variation: lire("alerte_variation", lirePourcentage(s.alerte_variation, 10000)),
    proprietaire_id: proprietaire,
    fin_suivi: fin,
    rappels_actifs: s.rappels_actifs,
  };
}

/** Création d'un KPI (KPI-01) : champs facultatifs vides omis, cible initiale facultative. */
export function validerCreationKpi(
  s: SaisieKpi,
  ctx: ContexteKpi,
): Resultat<ChargeCreationKpi, ChampKpi> {
  const erreurs: Record<string, string> = {};
  const champs = lireChamps(s, ctx, erreurs);
  if (!dansListe(SENS_LECTURE_KPI, s.sens)) erreurs.sens = "Choisissez le sens de lecture.";
  if (!dansListe(NATURES_KPI, s.nature)) erreurs.nature = "Choisissez la nature du KPI.";
  if (!dansListe(FREQUENCES_KPI, s.frequence)) erreurs.frequence = "Choisissez une fréquence.";
  const debut = s.debut_suivi;
  if (debut === "") erreurs.debut_suivi = "Le début du suivi est obligatoire.";
  else if (!dateValide(debut) || debut < DATE_SUIVI_KPI_MIN) {
    erreurs.debut_suivi = "Date de début de suivi invalide.";
  } else if (debut < ilYaDixAns(ctx.aujourdhui)) {
    erreurs.debut_suivi = `Le suivi commence au plus 10 ans avant aujourd'hui (pas avant le ${formaterDate(ilYaDixAns(ctx.aujourdhui))}).`;
  }
  const cible = lireValeurKpi(s.cible);
  if (cible.erreur) erreurs.cible = cible.erreur;
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: ChargeCreationKpi = {
    libelle: champs.libelle,
    unite: champs.unite,
    sens: s.sens as SensLectureKpiApi,
    nature: s.nature as NatureKpiApi,
    frequence: s.frequence as FrequenceKpiApi,
    debut_suivi: debut,
    ponderation: champs.ponderation,
    rappels_actifs: champs.rappels_actifs,
  };
  if (champs.description !== null) charge.description = champs.description;
  if (champs.perspective !== null) charge.perspective = champs.perspective;
  if (champs.seuil_vert !== null && champs.seuil_orange !== null) {
    charge.seuil_vert = champs.seuil_vert;
    charge.seuil_orange = champs.seuil_orange;
  }
  if (champs.alerte_haut !== null) charge.alerte_haut = champs.alerte_haut;
  if (champs.alerte_bas !== null) charge.alerte_bas = champs.alerte_bas;
  if (champs.alerte_variation !== null) charge.alerte_variation = champs.alerte_variation;
  if (champs.proprietaire_id !== null) charge.proprietaire_id = champs.proprietaire_id;
  if (champs.fin_suivi !== null) charge.fin_suivi = champs.fin_suivi;
  if (cible.valeur !== null) charge.cible = cible.valeur;
  return { ok: true, charge };
}

/** Champs liés envoyés ensemble (le schéma contrôle leur cohérence sur ce qu'il reçoit). */
const PAIRES: readonly (readonly (keyof ChampsKpi)[])[] = [
  ["seuil_vert", "seuil_orange"],
  ["alerte_haut", "alerte_bas"],
];

/**
 * Modification (sens, nature, fréquence et début de suivi sont figés) : seuls les champs
 * changés partent ; `inchange` quand il n'y a rien à enregistrer.
 */
export function validerModificationKpi(
  s: SaisieKpi,
  initial: DefinitionKpi,
  ctx: Omit<ContexteKpi, "debutFixe">,
): Resultat<ChargeModificationKpi, ChampKpi> & { inchange?: boolean } {
  const erreurs: Record<string, string> = {};
  // Le propriétaire actuel reste admis tel quel, même s'il a quitté l'équipe (non renvoyé).
  const proprietaires = initial.proprietaire_id
    ? [...ctx.proprietaires, initial.proprietaire_id]
    : ctx.proprietaires;
  const champs = lireChamps(s, { ...ctx, proprietaires, debutFixe: initial.debut_suivi }, erreurs);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const avant: ChampsKpi = {
    libelle: initial.libelle,
    description: initial.description,
    unite: initial.unite,
    perspective: initial.perspective,
    ponderation: initial.ponderation,
    seuil_vert: initial.seuil_vert,
    seuil_orange: initial.seuil_orange,
    alerte_haut: initial.alerte_haut,
    alerte_bas: initial.alerte_bas,
    alerte_variation: initial.alerte_variation,
    proprietaire_id: initial.proprietaire_id,
    fin_suivi: initial.fin_suivi,
    rappels_actifs: initial.rappels_actifs,
  };
  const charge: Record<string, unknown> = {};
  for (const cle of Object.keys(champs) as (keyof ChampsKpi)[]) {
    if (champs[cle] !== avant[cle]) charge[cle] = champs[cle];
  }
  for (const paire of PAIRES) {
    if (paire.some((c) => c in charge)) for (const c of paire) charge[c] = champs[c];
  }
  if (Object.keys(charge).length === 0) return { ok: false, erreurs: {}, inchange: true };
  return { ok: true, charge: charge as ChargeModificationKpi };
}
