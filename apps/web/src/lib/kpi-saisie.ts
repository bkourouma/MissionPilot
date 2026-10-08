/**
 * Saisies des écrans KPI (définition, cible, mesure, correction, annulation, contributeurs,
 * réglages du cabinet) : lecture des textes saisis et contrôles AVANT l'appel, avec des
 * messages français. Logique pure, testée dans `kpi-saisie.test.ts`.
 *
 * Les règles reprennent le schéma partagé (`packages/shared/src/schemas/kpi.ts`) et les
 * contraintes de la base (migration 0160) pour éviter un aller-retour refusé ; l'API reste
 * seule juge. Aucune valeur n'est arrondie : une saisie qui ne tiendrait pas exactement
 * (plus de 15 chiffres significatifs ou de 6 décimales) est refusée.
 */
import {
  CHIFFRES_SIGNIFICATIFS_KPI,
  DATE_SUIVI_KPI_MIN,
  FREQUENCES_KPI,
  NATURES_KPI,
  PERSPECTIVES_KPI,
  SENS_LECTURE_KPI,
  valeurKpiSchema,
  type FrequenceKpiApi,
  type NatureKpiApi,
  type PerspectiveKpi,
  type SensLectureKpiApi,
} from "@missionpilot/shared";
import { formaterDate } from "./format";
import type { DefinitionKpi, ParametresKpi } from "./kpi";
import { MAX_CONTRIBUTEURS_KPI } from "./kpi";
import { dateValide } from "./periode";
import type { Resultat } from "./saisie";

// --- Lecture des nombres --------------------------------------------------------------------

export interface Lecture<T> {
  valeur: T | null;
  erreur: string | null;
}

