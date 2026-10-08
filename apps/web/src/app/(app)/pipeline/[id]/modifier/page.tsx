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
import { exigerPermission } from "../../../../../lib/session";
import { FormulaireOpportunite } from "../../FormulaireOpportunite";

export const metadata: Metadata = { title: "Modifier l'opportunité" };

export default async function PageModifierOpportunite({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
        titre="Modifier l'opportunité"
        retour={{ href: `/pipeline/${id}`, libelle: "Opportunité" }}
      />
      {!r.ok ? (
        <EtatErreur
          titre="L'opportunité n'a pas pu être chargée."
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
