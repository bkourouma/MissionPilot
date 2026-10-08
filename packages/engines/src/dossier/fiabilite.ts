/**
 * Indice de fiabilité des données d'un client (DOS-04, PRD complémentaire §4.3 et §5).
 *
 * Cinq composantes, en points ENTIERS (barème par défaut, à calibrer au pilote) :
 * - certification des comptes (35) : certifiés 35, non certifiés 15,
 *   reconstitués 5, non renseignée 0 ;
 * - part de l'informel et des espèces (25) : faible 25, moyenne 12, forte 0,
 *   non renseignée 0 ;
 * - cohérence des états financiers courants (20) : part des états dont tous
 *   les contrôles du moteur passent, × 20, tronqué ; aucun état : 0 ;
 * - ancienneté du dernier exercice clos (10) : ≤ 18 mois 10, ≤ 30 mois 5,
 *   au-delà ou aucun 0 ;
 * - qualité des sources des faits confirmés (10) : part des faits de
 *   fiabilité A ou B, × 10, tronqué ; aucun fait : 0.
 *
 * Classe : A ≥ 80, B ≥ 60, C ≥ 40, D sinon. Les analyses sont « indicatives »
 * (prudence affichée sur toute analyse financière) si la classe est C ou D,
 * si les comptes ne sont pas certifiés (ou inconnus) ou si l'informel est
 * fort : règle du PRD (§4.4, « analyses marquées indicatives »). Les
 * recommandations sont des codes stables, dans un ordre fixe.
 */
import { analyserDateISO, type DateISO } from "../commun/dates";
import { ErreurDossier } from "./erreurs";

export const CERTIFICATIONS_COMPTES = ["certifies", "non_certifies", "reconstitues"] as const;
export type CertificationComptes = (typeof CERTIFICATIONS_COMPTES)[number];

export const NIVEAUX_INFORMEL = ["faible", "moyenne", "forte"] as const;
export type NiveauInformel = (typeof NIVEAUX_INFORMEL)[number];

export const CLASSES_FIABILITE_DOSSIER = ["A", "B", "C", "D"] as const;
export type ClasseFiabiliteDossier = (typeof CLASSES_FIABILITE_DOSSIER)[number];

export interface BaremeFiabiliteDossier {
  readonly certification: Readonly<Record<CertificationComptes, number>>;
  readonly informel: Readonly<Record<NiveauInformel, number>>;
  readonly coherenceMax: number;
  readonly ancienneteRecente: number;
  readonly ancienneteMoyenne: number;
  readonly sourcesMax: number;
  readonly moisRecents: number;
  readonly moisMoyens: number;
  /** Seuils de classe A, B, C (points minimaux, décroissants). */
  readonly seuils: readonly [number, number, number];
}

/** Barème par défaut (total 100), à calibrer au pilote. */
export const BAREME_FIABILITE_DOSSIER_DEFAUT: BaremeFiabiliteDossier = {
  certification: { certifies: 35, non_certifies: 15, reconstitues: 5 },
  informel: { faible: 25, moyenne: 12, forte: 0 },
  coherenceMax: 20,
  ancienneteRecente: 10,
  ancienneteMoyenne: 5,
  sourcesMax: 10,
  moisRecents: 18,
  moisMoyens: 30,
  seuils: [80, 60, 40],
};

export interface EtatPourFiabilite {
  readonly dateCloture: DateISO;
  /** Tous les contrôles du moteur ont passé (conforme et complet). */
  readonly controlesOk: boolean;
}

export interface EntreeFiabiliteDossier {
  readonly certification: CertificationComptes | null;
  readonly partInformel: NiveauInformel | null;
  /** États financiers COURANTS (ni remplacés ni rejetés). */
  readonly etats: readonly EtatPourFiabilite[];
  /** Fiabilité des faits confirmés courants. */
  readonly fiabilitesFaits: readonly ("A" | "B" | "C" | "D")[];
  /** Date de référence (aujourd'hui, toujours fournie par l'appelant). */
  readonly dateReference: DateISO;
}

export const CODES_RECOMMANDATION_FIABILITE = [
  "CERTIFICATION_INCONNUE",
  "COMPTES_NON_CERTIFIES",
  "COMPTES_RECONSTITUES",
  "INFORMEL_INCONNU",
  "INFORMEL_FORT",
  "AUCUN_ETAT_FINANCIER",
  "ETATS_INCOHERENTS",
  "DONNEES_ANCIENNES",
  "SOURCES_FAIBLES",
] as const;
export type CodeRecommandationFiabilite = (typeof CODES_RECOMMANDATION_FIABILITE)[number];

export interface RecommandationFiabilite {
  readonly code: CodeRecommandationFiabilite;
  readonly message: string;
}

export interface DetailFiabiliteDossier {
  readonly certification: number;
  readonly informel: number;
  readonly coherence: number;
  readonly anciennete: number;
  readonly sources: number;
}

export interface IndiceFiabiliteDossier {
  readonly points: number;
  readonly classe: ClasseFiabiliteDossier;
  readonly detail: DetailFiabiliteDossier;
  readonly analysesIndicatives: boolean;
  /** Mois écoulés depuis la clôture du dernier exercice, `null` sans état. */
  readonly moisDepuisDerniereCloture: number | null;
  readonly recommandations: readonly RecommandationFiabilite[];
}

