/** Contenus du plan stratégique : contrôles en français et construction des `donnees` d'une version. */
import {
  DEPENDANCES_INITIATIVE_MAX,
  LOCALES_INTL,
  PERSPECTIVES_PLAN,
  STATUTS_INITIATIVE,
  creerTraduire,
  type Langue,
  type PerspectivePlan,
  type StatutInitiative,
  type Traduire,
  type TypeElementPlan,
} from "@missionpilot/shared";
import type { Devise } from "./format";
import { lireMontantSigne } from "./plan-hypotheses";
import { BORNES_ELEMENT, type ChampElement, type SaisieElement } from "./plan-elements-saisie";
import { lireMontant, type Resultat } from "./saisie";

// --- Contrôles --------------------------------------------------------------------------------

type Erreurs = Partial<Record<ChampElement, string>>;

/** Langue et traduction passées aux contrôles. */
interface Cadre {
  langue: Langue;
  t: Traduire;
}
const requis = (c: Cadre) => c.t("Champ obligatoire.", "Required field.");
const auPlus = (c: Cadre, max: number) =>
  c.t(
    `${max.toLocaleString(LOCALES_INTL[c.langue])} caractères au plus.`,
    `${max.toLocaleString(LOCALES_INTL[c.langue])} characters at most.`,
  );
const dateInvalide = (c: Cadre) =>
  c.t("Date invalide (entre 2000 et 2100).", "Invalid date (between 2000 and 2100).");
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date AAAA-MM-JJ valide, de 2000 à 2100 (contrainte de la base). */
export function dateValide(v: string): boolean {
  const m = DATE.exec(v);
  if (!m) return false;
  const annee = Number(m[1]);
  const d = new Date(`${v}T00:00:00Z`);
  return (
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === v &&
    annee >= 2000 &&
    annee <= 2100
  );
}

function texteRequis(v: string, cle: ChampElement, max: number, err: Erreurs, c: Cadre): string {
  const texte = v.trim();
  if (texte === "") err[cle] = requis(c);
  else if (texte.length > max) err[cle] = auPlus(c, max);
  return texte;
}

function texteFacultatif(v: string, cle: ChampElement, max: number, err: Erreurs, c: Cadre) {
  const texte = v.trim();
  if (texte.length > max) err[cle] = auPlus(c, max);
  return texte === "" ? undefined : texte;
}

/** Une entrée par ligne, sans doublon ni ligne vide. */
export function lireLignes(v: string): string[] {
  return [
    ...new Set(
      v
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== ""),
    ),
  ];
}

function liste(
  v: string,
  cle: ChampElement,
  max: number,
  maxLongueur: number,
  err: Erreurs,
  c: Cadre,
) {
  const l = lireLignes(v);
  if (l.length > max) err[cle] = c.t(`${max} lignes au plus.`, `${max} lines at most.`);
  else if (l.some((x) => x.length > maxLongueur)) {
    err[cle] = c.t(
      `Chaque ligne fait ${maxLongueur} caractères au plus.`,
      `Each line is ${maxLongueur} characters at most.`,
    );
  }
  return l;
}

function dateFacultative(v: string, cle: ChampElement, err: Erreurs, c: Cadre) {
  const texte = v.trim();
  if (texte === "") return undefined;
  if (!dateValide(texte)) err[cle] = dateInvalide(c);
  return texte;
}

const B = BORNES_ELEMENT;

function donneesSwot(s: SaisieElement, err: Erreurs, c: Cadre) {
  const d = {
    forces: liste(s.forces, "forces", B.constats, B.constat, err, c),
    faiblesses: liste(s.faiblesses, "faiblesses", B.constats, B.constat, err, c),
    opportunites: liste(s.opportunites, "opportunites", B.constats, B.constat, err, c),
    menaces: liste(s.menaces, "menaces", B.constats, B.constat, err, c),
  };
  if (Object.values(d).every((l) => l.length === 0)) {
    err.swot = c.t(
      "Renseignez au moins un constat (force, faiblesse, opportunité ou menace).",
      "Enter at least one finding (strength, weakness, opportunity or threat).",
    );
  }
  return d;
}

function donneesObjectif(s: SaisieElement, err: Erreurs, c: Cadre) {
  if (!(PERSPECTIVES_PLAN as readonly string[]).includes(s.perspective)) {
    err.perspective = c.t("Choisissez une perspective.", "Choose a perspective.");
  }
  return {
    titre: texteRequis(s.titre, "titre", B.titre, err, c),
    description: texteFacultatif(s.description, "description", B.description, err, c),
    perspective: s.perspective as PerspectivePlan,
    indicateur: texteFacultatif(s.indicateur, "indicateur", B.court, err, c),
    cible: texteFacultatif(s.cible, "cible", B.court, err, c),
    echeance: dateFacultative(s.echeance, "echeance", err, c),
  };
}

