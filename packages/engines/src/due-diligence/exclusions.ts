/**
 * Filtrage d'exclusion et revue environnementale et sociale (DD-14, SPEC-3b §5.7). La liste
 * d'exclusion est saisie par le cabinet ou l'investisseur ; le moteur signale des TOUCHES (faux
 * positifs possibles, tranchés par l'expert, jamais l'inverse) et synthétise les huit thèmes de
 * revue. Fonctions pures.
 */
import type { LectureSolidite } from "../preuves/solidite";
import { ErreurDueDiligence } from "./erreurs";
import { NIVEAUX_ES, rangNiveauEs, type NiveauEs } from "./vocabulaire";

/** NFD sans accents, minuscules, tout non alphanumérique → espace, espaces réduits. */
export function normaliserTexteDd(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface RegleExclusion {
  readonly code: string;
  readonly motsCles: readonly string[];
  readonly secteurCodes: readonly string[];
  readonly paysCodes: readonly string[];
}
export interface DeclarationsFiltrage {
  readonly activites: readonly string[];
  readonly secteurCodes: readonly string[];
  readonly paysCodes: readonly string[];
}
export type CritereTouche = "mot_cle" | "secteur" | "pays";
export interface ToucheExclusion {
  readonly regle: string;
  /** Ordre canonique : mot_cle, secteur, pays. */
  readonly criteres: readonly CritereTouche[];
  /** Mots-clés d'origine (non normalisés) qui ont touché. */
  readonly motsTrouves: readonly string[];
}
export interface ResultatFiltrage {
  readonly touches: readonly ToucheExclusion[];
  readonly nonTouchees: number;
}

function entree(message: string): never {
  throw new ErreurDueDiligence("ENTREE_INVALIDE", message);
}

function mots(texte: string): string[] {
  const n = normaliserTexteDd(texte);
  return n === "" ? [] : n.split(" ");
}

/** Les mots du mot-clé se retrouvent consécutifs dans l'activité, chacun étant un préfixe. */
function motCleCorrespond(motsCle: readonly string[], activite: readonly string[]): boolean {
  for (let debut = 0; debut + motsCle.length <= activite.length; debut += 1) {
    if (motsCle.every((m, i) => (activite[debut + i] as string).startsWith(m))) return true;
  }
  return false;
}

export function filtrerExclusions(
  declarations: DeclarationsFiltrage,
  regles: readonly RegleExclusion[],
): ResultatFiltrage {
  const codes = new Set<string>();
  const motsCleParRegle = new Map<string, { origine: string; mots: string[] }[]>();
  for (const r of regles) {
    if (codes.has(r.code)) entree(`Règle « ${r.code} » en double.`);
    codes.add(r.code);
    if (r.motsCles.length + r.secteurCodes.length + r.paysCodes.length === 0) {
      entree(`Règle « ${r.code} » : au moins un critère attendu.`);
    }
    motsCleParRegle.set(
      r.code,
      r.motsCles.map((origine) => {
        const m = mots(origine);
        if (m.length === 0) entree(`Règle « ${r.code} » : mot-clé vide.`);
        return { origine, mots: m };
      }),
    );
  }

  const activites = declarations.activites.map(mots);
  const touches: ToucheExclusion[] = [];
  for (const r of regles) {
    const motsTrouves = (motsCleParRegle.get(r.code) ?? [])
      .filter((k) => activites.some((a) => motCleCorrespond(k.mots, a)))
      .map((k) => k.origine);
    const criteres: CritereTouche[] = [];
    if (motsTrouves.length > 0) criteres.push("mot_cle");
    if (r.secteurCodes.some((c) => declarations.secteurCodes.includes(c))) criteres.push("secteur");
    if (r.paysCodes.some((c) => declarations.paysCodes.includes(c))) criteres.push("pays");
    if (criteres.length > 0) touches.push({ regle: r.code, criteres, motsTrouves });
  }
  return { touches, nonTouchees: regles.length - touches.length };
}

export interface DecisionExclusion {
  readonly regle: string;
  readonly decision: "confirmee" | "ecartee";
  readonly numero: number;
}

/**
 * Nombre de règles touchées dont la DERNIÈRE décision (plus grand `numero`) n'est pas « ecartee »
 * (absence de décision ou « confirmee » : la règle bloque).
 */
export function touchesBloquantes(
  touches: readonly ToucheExclusion[],
  decisions: readonly DecisionExclusion[],
): number {
  const derniere = new Map<string, DecisionExclusion>();
  for (const d of decisions) {
    if (!Number.isInteger(d.numero)) entree(`Décision sur « ${d.regle} » : numéro entier attendu.`);
    if (d.decision !== "confirmee" && d.decision !== "ecartee") {
      entree(`Décision inconnue : « ${String(d.decision)} ».`);
    }
    const courante = derniere.get(d.regle);
    if (courante === undefined || d.numero > courante.numero) derniere.set(d.regle, d);
  }
  return touches.filter((t) => derniere.get(t.regle)?.decision !== "ecartee").length;
}

export interface ThemeEsEntree {
  readonly code: string;
  readonly niveau: NiveauEs;
  readonly lecture: LectureSolidite | null;
}
export interface SyntheseEs {
  readonly niveauGlobal: NiveauEs;
  readonly parNiveau: Readonly<Record<NiveauEs, number>>;
  readonly manquants: readonly string[];
  readonly complet: boolean;
  /** Niveau élevé ou critique ET lecture fragile ou `null` ; tri niveau décroissant, puis code. */
  readonly aDocumenter: readonly string[];
  readonly touchesBloquantes: number;
  /** Au moins une exclusion touchée non levée. */
  readonly bloquant: boolean;
}

export function syntheseSocioEnvironnementale(
  themes: readonly ThemeEsEntree[],
  touchesBloquantesNb: number,
  themesAttendus: readonly string[],
): SyntheseEs {
  if (!Number.isInteger(touchesBloquantesNb) || touchesBloquantesNb < 0) {
    entree("Nombre d'exclusions bloquantes : entier positif ou nul attendu.");
  }
  const codes = new Set<string>();
  const parNiveau: Record<NiveauEs, number> = {
    non_concerne: 0,
    faible: 0,
    modere: 0,
    eleve: 0,
    critique: 0,
  };
  let niveauGlobal: NiveauEs = "non_concerne";
  for (const t of themes) {
    if (codes.has(t.code)) entree(`Thème « ${t.code} » en double.`);
    codes.add(t.code);
    if (!(NIVEAUX_ES as readonly string[]).includes(t.niveau)) {
      entree(`Niveau E&S inconnu : « ${String(t.niveau)} ».`);
    }
    parNiveau[t.niveau] += 1;
    if (rangNiveauEs(t.niveau) > rangNiveauEs(niveauGlobal)) niveauGlobal = t.niveau;
  }
  const manquants = themesAttendus.filter((c) => !codes.has(c));
  const aDocumenter = themes
    .filter((t) => rangNiveauEs(t.niveau) >= 3 && (t.lecture === null || t.lecture === "fragile"))
    .sort(
      (a, b) =>
        rangNiveauEs(b.niveau) - rangNiveauEs(a.niveau) ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    )
    .map((t) => t.code);
  return {
    niveauGlobal,
    parNiveau,
    manquants,
    complet: themes.length > 0 && manquants.length === 0,
    aDocumenter,
    touchesBloquantes: touchesBloquantesNb,
    bloquant: touchesBloquantesNb > 0,
  };
}