/** Nombre saisi à la française, sans espaces : « -1 250,50 » → « -1250.50 ». */
function normaliser(v: string): string {
  return v.replace(/\s/g, "").replace(",", ".");
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Parties d'un décimal normalisé, sans zéros de tête ni zéros décimaux de queue. */
function parties(brut: string) {
  const negatif = brut.startsWith("-");
  const [ent = "0", dec = ""] = brut.replace(/^-/, "").split(".");
  return { negatif, entier: ent.replace(/^0+(?=\d)/, ""), decimales: dec.replace(/0+$/, "") };
}

/**
 * Valeur d'un KPI (mesure, cible, seuil d'alerte) : au plus 15 chiffres entiers, 6 décimales
 * et 15 chiffres significatifs (exactitude d'un nombre JSON). Vide : `valeur` null.
 */
export function lireValeurKpi(v: string): Lecture<number> {
  const brut = normaliser(v);
  if (brut === "") return { valeur: null, erreur: null };
  if (!DECIMAL.test(brut)) return { valeur: null, erreur: "Nombre attendu (ex. 1 250,5)." };
  const { negatif, entier, decimales } = parties(brut);
  if (entier.length > 15) return { valeur: null, erreur: "15 chiffres avant la virgule au plus." };
  if (decimales.length > 6) return { valeur: null, erreur: "6 décimales au plus." };
  if ((entier + decimales).replace(/^0+/, "").length > CHIFFRES_SIGNIFICATIFS_KPI) {
    return {
      valeur: null,
      erreur: `${CHIFFRES_SIGNIFICATIFS_KPI} chiffres significatifs au plus : au-delà, la valeur ne serait pas enregistrée exactement.`,
    };
  }
  const n = Number(`${negatif ? "-" : ""}${entier}${decimales ? `.${decimales}` : ""}`);
  const valeur = n === 0 ? 0 : n;
  if (!valeurKpiSchema.safeParse(valeur).success) {
    return { valeur: null, erreur: "Valeur refusée : trop de chiffres pour être exacte." };
  }
  return { valeur, erreur: null };
}

/**
 * Pourcentage saisi (« 95 », « 87,5 ») → fraction exacte (0,95 ; 0,875) par décalage de la
 * virgule dans l'écriture décimale (aucune division flottante). Deux décimales au plus.
 */
export function lirePourcentage(v: string, max: number): Lecture<number> {
  const brut = normaliser(v).replace(/%$/, "");
  if (brut === "") return { valeur: null, erreur: null };
  if (!/^\d+(\.\d+)?$/.test(brut)) {
    return { valeur: null, erreur: "Pourcentage positif attendu (ex. 95 ou 87,5)." };
  }
  const { entier, decimales } = parties(brut);
  if (decimales.length > 2) return { valeur: null, erreur: "2 décimales au plus." };
  if (Number(brut) > max) {
    return { valeur: null, erreur: `${max.toLocaleString("fr-FR")} % au plus.` };
  }
  const chiffres = `${entier}${decimales}`;
  const position = entier.length - 2;
  const texte =
    position > 0
      ? `${chiffres.slice(0, position)}.${chiffres.slice(position)}`
      : `0.${"0".repeat(-position)}${chiffres}`;
  return { valeur: Number(texte), erreur: null };
}

/** Fraction de l'API (0,955) → pourcentage modifiable (« 95,5 »), par décalage de la virgule. */
export function fractionVersPourcentage(f: number | null | undefined): string {
  if (f === null || f === undefined || !Number.isFinite(f) || f < 0) return "";
  const s = String(f);
  if (!/^\d+(\.\d+)?$/.test(s)) return "";
  const [ent = "0", dec = ""] = s.split(".");
  const entier = `${ent}${dec.slice(0, 2).padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
  const reste = dec.slice(2);
  return reste ? `${entier},${reste}` : entier;
}

/** Valeur de l'API → texte modifiable (« 1250,5 »). */
export function valeurVersSaisie(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return String(v).replace(".", ",");
}

/** Entier borné (délais, nombres de périodes). */
export function lireEntier(v: string, min: number, max: number): Lecture<number> {
  const brut = v.trim();
  if (brut === "") return { valeur: null, erreur: null };
  if (!/^\d{1,4}$/.test(brut) || Number(brut) < min || Number(brut) > max) {
    return { valeur: null, erreur: `Nombre entier de ${min} à ${max} attendu.` };
  }
  return { valeur: Number(brut), erreur: null };
}

/** Pondération d'un KPI dans le score composite : 0 à 1000, quatre décimales au plus. */
export function lirePonderation(v: string): Lecture<number> {
  const brut = normaliser(v);
  if (brut === "")
    return { valeur: null, erreur: "La pondération est obligatoire (1 par défaut)." };
  if (!/^\d+(\.\d+)?$/.test(brut)) {
    return { valeur: null, erreur: "Nombre positif attendu (ex. 1 ou 2,5)." };
  }
  const { entier, decimales } = parties(brut);
  if (decimales.length > 4) return { valeur: null, erreur: "4 décimales au plus." };
  const n = Number(`${entier}${decimales ? `.${decimales}` : ""}`);
  if (n > 1000) return { valeur: null, erreur: "1 000 au plus." };
  return { valeur: n, erreur: null };
}

// --- Textes ---------------------------------------------------------------------------------

export const LIBELLE_MAX = 200;
export const DESCRIPTION_MAX = 2000;
export const UNITE_MAX = 40;
export const MOTIF_MAX = 500;
export const COMMENTAIRE_MAX = 1000;
export const JUSTIFICATIF_MAX = 500;

function texteFacultatif(
  v: string,
  max: number,
  erreurs: Record<string, string>,
  champ: string,
): string | null {
  const t = v.trim();
  if (t.length > max) erreurs[champ] = `${max.toLocaleString("fr-FR")} caractères au plus.`;
  return t === "" ? null : t;
}

function texteObligatoire(
  v: string,
  max: number,
  erreurs: Record<string, string>,
  champ: string,
  messageVide: string,
): string {
  const t = v.trim();
  if (t === "") erreurs[champ] = messageVide;
  else if (t.length > max) erreurs[champ] = `${max.toLocaleString("fr-FR")} caractères au plus.`;
  return t;
}

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

// --- Cible versionnée -----------------------------------------------------------------------

export interface SaisieCible {
  valeur: string;
  sans_cible: boolean;
  a_partir_de: string;
  motif: string;
}

export type ChampCible = keyof SaisieCible;

export interface ChargeCible {
  valeur: number | null;
  a_partir_de: string;
  motif?: string;
}

/** Nouvelle version de cible (ajout seul), ramenée par l'API au début de sa période. */
export function validerCible(
  s: SaisieCible,
  def: Pick<DefinitionKpi, "debut_suivi">,
): Resultat<ChargeCible, ChampCible> {
  const erreurs: Partial<Record<ChampCible, string>> = {};
  let valeur: number | null = null;
  if (!s.sans_cible) {
    const l = lireValeurKpi(s.valeur);
    if (l.erreur) erreurs.valeur = l.erreur;
    else if (l.valeur === null) erreurs.valeur = "Saisissez la cible, ou cochez « Sans cible ».";
    valeur = l.valeur;
  }
  if (s.a_partir_de === "") erreurs.a_partir_de = "La date d'application est obligatoire.";
  else if (!dateValide(s.a_partir_de)) erreurs.a_partir_de = "Date invalide.";
  else if (s.a_partir_de < def.debut_suivi) {
    erreurs.a_partir_de = `Une cible ne peut pas précéder le début du suivi (${formaterDate(def.debut_suivi)}).`;
  }
  const motif = s.motif.trim();
  if (motif.length > MOTIF_MAX) erreurs.motif = `${MOTIF_MAX} caractères au plus.`;
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: { valeur, a_partir_de: s.a_partir_de, ...(motif ? { motif } : {}) },
  };
}

// --- Mesures --------------------------------------------------------------------------------

export interface SaisieMesure {
  date_mesure: string;
  valeur: string;
  commentaire: string;
  justificatif: string;
  /** Correction et annulation seulement. */
  motif: string;
}

export type ChampMesure = keyof SaisieMesure;

export interface ChargeMesure {
  date_mesure: string;
  valeur: number;
  commentaire?: string;
  justificatif?: string;
}

export interface ChargeCorrection extends ChargeMesure {
  motif: string;
}

/** Dernier jour où une mesure peut être datée : aujourd'hui, ou la fin du suivi si passée. */
export function dateMesureMax(def: Pick<DefinitionKpi, "fin_suivi">, aujourdhui: string): string {
  return def.fin_suivi !== null && def.fin_suivi < aujourdhui ? def.fin_suivi : aujourdhui;
}

function lireMesure(
  s: SaisieMesure,
  def: Pick<DefinitionKpi, "debut_suivi" | "fin_suivi">,
  aujourdhui: string,
  erreurs: Partial<Record<ChampMesure, string>>,
): ChargeMesure {
  const max = dateMesureMax(def, aujourdhui);
  if (s.date_mesure === "") erreurs.date_mesure = "La date de la mesure est obligatoire.";
  else if (!dateValide(s.date_mesure)) erreurs.date_mesure = "Date invalide.";
  else if (s.date_mesure < def.debut_suivi || s.date_mesure > max) {
    erreurs.date_mesure = `Date comprise entre le ${formaterDate(def.debut_suivi)} et le ${formaterDate(max)} attendue.`;
  }
  const l = lireValeurKpi(s.valeur);
  if (l.erreur) erreurs.valeur = l.erreur;
  else if (l.valeur === null) erreurs.valeur = "La valeur est obligatoire.";
  const libres = erreurs as Record<string, string>;
  const commentaire = texteFacultatif(s.commentaire, COMMENTAIRE_MAX, libres, "commentaire");
  const justificatif = texteFacultatif(s.justificatif, JUSTIFICATIF_MAX, libres, "justificatif");
  return {
    date_mesure: s.date_mesure,
    valeur: l.valeur ?? 0,
    ...(commentaire ? { commentaire } : {}),
    ...(justificatif ? { justificatif } : {}),
  };
}

/** Saisie d'une mesure datée (KPI-02) côté cabinet. */
export function validerMesure(
  s: SaisieMesure,
  def: Pick<DefinitionKpi, "debut_suivi" | "fin_suivi">,
  aujourdhui: string,
): Resultat<ChargeMesure, ChampMesure> {
  const erreurs: Partial<Record<ChampMesure, string>> = {};
  const charge = lireMesure(s, def, aujourdhui, erreurs);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge };
}

function lireMotif(v: string, erreurs: Partial<Record<ChampMesure, string>>): string {
  const motif = v.trim();
  if (motif === "") erreurs.motif = "Le motif est obligatoire : il reste dans l'historique.";
  else if (motif.length > MOTIF_MAX) erreurs.motif = `${MOTIF_MAX} caractères au plus.`;
  return motif;
}

/** Correction : nouvelle ligne qui remplace la mesure, motif obligatoire. */
export function validerCorrection(
  s: SaisieMesure,
  def: Pick<DefinitionKpi, "debut_suivi" | "fin_suivi">,
  aujourdhui: string,
): Resultat<ChargeCorrection, ChampMesure> {
  const erreurs: Partial<Record<ChampMesure, string>> = {};
  const charge = lireMesure(s, def, aujourdhui, erreurs);
  const motif = lireMotif(s.motif, erreurs);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { ...charge, motif } };
}

/** Annulation d'une mesure saisie par erreur : motif obligatoire. */
export function validerAnnulation(motif: string): Resultat<{ motif: string }, "motif"> {
  const erreurs: Partial<Record<ChampMesure, string>> = {};
  const m = lireMotif(motif, erreurs);
  if (erreurs.motif) return { ok: false, erreurs: { motif: erreurs.motif } };
  return { ok: true, charge: { motif: m } };
}

// --- Contributeurs et réglages du cabinet --------------------------------------------------

/** Remplacement complet des contributeurs du portail (50 au plus, sans doublon). */
export function validerContributeurs(
  ids: readonly string[],
  eligibles: readonly string[],
): Resultat<{ utilisateurs: string[] }, "utilisateurs"> {
  const uniques = [...new Set(ids)];
  if (uniques.some((id) => !eligibles.includes(id))) {
    return {
      ok: false,
      erreurs: {
        utilisateurs: "Choisissez les contributeurs parmi les comptes du portail du client.",
      },
    };
  }
  if (uniques.length > MAX_CONTRIBUTEURS_KPI) {
    return {
      ok: false,
      erreurs: { utilisateurs: `${MAX_CONTRIBUTEURS_KPI} contributeurs au plus par KPI.` },
    };
  }
  return { ok: true, charge: { utilisateurs: uniques } };
}

export interface SaisieParametres {
  rappels_actifs: boolean;
  delai_grace_jours: string;
  periodes_degradation: string;
  valeurs_validees: boolean;
}

export type ChampParametres = keyof SaisieParametres;

export const saisieDepuisParametres = (p: ParametresKpi): SaisieParametres => ({
  rappels_actifs: p.rappels_actifs,
  delai_grace_jours: String(p.delai_grace_jours),
  periodes_degradation: String(p.periodes_degradation),
  valeurs_validees: p.valeurs_validees,
});

/** Réglages du cabinet : délai de grâce 0–60 jours, dégradation après 1 à 24 périodes. */
export function validerParametres(
  s: SaisieParametres,
  actuel: ParametresKpi,
): Resultat<Partial<ParametresKpi>, ChampParametres> & { inchange?: boolean } {
  const erreurs: Partial<Record<ChampParametres, string>> = {};
  const delai = lireEntier(s.delai_grace_jours, 0, 60);
  const periodes = lireEntier(s.periodes_degradation, 1, 24);
  if (delai.erreur || delai.valeur === null) {
    erreurs.delai_grace_jours = delai.erreur ?? "Nombre de jours obligatoire (0 à 60).";
  }
  if (periodes.erreur || periodes.valeur === null) {
    erreurs.periodes_degradation = periodes.erreur ?? "Nombre de périodes obligatoire (1 à 24).";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const apres: ParametresKpi = {
    rappels_actifs: s.rappels_actifs,
    delai_grace_jours: delai.valeur as number,
    periodes_degradation: periodes.valeur as number,
    valeurs_validees: s.valeurs_validees,
  };
  const charge: Partial<ParametresKpi> = {};
  for (const cle of Object.keys(apres) as (keyof ParametresKpi)[]) {
    if (apres[cle] !== actuel[cle]) (charge as Record<string, unknown>)[cle] = apres[cle];
  }
  if (Object.keys(charge).length === 0) return { ok: false, erreurs: {}, inchange: true };
  return { ok: true, charge };
}
