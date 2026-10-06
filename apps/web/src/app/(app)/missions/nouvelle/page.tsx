import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { optionsPersonnes } from "../../../../lib/personnes";
import {
  chargerClientsActifs,
  chargerPersonnes,
  chargerTypesActifs,
} from "../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireMission } from "../FormulaireMission";

export const metadata: Metadata = { title: "Nouvelle mission" };

export default async function PageNouvelleMission() {
  const { utilisateur } = await exigerPermission("mission.creer");
  const roles = utilisateur.roles;
  const [clients, types, personnes] = await Promise.all([
    chargerClientsActifs(roles),
    chargerTypesActifs(roles),
    chargerPersonnes(roles),
  ]);
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre="Nouvelle mission"
        retour={{ href: "/missions", libelle: "Missions" }}
        soustitre="Depuis un type du catalogue (découpage pré-rempli) ou vierge. Pour une mission gagnée, partez plutôt de la proposition acceptée dans le Pipeline."
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
