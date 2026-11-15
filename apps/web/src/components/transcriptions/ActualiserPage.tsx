"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { Bouton } from "../ui/Bouton";
import { useT } from "../i18n/FournisseurLangue";

/** « Actualiser » : recharge les données de la page (transcription en file ou en cours). */
export function ActualiserPage() {
  const t = useT();
  const { rafraichir } = useRafraichir();
  return (
    <Bouton variante="secondaire" icone="historique" onClick={() => rafraichir()}>
      {t("Actualiser", "Refresh")}
    </Bouton>
  );
}
