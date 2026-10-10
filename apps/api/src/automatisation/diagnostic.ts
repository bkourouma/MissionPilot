/*
 * DIAGNOSTIC DU MOTEUR D'AUTOMATISATION — trace côté serveur des erreurs inattendues que le
 * moteur transforme volontairement en résultat « échec » (action) ou en erreur de publication :
 * sans trace, une panne (base, code) resterait invisible, le client n'en voyant que
 * « Erreur inattendue. ».
 *
 * Aucun `console.*` : la sortie est le journal de l'application (`app.log`), branché une fois
 * par le plugin de routes (`routes/automatisation.ts`) ; le worker tourne dans le même
 * processus (server.ts). Sans sortie branchée (tests, scripts), rien n'est écrit.
 *
 * Ce qui est consigné : contexte, message, code SQLSTATE, contrainte et table, comme le
 * gestionnaire d'erreurs de `app.ts` (jamais le `detail` de PostgreSQL, qui peut citer des
 * données, ni le contenu d'un événement ou d'une action).
 */

export type SortieDiagnostic = (entree: Record<string, unknown>, message: string) => void;

let sortie: SortieDiagnostic | null = null;

/** Branche la sortie ; renvoie la fonction qui la débranche (sans effet si remplacée depuis). */
export function brancherDiagnostic(s: SortieDiagnostic): () => void {
  sortie = s;
  return () => {
    if (sortie === s) sortie = null;
  };
}

interface ErreurInconnue {
  message?: unknown;
  code?: unknown;
  constraint?: unknown;
  table?: unknown;
}

const texte = (v: unknown): string | undefined =>
  typeof v === "string" ? v.slice(0, 300) : undefined;

/**
 * Consigne un incident inattendu. `contexte` dit où (« action », « agent », « publication »…),
 * `reperes` ajoute des identifiants non sensibles (code d'événement, type d'action,
 * identifiants). Ne lève jamais.
 */
export function journaliserIncident(
  contexte: string,
  erreur: unknown,
  reperes: Readonly<Record<string, string | number | null>> = {},
): void {
  if (!sortie) return;
  const e: ErreurInconnue = typeof erreur === "object" && erreur !== null ? erreur : {};
  try {
    sortie(
      {
        contexte,
        ...reperes,
        message: texte(e.message) ?? (typeof erreur === "string" ? texte(erreur) : undefined),
        code: texte(e.code),
        constraint: texte(e.constraint),
        table: texte(e.table),
      },
      `Automatisation : incident inattendu (${contexte}).`,
    );
  } catch {
    // Un défaut de journalisation ne doit jamais faire échouer le traitement.
  }
}
