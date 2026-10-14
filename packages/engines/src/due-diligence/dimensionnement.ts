/**
 * Dimensionnement de marché (DD-12, SPEC-3b §5.2), descendant et ascendant, avec fourchette,
 * sensibilité et recoupement.
 *
 * Entrées entières uniquement : `nombre`, `pourcentage_bp` (points de base, 0 à 10 000) et
 * `montant` (unités mineures de la devise du dossier). Calcul en `bigint` sur la fraction exacte,
 * UN SEUL arrondi par valeur publiée (à l'entier le plus proche, demi s'éloignant de zéro) ; tout
 * résultat doit tenir dans `Number.MAX_SAFE_INTEGER`, sinon `DEPASSEMENT`. Aucun flottant n'entre
 * dans une formule. Seuils provisoires (DECISIONS.md).
 */
import { diviserArrondi } from "../finance/calcul-exact";
import { ErreurDueDiligence } from "./erreurs";
import { METHODES_DIMENSIONNEMENT, type MethodeDimensionnement } from "./vocabulaire";

export const UNITES_PARAMETRE = ["nombre", "pourcentage_bp", "montant"] as const;
export type UniteParametre = (typeof UNITES_PARAMETRE)[number];

/** Paramètres exigés par méthode, dans l'ordre d'affichage. */
export const PARAMETRES_DESCENDANT: readonly { code: string; unite: UniteParametre }[] = [
  { code: "marche_total", unite: "montant" },
  { code: "part_segment", unite: "pourcentage_bp" },
  { code: "part_adressable", unite: "pourcentage_bp" },
  { code: "part_capturable", unite: "pourcentage_bp" },
];
export const PARAMETRES_ASCENDANT: readonly { code: string; unite: UniteParametre }[] = [
  { code: "clients_cibles", unite: "nombre" },
  { code: "taux_conquete", unite: "pourcentage_bp" },
  { code: "volume_par_client", unite: "nombre" },
  { code: "prix_unitaire", unite: "montant" },
];

/** 30 % d'écart relatif entre les deux méthodes, PROVISOIRE. */
export const SEUIL_RECOUPEMENT_BP = 3_000;
/** Un ajustement vaut de 0,01 % à 200 %, PROVISOIRE. */
export const FACTEUR_AJUSTEMENT_MAX_BP = 20_000;
export const AJUSTEMENTS_MAX = 10;

const POINTS_DE_BASE_PLEIN = 10_000;

export type SourceParametre =
  { readonly type: "preuve"; readonly preuveId: string } | { readonly type: "avis_expert" };

export interface ParametreDimensionnement {
  readonly code: string;
  readonly bas: number;
  readonly base: number;
  readonly haut: number;
  /** `null` : accepté ici, signalé en sortie (`couverture.absente`). */
  readonly source: SourceParametre | null;
}
export interface AjustementDimensionnement {
  readonly libelle: string;
  readonly facteurBp: number;
}
export interface EntreeDimensionnement {
  readonly methode: MethodeDimensionnement;
  readonly parametres: readonly ParametreDimensionnement[];
  readonly ajustements?: readonly AjustementDimensionnement[];
}
export interface FourchetteDd {
  readonly bas: number;
  readonly base: number;
  readonly haut: number;
}
export type CodeEtageDd =
  "marche_total" | "marche_adressable" | "marche_capturable" | "marche_atteignable";
export interface EtageDd {
  readonly code: CodeEtageDd;
  readonly valeurs: FourchetteDd;
}
export interface SensibiliteParametre {
  readonly code: string;
  readonly resultatBas: number;
  readonly resultatHaut: number;
  readonly amplitude: number;
  readonly partAmplitudeBp: number;
}
export interface CouvertureSources {
  readonly total: number;
  readonly preuve: number;
  readonly avisExpert: number;
  readonly absente: readonly string[];
}
export interface ResultatDimensionnement {
  readonly methode: MethodeDimensionnement;
  readonly etages: readonly EtageDd[];
  readonly avantAjustement: FourchetteDd;
  readonly resultat: FourchetteDd;
  readonly ajuste: boolean;
  /** `base` cumulée après chaque ajustement (un seul arrondi sur la fraction exacte). */
  readonly ajustementsAppliques: readonly {
    libelle: string;
    facteurBp: number;
    base: number;
  }[];
  readonly sensibilite: readonly SensibiliteParametre[];
  readonly couverture: CouvertureSources;
}

type Scenario = "bas" | "base" | "haut";
type Choix = (p: ParametreDimensionnement) => Scenario;

interface Fraction {
  readonly num: bigint;
  readonly den: bigint;
}
interface EtageExact {
  readonly code: CodeEtageDd;
  readonly f: Fraction;
}

function invalide(message: string): never {
  throw new ErreurDueDiligence("PARAMETRE_INVALIDE", message);
}

function entierSur(valeur: number, nom: string): void {
  if (typeof valeur !== "number" || !Number.isSafeInteger(valeur) || valeur < 0) {
    invalide(`${nom} : entier positif ou nul et sûr attendu.`);
  }
}

