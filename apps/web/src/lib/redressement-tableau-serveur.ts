import type { RedTableauDossierVue, RedTableauPortefeuilleVue } from "@missionpilot/shared";
import { chargerServeur } from "./api-serveur";
import {
  cheminTableauDossier,
  cheminTableauPortefeuille,
  type FiltresTableau,
} from "./redressement-tableau";

/**
 * Chargements serveur du tableau de bord (dépend de `next/headers` : à ne pas importer dans un
 * composant client). Non testé directement ; chemins et filtres sont dans `redressement-tableau.ts`.
 */

export const chargerTableauDossier = (dossierId: string) =>
  chargerServeur<RedTableauDossierVue>(cheminTableauDossier(dossierId));

export const chargerTableauPortefeuille = (filtres: FiltresTableau) =>
  chargerServeur<RedTableauPortefeuilleVue>(cheminTableauPortefeuille(filtres));
