import { ajouterJours } from "@missionpilot/engines";
import { AUJOURDHUI, DEBUT_ACTIVITE, GRAINE_TENANT_DEMO } from "./constantes.js";

/*
 * Horloge fictive et générateur pseudo-aléatoire À GRAINE FIXE du seed « Tenant démo ».
 * Aucune fonction ne lit l'heure réelle : deux exécutions produisent les mêmes dates et les
 * mêmes tirages. Dates au format ISO `AAAA-MM-JJ` (chaînes, comme partout dans l'API).
 */

/** `AUJOURDHUI` décalé de `offset` jours (négatif = passé) : `jour(-30)`, `jour(14)`. */
export const jour = (offset: number): string => ajouterJours(AUJOURDHUI, offset);

/** Date située `n` jours AVANT aujourd'hui (`dateAvant(7)` = il y a une semaine). */
export const dateAvant = (n: number): string => jour(-n);

/** Date située `n` jours APRÈS aujourd'hui. */
export const dateApres = (n: number): string => jour(n);

/** Date située `n` jours après le DÉBUT de l'activité (2024-10-01). */
export const depuisDebut = (n: number): string => ajouterJours(DEBUT_ACTIVITE, n);

/** Nombre de jours calendaires entre deux dates ISO (fin − début). */
export function ecartJours(debut: string, fin: string): number {
  return Math.round(
    (Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / 86_400_000,
  );
}

/** Lundi de la semaine de `date`. */
export function lundiDe(date: string): string {
  const j = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = dimanche
  return ajouterJours(date, -((j + 6) % 7));
}

/** Vrai pour un samedi ou un dimanche. */
export function estWeekEnd(date: string): boolean {
  const j = new Date(`${date}T00:00:00Z`).getUTCDay();
  return j === 0 || j === 6;
}

/** Lundis de la période [debut ; fin] (bornes comprises), dans l'ordre chronologique. */
export function lundisEntre(debut: string, fin: string): string[] {
  const lundis: string[] = [];
  for (let l = lundiDe(debut); l <= fin; l = ajouterJours(l, 7)) {
    if (l >= debut) lundis.push(l);
  }
  return lundis;
}

/** Premier jour du mois (`AAAA-MM-01`) de `date`. */
export const debutDeMois = (date: string): string => `${date.slice(0, 7)}-01`;

/* ----- Générateur pseudo-aléatoire à graine (mulberry32) ----- */

export interface Alea {
  /** Flottant dans [0 ; 1). */
  suivant(): number;
  /** Entier dans [min ; max] (bornes comprises). */
  entier(min: number, max: number): number;
  /** Vrai avec la probabilité `p` (0 à 1). */
  proba(p: number): boolean;
  /** Un élément du tableau (non vide). */
  choisir<T>(elements: readonly T[]): T;
  /** Copie mélangée (Fisher-Yates). */
  melanger<T>(elements: readonly T[]): T[];
  /** Flux INDÉPENDANT dérivé de celui-ci et d'un nom stable : `alea.deriver("missions")`. */
  deriver(nom: string): Alea;
}

function hacherTexte(texte: string): number {
  let h = 2166136261;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Générateur déterministe : même graine, même suite. */
export function creerAlea(graine: number): Alea {
  let etat = graine >>> 0;
  const suivant = (): number => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    suivant,
    entier: (min, max) => min + Math.floor(suivant() * (max - min + 1)),
    proba: (p) => suivant() < p,
    choisir: <T>(elements: readonly T[]): T =>
      elements[Math.floor(suivant() * elements.length)] as T,
    melanger: <T>(elements: readonly T[]): T[] => {
      const copie = [...elements];
      for (let i = copie.length - 1; i > 0; i--) {
        const j = Math.floor(suivant() * (i + 1));
        [copie[i], copie[j]] = [copie[j] as T, copie[i] as T];
      }
      return copie;
    },
    deriver: (nom) => creerAlea((graine ^ hacherTexte(nom)) >>> 0),
  };
}

/** Flux racine du seed (graine fixe) : les phases en dérivent le leur avec `deriver(nom)`. */
export const aleaRacine = (): Alea => creerAlea(GRAINE_TENANT_DEMO);