function definitionsMethode(
  methode: MethodeDimensionnement,
): readonly { code: string; unite: UniteParametre }[] {
  if (!(METHODES_DIMENSIONNEMENT as readonly string[]).includes(methode)) {
    invalide(`Méthode de dimensionnement inconnue : « ${String(methode)} ».`);
  }
  return methode === "descendant" ? PARAMETRES_DESCENDANT : PARAMETRES_ASCENDANT;
}

function valider(
  entree: EntreeDimensionnement,
): readonly { code: string; unite: UniteParametre }[] {
  const attendus = definitionsMethode(entree.methode);
  const vus = new Set<string>();
  for (const p of entree.parametres) {
    const def = attendus.find((a) => a.code === p.code);
    if (def === undefined) {
      invalide(`Paramètre « ${p.code} » hors de la méthode ${entree.methode}.`);
    }
    if (vus.has(p.code)) invalide(`Paramètre « ${p.code} » en double.`);
    vus.add(p.code);
    for (const cle of ["bas", "base", "haut"] as const) {
      entierSur(p[cle], `${p.code}.${cle}`);
      if (def.unite === "pourcentage_bp" && p[cle] > POINTS_DE_BASE_PLEIN) {
        invalide(`${p.code}.${cle} : un pourcentage ne dépasse pas 10 000 points de base.`);
      }
    }
  }
  for (const a of attendus) {
    if (!vus.has(a.code)) {
      throw new ErreurDueDiligence("PARAMETRE_MANQUANT", `Paramètre « ${a.code} » manquant.`);
    }
  }
  for (const p of entree.parametres) {
    if (p.bas > p.base || p.base > p.haut) {
      throw new ErreurDueDiligence("BORNES_INCOHERENTES", `${p.code} : bas ≤ base ≤ haut attendu.`);
    }
  }
  const ajustements = entree.ajustements ?? [];
  if (ajustements.length > AJUSTEMENTS_MAX) {
    invalide(`Au plus ${AJUSTEMENTS_MAX} ajustements.`);
  }
  for (const a of ajustements) {
    if (
      !Number.isInteger(a.facteurBp) ||
      a.facteurBp < 1 ||
      a.facteurBp > FACTEUR_AJUSTEMENT_MAX_BP
    ) {
      invalide(`Facteur d'ajustement : entier de 1 à ${FACTEUR_AJUSTEMENT_MAX_BP} attendu.`);
    }
  }
  return attendus;
}

/** Étages exacts (avant arrondi) pour un jeu de valeurs ; le dernier est le résultat de la méthode. */
function etagesExacts(
  methode: MethodeDimensionnement,
  v: ReadonlyMap<string, bigint>,
): readonly EtageExact[] {
  const g = (code: string): bigint => v.get(code) ?? 0n;
  if (methode === "descendant") {
    const adressable = g("marche_total") * g("part_segment") * g("part_adressable");
    return [
      { code: "marche_total", f: { num: g("marche_total"), den: 1n } },
      { code: "marche_adressable", f: { num: adressable, den: 10n ** 8n } },
      { code: "marche_capturable", f: { num: adressable * g("part_capturable"), den: 10n ** 12n } },
    ];
  }
  return [
    {
      code: "marche_atteignable",
      f: {
        num: g("clients_cibles") * g("taux_conquete") * g("volume_par_client") * g("prix_unitaire"),
        den: 10n ** 4n,
      },
    },
  ];
}

function arrondiSur(f: Fraction): number {
  const r = diviserArrondi(f.num, f.den);
  if (r > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ErreurDueDiligence(
      "DEPASSEMENT",
      "Résultat supérieur au plus grand entier représentable.",
    );
  }
  return Number(r);
}

function appliquerFacteurs(f: Fraction, facteurs: readonly number[]): Fraction {
  let num = f.num;
  let den = f.den;
  for (const facteur of facteurs) {
    num *= BigInt(facteur);
    den *= 10n ** 4n;
  }
  return { num, den };
}

function valeursPour(
  parametres: readonly ParametreDimensionnement[],
  choix: Choix,
): Map<string, bigint> {
  return new Map(parametres.map((p) => [p.code, BigInt(p[choix(p)])] as const));
}

function dernierEtage(etages: readonly EtageExact[]): Fraction {
  return (etages[etages.length - 1] as EtageExact).f;
}

function resultatFinal(
  methode: MethodeDimensionnement,
  parametres: readonly ParametreDimensionnement[],
  facteurs: readonly number[],
  choix: Choix,
): number {
  const etages = etagesExacts(methode, valeursPour(parametres, choix));
  return arrondiSur(appliquerFacteurs(dernierEtage(etages), facteurs));
}

