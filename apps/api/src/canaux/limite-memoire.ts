/*
 * Limiteur EN MÉMOIRE à fenêtre glissante, propre à chaque processus (SPEC-3c §8, constat de
 * l'audit de sécurité). Sert uniquement à protéger la base d'une route PUBLIQUE : le limiteur
 * persistant (`webhook_invalide`) ouvre une transaction sur une ligne unique à chaque signature
 * invalide, même au-delà de son plafond, et un flot d'invalides saturerait le pool de connexions.
 * Cette garde coupe AVANT la base. Limite assumée : n instances = n fois le plafond, et le
 * compteur repart à zéro au redémarrage (même exception documentée que `brief/debit.ts`) ; la
 * garde persistante reste la référence partagée entre instances.
 */
export class LimiteMemoire {
  private readonly instants = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly fenetreMs: number,
    /** Clés suivies au plus : borne la mémoire face à des adresses forgées. */
    private readonly clesMax = 10_000,
  ) {}

  /** Compte un passage et renvoie `false` si la clé a déjà atteint le plafond sur la fenêtre. */
  reserver(cle: string, maintenant: number = Date.now()): boolean {
    const debut = maintenant - this.fenetreMs;
    let cleRetenue = cle;
    if (!this.instants.has(cle) && this.instants.size >= this.clesMax) {
      for (const [k, ts] of this.instants) {
        if (!ts.some((t) => t > debut)) this.instants.delete(k);
      }
      // Toujours plein : les clés nouvelles partagent un seul seau (jamais de croissance sans borne).
      if (this.instants.size >= this.clesMax) cleRetenue = "*";
    }
    const recents = (this.instants.get(cleRetenue) ?? []).filter((t) => t > debut);
    recents.push(maintenant);
    this.instants.set(cleRetenue, recents);
    return recents.length <= this.max;
  }

  /** Remet les compteurs à zéro (tests). */
  reinitialiser(): void {
    this.instants.clear();
  }
}
