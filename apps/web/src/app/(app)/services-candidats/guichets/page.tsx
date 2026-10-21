import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { GestionGuichets } from "../../../../components/services-candidats/GestionGuichets";
import { PanneauRapprochement } from "../../../../components/services-candidats/PanneauRapprochement";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { chargerClientsActifs } from "../../../../lib/referentiels-serveur";
import type { Guichet } from "../../../../lib/services-candidats";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Guichets de financement" };

export default async function PageGuichets() {
  const { utilisateur } = await exigerPermission("services_candidats.lire");
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
        titre="Guichets de financement"
        soustitre="Liste gérée par le cabinet, sans source externe : banques, bailleurs, fonds et programmes à rapprocher d'un client."
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les guichets n'ont pas pu être chargés."
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
