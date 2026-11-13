"use client";

import { BoutonActionAo } from "../../../../../components/appels-offres/ActionsAo";
import { useT } from "../../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../../lib/api";

/** Génère les étapes standard à rebours de la date limite (dates calculées par le moteur). */
export function GenererRetroplanningAo({ id }: { id: string }) {
  const t = useT();
  return (
    <BoutonActionAo
      variante="primaire"
      action={() => api.post(`/api/appels-offres/${encodeURIComponent(id)}/retroplanning`, {})}
    >
      {t("Générer le rétro-planning", "Generate the backward schedule")}
    </BoutonActionAo>
  );
}
