import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { DemandePortailVue } from "../../../../../components/portail/salle/DemandePortailVue";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { obtenirT } from "../../../../../lib/i18n/serveur";
import { aujourdhui } from "../../../../../lib/periode";
import { estIdentifiant, peut } from "../../../../../lib/portail";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";
import {
  cheminApiDemandePortail,
  CHEMIN_SALLE_PORTAIL,
  hrefDemandePortail,
  type DemandePortail,
} from "../../../../../lib/salle-mission-portail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Documents demandés", "Documents requested") };
}

/**
 * Demande de documents reçue : pièces à fournir et dépôt. Inexistante, d'une autre entreprise
 * ou pas encore envoyée : la même page « introuvable » (l'API répond le même 404).
 */
export default async function DemandeSallePortail({ params }: { params: Promise<{ id: string }> }) {
  const t = await obtenirT();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.salle.deposer")) {
    return <NonDisponible titre={t("Documents demandés", "Documents requested")} />;
  }
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const r = await chargerPortail<DemandePortail>(cheminApiDemandePortail(id));
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Documents demandés", "Documents requested")}
          retour={{
            href: CHEMIN_SALLE_PORTAIL,
            libelle: t("Documents à fournir", "Documents to provide"),
          }}
        />
        <EtatErreur
          titre={t("Cette demande n'a pas pu être chargée.", "This request could not be loaded.")}
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
        retour={{
          href: CHEMIN_SALLE_PORTAIL,
          libelle: t("Documents à fournir", "Documents to provide"),
        }}
      />
      <DemandePortailVue demande={r.donnees} aujourdhui={aujourdhui()} />
    </div>
  );
}
