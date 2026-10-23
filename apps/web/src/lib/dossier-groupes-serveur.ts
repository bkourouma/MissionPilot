import { chargerServeur } from "./api-serveur";
import {
  cheminApiGroupe,
  cheminApiParticipations,
  type GroupeApi,
  type ParametresGroupe,
  type ParticipationApi,
} from "./dossier-groupes";

/**
 * Chargements serveur de l'écran « Groupe » (Server Components). À ne pas importer dans un
 * composant client (dépend de `next/headers` par `api-serveur`).
 */
export const chargerGroupe = (id: string, p: ParametresGroupe) =>
  chargerServeur<GroupeApi>(cheminApiGroupe(id, p));

export const chargerParticipations = (id: string) =>
  chargerServeur<{ elements: ParticipationApi[] }>(cheminApiParticipations(id));
