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
  hrefPartageInvestisseur,
  hrefReglagePortailDd,
  publicationsActives,
} from "../../../../../../../lib/due-diligence-portail";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Partage avec l'investisseur" };

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
  const { utilisateur } = await exigerPermission("dd.lire");
  const droits = droitsPortailDd(utilisateur.roles);
  if (!droits.gerer) {
    return (
      <Carte titre="Partage avec l'investisseur" niveauTitre={3}>
        <Alerte tonalite="info" annonce="aucune">
          <p>
            Le partage avec l&apos;investisseur est réservé aux associés et aux directeurs de
            mission du cabinet.
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
        titre="Le partage avec l'investisseur n'a pas pu être chargé."
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
        titre="Partage avec l'investisseur"
        niveauTitre={3}
        actions={
          <BadgeStatut tonalite={etat.option_active ? "succes" : "neutre"}>
            {etat.option_active ? "Portail activé" : "Portail désactivé"}
          </BadgeStatut>
        }
      >
        <p>
          L&apos;investisseur consulte en lecture seule les notes validées que vous publiez ici,
          avec les rapports que vous choisissez. Rien n&apos;est publié sans votre action, et chaque
          note reste une copie figée de la version validée.
        </p>
        {!etat.option_active ? (
          <Alerte tonalite="attention" annonce="aucune" titre="Option désactivée">
            <p>{EXPLICATION_OPTION_DESACTIVEE}</p>
            {droits.configurer ? (
              <p>
                <Link href={hrefReglagePortailDd}>Activer l&apos;option dans les paramètres</Link>
              </p>
            ) : null}
          </Alerte>
        ) : null}
        {cloturee ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>La mission est clôturée : le partage est figé, les actions seront refusées.</p>
          </Alerte>
        ) : null}
      </Carte>
      <Carte titre="Comptes investisseurs" niveauTitre={3}>
        <PartageInvestisseurComptes dossierId={dossierId} comptes={etat.comptes} />
      </Carte>
      <Carte titre="Notes publiables" niveauTitre={3}>
        <PartageInvestisseurNotes notes={etat.notes_publiables} optionActive={etat.option_active} />
      </Carte>
      <Carte titre="Publications actives" niveauTitre={3}>
        <PartageInvestisseurPublications publications={publicationsActives(etat.publications)} />
      </Carte>
    </>
  );
}
