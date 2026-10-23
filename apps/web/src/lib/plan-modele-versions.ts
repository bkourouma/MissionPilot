/** Modèle financier du plan : libellés des versions et de la validation. */
import { formaterDate, formaterDateHeure } from "./format";
import { VERSIONS_MODELE_MAX, type ResumeModele } from "./plan-modele-types";

// --- Versions, validation ---------------------------------------------------------------------

export function libelleVersionModele(
  v: Pick<ResumeModele, "version" | "auteur_nom" | "calcule_le">,
) {
  return `Version ${v.version} · calculée le ${formaterDateHeure(v.calcule_le)} par ${v.auteur_nom}`;
}

export function libelleValidationModele(v: Pick<ResumeModele, "validation">): string {
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

/** Annonce affichée au retour d'un enregistrement (`?enregistree=1`). */
export function messageVersionEnregistree(version: number, partageRetire: boolean): string {
  const base = `Version ${version} enregistrée : résultat calculé par le moteur, figé et horodaté. ${TEXTE_REGLE_VALIDATION_MODELE}`;
  return partageRetire
    ? `${base} Le partage au client a été retiré : faites tout valider, puis partagez de nouveau.`
    : base;
}

/** Le plafond de versions est atteint : une nouvelle version serait refusée (409). */
export const plafondAtteint = (derniere: number | null | undefined) =>
  typeof derniere === "number" && derniere >= VERSIONS_MODELE_MAX;

export const MESSAGE_PLAFOND = `Ce plan a atteint ${VERSIONS_MODELE_MAX} versions du modèle financier : aucune nouvelle version ne peut être enregistrée. La simulation reste possible ; pour repartir de zéro, créez un nouveau plan.`;
