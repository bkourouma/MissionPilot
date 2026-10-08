import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { DemandeCabinet } from "../../../../../../components/salle-mission/DemandeCabinet";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../lib/periode";
import {
  cheminDemande,
  hrefDemande,
  hrefSalle,
  peutGererSalle,
  type DemandeDetail,
} from "../../../../../../lib/salle-mission";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Demande de documents" };

/** Demande documentaire d'une mission : pièces, dépôts, décisions et relances. */
export default async function PageDemandeSalle({
  params,
}: {
  params: Promise<{ id: string; demandeId: string }>;
}) {
  const { id, demandeId } = await params;
  if (!estIdentifiant(demandeId)) notFound();
  const { utilisateur } = await exigerPermission("salle.lire");
  const m = await chargerMission(id);
  if (!m.ok) return null;
  const r = await chargerServeur<DemandeDetail>(cheminDemande(id, demandeId));
  if (!r.ok && r.statut === 404) notFound();
  const retour = (
    <p>
      <Link href={hrefSalle(id)}>← Toutes les demandes de la mission</Link>
    </p>
  );
  if (!r.ok) {
    return (
      <div className="mp-pile">
        {retour}
        <EtatErreur
          titre="La demande n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefDemande(id, demandeId)}
        />
      </div>
    );
  }
  return (
    <div className="mp-pile">
      {retour}
      <DemandeCabinet
        missionId={id}
        demande={r.donnees}
        aujourdhui={aujourdhui()}
        contexte={{
          gerer: peutGererSalle(utilisateur.roles),
          missionCloturee: m.donnees.statut === "cloturee",
          documents: aPermission(utilisateur.roles, "document.ecrire"),
        }}
      />
    </div>
  );
}
