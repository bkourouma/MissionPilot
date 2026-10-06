/**
 * Limiteur de tentatives en mémoire, borné. La tentative est réservée AVANT le calcul
 * coûteux : des requêtes simultanées ne peuvent pas dépasser le plafond.
 * La clé est l'e-mail seul : l'adresse IP vue par l'API est celle du relais web,
 * et X-Forwarded-For est falsifiable par le client.
 */
export interface Limiteur {
  /** Réserve une tentative ; faux si le plafond de la fenêtre est atteint. */
  reserver(cle: string): boolean;
  /** Efface le compteur (connexion réussie). */
  liberer(cle: string): void;
}

export function creerLimiteur(max: number, fenetreMs: number, capacite = 10_000): Limiteur {
  const entrees = new Map<string, { n: number; debut: number }>();
  return {
    reserver(cle) {
      const maintenant = Date.now();
      let e = entrees.get(cle);
      if (!e || maintenant - e.debut >= fenetreMs) {
        entrees.delete(cle);
        if (entrees.size >= capacite) {
          const plusAncienne = entrees.keys().next().value;
          if (plusAncienne !== undefined) entrees.delete(plusAncienne);
        }
        e = { n: 0, debut: maintenant };
        entrees.set(cle, e);
      }
      if (e.n >= max) return false;
      e.n += 1;
      return true;
    },
    liberer(cle) {
      entrees.delete(cle);
    },
  };
}
