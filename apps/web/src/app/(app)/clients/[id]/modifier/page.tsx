import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import type { ClientDetaille } from "../../../../../lib/clients";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../lib/session";
import { FormulaireClient } from "../../FormulaireClient";

export const metadata: Metadata = { title: "Modifier un client" };

export default async function PageModifierClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  await exigerPermission("clients.ecrire");
  const r = await chargerServeur<ClientDetaille>(`/api/clients/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={r.ok ? `Modifier ${r.donnees.raison_sociale}` : "Modifier un client"}
        retour={{ href: `/clients/${id}`, libelle: "Fiche client" }}
      />
      {r.ok ? (
        <Carte>
          <FormulaireClient client={r.donnees} />
        </Carte>
      ) : (
        <EtatErreur
          titre="La fiche du client n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={`/clients/${id}/modifier`}
        />
      )}
    </div>
  );
}
