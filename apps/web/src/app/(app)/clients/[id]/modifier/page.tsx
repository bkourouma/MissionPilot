import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import type { ClientDetaille } from "../../../../../lib/clients";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";
import { FormulaireClient } from "../../FormulaireClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Modifier un client", "Edit a client") };
}

export default async function PageModifierClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  if (!estIdentifiant(id)) notFound();
  await exigerPermission("clients.ecrire");
  const r = await chargerServeur<ClientDetaille>(`/api/clients/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={
          r.ok
            ? `${t("Modifier", "Edit")} ${r.donnees.raison_sociale}`
            : t("Modifier un client", "Edit a client")
        }
        retour={{ href: `/clients/${id}`, libelle: t("Fiche client", "Client record") }}
      />
      {r.ok ? (
        <Carte>
          <FormulaireClient client={r.donnees} />
        </Carte>
      ) : (
        <EtatErreur
          titre={t(
            "La fiche du client n'a pas pu être chargée.",
            "The client record could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={`/clients/${id}/modifier`}
        />
      )}
    </div>
  );
}
