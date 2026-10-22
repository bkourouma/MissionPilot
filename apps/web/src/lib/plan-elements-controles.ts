/** Contenus du plan stratégique : contrôles en français et construction des `donnees` d'une version. */
import {
  DEPENDANCES_INITIATIVE_MAX,
  PERSPECTIVES_PLAN,
  STATUTS_INITIATIVE,
  type PerspectivePlan,
  type StatutInitiative,
  type TypeElementPlan,
} from "@missionpilot/shared";
import type { Devise } from "./format";
import { lireMontantSigne } from "./plan-hypotheses";
import { BORNES_ELEMENT, type ChampElement, type SaisieElement } from "./plan-elements-saisie";
import { lireMontant, type Resultat } from "./saisie";

// --- Contrôles --------------------------------------------------------------------------------

type Erreurs = Partial<Record<ChampElement, string>>;

const REQUIS = "Champ obligatoire.";
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

function texteRequis(v: string, cle: ChampElement, max: number, err: Erreurs): string {
  const t = v.trim();
  if (t === "") err[cle] = REQUIS;
  else if (t.length > max) err[cle] = `${max.toLocaleString("fr-FR")} caractères au plus.`;
  return t;
}

function texteFacultatif(v: string, cle: ChampElement, max: number, err: Erreurs) {
  const t = v.trim();
  if (t.length > max) err[cle] = `${max.toLocaleString("fr-FR")} caractères au plus.`;
  return t === "" ? undefined : t;
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

function liste(v: string, cle: ChampElement, max: number, maxLongueur: number, err: Erreurs) {
  const l = lireLignes(v);
  if (l.length > max) err[cle] = `${max} lignes au plus.`;
  else if (l.some((x) => x.length > maxLongueur)) {
    err[cle] = `Chaque ligne fait ${maxLongueur} caractères au plus.`;
  }
  return l;
}

function dateFacultative(v: string, cle: ChampElement, err: Erreurs) {
  const t = v.trim();
  if (t === "") return undefined;
  if (!dateValide(t)) err[cle] = "Date invalide (entre 2000 et 2100).";
  return t;
}

const B = BORNES_ELEMENT;

function donneesSwot(s: SaisieElement, err: Erreurs) {
  const d = {
    forces: liste(s.forces, "forces", B.constats, B.constat, err),
    faiblesses: liste(s.faiblesses, "faiblesses", B.constats, B.constat, err),
    opportunites: liste(s.opportunites, "opportunites", B.constats, B.constat, err),
    menaces: liste(s.menaces, "menaces", B.constats, B.constat, err),
  };
  if (Object.values(d).every((l) => l.length === 0)) {
    err.swot = "Renseignez au moins un constat (force, faiblesse, opportunité ou menace).";
  }
  return d;
}

function donneesObjectif(s: SaisieElement, err: Erreurs) {
  if (!(PERSPECTIVES_PLAN as readonly string[]).includes(s.perspective)) {
    err.perspective = "Choisissez une perspective.";
  }
  return {
    titre: texteRequis(s.titre, "titre", B.titre, err),
    description: texteFacultatif(s.description, "description", B.description, err),
    perspective: s.perspective as PerspectivePlan,
    indicateur: texteFacultatif(s.indicateur, "indicateur", B.court, err),
    cible: texteFacultatif(s.cible, "cible", B.court, err),
    echeance: dateFacultative(s.echeance, "echeance", err),
  };
}

function gainsAnnuels(s: SaisieElement, horizon: number, devise: Devise, err: Erreurs) {
  const cases = Array.from({ length: horizon }, (_, i) => (s.gains[i] ?? "").trim());
  if (cases.every((c) => c === "")) return undefined;
  if (cases.some((c) => c === "")) {
    err.gains = `Renseignez les ${horizon} années, ou laissez-les toutes vides (ROI non calculé).`;
    return undefined;
  }
  const valeurs = cases.map((c) => lireMontantSigne(c, devise));
  if (valeurs.some((v) => v === null || Number.isNaN(v))) {
    err.gains = "Montant illisible : chiffres seulement, signe moins pour une perte.";
    return undefined;
  }
  return valeurs as number[];
}

function donneesInitiative(s: SaisieElement, horizon: number, devise: Devise, err: Erreurs) {
  const echeance = s.echeance.trim();
  if (echeance === "") err.echeance = REQUIS;
  else if (!dateValide(echeance)) err.echeance = "Date invalide (entre 2000 et 2100).";
  const debut = dateFacultative(s.debut, "debut", err);
  if (debut && !err.debut && !err.echeance && debut > echeance) {
    err.debut = "Le début doit précéder l'échéance.";
  }
  const budget = lireMontant(s.budget, devise);
  if (budget === null) err.budget = REQUIS;
  else if (Number.isNaN(budget)) err.budget = "Montant invalide (positif ou nul).";
  if (!(STATUTS_INITIATIVE as readonly string[]).includes(s.statut)) {
    err.statut = "Choisissez un statut.";
  }
  const responsable = s.responsable_id.trim();
  if (s.dependances.length > DEPENDANCES_INITIATIVE_MAX) {
    err.dependances = `${DEPENDANCES_INITIATIVE_MAX} dépendances au plus.`;
  }
  return {
    titre: texteRequis(s.titre, "titre", B.titre, err),
    description: texteFacultatif(s.description, "description", B.description, err),
    responsable_id: responsable === "" ? undefined : responsable,
    debut,
    echeance,
    budget: budget ?? 0,
    statut: s.statut as StatutInitiative,
    gains_annuels: gainsAnnuels(s, horizon, devise, err),
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
): Record<string, unknown> {
  switch (type) {
    case "diagnostic":
      return { synthese: texteRequis(s.synthese, "synthese", B.synthese, err) };
    case "swot":
      return donneesSwot(s, err);
    case "vision_mission": {
      const valeurs = liste(s.valeurs, "valeurs", B.valeurs, B.valeur, err);
      return {
        vision: texteRequis(s.vision, "vision", B.visionMission, err),
        mission: texteRequis(s.mission, "mission", B.visionMission, err),
        valeurs: valeurs.length ? valeurs : undefined,
      };
    }
    case "axe":
      return {
        titre: texteRequis(s.titre, "titre", B.titre, err),
        description: texteFacultatif(s.description, "description", B.description, err),
      };
    case "objectif":
      return donneesObjectif(s, err);
    case "initiative":
      return donneesInitiative(s, horizon, devise, err);
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
  ctx: { horizon: number; devise: Devise },
): Resultat<Record<string, unknown>, ChampElement> {
  const err: Erreurs = {};
  const donnees = donneesSelonType(type, s, ctx.horizon, ctx.devise, err);
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
