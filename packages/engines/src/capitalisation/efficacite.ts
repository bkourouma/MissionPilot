/**
 * Efficacité des recommandations (CAP-03) : initiative recommandée -> mise en oeuvre -> effet
 * mesuré sur le KPI -> score d'efficacité par contexte.
 *
 * Moteur PUR, arithmétique ENTIÈRE exacte (valeurs décimales lues en millionièmes, BigInt ;
 * proportions en pour mille ou en points, arrondies à la moitié supérieure) : aucun flottant,
 * aucun chiffre venu du modèle de langage. L'IA n'intervient pas.
 *
 * - Mesures EFFECTIVES d'un KPI : ni annulées, ni remplacées par une correction (même logique
 *   que `apps/api/src/kpi/donnees.ts`, `mesuresActivesDe`).
 * - Valeur de base : dernière mesure effective à la date de mise en oeuvre ou avant.
 * - Valeur d'effet : dernière mesure effective au moins `EFFICACITE_DELAI_EFFET_JOURS` jours après
 *   la mise en oeuvre.
 * - Score 0 à 100 = part de l'écart attendu (cible - base) comblée par l'effet (effet - base),
 *   bornée ; le sens du KPI est respecté. Écart attendu nul ou contraire au sens, mesures
 *   manquantes : NON ÉVALUABLE (score nul, raison explicite).
 * - Scores par contexte : agrégation (effectif, moyenne, médiane) pour chaque combinaison non vide
 *   des dimensions (type d'initiative, secteur, taille) ; sous le seuil d'observations, le score
 *   n'est pas affiché (nul) mais l'effectif reste visible.
 */

export const EFFICACITE_DELAI_EFFET_JOURS = 30;
export const EFFICACITE_SEUIL_OBSERVATIONS_PAR_DEFAUT = 5;

export type CodeErreurEfficacite = "VALEUR_INVALIDE" | "DATE_INVALIDE" | "SEUIL_INVALIDE";

export class ErreurEfficacite extends Error {
  readonly code: CodeErreurEfficacite;
  constructor(code: CodeErreurEfficacite, message: string) {
    super(message);
    this.name = "ErreurEfficacite";
    this.code = code;
  }
}

export type SensEfficacite = "plus_haut_mieux" | "plus_bas_mieux";

export interface MesureBruteEfficacite {
  id: string;
  /** AAAA-MM-JJ. */
  date_mesure: string;
  /** Décimal en texte ; nul pour une annulation. */
  valeur: string | null;
  annulation: boolean;
  remplace_id: string | null;
}

export interface MesureEffectiveEfficacite {
  id: string;
  date_mesure: string;
  valeur: string;
}

const ECHELLE = 1_000_000n;

function micro(valeur: string): bigint {
  if (!/^-?\d{1,15}(\.\d{1,6})?$/.test(valeur)) {
    throw new ErreurEfficacite(
      "VALEUR_INVALIDE",
      "Valeur décimale invalide (6 décimales au plus).",
    );
  }
  const neg = valeur.startsWith("-");
  const [entier, dec = ""] = valeur.replace("-", "").split(".");
  const v = BigInt(entier as string) * ECHELLE + BigInt(dec.padEnd(6, "0"));
  return neg ? -v : v;
}

