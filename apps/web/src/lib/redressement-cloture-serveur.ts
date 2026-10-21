import type {
  RedClotureRapportsVue,
  RedClotureVue,
  RedCloturesListeVue,
} from "@missionpilot/shared";
import { chargerServeur } from "./api-serveur";
import { cheminCloture, cheminClotures, cheminRapportsCloture } from "./redressement-cloture";

/**
 * Chargements serveur de l'onglet Clôture (dépend de `next/headers` : à ne pas importer dans un
 * composant client). Non testé directement ; le choix de la version est dans `redressement-cloture-saisie.ts`.
 */

export const chargerCloturesDossier = (dossierId: string) =>
  chargerServeur<RedCloturesListeVue>(cheminClotures(dossierId));

export const chargerClotureDetail = (id: string) =>
  chargerServeur<RedClotureVue>(cheminCloture(id));

export const chargerRapportsCloture = (id: string) =>
  chargerServeur<RedClotureRapportsVue>(cheminRapportsCloture(id));
