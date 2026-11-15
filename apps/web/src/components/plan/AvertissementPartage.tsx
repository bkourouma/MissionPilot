"use client";

import { avertissementPartage } from "../../lib/plan-strategique";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";

/**
 * Avertissement visible avant toute écriture sur un plan partagé : l'écriture retire le
 * partage au client (l'API le fait dans la même transaction, `plans/partage.ts`).
 */
export function AvertissementPartage({ partage }: { partage: boolean }) {
  const t = useT();
  const langue = useLangue();
  if (!partage) return null;
  return (
    <Alerte
      tonalite="attention"
      titre={t("Cette modification retirera le partage", "This change will withdraw sharing")}
      annonce="aucune"
    >
      <p>{avertissementPartage(langue)}</p>
    </Alerte>
  );
}
