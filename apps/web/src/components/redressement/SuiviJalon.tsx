import type {
  RedSuiviComparaisonVue,
  RedSuiviJalonVue,
  RedSuiviReleveVue,
} from "@missionpilot/shared";
import { RED_SUIVI_RATIOS, RED_SUIVI_TYPE_EVENEMENT_LIBELLES } from "@missionpilot/shared";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import { formaterVariationRatio } from "../../lib/redressement-cloture";
import {
  formaterRatioSuivi,
  libelleEcheanceJalon,
  libelleGraviteSuivi,
  libelleRatioSuivi,
  libelleReports,
  libelleSensSuivi,
  libelleSourceReleve,
  libelleStatutJalon,
  tonaliteGraviteSuivi,
  tonaliteSensSuivi,
  tonaliteStatutJalon,
} from "../../lib/redressement-suivi";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import { SuiviEvenementForm } from "./SuiviEvenementForm";
import { SuiviReleveForm } from "./SuiviReleveForm";

const COLONNES: ColonneTableau<RedSuiviComparaisonVue>[] = [
  { cle: "ratio", entete: "Ratio", rendu: (c) => libelleRatioSuivi(c.ratio) },
  {
    cle: "reference",
    entete: "Clôture",
    alignement: "droite",
    rendu: (c) => formaterRatioSuivi(c.ratio, c.reference_pb),
  },
  {
    cle: "releve",
    entete: "Relevé",
    alignement: "droite",
    rendu: (c) => formaterRatioSuivi(c.ratio, c.releve_pb),
  },
  {
    cle: "variation",
    entete: "Variation (points)",
    alignement: "droite",
    rendu: (c) => formaterVariationRatio(c.ratio, c.variation_pb),
  },
  {
    cle: "sens",
    entete: "Sens",
    rendu: (c) => (
      <span>
        <BadgeStatut tonalite={tonaliteSensSuivi(c.sens)}>{libelleSensSuivi(c.sens)}</BadgeStatut>
        {c.gravite ? (
          <>
            {" "}
            <BadgeStatut tonalite={tonaliteGraviteSuivi(c.gravite)} sansIcone>
              {libelleGraviteSuivi(c.gravite)}
            </BadgeStatut>
          </>
        ) : null}
      </span>
    ),
  },
];

function Releve({ r }: { r: RedSuiviReleveVue }) {
  const ratios = RED_SUIVI_RATIOS.filter((k) => r.ratios[k] !== undefined);
  return (
    <li className="mp-diag-item">
      <p className="mp-sui-meta">
        <strong>{`Relevé du ${formaterDate(r.date_releve)}`}</strong>
        <BadgeStatut tonalite="neutre" sansIcone>
          {libelleSourceReleve(r.source)}
        </BadgeStatut>
        <span className="mp-texte-doux mp-texte-petit">{`${r.cree_par.nom}, ${formaterDateHeure(r.cree_le)}`}</span>
      </p>
      {ratios.length > 0 ? (
        <dl className="mp-clo-liste-def" aria-label="Ratios du relevé">
          {ratios.map((k) => (
            <div key={k}>
              <dt>{libelleRatioSuivi(k)}</dt>
              <dd>{formaterRatioSuivi(k, r.ratios[k])}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {r.commentaire ? <p className="mp-texte-doux">{r.commentaire}</p> : null}
    </li>
  );
}

/**
 * Un jalon du suivi : échéance (date prévue courante, reports), relevés, comparaison du dernier
 * relevé à la clôture (variation en points) et historique des événements. Les formulaires ne sont
 * proposés qu'à qui peut écrire ; le jalon réalisé n'a plus de formulaire d'événement.
 */
export function SuiviJalon({
  dossierId,
  jalon: j,
  jalons,
  peutEcrire,
  aujourdhui,
}: {
  dossierId: string;
  jalon: RedSuiviJalonVue;
  jalons: readonly RedSuiviJalonVue[];
  peutEcrire: boolean;
  aujourdhui: string;
}) {
  const reports = libelleReports(j.nombre_reports);
  return (
    <Carte className="mp-sui-jalon" titre={`Jalon ${j.rang} : ${j.libelle}`} niveauTitre={3}>
      <div className="mp-pile">
        <p className="mp-sui-meta">
          <BadgeStatut tonalite={tonaliteStatutJalon(j.statut)}>
            {libelleStatutJalon(j.statut)}
          </BadgeStatut>
          {reports ? (
            <BadgeStatut tonalite="neutre" sansIcone>
              {reports}
            </BadgeStatut>
          ) : null}
          <span>{`Date prévue : ${formaterDate(j.date_prevue_courante)}`}</span>
          {j.date_prevue !== j.date_prevue_courante ? (
            <span className="mp-texte-doux">{`(initialement ${formaterDate(j.date_prevue)})`}</span>
          ) : null}
          <span className="mp-texte-doux">
            {j.statut === "realise" && j.realise_le
              ? `Réalisé le ${formaterDate(j.realise_le)}`
              : libelleEcheanceJalon(j)}
          </span>
        </p>

        <h4 className="mp-rapport-contenu__titre">Relevés</h4>
        {j.releves.length === 0 ? (
          <p className="mp-texte-doux">Aucun relevé pour ce jalon.</p>
        ) : (
          <ul className="mp-sui-liste" aria-label={`Relevés du jalon ${j.rang}`}>
            {j.releves.map((r) => (
              <Releve key={r.id} r={r} />
            ))}
          </ul>
        )}

        {j.comparaisons.length > 0 ? (
          <Tableau
            legende={`Dernier relevé du jalon ${j.rang} comparé à la clôture`}
            legendeVisible
            colonnes={COLONNES}
            lignes={j.comparaisons}
            cleLigne={(c) => c.ratio}
          />
        ) : null}

        {j.evenements.length > 0 ? (
          <>
            <h4 className="mp-rapport-contenu__titre">Historique</h4>
            <ul className="mp-sui-liste" aria-label={`Historique du jalon ${j.rang}`}>
              {j.evenements.map((e) => (
                <li key={e.id}>
                  {`${RED_SUIVI_TYPE_EVENEMENT_LIBELLES[e.type]} : ${formaterDate(e.date_effet)}`}
                  {e.motif ? `, motif : ${e.motif}` : ""}
                  <span className="mp-texte-doux mp-texte-petit">{` (${e.cree_par.nom})`}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {peutEcrire ? (
          <div className="mp-sui-formulaires">
            <details className="mp-diag-details">
              <summary>{`Enregistrer un relevé pour le jalon ${j.rang}`}</summary>
              <SuiviReleveForm
                dossierId={dossierId}
                jalons={jalons}
                jalonId={j.id}
                aujourdhui={aujourdhui}
              />
            </details>
            {j.statut === "realise" ? null : (
              <details className="mp-diag-details">
                <summary>{`Réaliser ou reporter le jalon ${j.rang}`}</summary>
                <SuiviEvenementForm dossierId={dossierId} jalonId={j.id} aujourdhui={aujourdhui} />
              </details>
            )}
          </div>
        ) : null}
      </div>
    </Carte>
  );
}
