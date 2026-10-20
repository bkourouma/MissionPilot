"use client";

import { useRouter } from "next/navigation";
import { Bouton } from "../ui/Bouton";

/** « Actualiser » : recharge les données de la page (transcription en file ou en cours). */
export function ActualiserPage() {
  const router = useRouter();
  return (
    <Bouton variante="secondaire" icone="historique" onClick={() => router.refresh()}>
      Actualiser
    </Bouton>
  );
}
