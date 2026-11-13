/** Espace client : jalons (état affiché, validation par le dirigeant client). */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { CODE_TFA_A_CONFIGURER, ErreurApi } from "./api";
import { formaterDate } from "./format";
import type { JalonPortail, Libelle } from "./portail-contrats";
import { messageErreurPortail } from "./portail-erreurs";
import { peut } from "./portail-menus";
import type { Resultat } from "./saisie";

// --- Jalons --------------------------------------------------------------------------------

export interface EtatJalon extends Libelle {
  /** Précision sous le libellé : date prévue, date et auteur de la validation. */
  detail: string | null;
}

/** Statut affiché d'un jalon : prévu, atteint (à valider) ou validé (par moi ou mon entreprise). */
export function etatJalon(
  j: Pick<JalonPortail, "atteint" | "date_prevue" | "validation">,
  langue: Langue = "fr",
) {
  const t = creerTraduire(langue);
  if (j.validation) {
    const quand = formaterDate(j.validation.valide_le, "Africa/Abidjan", langue);
    return {
      libelle: t("Validé", "Approved"),
      tonalite: "succes",
      detail: j.validation.valide_par_moi
        ? t(`Validé par vous le ${quand}`, `Approved by you on ${quand}`)
        : t(`Validé par votre entreprise le ${quand}`, `Approved by your company on ${quand}`),
    } satisfies EtatJalon;
  }
  if (j.atteint) {
    return {
      libelle: t("Atteint, en attente de validation", "Reached, pending approval"),
      tonalite: "attention",
      detail: j.date_prevue
        ? t(
            `Prévu le ${formaterDate(j.date_prevue, "UTC", langue)}`,
            `Planned for ${formaterDate(j.date_prevue, "UTC", langue)}`,
          )
        : null,
    } satisfies EtatJalon;
  }
  return {
    libelle: t("À venir", "Upcoming"),
    tonalite: "neutre",
    detail: j.date_prevue
      ? t(
          `Prévu le ${formaterDate(j.date_prevue, "UTC", langue)}`,
          `Planned for ${formaterDate(j.date_prevue, "UTC", langue)}`,
        )
      : t("Date à préciser", "Date to be confirmed"),
  } satisfies EtatJalon;
}

/** Le bouton « Valider ce jalon » : dirigeant client, jalon atteint et pas encore validé. */
export function peutValiderJalon(
  j: Pick<JalonPortail, "atteint" | "validation">,
  roles: readonly string[],
): boolean {
  return j.atteint && !j.validation && peut(roles, "portail.jalons.valider");
}

/** Longueur maximale du commentaire de validation (contrat de l'API). */
export const COMMENTAIRE_VALIDATION_MAX = 1000;

/** Commentaire facultatif : vide → aucun champ envoyé. */
export function validerCommentaireValidation(
  commentaire: string,
  langue: Langue = "fr",
): Resultat<{ commentaire?: string }, "commentaire"> {
  const texte = commentaire.trim();
  if (texte.length > COMMENTAIRE_VALIDATION_MAX) {
    return {
      ok: false,
      erreurs: {
        commentaire: creerTraduire(langue)(
          `Le commentaire ne doit pas dépasser ${COMMENTAIRE_VALIDATION_MAX} caractères (actuellement ${texte.length}).`,
          `The comment must not exceed ${COMMENTAIRE_VALIDATION_MAX} characters (currently ${texte.length}).`,
        ),
      },
    };
  }
  return { ok: true, charge: texte === "" ? {} : { commentaire: texte } };
}

/** Chemin de la validation d'un jalon. */
export const cheminValidationJalon = (missionId: string, jalonId: string) =>
  `/api/portail/missions/${encodeURIComponent(missionId)}/jalons/${encodeURIComponent(jalonId)}/valider`;

/** Message affiché quand la validation d'un jalon est refusée. */
export function messageValidationJalon(e: unknown, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (e instanceof ErreurApi) {
    if (e.code === "JALON_DEJA_VALIDE")
      return t(
        "Ce jalon a déjà été validé. Rechargez la page pour voir la validation enregistrée.",
        "This milestone has already been approved. Reload the page to see the recorded approval.",
      );
    if (e.code === "CONFLIT")
      return t(
        "Ce jalon n'est pas encore atteint : il pourra être validé quand le cabinet l'aura marqué comme atteint.",
        "This milestone has not been reached yet: it can be approved once the firm has marked it as reached.",
      );
    if (e.statut === 403 && e.code !== CODE_TFA_A_CONFIGURER)
      return t(
        "Seul le dirigeant de votre entreprise peut valider un jalon.",
        "Only your company's executive can approve a milestone.",
      );
  }
  return messageErreurPortail(e, langue);
}
