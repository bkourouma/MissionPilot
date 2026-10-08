import { cache } from "react";
import { chargerServeur } from "./api-serveur";
import { cheminPlan, type PlanDetaille } from "./plan-strategique";

/**
 * Plan stratégique chargé une seule fois par requête : la mise en page du plan (en-tête,
 * sous-onglets) et la page affichée le partagent. À n'importer que côté serveur.
 */
export const chargerPlan = cache((planId: string) =>
  chargerServeur<PlanDetaille>(cheminPlan(planId)),
);
