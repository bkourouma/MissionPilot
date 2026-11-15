import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { Onglets } from "../../../../../../components/ui/Onglets";
import {
  hrefDossier,
  hrefListeDossiers,
  resumeOperation,
  sousPagesDd,
} from "../../../../../../lib/due-diligence";
import { droitsPortailDd } from "../../../../../../lib/due-diligence-portail";
import { chargerDossier } from "../../../../../../lib/due-diligence-serveur";
import { libelleDevise } from "../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../lib/session";

/**
 * En-tête d'un dossier de due diligence (titre, secteur, pays, opération) et onglets : Synthèse,
 * Cadrage, Analyses, Chaîne de valeur, Risques, Hypothèses, Marché, Environnement et social, Plan
 * des 100 jours, Note au comité, Ajustements. Un dossier d'une autre mission, d'un autre cabinet ou
 * invisible répond 404 (comme l'API).
 */
export default async function LayoutDossierDd({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
  if (!estIdentifiant(dossierId)) notFound();
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("dd.lire");
  const mission = await chargerMission(id);
  // L'en-tête de la mission affiche déjà son erreur de chargement.
  if (!mission.ok) return null;
  const r = await chargerDossier(dossierId);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t(
          "Le dossier de due diligence n'a pas pu être chargé.",
          "The due diligence file could not be loaded.",
        )}
        message={r.message}
        hrefReessayer={hrefDossier(id, dossierId)}
      />
    );
  }
  const d = r.donnees;
  if (d.mission.id !== mission.donnees.id) notFound();
  return (
    <>
      <section className="mp-dd-pile" aria-labelledby="titre-dossier">
        <p className="mp-texte-petit">
          <Link href={hrefListeDossiers(id)}>
            {t("Tous les dossiers de due diligence", "All due diligence files")}
          </Link>
        </p>
        <h2 id="titre-dossier" className="mp-section__titre">
          {d.titre}
        </h2>
        <div className="mp-dd-meta">
          <BadgeStatut tonalite="neutre" sansIcone>
            {d.secteur_libelle ?? t("Secteur non précisé", "Sector not specified")}
          </BadgeStatut>
          {d.filiere_libelle ? (
            <BadgeStatut tonalite="neutre" sansIcone>
              {d.filiere_libelle}
            </BadgeStatut>
          ) : null}
          <BadgeStatut tonalite="neutre" sansIcone>
            {d.pays_libelle ?? t("Pays non précisé", "Country not specified")}
          </BadgeStatut>
          <span className="mp-texte-doux mp-texte-petit">
            {t(
              `${resumeOperation(d)} · montants en ${libelleDevise(d.devise)}`,
              `${resumeOperation(d, langue)} · amounts in ${libelleDevise(d.devise)}`,
            )}
          </span>
        </div>
      </section>
      <Onglets
        libelle={t("Sections du dossier de due diligence", "Due diligence file sections")}
        pages={sousPagesDd(
          id,
          dossierId,
          { partage: droitsPortailDd(utilisateur.roles).gerer },
          langue,
        )}
      />
      {children}
    </>
  );
}
