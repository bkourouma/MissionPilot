import type { Metadata } from "next";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { optionsPersonnes } from "../../../../lib/personnes";
import {
  chargerClientsActifs,
  chargerPersonnes,
  chargerTypesActifs,
} from "../../../../lib/referentiels-serveur";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireOpportunite } from "../FormulaireOpportunite";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Nouvelle opportunité", "New opportunity") };
}

export default async function PageNouvelleOpportunite() {
  const { utilisateur } = await exigerPermission("pipeline.gerer");
  const t = await obtenirT();
  const [clients, types, personnes] = await Promise.all([
    chargerClientsActifs(utilisateur.roles),
    chargerTypesActifs(utilisateur.roles),
    chargerPersonnes(utilisateur.roles),
  ]);
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Nouvelle opportunité", "New opportunity")}
        retour={{ href: "/pipeline", libelle: t("Pipeline", "Pipeline") }}
        soustitre={t(
          "Une piste commerciale : client, montant estimé et probabilité de gain.",
          "A sales lead: client, estimated amount and win probability.",
        )}
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
