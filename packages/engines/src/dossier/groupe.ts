/**
 * Groupes et filiales (DOS-05, PRD complémentaire §5) : structure de détention
 * et consolidation SIMPLE des indicateurs. Ce n'est PAS une consolidation
 * comptable légale : aucune élimination d'opérations intragroupe. C'est une
 * lecture d'aide au pilotage.
 *
 * HISTORIQUE DE DÉTENTION (ajout seul). Un lien est `{ detenteur, filiale,
 * pointsBase, dateEffet, creeLe }`, identifiants opaques, `pointsBase` entier
 * 0..10 000 (10 000 points de base = 100 %). Pour une paire (détenteur,
 * filiale), la participation en vigueur à la date D est le DERNIER
 * enregistrement tel que dateEffet ≤ D, départagé par `creeLe` le plus récent
 * puis par l'ordre d'entrée. Une valeur 0 marque la FIN de la détention ; sans
 * enregistrement, il n'y a pas de détention.
 *
 * CONTRÔLE D'UN NOUVEAU LIEN (`controlerNouvelleDetention`, à appeler avec
 * tout l'historique). Règle PRUDENTE : le cycle et le dépassement de 100 %
 * s'apprécient sur le dernier enregistrement de chaque paire TOUTES DATES
 * CONFONDUES (y compris à effet futur), le nouveau lien remplaçant celui de sa
 * paire. On ne crée donc jamais un cycle, même futur. Une fin de détention
 * (points = 0) exige une détention antérieure ou simultanée de la paire.
 *
 * STRUCTURE (`structureGroupe`, `structureDepuisTete`). Sur les participations
 * en vigueur à la date demandée : détenteurs (ancêtres) et filiales
 * (descendants) de la racine, et société de tête = ancêtre sans détenteur (la
 * plus petite par ordre lexical des identifiants s'il y en a plusieurs ; la
 * racine elle-même si elle n'a pas de détenteur). La part cumulée d'un noeud
 * est la somme, sur tous les chemins depuis la racine, du produit des parts le
 * long du chemin (losanges inclus). Le calcul est EXACT en BigInt (dénominateur
 * 10 000^PROFONDEUR_GROUPE_MAX) ; l'arrondi demi s'éloignant de zéro, en points
 * de base, n'intervient qu'à la fin (`arrondirPoints`). Au-delà de
 * PROFONDEUR_GROUPE_MAX niveaux : DETENTION_TROP_PROFONDE. `niveau` = nombre
 * minimal de liens entre la racine et le noeud ; `partDirecteBps` = part
 * détenue directement par/dans la racine, null si le noeud n'est pas voisin
 * direct. Pour un détenteur, la part cumulée est la part qu'il détient (en
 * direct et indirect) dans la racine.
 *
 * CONSOLIDATION SIMPLE (`consoliderGroupe`). L'entrée porte des parts cumulées
 * en points de base ENTIERS (précision suffisante pour l'affichage ; la
 * racine = 10 000) et un état financier accepté par entité visible.
 * (a) « intégrale » : somme à 100 % des entités incluses dont la part cumulée
 *     est STRICTEMENT supérieure à SEUIL_CONTROLE_POINTS (la racine compte pour
 *     100 %). Simplification : le contrôle indirect se lit sur la part cumulée.
 * (b) « proportionnelle » : pour toutes les entités incluses de part > 0, somme
 *     de montant × part cumulée, exacte en BigInt, puis UN SEUL arrondi demi
 *     s'éloignant de zéro.
 * (c) Un indicateur sans aucun montant parmi les entités concernées vaut null,
 *     jamais 0 ; une entité sans montant pour un indicateur ne compte pas pour
 *     lui.
 * (d) Marge nette = résultat / produits en points de base (`ratioArrondi`),
 *     calculée sur les SOMMES de chaque vue, jamais en moyenne de marges ; null
 *     si l'un des deux manque ou si les produits sont nuls.
 * (e) Fiabilité = moyenne pondérée des points (0..1000) des entités incluses
 *     ayant un indice, poids = part cumulée, arrondie à l'entier demi
 *     s'éloignant de zéro.
 * (f) Exclusions, dans cet ordre : état absent (ETAT_ABSENT), dossier non
 *     visible (NON_VISIBLE : aucune donnée de l'entité n'entre dans la sortie),
 *     devise sans conversion possible (DEVISE_DIFFERENTE : voir (h)), exercice
 *     différent (EXERCICE_DIFFERENT). `partielle` est vrai si une entité de part
 *     > 0 est exclue. Une entité de part 0 est ignorée.
 * (g) Entrée mal formée : ErreurDossier DETENTION_INVALIDE.
 * (h) Devises. La devise de consolidation est celle de la racine (`entree.devise`).
 *     Une entité dans une autre devise est CONVERTIE au taux fixe de la parité
 *     légale : 1 EUR = 655,957 XOF = 655,957 XAF, et XOF = XAF à parité 1:1
 *     (mêmes entiers, mêmes décimales). La conversion est exacte en BigInt sur
 *     les unités mineures (EUR : centimes ; FCFA : unités), arrondie UNE fois par
 *     montant, demi s'éloignant de zéro, AVANT toute somme ou pondération.
 *     Exemples : 1 000,00 EUR (100 000 centimes) → 655 957 XOF ; 655 957 XOF →
 *     1 000,00 EUR. L'USD n'a pas de taux validé : une entité en USD (ou une
 *     racine en USD avec des entités d'une autre devise) est exclue
 *     (DEVISE_DIFFERENTE) et la consolidation est partielle. Les entités
 *     converties sont listées dans `conversions`.
 *
 * Fonctions pures, déterministes, sans horloge ; mêmes entrées (quel que soit
 * l'ordre), mêmes sorties.
 */
