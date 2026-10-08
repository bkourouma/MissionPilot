import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { DemandePortailVue } from "../../../../../components/portail/salle/DemandePortailVue";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { aujourdhui } from "../../../../../lib/periode";
import { estIdentifiant, peut } from "../../../../../lib/portail";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";
import {
  cheminApiDemandePortail,
  CHEMIN_SALLE_PORTAIL,
  hrefDemandePortail,
  type DemandePortail,
} from "../../../../../lib/salle-mission-portail";

export const metadata: Metadata = { title: "Documents demandés" };

/**
 * Demande de documents reçue : pièces à fournir et dépôt. Inexistante, d'une autre entreprise
 * ou pas encore envoyée : la même page « introuvable » (l'API répond le même 404).
 */
export default async function DemandeSallePortail({ params }: { params: Promise<{ id: string }> }) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.salle.deposer")) {
    return <NonDisponible titre="Documents demandés" />;
  }
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const r = await chargerPortail<DemandePortail>(cheminApiDemandePortail(id));
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Documents demandés"
          retour={{ href: CHEMIN_SALLE_PORTAIL, libelle: "Documents à fournir" }}
        />
        <EtatErreur
          titre="Cette demande n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefDemandePortail(id)}
        />
      </div>
    );
  }
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={r.donnees.titre}
        retour={{ href: CHEMIN_SALLE_PORTAIL, libelle: "Documents à fournir" }}
      />
      <DemandePortailVue demande={r.donnees} aujourdhui={aujourdhui()} />
    </div>
  );
}
