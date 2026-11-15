/** Qualité : validations de saisie (module extrait de `qualite.ts`). */
import { UUID } from "./qualite-uuid";
import type { Violation } from "./qualite-types";
import {
  creerTraduire,
  type Langue,
  CLASSES_RISQUE,
  DECISION_ACCEPTATION_LIBELLES,
  FACTEURS_RISQUE_CLIENT,
  NIVEAU_RISQUE_LIBELLES,
  TYPES_LIVRABLE,
  type ClasseRisque,
  type DecisionAcceptation,
  type NiveauRisqueClient,
  type TypeLivrable,
} from "@missionpilot/shared";
import { ErreurApi } from "./api";
import type { Resultat } from "./saisie";

export const COMMENTAIRE_MAX = 2000;
export const LIBELLE_MAX = 200;

export interface SaisieOuverture {
  mission_id: string;
  type_livrable: string;
  livrable_id: string;
  libelle: string;
  classe: string;
}

export type ChargeOuverture = {
  mission_id: string;
  type_livrable: TypeLivrable;
  livrable_id: string;
  libelle: string;
  classe?: ClasseRisque;
};

/** Ouverture d'un suivi : un livrable « autre » reçoit un identifiant généré par l'appelant. */
export function validerOuverture(
  s: SaisieOuverture,
  genererId: () => string,
  langue: Langue = "fr",
): Resultat<ChargeOuverture, keyof SaisieOuverture> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<keyof SaisieOuverture, string>> = {};
  if (!UUID.test(s.mission_id))
    erreurs.mission_id = t(
      "Choisissez la mission du livrable.",
      "Choose the deliverable's engagement.",
    );
  if (!(TYPES_LIVRABLE as readonly string[]).includes(s.type_livrable)) {
    erreurs.type_livrable = t("Choisissez le type de livrable.", "Choose the deliverable type.");
  }
  const libelle = s.libelle.trim();
  if (libelle === "")
    erreurs.libelle = t("Donnez un nom au livrable.", "Give the deliverable a name.");
  else if (libelle.length > LIBELLE_MAX) {
    erreurs.libelle = t(
      `Le nom ne doit pas dépasser ${LIBELLE_MAX} caractères.`,
      `The name must not exceed ${LIBELLE_MAX} characters.`,
    );
  }
  const id = s.livrable_id.trim();
  const identifiantGenere = s.type_livrable === "autre" && id === "";
  if (!identifiantGenere && !UUID.test(id)) {
    erreurs.livrable_id = t(
      "Saisissez l'identifiant du livrable (UUID affiché par son module).",
      "Enter the deliverable ID (UUID shown by its module).",
    );
  }
  if (s.classe !== "" && !(CLASSES_RISQUE as readonly string[]).includes(s.classe)) {
    erreurs.classe = t("Classe inconnue.", "Unknown class.");
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      mission_id: s.mission_id,
      type_livrable: s.type_livrable as TypeLivrable,
      livrable_id: id === "" ? genererId() : id,
      libelle,
      ...(s.classe ? { classe: s.classe as ClasseRisque } : {}),
    },
  };
}

export function validerCommentaire(
  texte: string,
  { obligatoire }: { obligatoire: boolean },
  langue: Langue = "fr",
): Resultat<{ commentaire: string | null }, "commentaire"> {
  const tr = creerTraduire(langue);
  const t = texte.trim();
  if (obligatoire && t === "") {
    return {
      ok: false,
      erreurs: {
        commentaire: tr(
          "Un commentaire motivé est obligatoire.",
          "A reasoned comment is required.",
        ),
      },
    };
  }
  if (t.length > COMMENTAIRE_MAX) {
    return {
      ok: false,
      erreurs: {
        commentaire: tr(
          `Le commentaire ne doit pas dépasser ${COMMENTAIRE_MAX} caractères.`,
          `The comment must not exceed ${COMMENTAIRE_MAX} characters.`,
        ),
      },
    };
  }
  return { ok: true, charge: { commentaire: t === "" ? null : t } };
}

export function validerRelevement(
  classe: string,
  motif: string,
  actuelle: ClasseRisque,
  langue: Langue = "fr",
): Resultat<{ classe: ClasseRisque; motif: string }, "classe" | "motif"> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"classe" | "motif", string>> = {};
  const rang = (CLASSES_RISQUE as readonly string[]).indexOf(classe);
  if (rang < 0) erreurs.classe = t("Choisissez la nouvelle classe.", "Choose the new class.");
  else if (rang <= CLASSES_RISQUE.indexOf(actuelle)) {
    erreurs.classe = t(
      "La classe se relève : choisissez une classe supérieure à l'actuelle.",
      "The class can only be raised: choose a class above the current one.",
    );
  }
  if (motif.trim() === "")
    erreurs.motif = t(
      "Indiquez pourquoi la classe est relevée.",
      "Explain why the class is being raised.",
    );
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { classe: classe as ClasseRisque, motif: motif.trim() } };
}

