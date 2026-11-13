import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { optionsPersonnes } from "../../../../../lib/personnes";
import { saisieDepuisOpportunite, type Opportunite } from "../../../../../lib/pipeline";
import {
  chargerClientsActifs,
  chargerPersonnes,
  chargerTypesActifs,
} from "../../../../../lib/referentiels-serveur";
import { obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";
import { FormulaireOpportunite } from "../../FormulaireOpportunite";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Modifier l'opportunité", "Edit the opportunity") };
}

export default async function PageModifierOpportunite({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("pipeline.gerer");
  const [r, clients, types, personnes] = await Promise.all([
    chargerServeur<Opportunite>(`/api/opportunites/${id}`),
    chargerClientsActifs(utilisateur.roles),
    chargerTypesActifs(utilisateur.roles),
    chargerPersonnes(utilisateur.roles),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  if (r.ok && r.donnees.statut !== "ouverte") redirect(`/pipeline/${id}`);
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Modifier l'opportunité", "Edit the opportunity")}
        retour={{ href: `/pipeline/${id}`, libelle: t("Opportunité", "Opportunity") }}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "L'opportunité n'a pas pu être chargée.",
            "The opportunity could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={`/pipeline/${id}/modifier`}
        />
      ) : (
        <Carte>
          <FormulaireOpportunite
            opportunite={r.donnees}
            saisieInitiale={saisieDepuisOpportunite(r.donnees)}
            clients={
              clients.some((c) => c.valeur === r.donnees.client_id)
                ? clients
                : [
                    { valeur: r.donnees.client_id, libelle: r.donnees.client_raison_sociale },
                    ...clients,
                  ]
            }
            types={types.map(({ valeur, libelle }) => ({ valeur, libelle }))}
            personnes={optionsPersonnes(personnes)}
          />
        </Carte>
      )}
    </div>
  );
}
