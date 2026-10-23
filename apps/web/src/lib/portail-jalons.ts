/** Espace client : jalons (état affiché, validation par le dirigeant client). */
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
export function etatJalon(j: Pick<JalonPortail, "atteint" | "date_prevue" | "validation">) {
  if (j.validation) {
    const quand = formaterDate(j.validation.valide_le, "Africa/Abidjan");
    return {
      libelle: "Validé",
      tonalite: "succes",
      detail: j.validation.valide_par_moi
        ? `Validé par vous le ${quand}`
        : `Validé par votre entreprise le ${quand}`,
    } satisfies EtatJalon;
  }
  if (j.atteint) {
    return {
      libelle: "Atteint, en attente de validation",
      tonalite: "attention",
      detail: j.date_prevue ? `Prévu le ${formaterDate(j.date_prevue)}` : null,
    } satisfies EtatJalon;
  }
  return {
    libelle: "À venir",
    tonalite: "neutre",
    detail: j.date_prevue ? `Prévu le ${formaterDate(j.date_prevue)}` : "Date à préciser",
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
): Resultat<{ commentaire?: string }, "commentaire"> {
  const t = commentaire.trim();
  if (t.length > COMMENTAIRE_VALIDATION_MAX) {
    return {
      ok: false,
      erreurs: {
        commentaire: `Le commentaire ne doit pas dépasser ${COMMENTAIRE_VALIDATION_MAX} caractères (actuellement ${t.length}).`,
      },
    };
  }
  return { ok: true, charge: t === "" ? {} : { commentaire: t } };
}

/** Chemin de la validation d'un jalon. */
export const cheminValidationJalon = (missionId: string, jalonId: string) =>
  `/api/portail/missions/${encodeURIComponent(missionId)}/jalons/${encodeURIComponent(jalonId)}/valider`;

/** Message affiché quand la validation d'un jalon est refusée. */
export function messageValidationJalon(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.code === "JALON_DEJA_VALIDE")
      return "Ce jalon a déjà été validé. Rechargez la page pour voir la validation enregistrée.";
    if (e.code === "CONFLIT")
      return "Ce jalon n'est pas encore atteint : il pourra être validé quand le cabinet l'aura marqué comme atteint.";
    if (e.statut === 403 && e.code !== CODE_TFA_A_CONFIGURER)
      return "Seul le dirigeant de votre entreprise peut valider un jalon.";
  }
  return messageErreurPortail(e);
}