export interface SaisieAcceptation {
  facteurs: string[];
  niveau_retenu: string;
  decision: string;
  motif: string;
}

export function validerAcceptation(
  s: SaisieAcceptation,
  { conflits }: { conflits: number },
  langue: Langue = "fr",
): Resultat<
  {
    facteurs: string[];
    niveau_retenu?: NiveauRisqueClient;
    decision: DecisionAcceptation;
    motif: string | null;
  },
  "decision" | "motif" | "niveau_retenu"
> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"decision" | "motif" | "niveau_retenu", string>> = {};
  const decisions = Object.keys(DECISION_ACCEPTATION_LIBELLES);
  if (!decisions.includes(s.decision))
    erreurs.decision = t("Choisissez une décision.", "Choose a decision.");
  const motif = s.motif.trim();
  const exigeMotif =
    s.decision === "refusee" ||
    s.decision === "acceptee_sous_conditions" ||
    (s.decision === "acceptee" && conflits > 0);
  if (exigeMotif && motif === "") {
    erreurs.motif =
      s.decision === "acceptee"
        ? t(
            "Un conflit d'intérêts est détecté : motivez l'acceptation.",
            "A conflict of interest was detected: give a reason for accepting.",
          )
        : t(
            "Un motif est obligatoire pour refuser ou accepter sous conditions.",
            "A reason is required to decline or accept with conditions.",
          );
  }
  if (motif.length > COMMENTAIRE_MAX) {
    erreurs.motif = t(
      `Le motif ne doit pas dépasser ${COMMENTAIRE_MAX} caractères.`,
      `The reason must not exceed ${COMMENTAIRE_MAX} characters.`,
    );
  }
  if (s.niveau_retenu !== "" && !(s.niveau_retenu in NIVEAU_RISQUE_LIBELLES)) {
    erreurs.niveau_retenu = t("Niveau inconnu.", "Unknown level.");
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      facteurs: s.facteurs.filter((f) => FACTEURS_RISQUE_CLIENT.some((x) => x.code === f)),
      ...(s.niveau_retenu ? { niveau_retenu: s.niveau_retenu as NiveauRisqueClient } : {}),
      decision: s.decision as DecisionAcceptation,
      motif: motif === "" ? null : motif,
    },
  };
}

export interface SaisieSatisfaction {
  moment: string;
  jalon_id: string;
  note: string;
  commentaire: string;
  repondant: string;
}

export function validerSatisfaction(
  s: SaisieSatisfaction,
  langue: Langue = "fr",
): Resultat<
  {
    moment: "jalon" | "cloture";
    jalon_id?: string;
    note: number;
    commentaire: string | null;
    repondant: string | null;
  },
  "moment" | "jalon_id" | "note" | "commentaire"
> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"moment" | "jalon_id" | "note" | "commentaire", string>> = {};
  if (s.moment !== "jalon" && s.moment !== "cloture") {
    erreurs.moment = t("Choisissez le moment.", "Choose the timing.");
  }
  if (s.moment === "jalon" && !UUID.test(s.jalon_id)) {
    erreurs.jalon_id = t("Choisissez le jalon.", "Choose the milestone.");
  }
  const note = s.note.trim() === "" ? Number.NaN : Number(s.note.trim());
  if (!Number.isInteger(note) || note < 0 || note > 10) {
    erreurs.note = t("La note est un entier de 0 à 10.", "The score is an integer from 0 to 10.");
  }
  if (s.commentaire.trim().length > COMMENTAIRE_MAX) {
    erreurs.commentaire = t(
      `Le commentaire ne doit pas dépasser ${COMMENTAIRE_MAX} caractères.`,
      `The comment must not exceed ${COMMENTAIRE_MAX} characters.`,
    );
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const commentaire = s.commentaire.trim();
  const repondant = s.repondant.trim();
  return {
    ok: true,
    charge: {
      moment: s.moment as "jalon" | "cloture",
      ...(s.moment === "jalon" ? { jalon_id: s.jalon_id } : {}),
      note,
      commentaire: commentaire === "" ? null : commentaire,
      repondant: repondant === "" ? null : repondant.slice(0, 200),
    },
  };
}

/** Violations de garde jointes à un refus 409 `GARDE_VIOLEE` (`erreur.details.violations`). */
export function violationsDeErreur(e: unknown): Violation[] {
  if (!(e instanceof ErreurApi) || e.code !== "GARDE_VIOLEE") return [];
  const d = e.details as { violations?: unknown } | undefined;
  if (!d || !Array.isArray(d.violations)) return [];
  return d.violations.filter(
    (v): v is Violation =>
      typeof v === "object" && v !== null && typeof (v as { code?: unknown }).code === "string",
  );
}
