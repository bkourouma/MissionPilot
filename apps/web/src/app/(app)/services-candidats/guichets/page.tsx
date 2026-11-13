import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { GestionGuichets } from "../../../../components/services-candidats/GestionGuichets";
import { PanneauRapprochement } from "../../../../components/services-candidats/PanneauRapprochement";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { chargerClientsActifs } from "../../../../lib/referentiels-serveur";
import type { Guichet } from "../../../../lib/services-candidats";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Guichets de financement", "Funding sources") };
}

export default async function PageGuichets() {
  const { utilisateur } = await exigerPermission("services_candidats.lire");
  const t = await obtenirT();
  const roles = utilisateur.roles;
  const peutGerer = aPermission(roles, "services_candidats.gerer");
  // Le rapprochement depuis un client exige aussi « dossier.lire » : sans lui, profil saisi seul.
  const clients = aPermission(roles, "dossier.lire") ? await chargerClientsActifs(roles) : [];
  const r = await chargerServeur<{ elements: Guichet[]; tronque?: boolean }>(
    "/api/guichets-financement",
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Guichets de financement", "Funding sources")}
        soustitre={t(
          "Liste gérée par le cabinet, sans source externe : banques, bailleurs, fonds et programmes à rapprocher d'un client.",
          "List managed by the firm, with no external source: banks, donors, funds and programs to match with a client.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les guichets n'ont pas pu être chargés.",
            "The funding sources could not be loaded.",
          )}
          message={r.message}
          hrefReessayer="/services-candidats/guichets"
        />
      ) : (
        <>
          <GestionGuichets
            guichets={r.donnees.elements}
            tronque={r.donnees.tronque === true}
            peutGerer={peutGerer}
          />
          <PanneauRapprochement clients={clients} nombreGuichets={r.donnees.elements.length} />
        </>
      )}
    </div>
  );
}
