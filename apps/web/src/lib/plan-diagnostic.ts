/**
 * Diagnostic du plan stratégique lié à une notation PUBLIÉE (service #1, PLA-02) : types de la
 * réponse de l'API, libellés, options du choix, chemins et messages. Logique pure, testée dans
 * `plan-diagnostic.test.ts`.
 *
 * Score, classe, points forts et faibles viennent TELS QUELS du moteur de notation (API) ; ce
 * module les met en forme. Lire le lien exige « plan.lire » et « notation.lire » ; le changer,
 * « plan.ecrire » et « notation.lire ». Seules les notations publiées du client du plan, dont
 * la mission vous est visible, sont proposées.
 */
import { aPermission, creerTraduire, type Langue, type Role } from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { formaterDate, formaterDateHeure } from "./format";
import { formaterScore, libelleClasse, type Classe } from "./notation";
import { cheminPlan } from "./plan-strategique";

export interface DimensionNotee {
  dimension: string;
  libelle: string;
  score: number;
}

export interface NotationPubliee {
  notation_id: string;
  version_id: string;
  numero: number;
  mission_id: string;
  mission_intitule: string;
  publiee_le: string | null;
  score: number | null;
  classe: Classe | null;
  notable: boolean;
  forces: DimensionNotee[];
  faiblesses: DimensionNotee[];
}

export interface LienNotation {
  plan_id: string;
  lien: {
    lie_par: { id: string; nom: string };
    lie_le: string;
    /** Faux si la mission de la notation ne vous est plus visible (détails masqués). */
    accessible: boolean;
    notation: NotationPubliee | null;
  } | null;
  modifie_le: string | null;
}

export interface NotationsProposees {
  plan_id: string;
  elements: NotationPubliee[];
}

/** « Version 2 de « Notation de compétitivité », publiée le 12/03/2027 ». */
export function libelleNotation(n: NotationPubliee, langue: Langue = "fr"): string {
  if (langue === "en") {
    const dateEn = n.publiee_le
      ? `, published on ${formaterDate(n.publiee_le, "UTC", langue)}`
      : "";
    return `Version ${n.numero} of \u201c${n.mission_intitule}\u201d${dateEn}`;
  }
  const date = n.publiee_le ? `, publiée le ${formaterDate(n.publiee_le)}` : "";
  return `Version ${n.numero} de « ${n.mission_intitule} »${date}`;
}

/** « 72,5 sur 100 — Classe B — Avancé », ou « Score non calculable » si non notable. */
export function libelleScoreNotation(
  n: Pick<NotationPubliee, "score" | "classe" | "notable">,
  langue: Langue = "fr",
): string {
  if (!n.notable || n.score === null) {
    return creerTraduire(langue)(
      "Score global non calculable (réponses insuffisantes).",
      "Overall score cannot be computed (insufficient answers).",
    );
  }
  return langue === "en"
    ? `${formaterScore(n.score, langue)} out of 100 — ${libelleClasse(n.classe, langue)}`
    : `${formaterScore(n.score)} sur 100 — ${libelleClasse(n.classe)}`;
}

/** Dimensions en liste lisible (« Pilotage (82,0), Finances (70,0) »), « aucune » sinon. */
export function listeDimensions(d: readonly DimensionNotee[], langue: Langue = "fr"): string {
  return d.length
    ? d.map((x) => `${x.libelle} (${formaterScore(x.score, langue)})`).join(", ")
    : langue === "en"
      ? "none"
      : "aucune";
}

/** Options du choix : versions publiées, la plus récente d'abord (ordre de l'API). */
export function optionsNotations(p: Pick<NotationsProposees, "elements">, langue: Langue = "fr") {
  return p.elements.map((n) => ({
    valeur: n.version_id,
    libelle: `${libelleNotation(n, langue)} — ${libelleScoreNotation(n, langue)}`,
  }));
}

/** Mention du lien (« Lié par Awa Koné le 12/03/2027 à 10:15 »). */
export function mentionLien(l: NonNullable<LienNotation["lien"]>, langue: Langue = "fr"): string {
  if (langue === "en") {
    return `Linked by ${l.lie_par.nom} on ${formaterDateHeure(l.lie_le, undefined, langue)}`;
  }
  return `Lié par ${l.lie_par.nom} le ${formaterDateHeure(l.lie_le)}`;
}

/** Lire le lien : « plan.lire » et « notation.lire ». */
export const peutLireNotationPlan = (roles: readonly Role[]) =>
  aPermission(roles, "plan.lire") && aPermission(roles, "notation.lire");

/** Changer le lien : « plan.ecrire » et « notation.lire », mission non clôturée. */
export const peutLierNotationPlan = (roles: readonly Role[], missionCloturee: boolean) =>
  !missionCloturee && aPermission(roles, "plan.ecrire") && aPermission(roles, "notation.lire");

/** Message français d'un refus. */
export function messageLienNotation(e: unknown, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (e instanceof ErreurApi) {
    if (e.code === "NOTATION_NON_PUBLIEE") return e.message;
    if (e.statut === 404) {
      return t(
        "Cette notation est introuvable ou ne vous est pas accessible : rechargez la page.",
        "This rating cannot be found or is not accessible to you: reload the page.",
      );
    }
    if (e.statut === 409) return e.message;
    if (e.statut === 403) {
      return t(
        "Votre rôle ne vous permet pas de modifier ce plan.",
        "Your role does not allow you to edit this plan.",
      );
    }
  }
  return messageErreur(e);
}

export const cheminLienNotation = (planId: string) => `${cheminPlan(planId)}/diagnostic/notation`;
export const cheminNotationsProposees = (planId: string) =>
  `${cheminPlan(planId)}/diagnostic/notations-publiees`;
