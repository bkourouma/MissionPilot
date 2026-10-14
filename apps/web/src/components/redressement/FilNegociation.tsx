import type { RedEvenementNegociationVue } from "@missionpilot/shared";
import {
  formaterDate,
  formaterDateHeure,
  formaterMontantMineur,
  type Devise,
} from "../../lib/format";
import { libelleTypeEvenement } from "../../lib/redressement";

/**
 * Fil de négociation d'un créancier, du plus ancien au plus récent (type, date, montant,
 * conditions, auteur). Les conditions négociées sont confidentielles : elles n'apparaissent
 * jamais dans le journal d'audit, seulement ici pour les membres autorisés du dossier.
 */
export function FilNegociation({
  evenements,
  devise,
}: {
  evenements: RedEvenementNegociationVue[];
  devise: Devise;
}) {
  if (evenements.length === 0) {
    return <p className="mp-texte-doux">Aucun événement de négociation enregistré.</p>;
  }
  return (
    <ol className="mp-red-fil" aria-label="Fil de négociation">
      {evenements.map((e) => (
        <li key={e.id} className="mp-red-evenement">
          <div className="mp-red-evenement__entete">
            <p className="mp-red-evenement__titre">{libelleTypeEvenement(e.type)}</p>
            <span className="mp-texte-doux mp-texte-petit">{formaterDate(e.date_evenement)}</span>
          </div>
          {e.montant !== null ? (
            <p className="mp-red-valeur">
              Montant : {formaterMontantMineur(e.montant, devise)}
              {e.echeance_rang !== null ? ` (échéance ${e.echeance_rang})` : ""}
            </p>
          ) : null}
          {e.conditions ? (
            <p className="mp-red-evenement__texte">Conditions : {e.conditions}</p>
          ) : null}
          <p className="mp-texte-doux mp-texte-petit">
            {e.auteur.nom}, le {formaterDateHeure(e.cree_le)}
          </p>
        </li>
      ))}
    </ol>
  );
}
