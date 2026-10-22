/** Notation augmentée : chemins, paramètres d'URL et libellés de l'analyse (voir `notation-augmentee.ts`). */
import type {
  NiveauConfiance,
  ConstatPerception,
  SourceImpact,
  SimulationPassage,
  CombinaisonsNotation,
  EtapeCombinaison,
} from "./notation-augmentee-types";
import { aPermission, type Role } from "@missionpilot/shared";
import { type Classe, type TonaliteNotation } from "./notation";
import { type Resultat } from "./saisie";

const segment = encodeURIComponent;

/* ----- Chemins ----- */

export const cheminConfiance = (notationId: string, numero: number) =>
  `/api/notations/${segment(notationId)}/confiance?version=${numero}`;
export const cheminConstats = (notationId: string, numero: number) =>
  `/api/notations/${segment(notationId)}/constats?version=${numero}`;
export const cheminExplication = (notationId: string, numero: number, cible: Classe | null) =>
  `/api/notations/${segment(notationId)}/explication?version=${numero}${cible ? `&cible=${cible}` : ""}`;
export const cheminCommentaireExplication = (notationId: string, numero: number) =>
  `/api/notations/${segment(notationId)}/explication/commentaire?version=${numero}`;
export const cheminPropositionPlan = (notationId: string, numero: number, capacite: number) =>
  `/api/notations/${segment(notationId)}/plan-action/proposition?version=${numero}&capacite=${capacite}`;
export const cheminPlansAction = (notationId: string) =>
  `/api/notations/${segment(notationId)}/plans-action`;
export const cheminBanque = (curseur: string, statut: "brouillon" | "valide" | null) => {
  const q = new URLSearchParams({ limite: "50" });
  if (curseur) q.set("curseur", curseur);
  if (statut) q.set("statut", statut);
  return `/api/notation/banque?${q.toString()}`;
};
export const cheminCalibrations = (curseur: string) =>
  `/api/notation/calibrations?limite=50${curseur ? `&curseur=${segment(curseur)}` : ""}`;
export const hrefAnalyseNotation = (missionId: string, numero?: number | null) =>
  `/missions/${segment(missionId)}/notation/analyse${numero ? `?version=${numero}` : ""}`;

/* ----- Paramètres d'URL ----- */

