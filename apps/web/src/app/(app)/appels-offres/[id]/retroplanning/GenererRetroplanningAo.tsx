"use client";

import { BoutonActionAo } from "../../../../../components/appels-offres/ActionsAo";
import { api } from "../../../../../lib/api";

/** Génère les étapes standard à rebours de la date limite (dates calculées par le moteur). */
export function GenererRetroplanningAo({ id }: { id: string }) {
  return (
    <BoutonActionAo
      variante="primaire"
      action={() => api.post(`/api/appels-offres/${encodeURIComponent(id)}/retroplanning`, {})}
    >
      Générer le rétro-planning
    </BoutonActionAo>
  );
}