import { analyserDateISO } from "../commun/dates";
import { ratioArrondi } from "../commun/ratio";
import { versRationnel } from "../finance/calcul-exact";
import {
  PARITE_EUR_FCFA,
  convertir,
  figerTauxChange,
  montant,
  multiplierParRationnel,
  type Devise,
} from "../finance/monnaie";
import { ErreurDossier } from "./erreurs";

/** 10 000 points de base = 100 %. */
export const BASE_POINTS_DETENTION = 10_000;
/** Nombre maximal de liens entre la racine et un noeud. */
export const PROFONDEUR_GROUPE_MAX = 8;
/** Une part cumulée STRICTEMENT supérieure à ce seuil (50 %) vaut contrôle. */
export const SEUIL_CONTROLE_POINTS = 5_000;

export interface LienDetention {
  readonly detenteur: string;
  readonly filiale: string;
  readonly pointsBase: number;
  /** AAAA-MM-JJ. */
  readonly dateEffet: string;
  /** Horodatage ISO de saisie, pour départager. */
  readonly creeLe: string;
}

export interface NouvelleDetention {
  readonly detenteur: string;
  readonly filiale: string;
  readonly pointsBase: number;
  readonly dateEffet: string;
}

export interface NoeudGroupe {
  readonly client: string;
  readonly niveau: number;
  readonly partDirecteBps: number | null;
  readonly partCumuleeBps: number;
}

export interface StructureGroupe {
  readonly racine: string;
  readonly detenteurs: readonly NoeudGroupe[];
  readonly filiales: readonly NoeudGroupe[];
  readonly tete: string;
}

const BASE = BigInt(BASE_POINTS_DETENTION);
const ECHELLE = BASE ** BigInt(PROFONDEUR_GROUPE_MAX);

/** Division entière arrondie demi s'éloignant de zéro (dénominateur > 0). */
export function arrondirPoints(numerateur: bigint, denominateur: bigint): number {
  if (denominateur <= 0n) {
    throw new ErreurDossier("DETENTION_INVALIDE", "Dénominateur d'arrondi invalide.");
  }
  const negatif = numerateur < 0n;
  const absolu = negatif ? -numerateur : numerateur;
  const quotient = (2n * absolu + denominateur) / (2n * denominateur);
  return Number(negatif ? -quotient : quotient);
}

function pointsValides(p: number): boolean {
  return Number.isInteger(p) && p >= 0 && p <= BASE_POINTS_DETENTION;
}

