import type { Metadata } from "next";
import type { DdPortailOption } from "@missionpilot/shared";
import { PartageInvestisseurOption } from "../../../../../components/due-diligence/PartageInvestisseurOption";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  cheminOptionPortailDd,
  droitsPortailDd,
  etatOption,
  EXPLICATION_OPTION_DESACTIVEE,
  hrefReglagePortailDd,
} from "../../../../../lib/due-diligence-portail";
import { formaterDateHeure } from "../../../../../lib/format";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Portail investisseur" };

/**
 * Option du cabinet « portail investisseur » : désactivée par défaut, réglée par un associé seul
 * (`dd.portail.configurer`). Les autres rôles de gestion la lisent sans pouvoir la modifier.
 */
export default async function PageOptionPortailDd() {
  const { utilisateur } = await exigerPermission("dd.lire");
  const droits = droitsPortailDd(utilisateur.roles);
  if (!droits.gerer && !droits.configurer) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Portail investisseur" />
        <Alerte tonalite="info" annonce="aucune">
          <p>Ce réglage est réservé aux associés et aux directeurs de mission du cabinet.</p>
        </Alerte>
      </div>
    );
  }
  const r = await chargerServeur<DdPortailOption>(cheminOptionPortailDd);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Portail investisseur"
        soustitre="Permet aux investisseurs invités de consulter, en lecture seule, les notes de due diligence validées que vous publiez depuis un dossier."
      />
      {!r.ok ? (
        <EtatErreur
          titre="L'option n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefReglagePortailDd}
        />
      ) : (
        <Carte
          titre="Partage avec les investisseurs"
          niveauTitre={2}
          actions={
            <BadgeStatut tonalite={r.donnees.actif ? "succes" : "neutre"}>
              {etatOption(r.donnees.actif, r.donnees.modifie_le)}
            </BadgeStatut>
          }
        >
          {r.donnees.modifie_le ? (
            <p className="mp-texte-doux">{`Dernière modification : ${formaterDateHeure(r.donnees.modifie_le)}.`}</p>
          ) : null}
          {!r.donnees.actif ? <p>{EXPLICATION_OPTION_DESACTIVEE}</p> : null}
          {droits.configurer ? (
            <PartageInvestisseurOption actif={r.donnees.actif} />
          ) : (
            <Alerte tonalite="info" annonce="aucune">
              <p>Lecture seule : seul un associé peut activer ou désactiver cette option.</p>
            </Alerte>
          )}
        </Carte>
      )}
    </div>
  );
}
