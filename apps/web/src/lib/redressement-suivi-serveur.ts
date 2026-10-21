import type { RedSuiviVue } from "@missionpilot/shared";
import { chargerServeur } from "./api-serveur";
import { cheminSuivi } from "./redressement-suivi";

/**
 * Chargement serveur de l'onglet Suivi (dépend de `next/headers` : à ne pas importer dans un
 * composant client). Non testé directement.
 */
export const chargerSuiviDossier = (dossierId: string) =>
  chargerServeur<RedSuiviVue>(cheminSuivi(dossierId));
