/** Catalogue des types de mission (MIS-01, MIS-02) : logique pure, testée dans `catalogue.test.ts`. */
import {
  creerTraduire,
  MODES_FACTURATION,
  type Langue,
  type ModeFacturation,
} from "@missionpilot/shared";
import { lireNombre, texteOuNull, type Resultat } from "./saisie";

export interface MembreEquipe {
  grade_code: string;
  nombre: number;
}

export interface TypeMission {
  id: string;
  code: string;
  libelle: string;
  domaine: string | null;
  mode_facturation: ModeFacturation;
  duree_type_jours: number | null;
  equipe_type: MembreEquipe[];
  actif: boolean;
  a_valider: boolean;
}

export interface ElementModele {
  id: string;
  type_mission_id: string;
  parent_id: string | null;
  niveau: number;
  libelle: string;
  ordre: number;
  jours_par_grade: Record<string, number>;
  est_livrable: boolean;
  est_jalon: boolean;
}

export interface TypeMissionDetaille extends TypeMission {
  elements: ElementModele[];
}

export const MODE_LIBELLES: Record<ModeFacturation, string> = {
  forfait: "Forfait",
  regie: "Régie (temps passé)",
  forfait_variable: "Forfait avec part variable",
  abonnement: "Abonnement",
};

export const MODE_LIBELLES_EN: Record<ModeFacturation, string> = {
  forfait: "Fixed fee",
  regie: "Time and materials",
  forfait_variable: "Fixed fee with variable part",
  abonnement: "Subscription",
};

export const libelleMode = (m: ModeFacturation, langue: Langue = "fr") =>
  (langue === "en" ? MODE_LIBELLES_EN : MODE_LIBELLES)[m];

export const OPTIONS_MODES = MODES_FACTURATION.map((m) => ({
  valeur: m,
  libelle: MODE_LIBELLES[m],
}));

export const optionsModes = (langue: Langue = "fr") =>
  MODES_FACTURATION.map((m) => ({ valeur: m, libelle: libelleMode(m, langue) }));

export const NIVEAU_LIBELLES: Record<number, string> = { 1: "Phase", 2: "Lot", 3: "Tâche" };
export const NIVEAU_LIBELLES_EN: Record<number, string> = {
  1: "Phase",
  2: "Work package",
  3: "Task",
};
export const libelleNiveau = (n: number, langue: Langue = "fr") =>
  langue === "en" ? (NIVEAU_LIBELLES_EN[n] ?? "Item") : (NIVEAU_LIBELLES[n] ?? "Élément");
/** Enfant qu'on peut ajouter sous un élément de ce niveau, avec son article (null : aucun). */
export function libelleEnfant(n: number, langue: Langue = "fr"): string | null {
  const t = creerTraduire(langue);
  if (n === 1) return t("un lot", "a work package");
  if (n === 2) return t("une tâche", "a task");
  return null;
}

export interface NoeudArbre extends ElementModele {
  enfants: NoeudArbre[];
}

/**
 * Arbre phases > lots > tâches à partir de la liste à plat renvoyée par l'API (déjà dans
 * l'ordre de lecture). Un élément dont le parent est absent est rattaché à la racine.
 */
export function construireArbre(elements: readonly ElementModele[]): NoeudArbre[] {
  const noeuds = new Map<string, NoeudArbre>();
  for (const e of elements) noeuds.set(e.id, { ...e, enfants: [] });
  const racines: NoeudArbre[] = [];
  for (const e of elements) {
    const noeud = noeuds.get(e.id)!;
    const parent = e.parent_id ? noeuds.get(e.parent_id) : undefined;
    if (parent) parent.enfants.push(noeud);
    else racines.push(noeud);
  }
  return racines;
}

/** Jours types d'un élément, dans l'ordre des grades connus, sans les valeurs nulles. */
export function joursAffiches(
  jours: Record<string, number>,
  grades: readonly { code: string; libelle: string }[],
): { code: string; libelle: string; jours: number }[] {
  const connus = grades
    .filter((g) => (jours[g.code] ?? 0) > 0)
    .map((g) => ({ code: g.code, libelle: g.libelle, jours: jours[g.code]! }));
  const inconnus = Object.entries(jours)
    .filter(([code, j]) => j > 0 && !grades.some((g) => g.code === code))
    .map(([code, j]) => ({ code, libelle: code, jours: j }));
  return [...connus, ...inconnus];
}

// --- Formulaire type de mission -----------------------------------------------------

export interface SaisieTypeMission {
  code: string;
  libelle: string;
  domaine: string;
  mode_facturation: string;
  duree_type_jours: string;
  /** Nombre de collaborateurs par code de grade (texte saisi). */
  equipe: Record<string, string>;
  actif: boolean;
}

export type ChampTypeMission = Exclude<keyof SaisieTypeMission, "equipe"> | `equipe.${string}`;

export function saisieDepuisType(t: TypeMission): SaisieTypeMission {
  return {
    code: t.code,
    libelle: t.libelle,
    domaine: t.domaine ?? "",
    mode_facturation: t.mode_facturation,
    duree_type_jours: t.duree_type_jours === null ? "" : String(t.duree_type_jours),
    equipe: Object.fromEntries(t.equipe_type.map((m) => [m.grade_code, String(m.nombre)])),
    actif: t.actif,
  };
}

export const SAISIE_TYPE_VIDE: SaisieTypeMission = {
  code: "",
  libelle: "",
  domaine: "",
  mode_facturation: "forfait",
  duree_type_jours: "",
  equipe: {},
  actif: true,
};