function comparerCodes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dimensionnerMarche(entree: EntreeDimensionnement): ResultatDimensionnement {
  const attendus = valider(entree);
  const { methode } = entree;
  const ordre = (code: string): number => attendus.findIndex((x) => x.code === code);
  const parametres = [...entree.parametres].sort((a, b) => ordre(a.code) - ordre(b.code));
  const ajustements = entree.ajustements ?? [];
  const facteurs = ajustements.map((a) => a.facteurBp);

  const bas = etagesExacts(
    methode,
    valeursPour(parametres, () => "bas"),
  );
  const base = etagesExacts(
    methode,
    valeursPour(parametres, () => "base"),
  );
  const haut = etagesExacts(
    methode,
    valeursPour(parametres, () => "haut"),
  );
  const etages: EtageDd[] = base.map((e, i) => ({
    code: e.code,
    valeurs: {
      bas: arrondiSur((bas[i] as EtageExact).f),
      base: arrondiSur(e.f),
      haut: arrondiSur((haut[i] as EtageExact).f),
    },
  }));
  const avantAjustement = (etages[etages.length - 1] as EtageDd).valeurs;

  const resultat: FourchetteDd = {
    bas: arrondiSur(appliquerFacteurs(dernierEtage(bas), facteurs)),
    base: arrondiSur(appliquerFacteurs(dernierEtage(base), facteurs)),
    haut: arrondiSur(appliquerFacteurs(dernierEtage(haut), facteurs)),
  };

  const ajustementsAppliques = ajustements.map((a, i) => ({
    libelle: a.libelle,
    facteurBp: a.facteurBp,
    base: arrondiSur(appliquerFacteurs(dernierEtage(base), facteurs.slice(0, i + 1))),
  }));

  const brutes = parametres.map((p) => {
    const resultatBas = resultatFinal(methode, parametres, facteurs, (q) =>
      q.code === p.code ? "bas" : "base",
    );
    const resultatHaut = resultatFinal(methode, parametres, facteurs, (q) =>
      q.code === p.code ? "haut" : "base",
    );
    return { code: p.code, resultatBas, resultatHaut, amplitude: resultatHaut - resultatBas };
  });
  const amplitudeMax = brutes.reduce((m, b) => (b.amplitude > m ? b.amplitude : m), 0);
  const sensibilite: SensibiliteParametre[] = brutes
    .map((b) => ({
      ...b,
      partAmplitudeBp:
        amplitudeMax === 0
          ? 0
          : Number(diviserArrondi(BigInt(b.amplitude) * 10_000n, BigInt(amplitudeMax))),
    }))
    .sort((a, b) => b.amplitude - a.amplitude || comparerCodes(a.code, b.code));

  const couverture: CouvertureSources = {
    total: parametres.length,
    preuve: parametres.filter((p) => p.source?.type === "preuve").length,
    avisExpert: parametres.filter((p) => p.source?.type === "avis_expert").length,
    absente: parametres.filter((p) => p.source === null).map((p) => p.code),
  };

  return {
    methode,
    etages,
    avantAjustement,
    resultat,
    ajuste: ajustements.length > 0,
    ajustementsAppliques,
    sensibilite,
    couverture,
  };
}

export interface RecoupementDd {
  /** |d − a| × 10 000 / max(d, a) sur les `base`, arrondi ; 0 si les deux sont nuls. */
  readonly ecartBp: number;
  readonly plusEleve: "descendant" | "ascendant" | "egal";
  /** `ecartBp` strictement supérieur au seuil. */
  readonly alerte: boolean;
  /** Les fourchettes [bas, haut] se recoupent. */
  readonly chevauchement: boolean;
}

function verifierFourchette(f: FourchetteDd, nom: string): void {
  entierSur(f.bas, `${nom}.bas`);
  entierSur(f.base, `${nom}.base`);
  entierSur(f.haut, `${nom}.haut`);
  if (f.bas > f.base || f.base > f.haut) {
    throw new ErreurDueDiligence("BORNES_INCOHERENTES", `${nom} : bas ≤ base ≤ haut attendu.`);
  }
}

export function recouperDimensionnements(
  descendant: FourchetteDd,
  ascendant: FourchetteDd,
  seuilBp: number = SEUIL_RECOUPEMENT_BP,
): RecoupementDd {
  verifierFourchette(descendant, "descendant");
  verifierFourchette(ascendant, "ascendant");
  if (!Number.isInteger(seuilBp) || seuilBp < 0 || seuilBp > POINTS_DE_BASE_PLEIN) {
    invalide("Seuil de recoupement : entier de 0 à 10 000 points de base attendu.");
  }
  const d = BigInt(descendant.base);
  const a = BigInt(ascendant.base);
  const max = d > a ? d : a;
  const ecart = d > a ? d - a : a - d;
  const ecartBp = max === 0n ? 0 : Number(diviserArrondi(ecart * 10_000n, max));
  return {
    ecartBp,
    plusEleve: d === a ? "egal" : d > a ? "descendant" : "ascendant",
    alerte: ecartBp > seuilBp,
    chevauchement: descendant.bas <= ascendant.haut && ascendant.bas <= descendant.haut,
  };
}
