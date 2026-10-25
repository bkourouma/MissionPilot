import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { libellePays } from "../../../../../lib/plateforme";
import { CHEMIN_PLATEFORME, cheminCabinetPlateforme } from "../../../../../lib/plateforme-routes";
import { chargerCabinets, chargerUtilisateurs } from "../../../../../lib/plateforme-serveur";
import { GestionUtilisateurs } from "./GestionUtilisateurs";
import { estIdentifiantCabinet, sousTitreUtilisateurs } from "./gestion-utilisateurs";

export const metadata: Metadata = { title: "Utilisateurs du cabinet" };

const RETOUR = { href: CHEMIN_PLATEFORME, libelle: "Tous les cabinets" };

export default async function PageCabinetPlateforme({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!estIdentifiantCabinet(id)) notFound();

  const hrefReessayer = cheminCabinetPlateforme(id);
  const cabinets = await chargerCabinets();
  if (!cabinets.ok) {
    return (
      <>
        <EnteteDePage titre="Cabinet" retour={RETOUR} />
        <EtatErreur
          titre="Le cabinet n'a pas pu être chargé."
          message={cabinets.message}
          hrefReessayer={hrefReessayer}
        />
      </>
    );
  }
  const cabinet = cabinets.donnees.find((c) => c.id === id);
  if (!cabinet) notFound();

  const utilisateurs = await chargerUtilisateurs(id);
  if (!utilisateurs.ok && utilisateurs.statut === 404) notFound();

  return (
    <>
      <EnteteDePage
        titre={cabinet.nom}
        retour={RETOUR}
        badges={
          <>
            <BadgeStatut tonalite={cabinet.actif ? "succes" : "neutre"}>
              {cabinet.actif ? "Actif" : "Désactivé"}
            </BadgeStatut>
            {cabinet.estDemo ? <BadgeStatut tonalite="attention">Démo</BadgeStatut> : null}
            <BadgeStatut tonalite="neutre" sansIcone>
              {libellePays(cabinet.pays)}
            </BadgeStatut>
          </>
        }
        soustitre={utilisateurs.ok ? sousTitreUtilisateurs(utilisateurs.donnees) : undefined}
      />
      {utilisateurs.ok ? (
        <GestionUtilisateurs cabinet={cabinet} utilisateurs={utilisateurs.donnees} />
      ) : (
        <EtatErreur
          titre="Les utilisateurs n'ont pas pu être chargés."
          message={utilisateurs.message}
          hrefReessayer={hrefReessayer}
        />
      )}
    </>
  );
}
