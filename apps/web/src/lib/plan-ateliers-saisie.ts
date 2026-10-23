/** Ateliers stratégiques (PLA-15) : saisie et contrôle d'un atelier et des contributions (vote, classement, matrice). */
import {
  METHODES_ATELIER,
  OPTIONS_ATELIER_MAX,
  OPTIONS_ATELIER_MIN,
  type MethodeAtelier,
} from "@missionpilot/shared";
import type { AtelierDetail, MaContribution } from "./plan-ateliers-types";
import { lireNombre } from "./saisie";

/* ----- Saisie d'un atelier ----- */

export interface SaisieOptionAtelier {
  libelle: string;
  description: string;
}

export interface SaisieAtelier {
  titre: string;
  consigne: string;
  methodes: MethodeAtelier[];
  budget_points: string;
  plafond_par_option: string;
  axe_x_libelle: string;
  axe_x_inverse: boolean;
  axe_y_libelle: string;
  axe_y_inverse: boolean;
  options: SaisieOptionAtelier[];
}

export type ChampAtelier =
  | "titre"
  | "consigne"
  | "methodes"
  | "budget_points"
  | "plafond_par_option"
  | "axe_x_libelle"
  | "axe_y_libelle"
  | "options";

export function saisieAtelierVide(): SaisieAtelier {
  return {
    titre: "",
    consigne: "",
    methodes: ["vote"],
    budget_points: "10",
    plafond_par_option: "",
    axe_x_libelle: "Valeur / impact",
    axe_x_inverse: false,
    axe_y_libelle: "Effort",
    axe_y_inverse: true,
    options: [
      { libelle: "", description: "" },
      { libelle: "", description: "" },
    ],
  };
}

export function saisieDepuisAtelier(a: AtelierDetail): SaisieAtelier {
  return {
    titre: a.titre,
    consigne: a.consigne,
    methodes: [...a.methodes],
    budget_points: String(a.budget_points),
    plafond_par_option: a.plafond_par_option === null ? "" : String(a.plafond_par_option),
    axe_x_libelle: a.axes.x.libelle,
    axe_x_inverse: a.axes.x.inverse,
    axe_y_libelle: a.axes.y.libelle,
    axe_y_inverse: a.axes.y.inverse,
    options: a.options.map((o) => ({ libelle: o.libelle, description: o.description ?? "" })),
  };
}

const CONTROLE = /\p{Cc}/u;

