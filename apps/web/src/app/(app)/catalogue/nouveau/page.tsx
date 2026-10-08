import type { Metadata } from "next";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { chargerServeur } from "../../../../lib/api-serveur";
import type { Grade } from "../../../../lib/collaborateurs";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireTypeMission } from "../FormulaireTypeMission";

export const metadata: Metadata = { title: "Nouveau type de mission" };

export default async function PageNouveauType() {
  await exigerPermission("catalogue.ecrire");
  const grades = await chargerServeur<{ elements: Grade[] }>("/api/grades");
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre="Nouveau type de mission"
        retour={{ href: "/catalogue", libelle: "Catalogue" }}
      />
      <Carte>
        <FormulaireTypeMission
          grades={
            grades.ok
              ? grades.donnees.elements
                  .filter((g) => g.actif)
                  .map((g) => ({ code: g.code, libelle: g.libelle }))
              : []
          }
        />
      </Carte>
    </div>
  );
}
