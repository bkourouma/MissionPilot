/**
 * Contrôles d'équilibre d'un état financier ingéré (DOS-03, PRD complémentaire §5).
 *
 * Un état est une liste de lignes (bilan actif et passif, compte de résultat :
 * charges, produits, résultat net déclaré), montants en ENTIERS d'unités
 * mineures comme le reste des moteurs (FCFA : 1 unité ; EUR/USD : centimes).
 * Une ligne peut avoir un `parent` (sous-total de la même section) et un
 * `role` : `total` (total déclaré de sa section), `resultat_exercice` (résultat
 * de l'exercice au passif du bilan), `resultat_net` (résultat net déclaré du
 * compte de résultat, seule ligne de la section `resultat`).
 *
 * Contrôles (écart = constaté − attendu ; « ok » si |écart| ≤ tolérance) :
 * - SOUS_TOTAL : toute ligne qui a des enfants vaut la somme de ses enfants ;
 * - TOTAL_SECTION : le total déclaré d'une section vaut la somme de ses lignes
 *   de premier niveau ;
 * - EQUILIBRE_BILAN : total actif = total passif (déclarés, sinon calculés) ;
 * - RESULTAT_COMPTE : résultat net déclaré = produits − charges (si déclaré) ;
 * - RESULTAT_BILAN : résultat de l'exercice au passif = résultat du compte de
 *   résultat (déclaré, sinon produits − charges).
 *
 * EQUILIBRE_BILAN et RESULTAT_BILAN sont REQUIS : s'ils ne sont pas
 * vérifiables (bilan ou compte de résultat absent), l'état n'est jamais
 * acceptable automatiquement (`acceptationAutomatique` faux) : il part en revue
 * humaine, même sans écart. Sommes exactes en BigInt ; mêmes entrées, même
 * sortie, constats dans un ordre stable (ordre des lignes, puis des sections).
 */
import { ErreurDossier } from "./erreurs";

export const SECTIONS_ETAT_FINANCIER = [
  "actif",
  "passif",
  "charges",
  "produits",
  "resultat",
] as const;
export type SectionEtatFinancier = (typeof SECTIONS_ETAT_FINANCIER)[number];

export const ROLES_LIGNE_ETAT = ["total", "resultat_exercice", "resultat_net"] as const;
export type RoleLigneEtat = (typeof ROLES_LIGNE_ETAT)[number];

/** Bornes : lignes par état, montant absolu d'une ligne, tolérance. */
export const LIGNES_ETAT_MAX = 1000;
export const MONTANT_LIGNE_ETAT_MAX = 1_000_000_000_000_000;
export const TOLERANCE_ETAT_MAX = 1_000_000_000;

/** Code de poste : lettres, chiffres, « _ », « . », « - » (codes SYSCOHADA « AZ », « XI »…). */
const CODE_LIGNE = /^[A-Za-z0-9_.-]{1,40}$/;

export interface LigneEtatFinancier {
  readonly code: string;
  readonly section: SectionEtatFinancier;
  readonly montant: number;
  readonly parent?: string | null;
  readonly role?: RoleLigneEtat | null;
}

export interface OptionsControleEtat {
  /** Écart toléré en unités mineures (entier ≥ 0, 0 par défaut). */
  readonly tolerance?: number;
}

export const CODES_CONTROLE_ETAT = [
  "SOUS_TOTAL",
  "TOTAL_SECTION",
  "EQUILIBRE_BILAN",
  "RESULTAT_COMPTE",
  "RESULTAT_BILAN",
] as const;
export type CodeControleEtat = (typeof CODES_CONTROLE_ETAT)[number];

export type StatutConstatEtat = "ok" | "ecart" | "non_verifiable";

export interface ConstatControleEtat {
  readonly code: CodeControleEtat;
  readonly statut: StatutConstatEtat;
  /** Ligne (code) ou section concernée ; `null` pour un contrôle d'ensemble. */
  readonly cible: string | null;
  readonly attendu: number | null;
  readonly constate: number | null;
  readonly ecart: number | null;
  /** Codes des lignes qui entrent dans le contrôle. */
  readonly lignes: readonly string[];
  readonly message: string;
}

export interface TotauxEtatFinancier {
  readonly actif: number | null;
  readonly passif: number | null;
  readonly charges: number | null;
  readonly produits: number | null;
  /** Résultat retenu : net déclaré, sinon produits − charges. */
  readonly resultat: number | null;
}