const premier = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Classe visée du simulateur (A à D), sinon null (l'API vise la classe supérieure). */
export function lireCible(v: string | string[] | undefined): Classe | null {
  const x = premier(v);
  return x === "A" || x === "B" || x === "C" || x === "D" ? x : null;
}

export const CAPACITE_DEFAUT = 10;

/** Capacité du client (somme d'efforts, 1 à 100), sinon la valeur par défaut. */
export function lireCapacite(v: string | string[] | undefined): number {
  const x = Number(premier(v));
  return Number.isInteger(x) && x >= 1 && x <= 100 ? x : CAPACITE_DEFAUT;
}

/** Statut de filtre de la banque. */
export function lireStatutBanque(v: string | string[] | undefined): "brouillon" | "valide" | null {
  const x = premier(v);
  return x === "brouillon" || x === "valide" ? x : null;
}

/** Saisie de la capacité avant l'enregistrement d'un plan. */
export function validerCapacite(saisie: string): Resultat<{ capacite: number }, "capacite"> {
  const x = Number(saisie.trim());
  if (saisie.trim() === "" || !Number.isInteger(x) || x < 1 || x > 100) {
    return { ok: false, erreurs: { capacite: "Entier de 1 à 100 attendu." } };
  }
  return { ok: true, charge: { capacite: x } };
}

/* ----- Libellés et présentation ----- */

export const NIVEAUX_CONFIANCE: Record<
  NiveauConfiance,
  { libelle: string; tonalite: TonaliteNotation }
> = {
  elevee: { libelle: "Confiance élevée", tonalite: "succes" },
  suffisante: { libelle: "Confiance suffisante", tonalite: "attention" },
  insuffisante: { libelle: "Confiance insuffisante : publication impossible", tonalite: "danger" },
};

export const GRAVITES_CONSTAT: Record<
  ConstatPerception["gravite"],
  { libelle: string; tonalite: TonaliteNotation }
> = {
  majeur: { libelle: "Écart majeur", tonalite: "danger" },
  notable: { libelle: "Écart notable", tonalite: "attention" },
};

export const SOURCES_IMPACT: Record<SourceImpact, string> = {
  contexte_semblable: "Contextes semblables (secteur et taille)",
  secteur: "Même secteur",
  taille: "Même taille",
  general: "Tous contextes",
  aucun: "Aucune observation",
};

/** Ratio 0-1 affiché en pour-cent entier (« 81 % »). */
export function formaterRatio(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)} %`;
}

/**
 * Points signés au centième, en français (« +3,50 », « −1,20 », « 0,00 ») : arrondi d'abord, signe
 * ensuite (un écart de −0,004 s'affiche « 0,00 », jamais « −0,00 »).
 */
export function formaterPointsSignes(v: number): string {
  const centiemes = Math.round(Math.abs(v) * 100);
  const absolu = (centiemes / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (centiemes === 0) return absolu;
  return v > 0 ? `+${absolu}` : `−${absolu}`;
}

/** Phrase de synthèse du simulateur. */
export function phraseSimulation(s: SimulationPassage): string {
  if (s.deja_atteinte) return `La classe ${s.cible} est déjà atteinte.`;
  if (s.tronquee) {
    return `La simulation a été interrompue (trop de paliers à relever) avant la classe ${s.cible} : score projeté ${s.score_projete.toLocaleString("fr-FR")}, résultat partiel.`;
  }
  if (!s.atteignable) {
    return `La classe ${s.cible} n'est pas atteignable en relevant les seules pratiques répondues : score projeté ${s.score_projete.toLocaleString("fr-FR")}.`;
  }
  const n = s.etapes.length;
  return `Pour passer de ${s.classe_actuelle} à ${s.cible} (seuil ${s.seuil}), relever ${n} pratique${n > 1 ? "s" : ""} : score projeté ${s.score_projete.toLocaleString("fr-FR")} (classe ${s.classe_projetee}).`;
}

/** Avertissement quand la recherche de combinaisons a été interrompue par une borne. */
export const AVERTISSEMENT_RECHERCHE_TRONQUEE =
  "La recherche a été interrompue par une limite de calcul : la liste des combinaisons est " +
  "partielle et ne prouve pas qu'il n'en existe pas d'autre.";

/** Phrase de synthèse des combinaisons minimales ; jamais « impossible » quand la recherche est tronquée. */
export function phraseCombinaisons(c: CombinaisonsNotation): string {
  if (c.deja_atteinte) return `La classe ${c.cible} est déjà atteinte.`;
  if (c.atteignable && c.nombre_minimal_pratiques !== null) {
    const n = c.nombre_minimal_pratiques;
    return `Il suffit d'améliorer ${n} pratique${n > 1 ? "s" : ""} pour passer de ${c.classe_actuelle} à ${c.cible} (seuil ${c.seuil.toLocaleString("fr-FR")}, ${c.gain_necessaire.toLocaleString("fr-FR")} point${c.gain_necessaire >= 2 ? "s" : ""} à gagner).`;
  }
  if (c.tronquee) {
    return `Aucune combinaison n'a été trouvée vers la classe ${c.cible} dans les limites de la recherche : cela ne prouve pas que c'est impossible.`;
  }
  return `Aucune combinaison de pratiques déjà répondues ne permet d'atteindre la classe ${c.cible}.`;
}

/** Ligne d'une pratique d'une combinaison : « Question » : de 50 à 100 points (+1,33 sur la note). */
export function libelleEtapeCombinaison(x: EtapeCombinaison): string {
  const nombre = (v: number) => v.toLocaleString("fr-FR");
  return `« ${x.question} » : de ${nombre(x.points_avant)} à ${nombre(x.points_apres)} points (${formaterPointsSignes(x.gain)} sur la note)`;
}

/** Génération d'un commentaire IA : `notation.gerer` ET `ia.utiliser`, mission non clôturée. */
export function peutGenererCommentaire(roles: readonly Role[], missionCloturee: boolean): boolean {
  return (
    !missionCloturee && aPermission(roles, "notation.gerer") && aPermission(roles, "ia.utiliser")
  );
}
