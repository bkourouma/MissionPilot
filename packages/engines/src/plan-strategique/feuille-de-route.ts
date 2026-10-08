/**
 * Feuille de route du plan stratégique (PLA-05) : dépendances simples entre
 * initiatives et recalage automatique.
 *
 * Règles (fonctions pures, sans horloge : aucune notion de « date du jour ») :
 *
 * - Une dépendance est de type « fin → début » : une initiative ne commence
 *   qu'au lendemain de l'échéance de chacun de ses prédécesseurs.
 * - Une initiative sans date de début est un jalon : elle « commence » à son
 *   échéance (durée nulle).
 * - Seules les initiatives à lancer ou suspendues sont RECALÉES : décalées
 *   vers l'avant (jamais vers l'arrière) du nombre de jours nécessaire, durée
 *   conservée. Une initiative en cours ou terminée garde ses dates : une
 *   contrainte violée y est signalée comme CONFLIT.
 * - Une initiative abandonnée n'est ni recalée ni contraignante ; une
 *   dépendance vers elle, ou vers une initiative absente de la liste
 *   (retirée du plan), est ignorée et signalée.
 * - Une dépendance vers soi-même, en double, ou un cycle de dépendances est
 *   refusé (`ErreurPlan`) : `controlerDependances` sert à l'écriture, où une
 *   dépendance inconnue est aussi refusée.
 * - Chemin critique : chaîne de contraintes liantes (marge nulle ou négative)
 *   qui mène à l'échéance la plus tardive du plan.
 */
import { analyserDateISO, dateISODepuisJourUTC, type DateISO } from "../commun/dates";
import { ErreurPlan } from "./erreurs";

export type StatutInitiativeFeuille =
  "a_lancer" | "en_cours" | "terminee" | "suspendue" | "abandonnee";

/** Statuts dont les dates sont recalées par le moteur. */
export const STATUTS_RECALABLES: readonly StatutInitiativeFeuille[] = ["a_lancer", "suspendue"];

/** Nombre maximal de prédécesseurs d'une initiative (doublé par le schéma partagé et la base). */
export const DEPENDANCES_PAR_INITIATIVE_MAX = 20;

export interface InitiativeFeuilleDeRoute {
  readonly id: string;
  readonly debut: DateISO | null;
  readonly echeance: DateISO;
  readonly statut: StatutInitiativeFeuille;
  /** Identifiants des initiatives qui doivent se terminer avant celle-ci. */
  readonly dependances?: readonly string[];
}

export interface InitiativeRecalee {
  readonly id: string;
  readonly debutPrevu: DateISO | null;
  readonly echeancePrevue: DateISO;
  /** Dates après recalage (identiques aux dates prévues sans décalage). */
  readonly debut: DateISO | null;
  readonly echeance: DateISO;
  /** Jours de décalage appliqués (0 si l'initiative garde ses dates). */
  readonly decalageJours: number;
  readonly recalee: boolean;
  /** Prédécesseur dont l'échéance fixe le début au plus tôt (contrainte liante), sinon null. */
  readonly contraintePar: string | null;
  /** Prédécesseurs qui finissent trop tard pour une initiative en cours ou terminée. */
  readonly conflits: readonly string[];
  /** Dépendances sans effet : initiative absente (retirée) ou abandonnée. */
  readonly dependancesIgnorees: readonly string[];
}

export interface ResultatFeuilleDeRoute {
  /** Initiatives dans l'ordre reçu. */
  readonly initiatives: readonly InitiativeRecalee[];
  /** Ordre de calcul : chaque initiative après ses prédécesseurs (ordre reçu à égalité). */
  readonly ordre: readonly string[];
  /** Échéance recalée la plus tardive (initiatives non abandonnées), null s'il n'y en a pas. */
  readonly fin: DateISO | null;
  /** Initiatives du chemin critique, de la première à celle qui finit le plan. */
  readonly cheminCritique: readonly string[];
  readonly nombreRecalees: number;
  readonly nombreConflits: number;
}

