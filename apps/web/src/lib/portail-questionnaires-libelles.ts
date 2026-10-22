/** Questionnaires du portail : libellés, états affichés, progression et phrase de soumission. */
import type { ModeEnvoiQuestionnaire } from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { formaterDateHeure } from "./format";
import {
  echeance,
  type ProgressionPortail,
  type QuestionnairePortail,
} from "./portail-questionnaires-contrats";

// --- Libellés ------------------------------------------------------------------------------

export interface Libelle {
  libelle: string;
  tonalite: TonaliteStatut;
}

const MODES: Record<ModeEnvoiQuestionnaire, string> = {
  individuel: "Réponse individuelle",
  collectif: "Réponse partagée par l'entreprise",
  par_fonction: "Réponse par fonction",
};

/** Mode de réponse, en termes simples pour le client. */
export function libelleMode(mode: string, fonction: string | null = null): string {
  if (mode === "par_fonction" && fonction) return `Réponse en tant que ${fonction}`;
  return MODES[mode as ModeEnvoiQuestionnaire] ?? "Réponse individuelle";
}

/**
 * Le questionnaire accepte-t-il encore une saisie ? (l'API reste seule juge) Avec `aujourdhui`
 * (AAAA-MM-JJ), une date limite passée ferme aussi la saisie.
 */
export function estModifiable(
  q: Pick<QuestionnairePortail, "statut" | "reponse"> &
    Partial<Pick<QuestionnairePortail, "date_limite">>,
  aujourdhui?: string,
): boolean {
  if (q.statut !== "envoye" || q.reponse.statut === "soumise") return false;
  return !(aujourdhui !== undefined && q.date_limite && aujourdhui > q.date_limite);
}

/** Statut affiché d'un questionnaire reçu (liste et en-tête de la page de réponse). */
export function etatQuestionnaire(
  q: Pick<QuestionnairePortail, "statut" | "mode" | "date_limite" | "reponse">,
  aujourdhui: string,
): Libelle {
  if (q.reponse.statut === "soumise") {
    const partage = q.mode === "collectif" && q.reponse.soumission?.par_moi === false;
    return { libelle: partage ? "Envoyé par votre entreprise" : "Envoyé", tonalite: "succes" };
  }
  if (q.statut === "clos") return { libelle: "Clos, plus de réponse possible", tonalite: "neutre" };
  const depassee = echeance(q.date_limite, aujourdhui)?.depassee === true;
  if (q.reponse.statut === "brouillon") {
    return depassee
      ? { libelle: "En cours, date limite dépassée", tonalite: "danger" }
      : { libelle: "En cours", tonalite: "attention" };
  }
  return depassee
    ? { libelle: "À commencer, date limite dépassée", tonalite: "danger" }
    : { libelle: "À commencer", tonalite: "neutre" };
}

/** « 4 questions obligatoires sur 10 renseignées », d'après la progression calculée par l'API. */
export function texteProgression(p: ProgressionPortail): string {
  if (p.obligatoires_visibles === 0) return "Aucune question obligatoire à renseigner";
  const n = p.obligatoires_visibles;
  return `${p.obligatoires_repondues} question${p.obligatoires_repondues > 1 ? "s" : ""} obligatoire${
    p.obligatoires_repondues > 1 ? "s" : ""
  } sur ${n} renseignée${p.obligatoires_repondues > 1 ? "s" : ""}`;
}

/** Pourcentage borné 0..100 pour la barre de progression (valeur de l'API, jamais recalculée). */
export function pourcentageAffiche(p: Pick<ProgressionPortail, "pourcentage">): number {
  const v = Number.isFinite(p.pourcentage) ? Math.trunc(p.pourcentage) : 0;
  return Math.min(100, Math.max(0, v));
}

/** Phrase de soumission : « Vos réponses ont été envoyées le 12 janv. 2027 à 14:05. » */
export function texteSoumission(
  q: Pick<QuestionnairePortail, "mode" | "reponse">,
  fuseau = "Africa/Abidjan",
): string | null {
  const s = q.reponse.soumission;
  if (q.reponse.statut !== "soumise" || !s) return null;
  const quand = formaterDateHeure(s.le, fuseau);
  if (q.mode === "collectif") {
    return s.par_moi
      ? `Vous avez envoyé la réponse de votre entreprise le ${quand}.`
      : `Un collègue a envoyé la réponse de votre entreprise le ${quand}.`;
  }
  return `Vos réponses ont été envoyées le ${quand}.`;
}
