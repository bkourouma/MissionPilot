/**
 * Redressement, onglet « Clôture » : choix de la version affichée (paramètre d'URL) et corps de la
 * validation. Contrôles de forme avec messages en français ; l'API revalide tout. Aucun calcul
 * métier. Logique pure, testée dans `redressement-cloture.test.ts`.
 */
import { RED_CLOTURE_MOTIF_MAX, type RedClotureResume } from "@missionpilot/shared";
import { texteOuNull, type Resultat } from "./saisie";

/**
 * Version demandée dans l'URL (`?version=2`) parmi les versions listées ; à défaut ou si elle
 * n'existe pas, la plus récente (la liste arrive la plus récente d'abord).
 */
export function choisirVersion(
  versions: readonly RedClotureResume[],
  demandee: string | string[] | undefined,
): RedClotureResume | null {
  const brut = (Array.isArray(demandee) ? demandee[0] : demandee) ?? "";
  if (/^\d{1,6}$/.test(brut)) {
    const trouvee = versions.find((v) => v.version === Number(brut));
    if (trouvee) return trouvee;
  }
  return versions[0] ?? null;
}

export type ChampValidationCloture = "motif";

/** Corps de la validation : le motif est facultatif. */
export function corpsValidationCloture(
  motif: string,
): Resultat<{ motif?: string }, ChampValidationCloture> {
  const m = texteOuNull(motif);
  if (m !== null && m.length > RED_CLOTURE_MOTIF_MAX) {
    return {
      ok: false,
      erreurs: { motif: `Motif trop long (${RED_CLOTURE_MOTIF_MAX} caractères au plus).` },
    };
  }
  return { ok: true, charge: m === null ? {} : { motif: m } };
}
