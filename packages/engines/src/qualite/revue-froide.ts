/**
 * Revue à froid d'une mission clôturée (QUA-05) : note de revue, indépendance
 * du relecteur et suivi du plan d'amélioration. Fonctions pures : la date du
 * jour est fournie par l'appelant, jamais lue ici.
 */
import { ErreurQualite } from "./erreurs";

export interface CritereGrille {
  code: string;
  poids: number;
}

/** `note` de 1 à 5 ; `null` = sans objet. */
export interface EvaluationCritere {
  critere: string;
  note: number | null;
}

export type GraviteConstat = "mineur" | "majeur" | "critique";
export type ConclusionRevue = "conforme" | "reserves" | "non_conforme";

/** Seuils PROVISOIRES (score sur 100), à faire valider. */
export const SEUILS_REVUE_FROIDE = { conforme: 75, reserves: 50 } as const;

export interface ResultatRevueFroide {
  complete: boolean;
  manquants: string[];
  score: number | null;
  couverture: number;
  conclusion: ConclusionRevue | null;
  motifs: string[];
}

const arrondir = (x: number, decimales: number): number => {
  const f = 10 ** decimales;
  return Math.round(x * f) / f;
};

export function calculerRevueFroide(
  grille: readonly CritereGrille[],
  evaluations: readonly EvaluationCritere[],
  constats: readonly { gravite: GraviteConstat }[],
): ResultatRevueFroide {
  if (grille.length === 0) {
    throw new ErreurQualite("OPTIONS_INVALIDES", "La grille de revue ne contient aucun critère.");
  }
  const poids = new Map<string, number>();
  for (const c of grille) {
    if (!Number.isFinite(c.poids) || c.poids <= 0) {
      throw new ErreurQualite(
        "OPTIONS_INVALIDES",
        `Le poids du critère « ${c.code} » doit être strictement positif.`,
      );
    }
    if (poids.has(c.code)) {
      throw new ErreurQualite(
        "OPTIONS_INVALIDES",
        `Le critère « ${c.code} » apparaît deux fois dans la grille.`,
      );
    }
    poids.set(c.code, c.poids);
  }
  const evalues = new Map<string, number | null>();
  for (const e of evaluations) {
    if (!poids.has(e.critere)) {
      throw new ErreurQualite(
        "OPTIONS_INVALIDES",
        `Critère « ${e.critere} » inconnu de la grille.`,
      );
    }
    if (evalues.has(e.critere)) {
      throw new ErreurQualite(
        "OPTIONS_INVALIDES",
        `Le critère « ${e.critere} » est évalué deux fois.`,
      );
    }
    if (e.note !== null && (!Number.isInteger(e.note) || e.note < 1 || e.note > 5)) {
      throw new ErreurQualite(
        "OPTIONS_INVALIDES",
        `La note du critère « ${e.critere} » doit être un entier de 1 à 5.`,
      );
    }
    evalues.set(e.critere, e.note);
  }

  const manquants = grille.filter((c) => !evalues.has(c.code)).map((c) => c.code);
  const poidsTotal = grille.reduce((s, c) => s + c.poids, 0);
  let poidsNotes = 0;
  let somme = 0;
  for (const c of grille) {
    const note = evalues.get(c.code);
    if (note === undefined || note === null) continue;
    poidsNotes += c.poids;
    somme += (c.poids * (note - 1)) / 4;
  }
  const score = poidsNotes > 0 ? arrondir((100 * somme) / poidsNotes, 1) : null;
  const couverture = arrondir(poidsNotes / poidsTotal, 2);
  const complete = manquants.length === 0;
  const motifs: string[] = [];

  if (!complete) {
    motifs.push(
      `Revue incomplète : ${manquants.length} critère(s) sans évaluation (${manquants.join(", ")}).`,
    );
    return { complete, manquants, score, couverture, conclusion: null, motifs };
  }
  if (score === null) {
    motifs.push("Aucun critère noté : tous les critères sont sans objet, pas de conclusion.");
    return { complete, manquants, score, couverture, conclusion: null, motifs };
  }

  let conclusion: ConclusionRevue;
  if (score >= SEUILS_REVUE_FROIDE.conforme) {
    conclusion = "conforme";
    motifs.push(`Score de ${score} sur 100, au moins ${SEUILS_REVUE_FROIDE.conforme} : conforme.`);
  } else if (score >= SEUILS_REVUE_FROIDE.reserves) {
    conclusion = "reserves";
    motifs.push(
      `Score de ${score} sur 100, entre ${SEUILS_REVUE_FROIDE.reserves} et ${SEUILS_REVUE_FROIDE.conforme} : conforme avec réserves.`,
    );
  } else {
    conclusion = "non_conforme";
    motifs.push(
      `Score de ${score} sur 100, inférieur à ${SEUILS_REVUE_FROIDE.reserves} : non conforme.`,
    );
  }

  if (constats.some((c) => c.gravite === "critique")) {
    if (conclusion !== "non_conforme") {
      motifs.push("Un constat critique impose la conclusion non conforme.");
    }
    conclusion = "non_conforme";
  } else if (constats.some((c) => c.gravite === "majeur") && conclusion === "conforme") {
    conclusion = "reserves";
    motifs.push("Un constat majeur limite la conclusion à conforme avec réserves.");
  }

  if (couverture < 0.5 && conclusion === "conforme") {
    conclusion = "reserves";
    motifs.push(
      `Couverture de la grille de ${couverture} (moins de la moitié des poids notés) : la conclusion ne peut pas être conforme.`,
    );
  }

  return { complete, manquants, score, couverture, conclusion, motifs };
}