interface Noeud {
  readonly index: number;
  readonly initiative: InitiativeFeuilleDeRoute;
  readonly debutJour: number | null;
  readonly finJour: number;
  readonly dependances: readonly string[];
}

function jour(date: unknown, chemin: string): number {
  const analyse = typeof date === "string" ? analyserDateISO(date) : null;
  if (!analyse?.valide) {
    throw new ErreurPlan("DATE_INVALIDE", `Date invalide (reçu ${String(date)}).`, chemin);
  }
  return analyse.jourUTC;
}

/** Contrôle les identifiants, les dates et la forme des dépendances ; construit les nœuds. */
function noeuds(
  initiatives: readonly InitiativeFeuilleDeRoute[],
  inconnuesPermises: boolean,
): Map<string, Noeud> {
  const parId = new Map<string, Noeud>();
  initiatives.forEach((initiative, index) => {
    const chemin = `initiatives[${index}]`;
    if (typeof initiative.id !== "string" || initiative.id === "" || parId.has(initiative.id)) {
      throw new ErreurPlan(
        "DEPENDANCE_INVALIDE",
        "Identifiant d'initiative absent ou en double.",
        `${chemin}.id`,
      );
    }
    const finJour = jour(initiative.echeance, `${chemin}.echeance`);
    const debutJour = initiative.debut === null ? null : jour(initiative.debut, `${chemin}.debut`);
    if (debutJour !== null && debutJour > finJour) {
      throw new ErreurPlan(
        "DATE_INVALIDE",
        "Le début d'une initiative précède son échéance.",
        `${chemin}.debut`,
      );
    }
    const dependances = initiative.dependances ?? [];
    if (dependances.length > DEPENDANCES_PAR_INITIATIVE_MAX) {
      throw new ErreurPlan(
        "DEPENDANCE_INVALIDE",
        `Au plus ${DEPENDANCES_PAR_INITIATIVE_MAX} dépendances par initiative.`,
        `${chemin}.dependances`,
      );
    }
    if (new Set(dependances).size !== dependances.length) {
      throw new ErreurPlan("DEPENDANCE_INVALIDE", "Dépendance en double.", `${chemin}.dependances`);
    }
    if (dependances.includes(initiative.id)) {
      throw new ErreurPlan(
        "DEPENDANCE_INVALIDE",
        "Une initiative ne dépend pas d'elle-même.",
        `${chemin}.dependances`,
      );
    }
    parId.set(initiative.id, { index, initiative, debutJour, finJour, dependances });
  });
  if (!inconnuesPermises) {
    for (const n of parId.values()) {
      const inconnue = n.dependances.find((d) => !parId.has(d));
      if (inconnue !== undefined) {
        throw new ErreurPlan(
          "DEPENDANCE_INVALIDE",
          `Dépendance vers une initiative inconnue (${inconnue}).`,
          `initiatives[${n.index}].dependances`,
        );
      }
    }
  }
  return parId;
}

/**
 * Ordre topologique (algorithme de Kahn) sur les dépendances connues, ordre
 * reçu à égalité ; `DEPENDANCE_CYCLIQUE` si un cycle subsiste.
 */
function ordonner(parId: ReadonlyMap<string, Noeud>): Noeud[] {
  const restants = new Map<string, number>();
  const successeurs = new Map<string, string[]>();
  for (const n of parId.values()) {
    const connues = n.dependances.filter((d) => parId.has(d));
    restants.set(n.initiative.id, connues.length);
    for (const d of connues) successeurs.set(d, [...(successeurs.get(d) ?? []), n.initiative.id]);
  }
  const prets = [...parId.values()].filter((n) => restants.get(n.initiative.id) === 0);
  const ordre: Noeud[] = [];
  while (prets.length) {
    prets.sort((a, b) => a.index - b.index);
    const n = prets.shift() as Noeud;
    ordre.push(n);
    for (const s of successeurs.get(n.initiative.id) ?? []) {
      const reste = (restants.get(s) as number) - 1;
      restants.set(s, reste);
      if (reste === 0) prets.push(parId.get(s) as Noeud);
    }
  }
  if (ordre.length !== parId.size) {
    const bloquee = [...parId.values()].find((n) => !ordre.includes(n)) as Noeud;
    throw new ErreurPlan(
      "DEPENDANCE_CYCLIQUE",
      "Les dépendances entre initiatives forment un cycle.",
      `initiatives[${bloquee.index}].dependances`,
    );
  }
  return ordre;
}

