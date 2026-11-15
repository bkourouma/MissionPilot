import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { optionsPersonnes } from "../../../../lib/personnes";
import {
  chargerClientsActifs,
  chargerPersonnes,
  chargerTypesActifs,
} from "../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireMission } from "../FormulaireMission";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Nouvelle mission", "New engagement") };
}

export default async function PageNouvelleMission() {
  const { utilisateur } = await exigerPermission("mission.creer");
  const t = await obtenirT();
  const roles = utilisateur.roles;
  const [clients, types, personnes] = await Promise.all([
    chargerClientsActifs(roles),
    chargerTypesActifs(roles),
    chargerPersonnes(roles),
  ]);
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Nouvelle mission", "New engagement")}
        retour={{ href: "/missions", libelle: t("Missions", "Engagements") }}
        soustitre={t(
          "Depuis un type du catalogue (découpage pré-rempli) ou vierge. Pour une mission gagnée, partez plutôt de la proposition acceptée dans le Pipeline.",
          "From a catalog type (pre-filled work breakdown) or blank. For a won engagement, start instead from the accepted proposal in the Pipeline.",
        )}
      />
      <Carte>
        <FormulaireMission
          clients={clients}
          types={types}
          personnes={optionsPersonnes(personnes)}
          voitToutes={aPermission(roles, "mission.lire_toutes")}
        />
      </Carte>
    </div>
  );
}
