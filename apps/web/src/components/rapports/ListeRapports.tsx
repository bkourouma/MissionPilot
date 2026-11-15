import { creerTraduire } from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import type { Personne } from "../../lib/personnes";
import {
  libelleFormatRapport,
  libelleModeleVariante,
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
export async function ListeRapports({ rapports, utilisateurId, personnes }: ListeRapportsProps) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  return (
    <ul className="mp-liste-lignes" aria-label={t("Rapports générés", "Generated reports")}>
      {rapports.map((r) => {
        const date = formaterDateHeure(r.genere_le, undefined, langue);
        const modele = libelleModeleVariante(r.modele, r.variante, langue);
        const format = libelleFormatRapport(r.format, langue);
        return (
          <li key={r.id} className="mp-liste-lignes__ligne mp-rapport">
            <div className="mp-rapport__texte">
              <h3 className="mp-rapport__titre">
                {modele}
                <span className="mp-visuellement-cache">{` ${t("du", "on")} ${date}`}</span>
              </h3>
              <dl className="mp-rapport__meta">
                <div>
                  <dt>{t("Généré le", "Generated on")}</dt>
                  <dd>{date}</dd>
                </div>
                <div>
                  <dt>{t("Par", "By")}</dt>
                  <dd className="mp-coupure">
                    {nomAuteur(r.genere_par, utilisateurId, personnes, langue)}
                  </dd>
                </div>
                <div>
                  <dt>{t("Format", "Format")}</dt>
                  <dd>{format}</dd>
                </div>
                <div>
                  <dt>{t("Niveau", "Level")}</dt>
                  <dd>
                    <BadgeNiveau niveau={r.niveau} />
                  </dd>
                </div>
                <div>
                  <dt>{t("Statut", "Status")}</dt>
                  <dd>
                    <BadgeStatut tonalite="neutre" sansIcone>
                      {libelleStatutRapport(r.statut, langue)}
                    </BadgeStatut>
                  </dd>
                </div>
              </dl>
              <FichierJoint
                fichier={r.fichier}
                contexte={`(${modele} ${t("du", "on")} ${date}, ${format})`}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