export interface EntreeIndependance {
  relecteur_id: string;
  mission: {
    directeur_id: string | null;
    chef_id: string | null;
    cree_par: string | null;
    cloturee_par: string | null;
    signee_par: string | null;
  };
  /** mission_equipe */
  equipe: readonly string[];
  /** Affectations de planning. */
  affectes: readonly string[];
  /** Auteurs, valideurs et signataires des suivis qualité de la mission. */
  intervenants_qualite: readonly string[];
}

export type CodeViolationIndependance =
  | "DIRECTEUR"
  | "CHEF"
  | "EQUIPE"
  | "AFFECTE"
  | "CREATEUR"
  | "CLOTURE"
  | "SIGNATAIRE"
  | "INTERVENANT_QUALITE";

export interface ViolationIndependance {
  code: CodeViolationIndependance;
  message: string;
}

export function evaluerIndependanceRelecteur(e: EntreeIndependance): {
  independant: boolean;
  violations: ViolationIndependance[];
} {
  const r = e.relecteur_id;
  const m = e.mission;
  const violations: ViolationIndependance[] = [];
  const ajouter = (ok: boolean, code: CodeViolationIndependance, message: string): void => {
    if (ok) violations.push({ code, message });
  };
  ajouter(m.directeur_id === r, "DIRECTEUR", "Le relecteur est le directeur de la mission.");
  ajouter(m.chef_id === r, "CHEF", "Le relecteur est le chef de la mission.");
  ajouter(e.equipe.includes(r), "EQUIPE", "Le relecteur fait partie de l'équipe de la mission.");
  ajouter(
    e.affectes.includes(r),
    "AFFECTE",
    "Le relecteur a été affecté à la mission dans le planning.",
  );
  ajouter(m.cree_par === r, "CREATEUR", "Le relecteur a créé la mission.");
  ajouter(m.cloturee_par === r, "CLOTURE", "Le relecteur a clôturé la mission.");
  ajouter(m.signee_par === r, "SIGNATAIRE", "Le relecteur a signé la mission.");
  ajouter(
    e.intervenants_qualite.includes(r),
    "INTERVENANT_QUALITE",
    "Le relecteur est intervenu dans les suivis qualité de la mission (auteur, valideur ou signataire).",
  );
  violations.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { independant: violations.length === 0, violations };
}

export type StatutAction = "a_faire" | "en_cours" | "faite" | "abandonnee";

export interface ActionPlan {
  statut: StatutAction;
  /** AAAA-MM-JJ */
  echeance: string;
}

const estOuverte = (a: ActionPlan): boolean => a.statut === "a_faire" || a.statut === "en_cours";

export function actionEnRetard(a: ActionPlan, aujourdhui: string): boolean {
  return estOuverte(a) && a.echeance < aujourdhui;
}

export function transitionActionValide(de: StatutAction, vers: StatutAction): boolean {
  if (de === vers) return false;
  if (de === "a_faire") return vers === "en_cours" || vers === "faite" || vers === "abandonnee";
  if (de === "en_cours") return vers === "a_faire" || vers === "faite" || vers === "abandonnee";
  return false;
}

export interface EtatPlan {
  total: number;
  a_faire: number;
  en_cours: number;
  faites: number;
  abandonnees: number;
  en_retard: number;
  /** 0..100, une décimale : faites / (total - abandonnées). */
  taux_realisation: number;
  prochaine_echeance: string | null;
}

export function etatPlanAmelioration(actions: readonly ActionPlan[], aujourdhui: string): EtatPlan {
  const compte = (s: StatutAction): number => actions.filter((a) => a.statut === s).length;
  const faites = compte("faite");
  const abandonnees = compte("abandonnee");
  const denominateur = actions.length - abandonnees;
  const echeances = actions
    .filter(estOuverte)
    .map((a) => a.echeance)
    .sort();
  return {
    total: actions.length,
    a_faire: compte("a_faire"),
    en_cours: compte("en_cours"),
    faites,
    abandonnees,
    en_retard: actions.filter((a) => actionEnRetard(a, aujourdhui)).length,
    taux_realisation: denominateur > 0 ? arrondir((100 * faites) / denominateur, 1) : 0,
    prochaine_echeance: echeances[0] ?? null,
  };
}
