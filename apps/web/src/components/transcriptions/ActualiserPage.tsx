"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { Bouton } from "../ui/Bouton";

/** « Actualiser » : recharge les données de la page (transcription en file ou en cours). */
export function ActualiserPage() {
  const { rafraichir } = useRafraichir();
  return (
    <Bouton variante="secondaire" icone="historique" onClick={() => rafraichir()}>
      Actualiser
    </Bouton>
  );
}
