import type {
  RedSuiviComparaisonVue,
  RedSuiviJalonVue,
  RedSuiviReleveVue,
  Langue,
} from "@missionpilot/shared";
import { RED_SUIVI_RATIOS } from "@missionpilot/shared";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { formaterVariationRatio } from "../../lib/redressement-cloture";
import {
  formaterRatioSuivi,
  libelleEcheanceJalon,
  libelleGraviteSuivi,
  libelleJalon,
  libelleRatioSuivi,
  libelleReports,
  libelleSensSuivi,
  libelleSourceReleve,
  libelleStatutJalon,
  libelleTypeEvenementSuivi,
  tonaliteGraviteSuivi,
  tonaliteSensSuivi,
  tonaliteStatutJalon,
} from "../../lib/redressement-suivi";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import { SuiviEvenementForm } from "./SuiviEvenementForm";
import { SuiviReleveForm } from "./SuiviReleveForm";

function Releve({
  r,
  langue,
  t,
}: {
  r: RedSuiviReleveVue;
  langue: Langue;
  t: (fr: string, en: string) => string;
}) {
  const ratios = RED_SUIVI_RATIOS.filter((k) => r.ratios[k] !== undefined);
  const date = formaterDate(r.date_releve, "UTC", langue);
  return (
    <li className="mp-diag-item">
      <p className="mp-sui-meta">
        <strong>{t(`Relevé du ${date}`, `Reading of ${date}`)}</strong>
        <BadgeStatut tonalite="neutre" sansIcone>
          {libelleSourceReleve(r.source, langue)}
        </BadgeStatut>
        <span className="mp-texte-doux mp-texte-petit">{`${r.cree_par.nom}, ${formaterDateHeure(r.cree_le, undefined, langue)}`}</span>
      </p>
      {ratios.length > 0 ? (
        <dl
          className="mp-clo-liste-def"
          aria-label={t("Ratios du relevé", "Ratios of the reading")}
        >
          {ratios.map((k) => (
            <div key={k}>
              <dt>{libelleRatioSuivi(k, langue)}</dt>
              <dd>{formaterRatioSuivi(k, r.ratios[k], langue)}</dd>
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
export async function SuiviJalon({
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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const reports = libelleReports(j.nombre_reports, langue);
  const colonnes: ColonneTableau<RedSuiviComparaisonVue>[] = [
    { cle: "ratio", entete: "Ratio", rendu: (c) => libelleRatioSuivi(c.ratio, langue) },
    {
      cle: "reference",
      entete: t("Clôture", "Close-out"),
      alignement: "droite",
      rendu: (c) => formaterRatioSuivi(c.ratio, c.reference_pb, langue),
    },
    {
      cle: "releve",
      entete: t("Relevé", "Reading"),
      alignement: "droite",
      rendu: (c) => formaterRatioSuivi(c.ratio, c.releve_pb, langue),
    },
    {
      cle: "variation",
      entete: t("Variation (points)", "Change (points)"),
      alignement: "droite",
      rendu: (c) => formaterVariationRatio(c.ratio, c.variation_pb, langue),
    },
    {
      cle: "sens",
      entete: t("Sens", "Direction"),
      rendu: (c) => (
        <span>
          <BadgeStatut tonalite={tonaliteSensSuivi(c.sens)}>
            {libelleSensSuivi(c.sens, langue)}
          </BadgeStatut>
          {c.gravite ? (
            <>
              {" "}
              <BadgeStatut tonalite={tonaliteGraviteSuivi(c.gravite)} sansIcone>
                {libelleGraviteSuivi(c.gravite, langue)}
              </BadgeStatut>
            </>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <Carte className="mp-sui-jalon" titre={libelleJalon(j, langue)} niveauTitre={3}>
      <div className="mp-pile">
        <p className="mp-sui-meta">
          <BadgeStatut tonalite={tonaliteStatutJalon(j.statut)}>
            {libelleStatutJalon(j.statut, langue)}
          </BadgeStatut>
          {reports ? (
            <BadgeStatut tonalite="neutre" sansIcone>
              {reports}
            </BadgeStatut>
          ) : null}
          <span>
            {t(
              `Date prévue : ${formaterDate(j.date_prevue_courante, "UTC", langue)}`,
              `Planned date: ${formaterDate(j.date_prevue_courante, "UTC", langue)}`,
            )}
          </span>
          {j.date_prevue !== j.date_prevue_courante ? (
            <span className="mp-texte-doux">
              {t(
                `(initialement ${formaterDate(j.date_prevue, "UTC", langue)})`,
                `(originally ${formaterDate(j.date_prevue, "UTC", langue)})`,
              )}
            </span>
          ) : null}
          <span className="mp-texte-doux">
            {j.statut === "realise" && j.realise_le
              ? t(
                  `Réalisé le ${formaterDate(j.realise_le, "UTC", langue)}`,
                  `Completed on ${formaterDate(j.realise_le, "UTC", langue)}`,
                )
              : libelleEcheanceJalon(j, langue)}
          </span>
        </p>

        <h4 className="mp-rapport-contenu__titre">{t("Relevés", "Readings")}</h4>
        {j.releves.length === 0 ? (
          <p className="mp-texte-doux">
            {t("Aucun relevé pour ce jalon.", "No reading for this milestone.")}
          </p>
        ) : (
          <ul
            className="mp-sui-liste"
            aria-label={t(`Relevés du jalon ${j.rang}`, `Readings of milestone ${j.rang}`)}
          >
            {j.releves.map((r) => (
              <Releve key={r.id} r={r} langue={langue} t={t} />
            ))}
          </ul>
        )}

        {j.comparaisons.length > 0 ? (
          <Tableau
            legende={t(
              `Dernier relevé du jalon ${j.rang} comparé à la clôture`,
              `Latest reading of milestone ${j.rang} compared to close-out`,
            )}
            legendeVisible
            colonnes={colonnes}
            lignes={j.comparaisons}
            cleLigne={(c) => c.ratio}
          />
        ) : null}

        {j.evenements.length > 0 ? (
          <>
            <h4 className="mp-rapport-contenu__titre">{t("Historique", "History")}</h4>
            <ul
              className="mp-sui-liste"
              aria-label={t(`Historique du jalon ${j.rang}`, `History of milestone ${j.rang}`)}
            >
              {j.evenements.map((e) => (
                <li key={e.id}>
                  {`${libelleTypeEvenementSuivi(e.type, langue)}${t(" : ", ": ")}${formaterDate(e.date_effet, "UTC", langue)}`}
                  {e.motif ? `${t(", motif : ", ", reason: ")}${e.motif}` : ""}
                  <span className="mp-texte-doux mp-texte-petit">{` (${e.cree_par.nom})`}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {peutEcrire ? (
          <div className="mp-sui-formulaires">
            <details className="mp-diag-details">
              <summary>
                {t(
                  `Enregistrer un relevé pour le jalon ${j.rang}`,
                  `Save a reading for milestone ${j.rang}`,
                )}
              </summary>
              <SuiviReleveForm
                dossierId={dossierId}
                jalons={jalons}
                jalonId={j.id}
                aujourdhui={aujourdhui}
              />
            </details>
            {j.statut === "realise" ? null : (
              <details className="mp-diag-details">
                <summary>
                  {t(
                    `Réaliser ou reporter le jalon ${j.rang}`,
                    `Complete or postpone milestone ${j.rang}`,
                  )}
                </summary>
                <SuiviEvenementForm dossierId={dossierId} jalonId={j.id} aujourdhui={aujourdhui} />
              </details>
            )}
          </div>
        ) : null}
      </div>
    </Carte>
  );
}
