/**
 * Saisies des écrans KPI (définition, cible, mesure, correction, annulation, contributeurs,
 * réglages du cabinet) : lecture des textes saisis et contrôles AVANT l'appel, avec des
 * messages français. Logique pure, testée dans `kpi-saisie.test.ts`.
 *
 * Les règles reprennent le schéma partagé (`packages/shared/src/schemas/kpi.ts`) et les
 * contraintes de la base (migration 0160) pour éviter un aller-retour refusé ; l'API reste
 * seule juge. Aucune valeur n'est arrondie : une saisie qui ne tiendrait pas exactement
 * (plus de 15 chiffres significatifs ou de 6 décimales) est refusée.
 *
 * Sous-modules : `kpi-saisie-nombres` (nombres et textes), `kpi-saisie-definition` (définition
 * d'un KPI).
 */
import { formaterDate } from "./format";
import type { DefinitionKpi, ParametresKpi } from "./kpi";
import { MAX_CONTRIBUTEURS_KPI } from "./kpi";
import {
  COMMENTAIRE_MAX,
  JUSTIFICATIF_MAX,
  lireEntier,
  lireValeurKpi,
  MOTIF_MAX,
  texteFacultatif,
} from "./kpi-saisie-nombres";
import { dateValide } from "./periode";
import type { Resultat } from "./saisie";

export * from "./kpi-saisie-definition";
export type { Lecture } from "./kpi-saisie-nombres";
export {
  COMMENTAIRE_MAX,
  DESCRIPTION_MAX,
  fractionVersPourcentage,
  JUSTIFICATIF_MAX,
  LIBELLE_MAX,
  lireEntier,
  lirePonderation,
  lirePourcentage,
  lireValeurKpi,
  MOTIF_MAX,
  UNITE_MAX,
  valeurVersSaisie,
} from "./kpi-saisie-nombres";

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