function verifierDate(date: string, code: "DATE_INVALIDE" | "DETENTION_INVALIDE"): void {
  if (typeof date !== "string" || !analyserDateISO(date).valide) {
    throw new ErreurDossier(code, `Date invalide : « ${String(date)} ».`);
  }
}

function verifierLien(l: LienDetention): void {
  if (!l.detenteur || !l.filiale || !pointsValides(l.pointsBase)) {
    throw new ErreurDossier("DETENTION_INVALIDE", "Lien de détention mal formé.");
  }
  verifierDate(l.dateEffet, "DETENTION_INVALIDE");
}

function cle(detenteur: string, filiale: string): string {
  return `${detenteur}\u0000${filiale}`;
}

function comparerTexte(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function instant(creeLe: string): number {
  const t = Date.parse(creeLe);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

interface LienIndexe {
  readonly l: LienDetention;
  readonly i: number;
}

/** Ordre « plus récent » : date d'effet, horodatage de saisie, ordre d'entrée. */
function estPlusRecent(a: LienIndexe, b: LienIndexe): boolean {
  if (a.l.dateEffet !== b.l.dateEffet) return a.l.dateEffet > b.l.dateEffet;
  const ta = instant(a.l.creeLe);
  const tb = instant(b.l.creeLe);
  if (ta !== tb) return ta > tb;
  return a.i > b.i;
}

/** Dernier enregistrement de chaque paire, filtré (ou non) par date. */
function derniersParPaire(
  liens: readonly LienDetention[],
  aLaDate: string | null,
): Map<string, LienDetention> {
  const meilleurs = new Map<string, LienIndexe>();
  liens.forEach((l, i) => {
    verifierLien(l);
    if (aLaDate !== null && l.dateEffet > aLaDate) return;
    const k = cle(l.detenteur, l.filiale);
    const courant = meilleurs.get(k);
    if (!courant || estPlusRecent({ l, i }, courant)) meilleurs.set(k, { l, i });
  });
  return new Map([...meilleurs].map(([k, v]) => [k, v.l]));
}

/** Participations en vigueur (points > 0) à une date, triées détenteur puis filiale. */
export function participationsEnVigueur(
  liens: readonly LienDetention[],
  aLaDate: string,
): LienDetention[] {
  verifierDate(aLaDate, "DATE_INVALIDE");
  return [...derniersParPaire(liens, aLaDate).values()]
    .filter((l) => l.pointsBase > 0)
    .sort((a, b) => comparerTexte(a.detenteur, b.detenteur) || comparerTexte(a.filiale, b.filiale));
}

/** Cherche un chemin `depart -> … -> arrivee` (parcours en largeur, ordre lexical). */
function chercherChemin(
  aretes: ReadonlyMap<string, string[]>,
  depart: string,
  arrivee: string,
): string[] | null {
  const parent = new Map<string, string | null>([[depart, null]]);
  const file = [depart];
  for (const courant of file) {
    if (courant === arrivee) {
      const chemin: string[] = [];
      for (let n: string | null = courant; n !== null; n = parent.get(n) ?? null) chemin.unshift(n);
      return chemin;
    }
    for (const suivant of aretes.get(courant) ?? []) {
      if (!parent.has(suivant)) {
        parent.set(suivant, courant);
        file.push(suivant);
      }
    }
  }
  return null;
}

/** Nombre de liens du plus long chemin partant de `depart` (graphe sans cycle). */
function plusLongChemin(aretes: ReadonlyMap<string, string[]>, depart: string): number {
  const memo = new Map<string, number>();
  const visiter = (n: string): number => {
    const connu = memo.get(n);
    if (connu !== undefined) return connu;
    let max = 0;
    for (const suivant of aretes.get(n) ?? []) max = Math.max(max, 1 + visiter(suivant));
    memo.set(n, max);
    return max;
  };
  return visiter(depart);
}

/**
 * Refuse un nouveau lien d'historique (voir l'en-tête). Ne retourne rien :
 * lève une `ErreurDossier` (DETENTION_SOI_MEME, DETENTION_INVALIDE,
 * DETENTION_CYCLE, DETENTION_TROP_PROFONDE, DETENTION_SUPERIEURE_100).
 */
export function controlerNouvelleDetention(
  liens: readonly LienDetention[],
  nouveau: NouvelleDetention,
): void {
  if (nouveau.detenteur === nouveau.filiale) {
    throw new ErreurDossier("DETENTION_SOI_MEME", "Un dossier ne peut pas se détenir lui-même.");
  }
  if (!nouveau.detenteur || !nouveau.filiale || !pointsValides(nouveau.pointsBase)) {
    throw new ErreurDossier(
      "DETENTION_INVALIDE",
      "La participation doit être un entier de 0 à 10 000 points de base.",
    );
  }
  verifierDate(nouveau.dateEffet, "DETENTION_INVALIDE");
  const derniers = derniersParPaire(liens, null);

  if (nouveau.pointsBase === 0) {
    const anterieure = liens.some(
      (l) =>
        l.detenteur === nouveau.detenteur &&
        l.filiale === nouveau.filiale &&
        l.pointsBase > 0 &&
        l.dateEffet <= nouveau.dateEffet,
    );
    if (!anterieure) {
      throw new ErreurDossier(
        "DETENTION_INVALIDE",
        "Aucune détention antérieure à terminer pour cette paire.",
      );
    }
    return;
  }

  derniers.set(cle(nouveau.detenteur, nouveau.filiale), { ...nouveau, creeLe: "" });
  const aretes = new Map<string, string[]>();
  for (const l of derniers.values()) {
    if (l.pointsBase <= 0) continue;
    const liste = aretes.get(l.detenteur) ?? [];
    liste.push(l.filiale);
    aretes.set(l.detenteur, liste);
  }
  for (const liste of aretes.values()) liste.sort(comparerTexte);

  const chemin = chercherChemin(aretes, nouveau.filiale, nouveau.detenteur);
  if (chemin) {
    throw new ErreurDossier(
      "DETENTION_CYCLE",
      `Cette détention créerait un cycle : ${[nouveau.detenteur, ...chemin].join(" -> ")}.`,
    );
  }

  // Profondeur : le plus long chemin qui traverse ce lien (amont + 1 + aval) ne dépasse pas
  // PROFONDEUR_GROUPE_MAX liens (le graphe est sans cycle ici).
  const amont = new Map<string, string[]>();
  for (const [detenteur, filiales] of aretes) {
    for (const f of filiales) amont.set(f, [...(amont.get(f) ?? []), detenteur]);
  }
  const longueur =
    plusLongChemin(amont, nouveau.detenteur) + 1 + plusLongChemin(aretes, nouveau.filiale);
  if (longueur > PROFONDEUR_GROUPE_MAX) {
    throw new ErreurDossier(
      "DETENTION_TROP_PROFONDE",
      `Cette détention porterait la chaîne de détention à ${longueur} niveaux (maximum ${PROFONDEUR_GROUPE_MAX}).`,
    );
  }

  let somme = 0;
  for (const l of derniers.values()) {
    if (l.filiale === nouveau.filiale) somme += l.pointsBase;
  }
  if (somme > BASE_POINTS_DETENTION) {
    throw new ErreurDossier(
      "DETENTION_SUPERIEURE_100",
      `Les participations dans cette filiale atteindraient ${somme} points de base (maximum ${BASE_POINTS_DETENTION}).`,
    );
  }
}

interface Arete {
  readonly vers: string;
  readonly points: number;
}

function ajouter(table: Map<string, Arete[]>, de: string, arete: Arete): void {
  const liste = table.get(de) ?? [];
  liste.push(arete);
  table.set(de, liste);
}

/**
 * Parcourt le graphe par niveaux depuis la racine. Une valeur de niveau k est
 * la somme des produits de parts des chemins de longueur k, exprimée sur le
 * dénominateur ECHELLE (BASE^PROFONDEUR_GROUPE_MAX) : la division par BASE à
 * chaque lien reste exacte tant que k ≤ PROFONDEUR_GROUPE_MAX.
 */
function construireNoeuds(racine: string, suivants: ReadonlyMap<string, Arete[]>): NoeudGroupe[] {
  const niveaux = new Map<string, number>();
  const cumuls = new Map<string, bigint>();
  let front = new Map<string, bigint>([[racine, ECHELLE]]);
  for (let niveau = 1; front.size > 0; niveau++) {
    const prochain = new Map<string, bigint>();
    for (const [noeud, valeur] of front) {
      for (const a of suivants.get(noeud) ?? []) {
        prochain.set(a.vers, (prochain.get(a.vers) ?? 0n) + valeur * BigInt(a.points));
      }
    }
    if (prochain.size > 0 && niveau > PROFONDEUR_GROUPE_MAX) {
      throw new ErreurDossier(
        "DETENTION_TROP_PROFONDE",
        `La structure dépasse ${PROFONDEUR_GROUPE_MAX} niveaux de détention.`,
      );
    }
    front = new Map([...prochain].map(([n, v]) => [n, v / BASE]));
    for (const [n, v] of front) {
      if (!niveaux.has(n)) niveaux.set(n, niveau);
      cumuls.set(n, (cumuls.get(n) ?? 0n) + v);
    }
  }
  const directs = new Map((suivants.get(racine) ?? []).map((a) => [a.vers, a.points]));
  return [...niveaux]
    .map(([client, niveau]) => ({
      client,
      niveau,
      partDirecteBps: directs.get(client) ?? null,
      partCumuleeBps: arrondirPoints((cumuls.get(client) ?? 0n) * BASE, ECHELLE),
    }))
    .sort((a, b) => a.niveau - b.niveau || comparerTexte(a.client, b.client));
}

/**
 * Structure de détention autour d'un client à une date (voir l'en-tête).
 * `racine` est le client demandé ; `tete` la société de tête de ses ancêtres.
 */
export function structureGroupe(
  liens: readonly LienDetention[],
  client: string,
  aLaDate: string,
): StructureGroupe {
  const descendants = new Map<string, Arete[]>();
  const ascendants = new Map<string, Arete[]>();
  for (const l of participationsEnVigueur(liens, aLaDate)) {
    ajouter(descendants, l.detenteur, { vers: l.filiale, points: l.pointsBase });
    ajouter(ascendants, l.filiale, { vers: l.detenteur, points: l.pointsBase });
  }
  const filiales = construireNoeuds(client, descendants);
  const detenteurs = construireNoeuds(client, ascendants);
  const tetes = detenteurs
    .map((n) => n.client)
    .filter((n) => !ascendants.has(n))
    .sort(comparerTexte);
  return { racine: client, detenteurs, filiales, tete: tetes[0] ?? client };
}

/**
 * Arbre complet du groupe : structure depuis la société de tête, avec parts
 * cumulées depuis la tête.
 */
export function structureDepuisTete(
  liens: readonly LienDetention[],
  tete: string,
  aLaDate: string,
): StructureGroupe {
  return structureGroupe(liens, tete, aLaDate);
}

// ---------------------------------------------------------------------------
// Consolidation simple
// ---------------------------------------------------------------------------

export const DEVISES_GROUPE = ["XOF", "XAF", "EUR", "USD"] as const;
export const INDICATEURS_CONSOLIDES = [
  "actif",
  "passif",
  "charges",
  "produits",
  "resultat",
] as const;
type IndicateurMontant = (typeof INDICATEURS_CONSOLIDES)[number];

/** Date de fixation sans effet : la parité EUR/FCFA est fixe (finance/monnaie.ts). */
const DATE_PARITE = "2000-01-01";
const EST_FCFA = (d: string) => d === "XOF" || d === "XAF";

/**
 * Convertit un montant en unités mineures d'une devise vers une autre à la parité fixe
 * XOF/XAF/EUR (`PARITE_EUR_FCFA` et `convertir` de finance/monnaie.ts : exact, un seul arrondi
 * demi s'éloignant de zéro) ; `null` si aucun taux fixe n'existe (USD).
 */
export function convertirMontantGroupe(valeur: number, de: string, vers: string): number | null {
  if (de === vers || (EST_FCFA(de) && EST_FCFA(vers))) return valeur;
  if (de === "EUR" && EST_FCFA(vers)) {
    const taux = figerTauxChange("EUR", vers as Devise, PARITE_EUR_FCFA, DATE_PARITE);
    return convertir(montant(valeur, "EUR"), taux).valeur;
  }
  if (EST_FCFA(de) && vers === "EUR") {
    // Inverse exact de la parité : 1 FCFA = 1 / 655,957 EUR, soit ×100 centimes.
    const p = versRationnel(PARITE_EUR_FCFA, "parité");
    return multiplierParRationnel(montant(valeur, de as Devise), { num: 100n * p.den, den: p.num })
      .valeur;
  }
  return null;
}

export type MotifExclusionGroupe =
  "ETAT_ABSENT" | "DEVISE_DIFFERENTE" | "NON_VISIBLE" | "EXERCICE_DIFFERENT";

export interface MontantsEntiteGroupe {
  readonly actif: number | null;
  readonly passif: number | null;
  readonly charges: number | null;
  readonly produits: number | null;
  readonly resultat: number | null;
}

export interface EntiteGroupe {
  readonly client: string;
  readonly devise: string;
  readonly exercice: number;
  readonly montants: MontantsEntiteGroupe;
  readonly fiabilitePoints: number | null;
  readonly visible: boolean;
}

export interface NoeudConsolidation {
  readonly client: string;
  /** Points de base entiers, 0..10 000 ; la racine vaut 10 000. */
  readonly partCumuleeBps: number;
}

export interface EntreeConsolidation {
  readonly devise: string;
  readonly exercice: number;
  readonly noeuds: readonly NoeudConsolidation[];
  readonly entites: readonly EntiteGroupe[];
}

export interface IndicateursConsolides {
  readonly actif: number | null;
  readonly passif: number | null;
  readonly charges: number | null;
  readonly produits: number | null;
  readonly resultat: number | null;
  readonly margeNetteBps: number | null;
}

export interface ConsolidationGroupe {
  readonly devise: string;
  readonly exercice: number;
  readonly perimetre: {
    readonly inclus: readonly { client: string; partCumuleeBps: number; controlee: boolean }[];
    readonly exclus: readonly { client: string; motif: MotifExclusionGroupe }[];
  };
  readonly partielle: boolean;
  /** Entités converties dans la devise de la racine (de → vers), au taux fixe XOF/XAF/EUR. */
  readonly conversions: readonly { client: string; de: string; vers: string }[];
  readonly integrale: IndicateursConsolides;
  readonly proportionnelle: IndicateursConsolides;
  readonly fiabilite: { moyennePonderee: number | null; poids: "part_cumulee" };
}

function invalide(message: string): never {
  throw new ErreurDossier("DETENTION_INVALIDE", message);
}

function verifierEntree(e: EntreeConsolidation): void {
  if (!(DEVISES_GROUPE as readonly string[]).includes(e.devise)) invalide("Devise inconnue.");
  if (!Number.isInteger(e.exercice)) invalide("Exercice invalide.");
  const vus = new Set<string>();
  for (const n of e.noeuds) {
    if (!n.client || vus.has(n.client)) invalide("Noeud de groupe vide ou en double.");
    vus.add(n.client);
    if (!pointsValides(n.partCumuleeBps)) invalide("Part cumulée hors de 0..10 000.");
  }
  const vues = new Set<string>();
  for (const en of e.entites) {
    if (!en.client || vues.has(en.client)) invalide("Entité vide ou en double.");
    vues.add(en.client);
    for (const m of INDICATEURS_CONSOLIDES) {
      const v = en.montants[m];
      if (v !== null && !Number.isSafeInteger(v)) invalide(`Montant « ${m} » non entier sûr.`);
    }
    const f = en.fiabilitePoints;
    if (f !== null && !(Number.isInteger(f) && f >= 0 && f <= 1000)) {
      invalide("Points de fiabilité hors de 0..1000.");
    }
  }
}

interface Retenue {
  readonly montants: MontantsEntiteGroupe;
  readonly part: number;
  readonly fiabilite: number | null;
}

function sommeIndicateur(
  entites: readonly Retenue[],
  indicateur: IndicateurMontant,
  proportionnelle: boolean,
): number | null {
  let somme = 0n;
  let present = false;
  for (const e of entites) {
    const m = e.montants[indicateur];
    if (m === null) continue;
    present = true;
    somme += proportionnelle ? BigInt(m) * BigInt(e.part) : BigInt(m);
  }
  if (!present) return null;
  const valeur = proportionnelle ? arrondirPoints(somme, BASE) : Number(somme);
  if (!Number.isSafeInteger(valeur)) invalide("Somme consolidée hors des entiers sûrs.");
  return valeur;
}

function indicateurs(entites: readonly Retenue[], proportionnelle: boolean): IndicateursConsolides {
  const s = (i: IndicateurMontant) => sommeIndicateur(entites, i, proportionnelle);
  const resultat = s("resultat");
  const produits = s("produits");
  const ratio = resultat === null || produits === null ? null : ratioArrondi(resultat, produits);
  return {
    actif: s("actif"),
    passif: s("passif"),
    charges: s("charges"),
    produits,
    resultat,
    margeNetteBps: ratio === null ? null : Math.round(ratio * BASE_POINTS_DETENTION) + 0,
  };
}

function convertirMontants(
  m: MontantsEntiteGroupe,
  de: string,
  vers: string,
): MontantsEntiteGroupe {
  const c = (v: number | null) =>
    v === null ? null : (convertirMontantGroupe(v, de, vers) as number);
  return {
    actif: c(m.actif),
    passif: c(m.passif),
    charges: c(m.charges),
    produits: c(m.produits),
    resultat: c(m.resultat),
  };
}

function motifExclusion(
  e: EntiteGroupe | undefined,
  devise: string,
  exercice: number,
): MotifExclusionGroupe | null {
  if (!e) return "ETAT_ABSENT";
  if (!e.visible) return "NON_VISIBLE";
  if (e.devise !== devise && convertirMontantGroupe(0, e.devise, devise) === null) {
    return "DEVISE_DIFFERENTE";
  }
  if (e.exercice !== exercice) return "EXERCICE_DIFFERENT";
  return null;
}

/** Consolidation simple du groupe (voir l'en-tête pour les règles). */
export function consoliderGroupe(entree: EntreeConsolidation): ConsolidationGroupe {
  verifierEntree(entree);
  const parClient = new Map(entree.entites.map((e) => [e.client, e]));
  const inclus: { client: string; partCumuleeBps: number; controlee: boolean }[] = [];
  const exclus: { client: string; motif: MotifExclusionGroupe }[] = [];
  const retenues: Retenue[] = [];
  const conversions: { client: string; de: string; vers: string }[] = [];

  const noeuds = [...entree.noeuds].sort((a, b) => comparerTexte(a.client, b.client));
  for (const n of noeuds) {
    if (n.partCumuleeBps === 0) continue;
    const e = parClient.get(n.client);
    const motif = motifExclusion(e, entree.devise, entree.exercice);
    if (motif !== null || !e) {
      exclus.push({ client: n.client, motif: motif ?? "ETAT_ABSENT" });
      continue;
    }
    inclus.push({
      client: n.client,
      partCumuleeBps: n.partCumuleeBps,
      controlee: n.partCumuleeBps > SEUIL_CONTROLE_POINTS,
    });
    if (e.devise !== entree.devise) {
      conversions.push({ client: e.client, de: e.devise, vers: entree.devise });
    }
    retenues.push({
      montants: convertirMontants(e.montants, e.devise, entree.devise),
      part: n.partCumuleeBps,
      fiabilite: e.fiabilitePoints,
    });
  }
  inclus.sort((a, b) => b.partCumuleeBps - a.partCumuleeBps || comparerTexte(a.client, b.client));

  let poids = 0n;
  let pondere = 0n;
  for (const r of retenues) {
    if (r.fiabilite === null) continue;
    poids += BigInt(r.part);
    pondere += BigInt(r.part) * BigInt(r.fiabilite);
  }
  return {
    devise: entree.devise,
    exercice: entree.exercice,
    perimetre: { inclus, exclus },
    partielle: exclus.length > 0,
    conversions,
    integrale: indicateurs(
      retenues.filter((r) => r.part > SEUIL_CONTROLE_POINTS),
      false,
    ),
    proportionnelle: indicateurs(retenues, true),
    fiabilite: {
      moyennePonderee: poids === 0n ? null : arrondirPoints(pondere, poids),
      poids: "part_cumulee",
    },
  };
}