export interface ChargeTypeMission {
  code: string;
  libelle: string;
  domaine: string | null;
  mode_facturation: ModeFacturation;
  duree_type_jours: number | null;
  equipe_type: MembreEquipe[];
  actif: boolean;
}

const CODE = /^[a-z0-9_]{1,40}$/;

export function validerTypeMission(
  s: SaisieTypeMission,
  langue: Langue = "fr",
): Resultat<ChargeTypeMission, ChampTypeMission> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampTypeMission, string>> = {};
  const code = s.code.trim();
  if (!CODE.test(code))
    erreurs.code = t(
      "Code : minuscules, chiffres et tiret bas, 40 caractères au plus (ex. plan_strategique).",
      "Code: lowercase letters, digits and underscores, 40 characters at most (e.g. strategic_plan).",
    );
  const libelle = s.libelle.trim();
  if (libelle === "")
    erreurs.libelle = t(
      "Saisissez le libellé du type de mission.",
      "Enter the engagement type label.",
    );
  else if (libelle.length > 160)
    erreurs.libelle = t("160 caractères au plus.", "160 characters at most.");
  if (s.domaine.trim().length > 120)
    erreurs.domaine = t("120 caractères au plus.", "120 characters at most.");
  if (!(MODES_FACTURATION as readonly string[]).includes(s.mode_facturation))
    erreurs.mode_facturation = t("Choisissez un mode de facturation.", "Choose a billing mode.");
  const duree = lireNombre(s.duree_type_jours);
  if (
    duree !== null &&
    (Number.isNaN(duree) || !Number.isInteger(duree) || duree < 1 || duree > 3650)
  )
    erreurs.duree_type_jours = t(
      "Nombre entier de jours entre 1 et 3650, ou laisser vide.",
      "Whole number of days between 1 and 3650, or leave empty.",
    );
  const equipe: MembreEquipe[] = [];
  for (const [grade, texte] of Object.entries(s.equipe)) {
    const n = lireNombre(texte);
    if (n === null || n === 0) continue;
    if (Number.isNaN(n) || !Number.isInteger(n) || n < 0 || n > 50)
      erreurs[`equipe.${grade}`] = t(
        "Nombre entier entre 0 et 50.",
        "Whole number between 0 and 50.",
      );
    else equipe.push({ grade_code: grade, nombre: n });
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      code,
      libelle,
      domaine: texteOuNull(s.domaine),
      mode_facturation: s.mode_facturation as ModeFacturation,
      duree_type_jours: duree,
      equipe_type: equipe,
      actif: s.actif,
    },
  };
}

/** Code et libellé proposés pour une copie : « audit_copie », « Audit (copie) ». */
export function propositionDuplication(
  t: Pick<TypeMission, "code" | "libelle">,
  langue: Langue = "fr",
) {
  const suffixe = langue === "en" ? "_copy" : "_copie";
  return {
    code: `${t.code.slice(0, 40 - suffixe.length)}${suffixe}`,
    libelle: `${t.libelle} (${langue === "en" ? "copy" : "copie"})`.slice(0, 160),
  };
}

// --- Formulaire élément du modèle ------------------------------------------------------

export interface SaisieElement {
  libelle: string;
  ordre: string;
  jours: Record<string, string>;
  est_livrable: boolean;
  est_jalon: boolean;
}

export type ChampElement = "libelle" | "ordre" | `jours.${string}`;

export function saisieDepuisElement(e: ElementModele): SaisieElement {
  return {
    libelle: e.libelle,
    ordre: String(e.ordre),
    jours: Object.fromEntries(
      Object.entries(e.jours_par_grade).map(([g, j]) => [g, String(j).replace(".", ",")]),
    ),
    est_livrable: e.est_livrable,
    est_jalon: e.est_jalon,
  };
}

export const SAISIE_ELEMENT_VIDE: SaisieElement = {
  libelle: "",
  ordre: "0",
  jours: {},
  est_livrable: false,
  est_jalon: false,
};

export interface ChargeElement {
  libelle: string;
  ordre: number;
  jours_par_grade: Record<string, number>;
  est_livrable: boolean;
  est_jalon: boolean;
}

export function validerElement(
  s: SaisieElement,
  langue: Langue = "fr",
): Resultat<ChargeElement, ChampElement> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampElement, string>> = {};
  const libelle = s.libelle.trim();
  if (libelle === "") erreurs.libelle = t("Saisissez un libellé.", "Enter a label.");
  else if (libelle.length > 200)
    erreurs.libelle = t("200 caractères au plus.", "200 characters at most.");
  const ordre = lireNombre(s.ordre);
  if (
    ordre === null ||
    Number.isNaN(ordre) ||
    !Number.isInteger(ordre) ||
    ordre < 0 ||
    ordre > 10000
  )
    erreurs.ordre = t("Nombre entier entre 0 et 10 000.", "Whole number between 0 and 10,000.");
  const jours: Record<string, number> = {};
  for (const [grade, texte] of Object.entries(s.jours)) {
    const n = lireNombre(texte);
    if (n === null) continue;
    if (Number.isNaN(n) || n < 0 || n > 1000 || !Number.isInteger(n * 2))
      erreurs[`jours.${grade}`] = t(
        "Jours au pas de 0,5 (ex. 2 ou 2,5), entre 0 et 1000.",
        "Days in steps of 0.5 (e.g. 2 or 2.5), between 0 and 1000.",
      );
    else if (n > 0) jours[grade] = n;
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      libelle,
      ordre: ordre as number,
      jours_par_grade: jours,
      est_livrable: s.est_livrable,
      est_jalon: s.est_jalon,
    },
  };
}
