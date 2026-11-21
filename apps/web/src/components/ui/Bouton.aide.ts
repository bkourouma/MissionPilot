/** Logique pure de l'accessibilité du bouton (testée sans rendu DOM). */

export interface EntreeAccessibiliteBouton {
  id: string;
  disabled?: boolean;
  chargement?: boolean;
  raisonDesactive?: string;
  /** `aria-describedby` déjà fourni par l'appelant : conservé. */
  describedBy?: string;
  title?: string;
}

export interface SortieAccessibiliteBouton {
  /** Un bouton en chargement est aussi désactivé (pas de double envoi). */
  desactive: boolean;
  ariaBusy: true | undefined;
  /** Identifiant du texte caché qui explique la désactivation (undefined : aucun). */
  idRaison: string | undefined;
  ariaDescribedBy: string | undefined;
  title: string | undefined;
}

export function accessibiliteBouton(e: EntreeAccessibiliteBouton): SortieAccessibiliteBouton {
  const desactive = Boolean(e.disabled || e.chargement);
  const raison = e.raisonDesactive?.trim();
  // La raison n'est annoncée que si le bouton est vraiment désactivé par l'appelant,
  // pas pendant un chargement (le texte de chargement suffit alors).
  const idRaison = e.disabled && !e.chargement && raison ? `${e.id}-raison` : undefined;
  const ariaDescribedBy = [e.describedBy, idRaison].filter(Boolean).join(" ") || undefined;
  return {
    desactive,
    ariaBusy: e.chargement ? true : undefined,
    idRaison,
    ariaDescribedBy,
    title: e.title ?? (idRaison ? raison : undefined),
  };
}
