import type { ReactNode } from "react";
import "../../../../../components/due-diligence/due-diligence.css";
import { exigerPermission } from "../../../../../lib/session";

/**
 * Due diligence d'une mission (service #2, DD-01 à DD-15) : dossiers d'opérations étudiées. Réservé
 * aux rôles qui lisent le service ; jamais servi au portail client. Les droits d'affichage ne sont
 * qu'un confort : l'API reste seule juge.
 */
export default async function LayoutDueDiligence({ children }: { children: ReactNode }) {
  await exigerPermission("dd.lire");
  return <div className="mp-dd">{children}</div>;
}
