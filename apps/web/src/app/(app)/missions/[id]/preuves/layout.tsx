import type { ReactNode } from "react";
import "../../../../../components/preuves/preuves.css";
import { Onglets } from "../../../../../components/ui/Onglets";
import { sousPagesPreuves } from "../../../../../lib/preuves";
import { exigerPermission } from "../../../../../lib/session";

/**
 * Registre des preuves d'une mission (PRV-01 à PRV-05) : registre, assertions, carte de
 * triangulation et file des contradictions à arbitrer. Réservé aux rôles qui lisent le registre ;
 * jamais servi au portail client.
 */
export default async function LayoutPreuves({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await exigerPermission("preuve.lire");
  return (
    <div className="mp-preuves">
      <Onglets libelle="Sections du registre des preuves" pages={sousPagesPreuves(id)} />
      {children}
    </div>
  );
}
