"use client";

/** Lance l'impression du navigateur (mise en page `@media print` de `tableau.css`). */
export function TableauImprimer() {
  return (
    <button
      type="button"
      className="mp-bouton mp-bouton--secondaire mp-tdb-hors-impression"
      onClick={() => window.print()}
    >
      Imprimer
    </button>
  );
}
