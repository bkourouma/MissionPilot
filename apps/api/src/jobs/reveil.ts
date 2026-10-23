/*
 * Signal de réveil des workers (BUG-2026-10-23-008).
 * Un code qui vient de mettre un job en file appelle `signalerJobCree()` ; les workers du même
 * processus qui écoutent avancent leur prochain cycle au lieu d'attendre l'intervalle normal.
 * Signal purement en mémoire : sans worker dans le processus (tests, API seule), il est sans effet,
 * et un worker d'un autre processus garde son intervalle habituel.
 */

type Ecouteur = () => void;

const ecouteurs = new Set<Ecouteur>();

/** Signale qu'un job vient d'être inséré en file. Une erreur d'écouteur n'atteint jamais l'appelant. */
export function signalerJobCree(): void {
  for (const fn of [...ecouteurs]) {
    try {
      fn();
    } catch {
      // Un écouteur défaillant ne doit pas faire échouer la mise en file.
    }
  }
}

/** S'abonne au signal ; renvoie la fonction de désabonnement. */
export function ecouterJobCree(fn: Ecouteur): () => void {
  ecouteurs.add(fn);
  return () => {
    ecouteurs.delete(fn);
  };
}
