import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { libellePays } from "../../../../../lib/plateforme";
import { CHEMIN_PLATEFORME, cheminCabinetPlateforme } from "../../../../../lib/plateforme-routes";
import { chargerCabinets, chargerUtilisateurs } from "../../../../../lib/plateforme-serveur";
import { GestionUtilisateurs } from "./GestionUtilisateurs";
import { estIdentifiantCabinet, sousTitreUtilisateurs } from "./gestion-utilisateurs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Utilisateurs du cabinet", "Firm users") };
}

export default async function PageCabinetPlateforme({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const RETOUR = { href: CHEMIN_PLATEFORME, libelle: t("Tous les cabinets", "All firms") };
  if (!estIdentifiantCabinet(id)) notFound();

  const hrefReessayer = cheminCabinetPlateforme(id);
  const cabinets = await chargerCabinets();
  if (!cabinets.ok) {
    return (
      <>
        <EnteteDePage titre={t("Cabinet", "Firm")} retour={RETOUR} />
        <EtatErreur
          titre={t("Le cabinet n'a pas pu être chargé.", "The firm could not be loaded.")}
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
              {cabinet.actif ? t("Actif", "Active") : t("Désactivé", "Deactivated")}
            </BadgeStatut>
            {cabinet.estDemo ? (
              <BadgeStatut tonalite="attention">{t("Démo", "Demo")}</BadgeStatut>
            ) : null}
            <BadgeStatut tonalite="neutre" sansIcone>
              {libellePays(cabinet.pays, langue)}
            </BadgeStatut>
          </>
        }
        soustitre={
          utilisateurs.ok ? sousTitreUtilisateurs(utilisateurs.donnees, langue) : undefined
        }
      />
      {utilisateurs.ok ? (
        <GestionUtilisateurs cabinet={cabinet} utilisateurs={utilisateurs.donnees} />
      ) : (
        <EtatErreur
          titre={t("Les utilisateurs n'ont pas pu être chargés.", "Users could not be loaded.")}
          message={utilisateurs.message}
          hrefReessayer={hrefReessayer}
        />
      )}
    </>
  );
}
