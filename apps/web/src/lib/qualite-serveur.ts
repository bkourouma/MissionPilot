import { redirect } from "next/navigation";
import { droitsQualite } from "./qualite";
import { obtenirSession, type Session } from "./session";

/**
 * Garde serveur des écrans qualité : consulter exige de voir les missions (`mission.lire`, comme
 * l'API) ; les actions de relecture et de signature sont proposées selon `droitsQualite` et
 * jugées par l'API. À n'importer que côté serveur.
 */
export async function exigerConsultationQualite(): Promise<Session> {
  const session = await obtenirSession();
  if (!droitsQualite(session.utilisateur.roles).consulter) redirect("/acces-refuse");
  return session;
}

/** Acceptation et satisfaction : réservées à qui relit (`qualite.relire`). */
export async function exigerRelectureQualite(): Promise<Session> {
  const session = await obtenirSession();
  if (!droitsQualite(session.utilisateur.roles).relire) redirect("/acces-refuse");
  return session;
}
