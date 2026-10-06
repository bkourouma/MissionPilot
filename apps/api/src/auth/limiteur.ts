/**
 * Limiteur de tentatives en mémoire, borné. La tentative est réservée AVANT le calcul
 * coûteux : des requêtes simultanées ne peuvent pas dépasser le plafond.
 * La clé est l'e-mail seul : l'adresse IP vue par l'API est celle du relais web,
 * et X-Forwarded-For est falsifiable par le client.
 *
 * Capacité (constat F4) : quand la table est pleine, seules des entrées dont la
 * fenêtre est ÉCOULÉE, ou qui ne sont pas bloquées, sont évincées (la plus
 * ancienne d'abord). Une entrée encore BLOQUÉE n'est jamais évincée : si toutes
 * le sont, la nouvelle clé est refusée. Saturer la table avec des e-mails
 * inventés ne vide donc pas le blocage d'une vraie cible.
 */
export interface Limiteur {
  /** Réserve une tentative ; faux si le plafond de la fenêtre est atteint. */
  reserver(cle: string): boolean;
  /** Efface le compteur (connexion réussie). */
  liberer(cle: string): void;
}

export function creerLimiteur(
  max: number,
  fenetreMs: number,
  capacite = 10_000,
  horloge: () => number = Date.now,
): Limiteur {
  const entrees = new Map<string, { n: number; debut: number }>();

  /** Fait une place ; faux si toutes les entrées sont encore bloquées. */
  function fairePlace(maintenant: number): boolean {
    let candidate: string | undefined;
    // Ordre d'insertion (Map) : de la plus ancienne à la plus récente.
    for (const [cle, e] of entrees) {
      if (maintenant - e.debut >= fenetreMs) {
        entrees.delete(cle); // fenêtre écoulée : sans valeur
        return true;
      }
      if (candidate === undefined && e.n < max) candidate = cle;
    }
    if (candidate === undefined) return false;
    entrees.delete(candidate);
    return true;
  }

  return {
    reserver(cle) {
      const maintenant = horloge();
      let e = entrees.get(cle);
      if (!e || maintenant - e.debut >= fenetreMs) {
        entrees.delete(cle);
        if (entrees.size >= capacite && !fairePlace(maintenant)) return false;
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
