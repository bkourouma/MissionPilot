import type { Metadata } from "next";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { chargerServeur } from "../../../../lib/api-serveur";
import type { Grade } from "../../../../lib/collaborateurs";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireTypeMission } from "../FormulaireTypeMission";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Nouveau type de mission", "New engagement type") };
}

export default async function PageNouveauType() {
  const t = await obtenirT();
  await exigerPermission("catalogue.ecrire");
  const grades = await chargerServeur<{ elements: Grade[] }>("/api/grades");
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Nouveau type de mission", "New engagement type")}
        retour={{ href: "/catalogue", libelle: t("Catalogue", "Catalog") }}
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
