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
  EXPLICATION_OPTION_DESACTIVEE_EN,
  hrefReglagePortailDd,
} from "../../../../../lib/due-diligence-portail";
import { formaterDateHeure } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Portail investisseur", "Investor portal") };
}

/**
 * Option du cabinet « portail investisseur » : désactivée par défaut, réglée par un associé seul
 * (`dd.portail.configurer`). Les autres rôles de gestion la lisent sans pouvoir la modifier.
 */
export default async function PageOptionPortailDd() {
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("dd.lire");
  const droits = droitsPortailDd(utilisateur.roles);
  if (!droits.gerer && !droits.configurer) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Portail investisseur", "Investor portal")} />
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {t(
              "Ce réglage est réservé aux associés et aux directeurs de mission du cabinet.",
              "This setting is reserved for the firm's partners and engagement directors.",
            )}
          </p>
        </Alerte>
      </div>
    );
  }
  const r = await chargerServeur<DdPortailOption>(cheminOptionPortailDd);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Portail investisseur", "Investor portal")}
        soustitre={t(
          "Permet aux investisseurs invités de consulter, en lecture seule, les notes de due diligence validées que vous publiez depuis un dossier.",
          "Allows invited investors to view, read-only, the approved due diligence memos you publish from a file.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t("L'option n'a pas pu être chargée.", "The option could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefReglagePortailDd}
        />
      ) : (
        <Carte
          titre={t("Partage avec les investisseurs", "Sharing with investors")}
          niveauTitre={2}
          actions={
            <BadgeStatut tonalite={r.donnees.actif ? "succes" : "neutre"}>
              {etatOption(r.donnees.actif, r.donnees.modifie_le, langue)}
            </BadgeStatut>
          }
        >
          {r.donnees.modifie_le ? (
            <p className="mp-texte-doux">
              {t(
                `Dernière modification : ${formaterDateHeure(r.donnees.modifie_le)}.`,
                `Last modified: ${formaterDateHeure(r.donnees.modifie_le, undefined, langue)}.`,
              )}
            </p>
          ) : null}
          {!r.donnees.actif ? (
            <p>{t(EXPLICATION_OPTION_DESACTIVEE, EXPLICATION_OPTION_DESACTIVEE_EN)}</p>
          ) : null}
          {droits.configurer ? (
            <PartageInvestisseurOption actif={r.donnees.actif} />
          ) : (
            <Alerte tonalite="info" annonce="aucune">
              <p>
                {t(
                  "Lecture seule : seul un associé peut activer ou désactiver cette option.",
                  "Read-only: only a partner can enable or disable this option.",
                )}
              </p>
            </Alerte>
          )}
        </Carte>
      )}
    </div>
  );
}
