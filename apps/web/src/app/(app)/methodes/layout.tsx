import type { ReactNode } from "react";
import "../../../components/methodes/methodes.css";
import { Onglets } from "../../../components/ui/Onglets";
import { ongletsMethodes } from "../../../lib/methodes";
import { exigerPermission } from "../../../lib/session";

/** Rubrique « Méthodes » (référentiel de méthodes, lot STD) : sous-pages selon les droits. */
export default async function LayoutMethodes({ children }: { children: ReactNode }) {
  const { utilisateur } = await exigerPermission("standard.lire");
  return (
    <div className="mp-rubrique">
      <Onglets
        libelle="Sections du référentiel de méthodes"
        pages={ongletsMethodes(utilisateur.roles)}
      />
      {children}
    </div>
  );
}
