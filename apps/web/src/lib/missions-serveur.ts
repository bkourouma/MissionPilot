import { cache } from "react";
import { chargerServeur } from "./api-serveur";
import type { MissionDetaillee } from "./missions";

/**
 * Fiche mission chargée une seule fois par requête : la mise en page de la mission (en-tête,
 * onglets) et la page affichée la partagent.
 */
export const chargerMission = cache((id: string) =>
  chargerServeur<MissionDetaillee>(`/api/missions/${id}`),
);