const MESSAGES: Record<CodeRecommandationFiabilite, string> = {
  CERTIFICATION_INCONNUE:
    "Renseigner la fiabilité des comptes (certifiés, non certifiés, reconstitués) dans les facteurs de contexte.",
  COMPTES_NON_CERTIFIES:
    "Comptes non certifiés : marquer toute analyse financière comme indicative.",
  COMPTES_RECONSTITUES:
    "Comptes reconstitués : recouper le chiffre d'affaires par les flux bancaires et Mobile Money.",
  INFORMEL_INCONNU:
    "Renseigner la part de l'informel et des espèces dans les facteurs de contexte.",
  INFORMEL_FORT:
    "Informel fort : reconstituer le chiffre d'affaires par les encaissements et prudence des conclusions.",
  AUCUN_ETAT_FINANCIER: "Ingérer au moins un état financier récent.",
  ETATS_INCOHERENTS:
    "Des états financiers présentent des écarts : obtenir des états corrigés avant toute analyse.",
  DONNEES_ANCIENNES: "Dernier exercice clos ancien : demander des états plus récents.",
  SOURCES_FAIBLES: "Faits peu fiables : les étayer par des sources de fiabilité A ou B.",
};

/** Mois révolus entre deux dates civiles (négatif si `fin` précède `debut`). */
export function moisRevolus(debut: DateISO, fin: DateISO): number {
  const [a1, m1, j1] = debut.split("-").map(Number) as [number, number, number];
  const [a2, m2, j2] = fin.split("-").map(Number) as [number, number, number];
  return (a2 - a1) * 12 + (m2 - m1) - (j2 < j1 ? 1 : 0);
}

function exigerDate(date: DateISO): void {
  if (!analyserDateISO(date).valide) {
    throw new ErreurDossier("DATE_INVALIDE", `Date invalide : « ${String(date).slice(0, 20)} ».`);
  }
}

/** Part entière tronquée : `max × num / den`, 0 si `den` est nul. */
const part = (max: number, num: number, den: number) =>
  den === 0 ? 0 : Math.floor((max * num) / den);

function pointsAnciennete(mois: number | null, b: BaremeFiabiliteDossier): number {
  if (mois === null) return 0;
  if (mois <= b.moisRecents) return b.ancienneteRecente;
  return mois <= b.moisMoyens ? b.ancienneteMoyenne : 0;
}

function recommandations(
  e: EntreeFiabiliteDossier,
  detail: DetailFiabiliteDossier,
  mois: number | null,
  b: BaremeFiabiliteDossier,
) {
  const codes: CodeRecommandationFiabilite[] = [];
  if (e.certification === null) codes.push("CERTIFICATION_INCONNUE");
  if (e.certification === "non_certifies") codes.push("COMPTES_NON_CERTIFIES");
  if (e.certification === "reconstitues") codes.push("COMPTES_RECONSTITUES");
  if (e.partInformel === null) codes.push("INFORMEL_INCONNU");
  if (e.partInformel === "forte") codes.push("INFORMEL_FORT");
  if (e.etats.length === 0) codes.push("AUCUN_ETAT_FINANCIER");
  if (e.etats.some((x) => !x.controlesOk)) codes.push("ETATS_INCOHERENTS");
  if (mois !== null && mois > b.moisRecents) codes.push("DONNEES_ANCIENNES");
  if (e.fiabilitesFaits.length > 0 && detail.sources * 2 < b.sourcesMax)
    codes.push("SOURCES_FAIBLES");
  return codes.map((code) => ({ code, message: MESSAGES[code] }));
}

function classeDe(points: number, b: BaremeFiabiliteDossier): ClasseFiabiliteDossier {
  if (points >= b.seuils[0]) return "A";
  if (points >= b.seuils[1]) return "B";
  return points >= b.seuils[2] ? "C" : "D";
}

/** Calcule l'indice de fiabilité d'un dossier. Lève `ErreurDossier` sur une date invalide. */
export function indiceFiabiliteDossier(
  entree: EntreeFiabiliteDossier,
  bareme: BaremeFiabiliteDossier = BAREME_FIABILITE_DOSSIER_DEFAUT,
): IndiceFiabiliteDossier {
  exigerDate(entree.dateReference);
  let derniere: DateISO | null = null;
  for (const e of entree.etats) {
    exigerDate(e.dateCloture);
    if (derniere === null || e.dateCloture > derniere) derniere = e.dateCloture;
  }
  const mois = derniere === null ? null : Math.max(0, moisRevolus(derniere, entree.dateReference));
  const fiables = entree.fiabilitesFaits.filter((f) => f === "A" || f === "B").length;
  const detail: DetailFiabiliteDossier = {
    certification: entree.certification === null ? 0 : bareme.certification[entree.certification],
    informel: entree.partInformel === null ? 0 : bareme.informel[entree.partInformel],
    coherence: part(
      bareme.coherenceMax,
      entree.etats.filter((e) => e.controlesOk).length,
      entree.etats.length,
    ),
    anciennete: pointsAnciennete(mois, bareme),
    sources: part(bareme.sourcesMax, fiables, entree.fiabilitesFaits.length),
  };
  const points =
    detail.certification + detail.informel + detail.coherence + detail.anciennete + detail.sources;
  const classe = classeDe(points, bareme);
  return {
    points,
    classe,
    detail,
    analysesIndicatives:
      classe === "C" ||
      classe === "D" ||
      entree.certification !== "certifies" ||
      entree.partInformel === "forte",
    moisDepuisDerniereCloture: mois,
    recommandations: recommandations(entree, detail, mois, bareme),
  };
}