/**
 * Contrôle d'écriture : identifiants uniques, dates valides, dépendances
 * connues, sans doublon ni boucle sur soi-même, et sans cycle.
 */
export function controlerDependances(initiatives: readonly InitiativeFeuilleDeRoute[]): void {
  ordonner(noeuds(initiatives, false));
}

/** Recalage automatique de la feuille de route (règles en tête de module). */
export function recalerFeuilleDeRoute(
  initiatives: readonly InitiativeFeuilleDeRoute[],
): ResultatFeuilleDeRoute {
  const parId = noeuds(initiatives, true);
  const ordre = ordonner(parId);
  const fins = new Map<string, number>();
  const resultats = new Map<string, InitiativeRecalee>();
  const finsActives: { id: string; fin: number; index: number }[] = [];

  for (const n of ordre) {
    const { initiative: i } = n;
    const abandonnee = i.statut === "abandonnee";
    const ignorees = n.dependances.filter(
      (d) => abandonnee || !parId.has(d) || parId.get(d)?.initiative.statut === "abandonnee",
    );
    const actives = n.dependances.filter((d) => !ignorees.includes(d));
    const debutEffectif = n.debutJour ?? n.finJour;

    // Début au plus tôt imposé par les prédécesseurs : lendemain de la fin la plus tardive.
    let besoin: number | null = null;
    let contraintePar: string | null = null;
    for (const d of actives) {
      const lendemain = (fins.get(d) as number) + 1;
      if (besoin === null || lendemain > besoin) {
        besoin = lendemain;
        contraintePar = d;
      }
    }
    if (besoin === null || besoin < debutEffectif) contraintePar = null;

    const recalable = STATUTS_RECALABLES.includes(i.statut);
    const decalage =
      recalable && besoin !== null && besoin > debutEffectif ? besoin - debutEffectif : 0;
    const conflits = recalable
      ? []
      : actives.filter((d) => (fins.get(d) as number) + 1 > debutEffectif);
    const fin = n.finJour + decalage;
    fins.set(i.id, fin);
    if (!abandonnee) finsActives.push({ id: i.id, fin, index: n.index });

    resultats.set(i.id, {
      id: i.id,
      debutPrevu: i.debut,
      echeancePrevue: i.echeance,
      debut: n.debutJour === null ? null : dateISODepuisJourUTC(n.debutJour + decalage),
      echeance: dateISODepuisJourUTC(fin),
      decalageJours: decalage,
      recalee: decalage > 0,
      contraintePar,
      conflits,
      dependancesIgnorees: ignorees,
    });
  }

  const derniere = finsActives.reduce<(typeof finsActives)[number] | null>(
    (m, f) => (m === null || f.fin > m.fin || (f.fin === m.fin && f.index < m.index) ? f : m),
    null,
  );
  const cheminCritique: string[] = [];
  for (let id = derniere?.id ?? null; id !== null; id = resultats.get(id)?.contraintePar ?? null) {
    cheminCritique.unshift(id);
  }
  const liste = initiatives.map((i) => resultats.get(i.id) as InitiativeRecalee);
  return {
    initiatives: liste,
    ordre: ordre.map((n) => n.initiative.id),
    fin: derniere ? dateISODepuisJourUTC(derniere.fin) : null,
    cheminCritique,
    nombreRecalees: liste.filter((r) => r.recalee).length,
    nombreConflits: liste.filter((r) => r.conflits.length > 0).length,
  };
}
