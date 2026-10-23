import type { ReactNode } from "react";
import "../../../../../components/redressement/redressement.css";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Onglets } from "../../../../../components/ui/Onglets";
import { formaterDate, libelleDevise } from "../../../../../lib/format";
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
  await exigerPermission("redressement.lire");
  const d = await chargerDossierMission(id);
  return (
    <div className="mp-red">
      {d.ok ? (
        <>
          <div className="mp-red-entete">
            <h2 className="mp-red-entete__titre">{d.donnees.intitule}</h2>
            <BadgeStatut tonalite={tonaliteStatutDossier(d.donnees.statut)}>
              {libelleStatutDossier(d.donnees.statut)}
            </BadgeStatut>
            <span className="mp-texte-doux">
              {libelleSecteur(d.donnees.secteur)} · {libelleDevise(d.donnees.devise)} · ouvert le{" "}
              {formaterDate(d.donnees.ouvert_le)}
            </span>
          </div>
          <Onglets
            libelle="Sections du dossier de redressement"
            pages={sousPagesRedressement(id)}
          />
        </>
      ) : null}
      {children}
    </div>
  );
}
