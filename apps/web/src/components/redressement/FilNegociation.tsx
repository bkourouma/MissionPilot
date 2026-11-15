import type { RedEvenementNegociationVue } from "@missionpilot/shared";
import {
  formaterDate,
  formaterDateHeure,
  formaterMontantMineur,
  type Devise,
} from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { creerTraduire } from "@missionpilot/shared";
import { libelleTypeEvenement } from "../../lib/redressement";

/**
 * Fil de négociation d'un créancier, du plus ancien au plus récent (type, date, montant,
 * conditions, auteur). Les conditions négociées sont confidentielles : elles n'apparaissent
 * jamais dans le journal d'audit, seulement ici pour les membres autorisés du dossier.
 */
export async function FilNegociation({
  evenements,
  devise,
}: {
  evenements: RedEvenementNegociationVue[];
  devise: Devise;
}) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  if (evenements.length === 0) {
    return (
      <p className="mp-texte-doux">
        {t("Aucun événement de négociation enregistré.", "No negotiation event recorded.")}
      </p>
    );
  }
  return (
    <ol className="mp-red-fil" aria-label={t("Fil de négociation", "Negotiation timeline")}>
      {evenements.map((e) => (
        <li key={e.id} className="mp-red-evenement">
          <div className="mp-red-evenement__entete">
            <p className="mp-red-evenement__titre">{libelleTypeEvenement(e.type, langue)}</p>
            <span className="mp-texte-doux mp-texte-petit">
              {formaterDate(e.date_evenement, "UTC", langue)}
            </span>
          </div>
          {e.montant !== null ? (
            <p className="mp-red-valeur">
              {t("Montant :", "Amount:")} {formaterMontantMineur(e.montant, devise, langue)}
              {e.echeance_rang !== null
                ? ` (${t("échéance", "installment")} ${e.echeance_rang})`
                : ""}
            </p>
          ) : null}
          {e.conditions ? (
            <p className="mp-red-evenement__texte">
              {t("Conditions :", "Terms:")} {e.conditions}
            </p>
          ) : null}
          <p className="mp-texte-doux mp-texte-petit">
            {e.auteur.nom}, {t("le", "on")} {formaterDateHeure(e.cree_le, undefined, langue)}
          </p>
        </li>
      ))}
    </ol>
  );
}