export interface ControleEtatFinancier {
  readonly constats: readonly ConstatControleEtat[];
  /** Aucun écart au-delà de la tolérance. */
  readonly conforme: boolean;
  /** Les contrôles requis (équilibre du bilan, résultat au bilan) ont pu être faits. */
  readonly complet: boolean;
  /** Conforme ET complet : seule condition d'une acceptation sans revue humaine. */
  readonly acceptationAutomatique: boolean;
  readonly tolerance: number;
  readonly totaux: TotauxEtatFinancier;
}

const CONTROLES_REQUIS: readonly CodeControleEtat[] = ["EQUILIBRE_BILAN", "RESULTAT_BILAN"];
const SECTIONS_SOMMEES = ["actif", "passif", "charges", "produits"] as const;
type SectionSommee = (typeof SECTIONS_SOMMEES)[number];

const LIBELLE_SECTION: Record<SectionSommee, string> = {
  actif: "l'actif",
  passif: "le passif",
  charges: "les charges",
  produits: "les produits",
};

function invalide(code: "LIGNES_INVALIDES" | "PARENT_INVALIDE" | "ROLE_INVALIDE", message: string) {
  return new ErreurDossier(code, message);
}

function verifierTolerance(tolerance: number): void {
  if (!Number.isSafeInteger(tolerance) || tolerance < 0 || tolerance > TOLERANCE_ETAT_MAX) {
    throw new ErreurDossier(
      "TOLERANCE_INVALIDE",
      `Tolérance : entier entre 0 et ${TOLERANCE_ETAT_MAX} unités mineures.`,
    );
  }
}

/** Forme de chaque ligne : code, section, montant, rôle. */
function verifierLigne(l: LigneEtatFinancier, codes: Set<string>): void {
  if (typeof l.code !== "string" || !CODE_LIGNE.test(l.code)) {
    throw new ErreurDossier(
      "CODE_LIGNE_INVALIDE",
      `Code de ligne invalide : « ${String(l.code).slice(0, 40)} ».`,
    );
  }
  if (codes.has(l.code)) {
    throw new ErreurDossier("CODE_LIGNE_EN_DOUBLE", `Code de ligne en double : ${l.code}.`);
  }
  codes.add(l.code);
  if (!(SECTIONS_ETAT_FINANCIER as readonly string[]).includes(l.section)) {
    throw invalide("LIGNES_INVALIDES", `Section inconnue pour la ligne ${l.code}.`);
  }
  if (!Number.isSafeInteger(l.montant) || Math.abs(l.montant) > MONTANT_LIGNE_ETAT_MAX) {
    throw new ErreurDossier("MONTANT_INVALIDE", `Montant invalide pour la ligne ${l.code}.`);
  }
  const role = l.role ?? null;
  if (role !== null && !(ROLES_LIGNE_ETAT as readonly string[]).includes(role)) {
    throw invalide("ROLE_INVALIDE", `Rôle inconnu pour la ligne ${l.code}.`);
  }
  const attendue =
    role === "resultat_exercice" ? "passif" : role === "resultat_net" ? "resultat" : null;
  if (attendue !== null && l.section !== attendue) {
    throw invalide(
      "ROLE_INVALIDE",
      `La ligne ${l.code} (${role}) doit être dans la section ${attendue}.`,
    );
  }
  if (l.section === "resultat" && role !== "resultat_net") {
    throw invalide(
      "ROLE_INVALIDE",
      "La section « resultat » ne porte que le résultat net déclaré.",
    );
  }
  if (role === "total" && (l.parent ?? null) !== null) {
    throw invalide("ROLE_INVALIDE", `Le total ${l.code} ne peut pas avoir de parent.`);
  }
}

/** Rôles uniques : un total par section, un résultat de l'exercice, un résultat net. */
function verifierRolesUniques(lignes: readonly LigneEtatFinancier[]): void {
  const vus = new Set<string>();
  for (const l of lignes) {
    if (!l.role) continue;
    const cle = l.role === "total" ? `total:${l.section}` : l.role;
    if (vus.has(cle)) {
      throw invalide("ROLE_INVALIDE", `Rôle « ${l.role} » en double (ligne ${l.code}).`);
    }
    vus.add(cle);
  }
}

