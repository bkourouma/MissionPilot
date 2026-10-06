import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { chargerServeur } from "../../../../lib/api-serveur";
import type { Grade } from "../../../../lib/collaborateurs";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireCollaborateur } from "../FormulaireCollaborateur";

export const metadata: Metadata = { title: "Nouveau collaborateur" };

export default async function PageNouveauCollaborateur() {
  const { utilisateur } = await exigerPermission("collaborateurs.ecrire");
  const grades = aPermission(utilisateur.roles, "catalogue.lire")
    ? await chargerServeur<{ elements: Grade[] }>("/api/grades")
    : null;
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre="Nouveau collaborateur"
        retour={{ href: "/collaborateurs", libelle: "Collaborateurs" }}
      />
      <Carte>
        <FormulaireCollaborateur
          grades={grades?.ok ? grades.donnees.elements.filter((g) => g.actif) : null}
        />
      </Carte>
    </div>
  );
}
