import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { chargerServeur } from "../../../../lib/api-serveur";
import type { Grade } from "../../../../lib/collaborateurs";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireCollaborateur } from "../FormulaireCollaborateur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Nouveau collaborateur", "New team member") };
}

export default async function PageNouveauCollaborateur() {
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("collaborateurs.ecrire");
  const grades = aPermission(utilisateur.roles, "catalogue.lire")
    ? await chargerServeur<{ elements: Grade[] }>("/api/grades")
    : null;
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Nouveau collaborateur", "New team member")}
        retour={{ href: "/collaborateurs", libelle: t("Collaborateurs", "Team members") }}
      />
      <Carte>
        <FormulaireCollaborateur
          grades={grades?.ok ? grades.donnees.elements.filter((g) => g.actif) : null}
        />
      </Carte>
    </div>
  );
}
