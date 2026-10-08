import { redirect } from "next/navigation";
import { droitsAppelsOffres } from "./appels-offres";
import { obtenirSession, type Session } from "./session";

/**
 * Garde serveur des écrans d'appels d'offres : consulter exige `ao.lire` (comme l'API) ; les
 * actions sont proposées selon `droitsAppelsOffres` et jugées par l'API. À n'importer que côté
 * serveur.
 */
export async function exigerLectureAo(): Promise<Session> {
  const session = await obtenirSession();
  if (!droitsAppelsOffres(session.utilisateur.roles).lire) redirect("/acces-refuse");
  return session;
}