/** Parents : existants, de la même section, jamais un total, sans cycle. */
function verifierParents(lignes: readonly LigneEtatFinancier[]): Map<string, LigneEtatFinancier> {
  const parCode = new Map(lignes.map((l) => [l.code, l]));
  for (const l of lignes) {
    const p = l.parent ?? null;
    if (p === null) continue;
    const parent = parCode.get(p);
    if (!parent)
      throw new ErreurDossier("PARENT_INCONNU", `Parent inconnu pour la ligne ${l.code} : ${p}.`);
    if (p === l.code || parent.section !== l.section || parent.role === "total") {
      throw invalide("PARENT_INVALIDE", `Parent invalide pour la ligne ${l.code} : ${p}.`);
    }
  }
  for (const l of lignes) {
    let courant: LigneEtatFinancier | undefined = l;
    for (let pas = 0; courant?.parent; pas++) {
      if (pas > lignes.length) {
        throw new ErreurDossier("CYCLE_PARENTS", `Cycle de parents autour de la ligne ${l.code}.`);
      }
      courant = parCode.get(courant.parent);
    }
  }
  return parCode;
}

/** Valide la structure des lignes ; lève `ErreurDossier` au premier défaut. */
export function validerLignesEtat(lignes: readonly LigneEtatFinancier[]): void {
  if (!Array.isArray(lignes) || lignes.length === 0 || lignes.length > LIGNES_ETAT_MAX) {
    throw invalide("LIGNES_INVALIDES", `Entre 1 et ${LIGNES_ETAT_MAX} lignes attendues.`);
  }
  const codes = new Set<string>();
  for (const l of lignes) verifierLigne(l, codes);
  verifierRolesUniques(lignes);
  verifierParents(lignes);
}

const somme = (montants: readonly number[]) => montants.reduce((s, m) => s + BigInt(m), 0n);

function versNombre(v: bigint): number {
  // Lignes ≤ 10^15 et au plus 1 000 lignes : |somme| ≤ 10^18 ; au-delà de 2^53, refus explicite.
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ErreurDossier("MONTANT_INVALIDE", "Somme hors des limites de calcul exact.");
  }
  return Number(v);
}

function constat(
  code: CodeControleEtat,
  cible: string | null,
  attendu: bigint,
  constate: bigint,
  tolerance: number,
  lignes: readonly string[],
  message: string,
): ConstatControleEtat {
  const ecart = constate - attendu;
  const absolu = ecart < 0n ? -ecart : ecart;
  return {
    code,
    statut: absolu <= BigInt(tolerance) ? "ok" : "ecart",
    cible,
    attendu: versNombre(attendu),
    constate: versNombre(constate),
    ecart: versNombre(ecart),
    lignes,
    message,
  };
}

function nonVerifiable(code: CodeControleEtat, message: string): ConstatControleEtat {
  return {
    code,
    statut: "non_verifiable",
    cible: null,
    attendu: null,
    constate: null,
    ecart: null,
    lignes: [],
    message,
  };
}

/** Sous-totaux : chaque ligne parente vaut la somme de ses enfants (ordre des lignes). */
function controlerSousTotaux(
  lignes: readonly LigneEtatFinancier[],
  tolerance: number,
): ConstatControleEtat[] {
  const enfants = new Map<string, LigneEtatFinancier[]>();
  for (const l of lignes) {
    if (l.parent) enfants.set(l.parent, [...(enfants.get(l.parent) ?? []), l]);
  }
  const constats: ConstatControleEtat[] = [];
  for (const l of lignes) {
    const e = enfants.get(l.code);
    if (!e) continue;
    constats.push(
      constat(
        "SOUS_TOTAL",
        l.code,
        somme(e.map((x) => x.montant)),
        BigInt(l.montant),
        tolerance,
        e.map((x) => x.code),
        `Le sous-total ${l.code} vaut la somme de ses ${e.length} ligne(s).`,
      ),
    );
  }
  return constats;
}

