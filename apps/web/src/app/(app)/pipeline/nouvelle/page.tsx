import type { Metadata } from "next";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { optionsPersonnes } from "../../../../lib/personnes";
import {
  chargerClientsActifs,
  chargerPersonnes,
  chargerTypesActifs,
} from "../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireOpportunite } from "../FormulaireOpportunite";

export const metadata: Metadata = { title: "Nouvelle opportunité" };

export default async function PageNouvelleOpportunite() {
  const { utilisateur } = await exigerPermission("pipeline.gerer");
  const [clients, types, personnes] = await Promise.all([
    chargerClientsActifs(utilisateur.roles),
    chargerTypesActifs(utilisateur.roles),
    chargerPersonnes(utilisateur.roles),
  ]);
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre="Nouvelle opportunité"
        retour={{ href: "/pipeline", libelle: "Pipeline" }}
        soustitre="Une piste commerciale : client, montant estimé et probabilité de gain."
      />
      <Carte>
        <FormulaireOpportunite
          clients={clients}
          types={types.map(({ valeur, libelle }) => ({ valeur, libelle }))}
          personnes={optionsPersonnes(personnes)}
        />
      </Carte>
    </div>
  );
}