function entierBorne(v: string, min: number, max: number): number | null {
  const n = lireNombre(v);
  return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function validerAtelier(s: SaisieAtelier) {
  const erreurs: Partial<Record<ChampAtelier, string>> = {};
  const titre = s.titre.trim();
  if (titre === "" || titre.length > 200 || CONTROLE.test(titre)) {
    erreurs.titre = "Titre obligatoire, 200 caractères au plus.";
  }
  if (s.consigne.trim().length > 4000) erreurs.consigne = "4 000 caractères au plus.";
  if (s.methodes.length === 0) erreurs.methodes = "Choisissez au moins une méthode.";
  const budget = entierBorne(s.budget_points, 1, 100);
  if (budget === null) erreurs.budget_points = "Entier de 1 à 100.";
  let plafond: number | null = null;
  if (s.plafond_par_option.trim() !== "") {
    plafond = entierBorne(s.plafond_par_option, 1, 100);
    if (plafond === null || (budget !== null && plafond > budget)) {
      erreurs.plafond_par_option = "Entier de 1 au budget de points.";
    }
  }
  for (const [cle, v] of [
    ["axe_x_libelle", s.axe_x_libelle],
    ["axe_y_libelle", s.axe_y_libelle],
  ] as const) {
    if (v.trim() === "" || v.trim().length > 60 || CONTROLE.test(v)) {
      erreurs[cle] = "Libellé obligatoire, 60 caractères au plus.";
    }
  }
  const options = s.options.map((o) => ({
    libelle: o.libelle.trim(),
    description: o.description.trim(),
  }));
  if (
    options.length < OPTIONS_ATELIER_MIN ||
    options.length > OPTIONS_ATELIER_MAX ||
    options.some(
      (o) =>
        o.libelle === "" ||
        o.libelle.length > 200 ||
        o.description.length > 500 ||
        CONTROLE.test(o.libelle),
    )
  ) {
    erreurs.options = `De ${OPTIONS_ATELIER_MIN} à ${OPTIONS_ATELIER_MAX} options, chacune avec un libellé (200 caractères au plus) et une description facultative (500 au plus).`;
  }
  if (Object.keys(erreurs).length) return { erreurs, corps: null };
  return {
    erreurs,
    corps: {
      titre,
      consigne: s.consigne.trim(),
      methodes: METHODES_ATELIER.filter((m) => s.methodes.includes(m)),
      budget_points: budget,
      plafond_par_option: plafond,
      axes: {
        x: { libelle: s.axe_x_libelle.trim(), inverse: s.axe_x_inverse },
        y: { libelle: s.axe_y_libelle.trim(), inverse: s.axe_y_inverse },
      },
      options: options.map((o) => ({
        libelle: o.libelle,
        ...(o.description === "" ? {} : { description: o.description }),
      })),
    },
  };
}

/* ----- Saisie d'une contribution ----- */

/** Points saisis par option (texte). */
export type SaisieVote = Record<string, string>;

export function saisieVote(
  options: readonly { id: string }[],
  existante?: MaContribution,
): SaisieVote {
  const connus = new Map((existante?.points ?? []).map((p) => [p.option_id, String(p.points)]));
  return Object.fromEntries(options.map((o) => [o.id, connus.get(o.id) ?? ""]));
}

/** Total des points déjà répartis (aide à la saisie ; le contrôle reste celui de l'API et du moteur). */
export function pointsRepartis(s: SaisieVote): number {
  return Object.values(s).reduce((somme, v) => {
    const n = entierBorne(v, 0, 100);
    return somme + (n ?? 0);
  }, 0);
}

export function validerVote(s: SaisieVote, budget: number, plafond: number | null) {
  const erreurs: Record<string, string> = {};
  const points: { option_id: string; points: number }[] = [];
  for (const [id, v] of Object.entries(s)) {
    if (v.trim() === "") continue;
    const n = entierBorne(v, 0, 100);
    if (n === null) erreurs[id] = "Entier de 0 à 100.";
    else if (plafond !== null && n > plafond)
      erreurs[id] = `${plafond} points au plus sur une option.`;
    else points.push({ option_id: id, points: n });
  }
  const somme = points.reduce((t, p) => t + p.points, 0);
  let global: string | null = null;
  if (somme > budget) global = `Vous répartissez ${somme} points ; le budget est de ${budget}.`;
  else if (somme === 0 && Object.keys(erreurs).length === 0)
    global = "Répartissez au moins un point.";
  if (Object.keys(erreurs).length || global) return { erreurs, global, corps: null };
  return { erreurs, global, corps: { points: points.filter((p) => p.points > 0) } };
}

/** Ordre initial d'un classement : le sien, complété des options non classées. */
export function ordreInitial(
  options: readonly { id: string }[],
  existante?: MaContribution,
): string[] {
  const classes = (existante?.classement ?? []).filter((id) => options.some((o) => o.id === id));
  return [...classes, ...options.map((o) => o.id).filter((id) => !classes.includes(id))];
}

/** Déplace l'élément `index` de `delta` rangs (borné). */
export function deplacer(ordre: readonly string[], index: number, delta: number): string[] {
  const cible = index + delta;
  if (index < 0 || index >= ordre.length || cible < 0 || cible >= ordre.length) return [...ordre];
  const copie = [...ordre];
  const [x] = copie.splice(index, 1);
  copie.splice(cible, 0, x as string);
  return copie;
}

export function validerClassement(ordre: readonly string[]) {
  if (ordre.length === 0) return { corps: null, global: "Classez au moins une option." };
  return { corps: { classement: [...ordre] }, global: null };
}

export type SaisieMatrice = Record<string, { x: string; y: string }>;

export function saisieMatrice(
  options: readonly { id: string }[],
  existante?: MaContribution,
): SaisieMatrice {
  const connues = new Map((existante?.positions ?? []).map((p) => [p.option_id, p]));
  return Object.fromEntries(
    options.map((o) => {
      const p = connues.get(o.id);
      return [o.id, { x: p ? String(p.x) : "", y: p ? String(p.y) : "" }];
    }),
  );
}

export const OPTIONS_NOTE_MATRICE = ["1", "2", "3", "4", "5"].map((v) => ({
  valeur: v,
  libelle: v,
}));

export function validerMatrice(s: SaisieMatrice) {
  const erreurs: Record<string, string> = {};
  const positions: { option_id: string; x: number; y: number }[] = [];
  for (const [id, p] of Object.entries(s)) {
    if (p.x === "" && p.y === "") continue;
    const x = /^[1-5]$/.test(p.x) ? Number(p.x) : null;
    const y = /^[1-5]$/.test(p.y) ? Number(p.y) : null;
    if (x === null || y === null) erreurs[id] = "Les deux notes, de 1 à 5.";
    else positions.push({ option_id: id, x, y });
  }
  let global: string | null = null;
  if (positions.length === 0 && Object.keys(erreurs).length === 0) {
    global = "Placez au moins une option.";
  }
  if (Object.keys(erreurs).length || global) return { erreurs, global, corps: null };
  return { erreurs, global, corps: { positions } };
}
