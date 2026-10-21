import type {
  RedCovenantsVue,
  RedFinancementVue,
  RedTresorerieMensuelleVue,
} from "@missionpilot/shared";
import { chargerServeur } from "./api-serveur";
import {
  cheminCovenants,
  cheminFinancement,
  cheminTresorerieMensuelle,
} from "./redressement-financement";

/**
 * Chargements serveur de l'onglet Financement (dépend de `next/headers` : à ne pas importer dans
 * un composant client). Non testé directement.
 */

export const chargerTresorerieMensuelle = (dossierId: string) =>
  chargerServeur<RedTresorerieMensuelleVue>(cheminTresorerieMensuelle(dossierId));

export const chargerCovenants = (dossierId: string) =>
  chargerServeur<RedCovenantsVue>(cheminCovenants(dossierId));

export const chargerFinancement = (dossierId: string) =>
  chargerServeur<RedFinancementVue>(cheminFinancement(dossierId));
