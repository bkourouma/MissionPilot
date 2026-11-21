/** Copie un texte dans le presse-papiers ; `false` si le navigateur refuse (jamais d'exception). */
export interface NavigateurPressePapiers {
  clipboard?: { writeText(texte: string): Promise<void> };
}

export async function copierTexte(
  texte: string,
  navigateur: NavigateurPressePapiers | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator,
): Promise<boolean> {
  try {
    if (!navigateur?.clipboard) return false;
    await navigateur.clipboard.writeText(texte);
    return true;
  } catch {
    return false;
  }
}