/** Totaux de section : déclaré (contrôlé contre la somme du premier niveau), sinon calculé. */
function controlerSections(
  lignes: readonly LigneEtatFinancier[],
  tolerance: number,
): { constats: ConstatControleEtat[]; totaux: Map<SectionSommee, bigint> } {
  const constats: ConstatControleEtat[] = [];
  const totaux = new Map<SectionSommee, bigint>();
  for (const section of SECTIONS_SOMMEES) {
    const premierNiveau = lignes.filter(
      (l) => l.section === section && !l.parent && l.role !== "total",
    );
    const declare = lignes.find((l) => l.section === section && l.role === "total");
    if (premierNiveau.length === 0 && !declare) continue;
    const calcule = somme(premierNiveau.map((l) => l.montant));
    if (declare) {
      constats.push(
        constat(
          "TOTAL_SECTION",
          section,
          calcule,
          BigInt(declare.montant),
          tolerance,
          premierNiveau.map((l) => l.code),
          `Le total déclaré pour ${LIBELLE_SECTION[section]} (${declare.code}) vaut la somme de ses lignes.`,
        ),
      );
    }
    totaux.set(section, declare ? BigInt(declare.montant) : calcule);
  }
  return { constats, totaux };
}

/** Équilibre du bilan et cohérence du résultat (compte de résultat ↔ bilan). */
function controlerEnsemble(
  lignes: readonly LigneEtatFinancier[],
  totaux: Map<SectionSommee, bigint>,
  tolerance: number,
): { constats: ConstatControleEtat[]; resultat: bigint | null } {
  const constats: ConstatControleEtat[] = [];
  const actif = totaux.get("actif");
  const passif = totaux.get("passif");
  constats.push(
    actif !== undefined && passif !== undefined
      ? constat(
          "EQUILIBRE_BILAN",
          null,
          actif,
          passif,
          tolerance,
          [],
          "Le total du passif égale le total de l'actif.",
        )
      : nonVerifiable(
          "EQUILIBRE_BILAN",
          "Équilibre du bilan non vérifiable : actif ou passif absent.",
        ),
  );
  const charges = totaux.get("charges");
  const produits = totaux.get("produits");
  const calcule = charges !== undefined && produits !== undefined ? produits - charges : null;
  const net = lignes.find((l) => l.role === "resultat_net");
  if (net && calcule !== null) {
    constats.push(
      constat(
        "RESULTAT_COMPTE",
        net.code,
        calcule,
        BigInt(net.montant),
        tolerance,
        [net.code],
        "Le résultat net déclaré égale produits − charges.",
      ),
    );
  }
  const resultat = net ? BigInt(net.montant) : calcule;
  const auBilan = lignes.find((l) => l.role === "resultat_exercice");
  constats.push(
    auBilan && resultat !== null
      ? constat(
          "RESULTAT_BILAN",
          auBilan.code,
          resultat,
          BigInt(auBilan.montant),
          tolerance,
          [auBilan.code],
          "Le résultat de l'exercice au bilan égale celui du compte de résultat.",
        )
      : nonVerifiable(
          "RESULTAT_BILAN",
          "Résultat non vérifiable : résultat au bilan ou compte de résultat absent.",
        ),
  );
  return { constats, resultat };
}

/**
 * Contrôle un état financier. Lève `ErreurDossier` si la structure est
 * invalide ; renvoie sinon les constats détaillés et la décision d'acceptation
 * automatique (jamais vraie si un contrôle requis n'a pas pu être fait).
 */
export function controlerEtatFinancier(
  lignes: readonly LigneEtatFinancier[],
  options: OptionsControleEtat = {},
): ControleEtatFinancier {
  const tolerance = options.tolerance ?? 0;
  verifierTolerance(tolerance);
  validerLignesEtat(lignes);
  const sousTotaux = controlerSousTotaux(lignes, tolerance);
  const sections = controlerSections(lignes, tolerance);
  const ensemble = controlerEnsemble(lignes, sections.totaux, tolerance);
  const constats = [...sousTotaux, ...sections.constats, ...ensemble.constats];
  const conforme = constats.every((c) => c.statut !== "ecart");
  const complet = CONTROLES_REQUIS.every((code) =>
    constats.some((c) => c.code === code && c.statut !== "non_verifiable"),
  );
  const total = (s: SectionSommee) => {
    const v = sections.totaux.get(s);
    return v === undefined ? null : versNombre(v);
  };
  return {
    constats,
    conforme,
    complet,
    acceptationAutomatique: conforme && complet,
    tolerance,
    totaux: {
      actif: total("actif"),
      passif: total("passif"),
      charges: total("charges"),
      produits: total("produits"),
      resultat: ensemble.resultat === null ? null : versNombre(ensemble.resultat),
    },
  };
}
