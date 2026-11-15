"use client";

import { useT } from "../i18n/FournisseurLangue";
import { Icone } from "./Icone";

/**
 * Marque « Calculé » : le chiffre vient d'un moteur de calcul testé, jamais du modèle de langage.
 * À poser sur les valeurs calculées pour qu'elles ne se confondent pas avec un contenu proposé
 * par l'IA (brouillon) ni avec un contenu validé par un expert.
 */
export function Calcule() {
  const t = useT();
  return (
    <span
      className="mp-calcule"
      title={t(
        "Calculé par le moteur de calcul du cabinet",
        "Computed by the firm's calculation engine",
      )}
    >
      <Icone nom="facture" taille={14} />
      <span>{t("Calculé", "Computed")}</span>
    </span>
  );
}
