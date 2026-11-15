import Link from "next/link";
import type { Metadata } from "next";
import type { DdPortailEtatDossier } from "@missionpilot/shared";
import { PartageInvestisseurComptes } from "../../../../../../../components/due-diligence/PartageInvestisseurComptes";
import { PartageInvestisseurNotes } from "../../../../../../../components/due-diligence/PartageInvestisseurNotes";
import { PartageInvestisseurPublications } from "../../../../../../../components/due-diligence/PartageInvestisseurPublications";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  cheminPartageDossier,
  droitsPortailDd,
  EXPLICATION_OPTION_DESACTIVEE,
  EXPLICATION_OPTION_DESACTIVEE_EN,
  hrefPartageInvestisseur,
  hrefReglagePortailDd,
  publicationsActives,
} from "../../../../../../../lib/due-diligence-portail";
import { obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Partage avec l'investisseur", "Sharing with the investor") };
}

/**
 * Partage avec l'investisseur (portail, lecture seule) : état de l'option du cabinet, comptes à
 * inviter ou retirer, notes validées à publier avec leurs rapports, publications actives. Réservé
 * à `dd.portail.gerer` (l'API juge) ; l'option se règle dans les paramètres de la due diligence.
 */
export default async function PagePartageInvestisseur({
  params,
}: {
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("dd.lire");
  const droits = droitsPortailDd(utilisateur.roles);
  if (!droits.gerer) {
    return (
      <Carte titre={t("Partage avec l'investisseur", "Sharing with the investor")} niveauTitre={3}>
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {t(
              "Le partage avec l'investisseur est réservé aux associés et aux directeurs de mission du cabinet.",
              "Sharing with the investor is reserved for the firm's partners and engagement directors.",
            )}
          </p>
        </Alerte>
      </Carte>
    );
  }
  const mission = await chargerMission(id);
  if (!mission.ok) return null;
  const r = await chargerServeur<DdPortailEtatDossier>(cheminPartageDossier(dossierId));
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t(
          "Le partage avec l'investisseur n'a pas pu être chargé.",
          "The sharing with the investor could not be loaded.",
        )}
        message={r.message}
        hrefReessayer={hrefPartageInvestisseur(id, dossierId)}
      />
    );
  }
  const etat = r.donnees;
  const cloturee = mission.donnees.statut === "cloturee";

  return (
    <>
      <Carte
        titre={t("Partage avec l'investisseur", "Sharing with the investor")}
        niveauTitre={3}
        actions={
          <BadgeStatut tonalite={etat.option_active ? "succes" : "neutre"}>
            {etat.option_active
              ? t("Portail activé", "Portal enabled")
              : t("Portail désactivé", "Portal disabled")}
          </BadgeStatut>
        }
      >
        <p>
          {t(
            "L'investisseur consulte en lecture seule les notes validées que vous publiez ici, avec les rapports que vous choisissez. Rien n'est publié sans votre action, et chaque note reste une copie figée de la version validée.",
            "The investor views, read-only, the approved memos you publish here, with the reports you choose. Nothing is published without your action, and each memo remains a frozen copy of the approved version.",
          )}
        </p>
        {!etat.option_active ? (
          <Alerte
            tonalite="attention"
            annonce="aucune"
            titre={t("Option désactivée", "Option disabled")}
          >
            <p>{t(EXPLICATION_OPTION_DESACTIVEE, EXPLICATION_OPTION_DESACTIVEE_EN)}</p>
            {droits.configurer ? (
              <p>
                <Link href={hrefReglagePortailDd}>
                  {t("Activer l'option dans les paramètres", "Enable the option in the settings")}
                </Link>
              </p>
            ) : null}
          </Alerte>
        ) : null}
        {cloturee ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>
              {t(
                "La mission est clôturée : le partage est figé, les actions seront refusées.",
                "The engagement is closed: sharing is frozen, actions will be refused.",
              )}
            </p>
          </Alerte>
        ) : null}
      </Carte>
      <Carte titre={t("Comptes investisseurs", "Investor accounts")} niveauTitre={3}>
        <PartageInvestisseurComptes dossierId={dossierId} comptes={etat.comptes} />
      </Carte>
      <Carte titre={t("Notes publiables", "Publishable memos")} niveauTitre={3}>
        <PartageInvestisseurNotes notes={etat.notes_publiables} optionActive={etat.option_active} />
      </Carte>
      <Carte titre={t("Publications actives", "Active publications")} niveauTitre={3}>
        <PartageInvestisseurPublications publications={publicationsActives(etat.publications)} />
      </Carte>
    </>
  );
}