function gainsAnnuels(s: SaisieElement, horizon: number, devise: Devise, err: Erreurs, c: Cadre) {
  const cases = Array.from({ length: horizon }, (_, i) => (s.gains[i] ?? "").trim());
  if (cases.every((x) => x === "")) return undefined;
  if (cases.some((x) => x === "")) {
    err.gains = c.t(
      `Renseignez les ${horizon} années, ou laissez-les toutes vides (ROI non calculé).`,
      `Fill in all ${horizon} years, or leave them all empty (ROI not computed).`,
    );
    return undefined;
  }
  const valeurs = cases.map((x) => lireMontantSigne(x, devise));
  if (valeurs.some((v) => v === null || Number.isNaN(v))) {
    err.gains = c.t(
      "Montant illisible : chiffres seulement, signe moins pour une perte.",
      "Unreadable amount: digits only, minus sign for a loss.",
    );
    return undefined;
  }
  return valeurs as number[];
}

function donneesInitiative(
  s: SaisieElement,
  horizon: number,
  devise: Devise,
  err: Erreurs,
  c: Cadre,
) {
  const echeance = s.echeance.trim();
  if (echeance === "") err.echeance = requis(c);
  else if (!dateValide(echeance)) err.echeance = dateInvalide(c);
  const debut = dateFacultative(s.debut, "debut", err, c);
  if (debut && !err.debut && !err.echeance && debut > echeance) {
    err.debut = c.t("Le début doit précéder l'échéance.", "The start must precede the due date.");
  }
  const budget = lireMontant(s.budget, devise);
  if (budget === null) err.budget = requis(c);
  else if (Number.isNaN(budget))
    err.budget = c.t("Montant invalide (positif ou nul).", "Invalid amount (zero or positive).");
  if (!(STATUTS_INITIATIVE as readonly string[]).includes(s.statut)) {
    err.statut = c.t("Choisissez un statut.", "Choose a status.");
  }
  const responsable = s.responsable_id.trim();
  if (s.dependances.length > DEPENDANCES_INITIATIVE_MAX) {
    err.dependances = c.t(
      `${DEPENDANCES_INITIATIVE_MAX} dépendances au plus.`,
      `${DEPENDANCES_INITIATIVE_MAX} dependencies at most.`,
    );
  }
  return {
    titre: texteRequis(s.titre, "titre", B.titre, err, c),
    description: texteFacultatif(s.description, "description", B.description, err, c),
    responsable_id: responsable === "" ? undefined : responsable,
    debut,
    echeance,
    budget: budget ?? 0,
    statut: s.statut as StatutInitiative,
    gains_annuels: gainsAnnuels(s, horizon, devise, err, c),
    // Absent plutôt que vide : une version sans dépendance garde la forme d'avant PLA-05.
    dependances: s.dependances.length ? [...new Set(s.dependances)] : undefined,
  };
}

function donneesSelonType(
  type: TypeElementPlan,
  s: SaisieElement,
  horizon: number,
  devise: Devise,
  err: Erreurs,
  c: Cadre,
): Record<string, unknown> {
  switch (type) {
    case "diagnostic":
      return { synthese: texteRequis(s.synthese, "synthese", B.synthese, err, c) };
    case "swot":
      return donneesSwot(s, err, c);
    case "vision_mission": {
      const valeurs = liste(s.valeurs, "valeurs", B.valeurs, B.valeur, err, c);
      return {
        vision: texteRequis(s.vision, "vision", B.visionMission, err, c),
        mission: texteRequis(s.mission, "mission", B.visionMission, err, c),
        valeurs: valeurs.length ? valeurs : undefined,
      };
    }
    case "axe":
      return {
        titre: texteRequis(s.titre, "titre", B.titre, err, c),
        description: texteFacultatif(s.description, "description", B.description, err, c),
      };
    case "objectif":
      return donneesObjectif(s, err, c);
    case "initiative":
      return donneesInitiative(s, horizon, devise, err, c);
  }
}

/** Supprime les clés absentes ou nulles (champs facultatifs non saisis). */
export function sansVides(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
}

/**
 * Contrôle la saisie et construit les `donnees` d'une version (contenu complet du type).
 * `horizon` borne les gains annuels ; `devise` convertit les montants en unités mineures.
 */
export function validerElement(
  type: TypeElementPlan,
  s: SaisieElement,
  ctx: { horizon: number; devise: Devise; langue?: Langue },
): Resultat<Record<string, unknown>, ChampElement> {
  const err: Erreurs = {};
  const langue = ctx.langue ?? "fr";
  const donnees = donneesSelonType(type, s, ctx.horizon, ctx.devise, err, {
    langue,
    t: creerTraduire(langue),
  });
  if (Object.keys(err).length > 0) return { ok: false, erreurs: err };
  return { ok: true, charge: sansVides(donnees) };
}

function canonique(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonique).join(",")}]`;
  if (x !== null && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined && o[k] !== null)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}

/** Vrai si les données saisies reprennent exactement la version courante (l'API refuserait : 409). */
export function memeContenu(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return canonique(a) === canonique(b);
}

export const MESSAGE_CONTENU_IDENTIQUE =
  "Aucune modification : le contenu est identique à la version courante.";
export const MESSAGE_CONTENU_IDENTIQUE_EN =
  "No changes: the content is identical to the current version.";
export const messageContenuIdentique = (langue: Langue = "fr") =>
  langue === "en" ? MESSAGE_CONTENU_IDENTIQUE_EN : MESSAGE_CONTENU_IDENTIQUE;
