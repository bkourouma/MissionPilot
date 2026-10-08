import { redirect } from "next/navigation";
import { peutLireNotation } from "./notation";
import { obtenirSession, type Session } from "./session";

/**
 * Garde serveur des écrans de notation : `notation.gerer` OU `notation.publier` (miroir des
 * routes de lecture de l'API) ; sinon « Accès refusé ». À n'importer que côté serveur.
 */
export async function exigerLectureNotation(): Promise<Session> {
  const session = await obtenirSession();
  if (!peutLireNotation(session.utilisateur.roles)) redirect("/acces-refuse");
  return session;
}
