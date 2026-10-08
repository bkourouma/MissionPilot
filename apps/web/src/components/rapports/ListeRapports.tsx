import { formaterDateHeure } from "../../lib/format";
import type { Personne } from "../../lib/personnes";
import {
  libelleFormat,
  libelleModele,
  libelleStatutRapport,
  nomAuteur,
  type RapportMission,
} from "../../lib/rapports";
import { FichierJoint } from "../fichiers/FichierJoint";
import { BadgeStatut } from "../ui/BadgeStatut";
import { BadgeNiveau } from "./BadgeNiveau";
import "./rapports.css";

export interface ListeRapportsProps {
  rapports: readonly RapportMission[];
  /** Utilisateur connecté (affiché « Vous » comme auteur). */
  utilisateurId: string;
  /** Noms connus (référentiel du cabinet, équipe de la mission). */
  personnes: readonly Personne[];
}

/**
 * Rapports déjà générés : date, auteur, format, niveau (libellé et icône), statut, et liens
 * authentifiés d'ouverture et de téléchargement (`FichierJoint`, revérifiés par l'API à chaque
 * appel). La liste ne contient que ce que l'API a jugé lisible par l'utilisateur.
 */
export function ListeRapports({ rapports, utilisateurId, personnes }: ListeRapportsProps) {
  return (
    <ul className="mp-liste-lignes" aria-label="Rapports générés">
      {rapports.map((r) => {
        const date = formaterDateHeure(r.genere_le);
        const modele = libelleModele(r.modele);
        const format = libelleFormat(r.format);
        return (
          <li key={r.id} className="mp-liste-lignes__ligne mp-rapport">
            <div className="mp-rapport__texte">
              <h3 className="mp-rapport__titre">
                {modele}
                <span className="mp-visuellement-cache">{` du ${date}`}</span>
              </h3>
              <dl className="mp-rapport__meta">
                <div>
                  <dt>Généré le</dt>
                  <dd>{date}</dd>
                </div>
                <div>
                  <dt>Par</dt>
                  <dd className="mp-coupure">
                    {nomAuteur(r.genere_par, utilisateurId, personnes)}
                  </dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>{format}</dd>
                </div>
                <div>
                  <dt>Niveau</dt>
                  <dd>
                    <BadgeNiveau niveau={r.niveau} />
                  </dd>
                </div>
                <div>
                  <dt>Statut</dt>
                  <dd>
                    <BadgeStatut tonalite="neutre" sansIcone>
                      {libelleStatutRapport(r.statut)}
                    </BadgeStatut>
                  </dd>
                </div>
              </dl>
              <FichierJoint fichier={r.fichier} contexte={`(${modele} du ${date}, ${format})`} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