function texte(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const entier = (a / ECHELLE).toString();
  const dec = (a % ECHELLE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${entier}${dec ? `.${dec}` : ""}`;
}

/** Quotient arrondi à la moitié supérieure (vers +infini) ; diviseur strictement positif. */
function diviser(num: bigint, den: bigint): bigint {
  const n2 = 2n * num + den;
  const d2 = 2n * den;
  const q = n2 / d2;
  return n2 % d2 !== 0n && n2 < 0n ? q - 1n : q;
}

function jourDepuisEpoque(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ErreurEfficacite("DATE_INVALIDE", "Date invalide (AAAA-MM-JJ attendu).");
  }
  const t = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  if (new Date(t).toISOString().slice(0, 10) !== date) {
    throw new ErreurEfficacite("DATE_INVALIDE", "Date invalide (AAAA-MM-JJ attendu).");
  }
  return Math.round(t / 86_400_000);
}

/** Mesures effectives, par date croissante (puis identifiant) : ni annulées ni remplacées. */
export function mesuresEffectivesEfficacite(
  mesures: readonly MesureBruteEfficacite[],
): MesureEffectiveEfficacite[] {
  const remplacees = new Set<string>();
  for (const m of mesures) if (m.remplace_id) remplacees.add(m.remplace_id);
  return mesures
    .filter((m) => !m.annulation && m.valeur !== null && !remplacees.has(m.id))
    .map((m) => ({ id: m.id, date_mesure: m.date_mesure, valeur: m.valeur as string }))
    .sort((a, b) =>
      a.date_mesure === b.date_mesure
        ? a.id.localeCompare(b.id)
        : a.date_mesure.localeCompare(b.date_mesure),
    );
}

export type RaisonNonEvaluable =
  | "AUCUNE_MESURE_DE_BASE"
  | "AUCUNE_MESURE_D_EFFET"
  | "ECART_ATTENDU_NUL"
  | "CIBLE_CONTRAIRE_AU_SENS";

export const RAISONS_EFFICACITE: Record<RaisonNonEvaluable, string> = {
  AUCUNE_MESURE_DE_BASE:
    "Aucune mesure effective à la date de mise en oeuvre ou avant : valeur de base inconnue.",
  AUCUNE_MESURE_D_EFFET: `Aucune mesure effective ${EFFICACITE_DELAI_EFFET_JOURS} jours ou plus après la mise en oeuvre.`,
  ECART_ATTENDU_NUL: "L'écart attendu est nul : la cible égale la valeur de base.",
  CIBLE_CONTRAIRE_AU_SENS: "La cible attendue va à l'encontre du sens de lecture du KPI.",
};

export interface EntreeEfficaciteInitiative {
  sens: SensEfficacite;
  /** AAAA-MM-JJ. */
  mise_en_oeuvre_le: string;
  /** Effet attendu : valeur visée du KPI (décimal en texte). */
  valeur_cible: string;
  mesures: readonly MesureBruteEfficacite[];
  delai_effet_jours?: number;
}

export interface ResultatEfficaciteInitiative {
  evaluable: boolean;
  raison_code: RaisonNonEvaluable | null;
  raison: string | null;
  delai_effet_jours: number;
  base: { mesure_id: string; date_mesure: string; valeur: string } | null;
  effet: { mesure_id: string; date_mesure: string; valeur: string } | null;
  cible: string;
  /** Cible - base (signé, dans l'unité du KPI). */
  ecart_attendu: string | null;
  /** Effet - base (signé). */
  ecart_realise: string | null;
  /** Part de l'écart attendu comblée, en pour mille (négative si le KPI recule ; bornée à +-100 000). */
  part_comblee_pour_mille: number | null;
  /** 0 à 100, nul si non évaluable. */
  score: number | null;
}

function refMesure(m: MesureEffectiveEfficacite | null) {
  return m && { mesure_id: m.id, date_mesure: m.date_mesure, valeur: m.valeur };
}

export function calculerEfficaciteInitiative(
  e: EntreeEfficaciteInitiative,
): ResultatEfficaciteInitiative {
  const delai = e.delai_effet_jours ?? EFFICACITE_DELAI_EFFET_JOURS;
  if (!Number.isInteger(delai) || delai < 0 || delai > 3650) {
    throw new ErreurEfficacite("SEUIL_INVALIDE", "Délai d'effet invalide.");
  }
  const cible = micro(e.valeur_cible);
  const jourOeuvre = jourDepuisEpoque(e.mise_en_oeuvre_le);
  let base: MesureEffectiveEfficacite | null = null;
  let effet: MesureEffectiveEfficacite | null = null;
  for (const m of mesuresEffectivesEfficacite(e.mesures)) {
    const j = jourDepuisEpoque(m.date_mesure);
    if (j <= jourOeuvre) base = m;
    if (j >= jourOeuvre + delai) effet = m;
  }
  const vide = (code: RaisonNonEvaluable): ResultatEfficaciteInitiative => ({
    evaluable: false,
    raison_code: code,
    raison: RAISONS_EFFICACITE[code],
    delai_effet_jours: delai,
    base: refMesure(base),
    effet: refMesure(effet),
    cible: texte(cible),
    ecart_attendu: null,
    ecart_realise: null,
    part_comblee_pour_mille: null,
    score: null,
  });
  if (!base) return vide("AUCUNE_MESURE_DE_BASE");
  if (!effet) return vide("AUCUNE_MESURE_D_EFFET");
  const signe = e.sens === "plus_haut_mieux" ? 1n : -1n;
  const vBase = micro(base.valeur);
  const vEffet = micro(effet.valeur);
  const attendu = signe * (cible - vBase);
  const realise = signe * (vEffet - vBase);
  if (attendu === 0n) return vide("ECART_ATTENDU_NUL");
  if (attendu < 0n) return vide("CIBLE_CONTRAIRE_AU_SENS");
  const part = diviser(realise * 1000n, attendu);
  let score = diviser(realise * 100n, attendu);
  if (score < 0n) score = 0n;
  if (score > 100n) score = 100n;
  const partBornee = part > 100_000n ? 100_000n : part < -100_000n ? -100_000n : part;
  return {
    evaluable: true,
    raison_code: null,
    raison: null,
    delai_effet_jours: delai,
    base: refMesure(base),
    effet: refMesure(effet),
    cible: texte(cible),
    ecart_attendu: texte(cible - vBase),
    ecart_realise: texte(vEffet - vBase),
    part_comblee_pour_mille: Number(partBornee),
    score: Number(score),
  };
}

export interface ObservationEfficaciteRecommandation {
  /** Score d'une recommandation évaluée ; nul si non évaluable (non comptée). */
  score: number | null;
  type_initiative: string | null;
  secteur: string | null;
  taille: string | null;
}

export type DimensionEfficacite = "type_initiative" | "secteur" | "taille";
const DIMENSIONS: readonly DimensionEfficacite[] = ["type_initiative", "secteur", "taille"];

export interface ScoreContexteEfficacite {
  cle: string;
  dimensions: DimensionEfficacite[];
  valeurs: Partial<Record<DimensionEfficacite, string>>;
  /** Nul sous le seuil : l'effectif d'un petit contexte pourrait identifier une recommandation. */
  effectif: number | null;
  /** Nul sous le seuil. */
  score_moyen: number | null;
  mediane: number | null;
  au_dessus_du_seuil: boolean;
  raison: string | null;
}

export function medianeEntiere(valeurs: readonly number[]): number {
  const t = [...valeurs].sort((a, b) => a - b);
  const n = t.length;
  if (n === 0) throw new ErreurEfficacite("VALEUR_INVALIDE", "Série vide.");
  if (n % 2 === 1) return t[(n - 1) / 2] as number;
  return Math.floor(((t[n / 2 - 1] as number) + (t[n / 2] as number) + 1) / 2);
}

export function scoresParContexte(
  observations: readonly ObservationEfficaciteRecommandation[],
  options: { seuilMin?: number } = {},
): ScoreContexteEfficacite[] {
  const seuil = options.seuilMin ?? EFFICACITE_SEUIL_OBSERVATIONS_PAR_DEFAUT;
  // Le seuil ne peut que RELEVER le masquage, jamais l'abaisser sous le défaut.
  if (
    !Number.isInteger(seuil) ||
    seuil < EFFICACITE_SEUIL_OBSERVATIONS_PAR_DEFAUT ||
    seuil > 1000
  ) {
    throw new ErreurEfficacite(
      "SEUIL_INVALIDE",
      `Le seuil d'observations doit être un entier de ${EFFICACITE_SEUIL_OBSERVATIONS_PAR_DEFAUT} à 1000.`,
    );
  }
  const groupes = new Map<
    string,
    { dimensions: DimensionEfficacite[]; valeurs: Record<string, string>; scores: number[] }
  >();
  for (const o of observations) {
    if (o.score === null) continue;
    if (!Number.isInteger(o.score) || o.score < 0 || o.score > 100) {
      throw new ErreurEfficacite(
        "VALEUR_INVALIDE",
        "Un score d'efficacité est un entier de 0 à 100.",
      );
    }
    for (let masque = 1; masque < 8; masque++) {
      const dimensions = DIMENSIONS.filter((_, i) => (masque & (1 << i)) !== 0);
      const valeurs: Record<string, string> = {};
      let complet = true;
      for (const d of dimensions) {
        const v = o[d];
        if (v === null || v === "") complet = false;
        else valeurs[d] = v;
      }
      if (!complet) continue;
      const cle = dimensions.map((d) => `${d}=${valeurs[d]}`).join("|");
      const g = groupes.get(cle) ?? { dimensions, valeurs, scores: [] };
      g.scores.push(o.score);
      groupes.set(cle, g);
    }
  }
  return [...groupes.entries()]
    .sort(([ca, a], [cb, b]) => b.scores.length - a.scores.length || ca.localeCompare(cb))
    .map(([cle, g]): ScoreContexteEfficacite => {
      const n = g.scores.length;
      const ok = n >= seuil;
      const somme = g.scores.reduce((s, x) => s + x, 0);
      return {
        cle,
        dimensions: g.dimensions,
        valeurs: g.valeurs,
        effectif: ok ? n : null,
        score_moyen: ok ? Math.floor((2 * somme + n) / (2 * n)) : null,
        mediane: ok ? medianeEntiere(g.scores) : null,
        au_dessus_du_seuil: ok,
        raison: ok ? null : "effectif insuffisant",
      };
    });
}
