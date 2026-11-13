import type { ReactNode } from "react";
import "../../../../../components/redressement/redressement.css";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Onglets } from "../../../../../components/ui/Onglets";
import { formaterDate, libelleDevise } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import {
  libelleSecteur,
  libelleStatutDossier,
  sousPagesRedressement,
  tonaliteStatutDossier,
} from "../../../../../lib/redressement";
import { chargerDossierMission } from "../../../../../lib/redressement-serveur";
import { exigerPermission } from "../../../../../lib/session";

/**
 * En-tête commun du dossier de redressement d'une mission (intitulé, statut, secteur, devise) et
 * navigation entre ses sections. Sans dossier (ou si son chargement échoue), seule la page
 * affiche l'état : la navigation de la mission reste utilisable.
 */
export default async function LayoutRedressement({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const langue = await obtenirLangue();
  const t = await obtenirT();
  await exigerPermission("redressement.lire");
  const d = await chargerDossierMission(id);
  return (
    <div className="mp-red">
      {d.ok ? (
        <>
          <div className="mp-red-entete">
            <h2 className="mp-red-entete__titre">{d.donnees.intitule}</h2>
            <BadgeStatut tonalite={tonaliteStatutDossier(d.donnees.statut)}>
              {libelleStatutDossier(d.donnees.statut, langue)}
            </BadgeStatut>
            <span className="mp-texte-doux">
              {libelleSecteur(d.donnees.secteur, langue)} · {libelleDevise(d.donnees.devise)} ·{" "}
              {t("ouvert le", "opened on")} {formaterDate(d.donnees.ouvert_le, "UTC", langue)}
            </span>
          </div>
          <Onglets
            libelle={t("Sections du dossier de redressement", "Turnaround file sections")}
            pages={sousPagesRedressement(id, langue)}
          />
        </>
      ) : null}
      {children}
    </div>
  );
}
