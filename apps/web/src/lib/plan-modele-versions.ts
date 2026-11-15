/** Modèle financier du plan : libellés des versions et de la validation. */
import type { Langue } from "@missionpilot/shared";
import { formaterDate, formaterDateHeure } from "./format";
import { VERSIONS_MODELE_MAX, type ResumeModele } from "./plan-modele-types";

// --- Versions, validation ---------------------------------------------------------------------

export function libelleVersionModele(
  v: Pick<ResumeModele, "version" | "auteur_nom" | "calcule_le">,
  langue: Langue = "fr",
) {
  if (langue === "en") {
    return `Version ${v.version} · computed on ${formaterDateHeure(v.calcule_le, undefined, langue)} by ${v.auteur_nom}`;
  }
  return `Version ${v.version} · calculée le ${formaterDateHeure(v.calcule_le)} par ${v.auteur_nom}`;
}

export function libelleValidationModele(
  v: Pick<ResumeModele, "validation">,
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    if (!v.validation) return "Not approved";
    const qui = v.validation.valideur_nom ?? "a manager";
    return `Approved by ${qui} on ${formaterDate(v.validation.valide_le, "Africa/Abidjan", langue)}`;
  }
  if (!v.validation) return "Non validée";
  const qui = v.validation.valideur_nom ?? "un responsable";
  return `Validée par ${qui} le ${formaterDate(v.validation.valide_le, "Africa/Abidjan")}`;
}

/**
 * Règle de validation d'une version du modèle (miroir de `valideurDispense`, API) : un responsable de
 * la mission autre que l'auteur ; l'associé et le directeur de la mission peuvent valider leur propre version.
 */
export const TEXTE_REGLE_VALIDATION_MODELE =
  "Elle doit être validée par un responsable de la mission, autre que son auteur ; l'associé et le directeur de la mission peuvent toutefois valider leur propre version.";

export const TEXTE_REGLE_VALIDATION_MODELE_EN =
  "It must be approved by an engagement lead other than its author; however, the partner and the engagement director may approve their own version.";

export const texteRegleValidationModele = (langue: Langue = "fr") =>
  langue === "en" ? TEXTE_REGLE_VALIDATION_MODELE_EN : TEXTE_REGLE_VALIDATION_MODELE;

/** Annonce affichée au retour d'un enregistrement (`?enregistree=1`). */
export function messageVersionEnregistree(
  version: number,
  partageRetire: boolean,
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    const baseEn = `Version ${version} saved: result computed by the engine, frozen and timestamped. ${TEXTE_REGLE_VALIDATION_MODELE_EN}`;
    return partageRetire
      ? `${baseEn} Sharing with the client was withdrawn: have everything approved, then share again.`
      : baseEn;
  }
  const base = `Version ${version} enregistrée : résultat calculé par le moteur, figé et horodaté. ${TEXTE_REGLE_VALIDATION_MODELE}`;
  return partageRetire
    ? `${base} Le partage au client a été retiré : faites tout valider, puis partagez de nouveau.`
    : base;
}

/** Le plafond de versions est atteint : une nouvelle version serait refusée (409). */
export const plafondAtteint = (derniere: number | null | undefined) =>
  typeof derniere === "number" && derniere >= VERSIONS_MODELE_MAX;

export const MESSAGE_PLAFOND_EN = `This plan has reached ${VERSIONS_MODELE_MAX} financial model versions: no new version can be saved. Simulation is still possible; to start over, create a new plan.`;

export const messagePlafond = (langue: Langue = "fr") =>
  langue === "en" ? MESSAGE_PLAFOND_EN : MESSAGE_PLAFOND;

export const MESSAGE_PLAFOND = `Ce plan a atteint ${VERSIONS_MODELE_MAX} versions du modèle financier : aucune nouvelle version ne peut être enregistrée. La simulation reste possible ; pour repartir de zéro, créez un nouveau plan.`;
