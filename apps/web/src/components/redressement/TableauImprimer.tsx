"use client";

import { useT } from "../i18n/FournisseurLangue";

/** Lance l'impression du navigateur (mise en page `@media print` de `tableau.css`). */
export function TableauImprimer() {
  const t = useT();
  return (
    <button
      type="button"
      className="mp-bouton mp-bouton--secondaire mp-tdb-hors-impression"
      onClick={() => window.print()}
    >
      {t("Imprimer", "Print")}
    </button>
  );
}
