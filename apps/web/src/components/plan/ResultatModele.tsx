"use client";

import type { Devise } from "../../lib/format";
import {
  alertePlan,
  alertesParScenario,
  descriptionEcarts,
  ETATS_FINANCIERS,
  indicateursCles,
  lignesScenarios,
  libelleScenario,
  mentionRatios,
  mentionSyscohada,
  SCENARIOS,
  texteAlerte,
  titreEtat,
  titreAlertesScenario,
  type CodeAlertePlan,
  type ResultatScenarios,
} from "../../lib/plan-modele";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { GraphiqueTresorerie } from "./GraphiqueTresorerie";
import { TableauEtat } from "./TableauEtat";

type NiveauTitre = 3 | 4 | 5;

/** Alertes déterministes du moteur, en évidence : gravité et montants écrits, pas seulement la couleur. */
export function AlertesModele({
  resultat,
  devise,
}: {
  resultat: ResultatScenarios;
  devise: Devise;
}) {
  const t = useT();
  const langue = useLangue();
  const groupes = alertesParScenario(resultat);
  if (groupes.length === 0) {
    return (
      <Alerte tonalite="succes" titre={t("Aucune alerte", "No alerts")} annonce="aucune">
        <p>
          {t(
            "Trésorerie, capitaux propres et équilibre du bilan restent dans les seuils pour les trois scénarios.",
            "Cash, equity and balance sheet balance stay within thresholds in all three scenarios.",
          )}
        </p>
      </Alerte>
    );
  }
  return (
    <div className="mp-plan__section">
      {groupes.map(({ scenario, alertes }) => {
        const critique = alertes.some((a) => a.gravite === "critique");
        const codes = [...new Set(alertes.map((a) => a.code))];
        return (
          <Alerte
            key={scenario}
            tonalite={critique ? "danger" : "attention"}
            titre={titreAlertesScenario(scenario, alertes, langue)}
            annonce="aucune"
          >
            <ul className="mp-plan-alertes">
              {alertes.map((a) => (
                <li key={`${a.code}-${a.annee}`}>{texteAlerte(a, devise, langue)}</li>
              ))}
            </ul>
            {codes.map((c) => {
              const info = alertePlan(c as CodeAlertePlan, langue);
              return info ? (
                <p key={c} className="mp-texte-petit">
                  <strong>
                    {info.libelle}
                    {langue === "en" ? ":" : " :"}
                  </strong>{" "}
                  {info.explication}
                </p>
              ) : null;
            })}
          </Alerte>
        );
      })}
    </div>
  );
}

/** Indicateurs clés du scénario de base (synthèse du moteur). */
export function IndicateursCles({
  resultat,
  devise,
}: {
  resultat: ResultatScenarios;
  devise: Devise;
}) {
  const t = useT();
  const langue = useLangue();
  const cles = indicateursCles(resultat.base.synthese, devise, langue);
  return (
    <ul
      className="mp-plan-cles"
      aria-label={t("Indicateurs clés du scénario de base", "Key indicators of the base scenario")}
    >
      {cles.map(([libelle, valeur]) => (
        <li key={libelle}>
          <span className="mp-plan-cles__libelle">{libelle}</span>
          <span className="mp-plan-cles__valeur">{valeur}</span>
        </li>
      ))}
    </ul>
  );
}

/** Les trois scénarios côte à côte (synthèse du moteur) et les écarts appliqués. */
export function TableauScenarios({
  resultat,
  devise,
  idPrefixe,
}: {
  resultat: ResultatScenarios;
  devise: Devise;
  idPrefixe: string;
}) {
  const t = useT();
  const langue = useLangue();
  const lignes = lignesScenarios(resultat.synthese, devise, langue);
  const id = `${idPrefixe}-scenarios`;
  return (
    <div className="mp-plan-etat" role="region" aria-labelledby={id} tabIndex={0}>
      <table>
        <caption id={id}>
          {t(
            "Scénarios base, optimiste et pessimiste",
            "Base, optimistic and pessimistic scenarios",
          )}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("Indicateur", "Indicator")}</th>
            {SCENARIOS.map((s) => (
              <th key={s} scope="col">
                {libelleScenario(s, langue)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.cle}>
              <th scope="row">{l.libelle}</th>
              {SCENARIOS.map((s) => (
                <td key={s}>{l.valeurs[s]}</td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row">
              {t("Écarts appliqués aux hypothèses", "Deviations applied to the assumptions")}
            </th>
            <td className="mp-plan-etat__texte">
              {t("Hypothèses saisies", "Entered assumptions")}
            </td>
            <td className="mp-plan-etat__texte">
              {descriptionEcarts(resultat.ecarts?.optimiste, langue)}
            </td>
            <td className="mp-plan-etat__texte">
              {descriptionEcarts(resultat.ecarts?.pessimiste, langue)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Résultat complet d'un calcul du moteur (version enregistrée ou simulation) : alertes,
 * indicateurs clés, scénarios côte à côte, graphique de trésorerie et ses valeurs, puis les
 * états financiers du scénario de base. Tous les chiffres viennent de l'API.
 */
export function ResultatModele({
  resultat,
  devise,
  idPrefixe,
  niveauTitre = 3,
}: {
  resultat: ResultatScenarios;
  devise: Devise;
  idPrefixe: string;
  niveauTitre?: NiveauTitre;
}) {
  const t = useT();
  const langue = useLangue();
  const T = `h${niveauTitre}` as const;
  const base = resultat.base;
  return (
    <div className="mp-plan">
      <section className="mp-plan__section" aria-labelledby={`${idPrefixe}-t-alertes`}>
        <T id={`${idPrefixe}-t-alertes`} className="mp-plan__intertitre">
          {t("Alertes", "Alerts")}
        </T>
        <AlertesModele resultat={resultat} devise={devise} />
      </section>
      <section className="mp-plan__section" aria-labelledby={`${idPrefixe}-t-cles`}>
        <T id={`${idPrefixe}-t-cles`} className="mp-plan__intertitre">
          {t("Indicateurs clés (scénario de base)", "Key indicators (base scenario)")}
        </T>
        <IndicateursCles resultat={resultat} devise={devise} />
      </section>
      <section className="mp-plan__section" aria-labelledby={`${idPrefixe}-t-scenarios`}>
        <T id={`${idPrefixe}-t-scenarios`} className="mp-plan__intertitre">
          {t("Trois scénarios côte à côte", "Three scenarios side by side")}
        </T>
        <TableauScenarios resultat={resultat} devise={devise} idPrefixe={idPrefixe} />
      </section>
      <section className="mp-plan__section" aria-labelledby={`${idPrefixe}-t-tresorerie`}>
        <T id={`${idPrefixe}-t-tresorerie`} className="mp-plan__intertitre">
          {t("Trésorerie", "Cash")}
        </T>
        <GraphiqueTresorerie
          resultat={resultat}
          devise={devise}
          idPrefixe={`${idPrefixe}-graphique`}
        />
      </section>
      <section className="mp-plan__section" aria-labelledby={`${idPrefixe}-t-etats`}>
        <T id={`${idPrefixe}-t-etats`} className="mp-plan__intertitre">
          {t(
            "États financiers prévisionnels (scénario de base)",
            "Projected financial statements (base scenario)",
          )}
        </T>
        <p className="mp-texte-doux mp-texte-petit">{mentionSyscohada(langue)}</p>
        {ETATS_FINANCIERS.map((e) => (
          <TableauEtat
            key={e.cle}
            titre={titreEtat(e, langue)}
            lignes={e.lignes}
            annees={base.annees}
            devise={devise}
            idPrefixe={`${idPrefixe}-${e.cle}`}
          />
        ))}
        <p className="mp-texte-doux mp-texte-petit">{mentionRatios(langue)}</p>
        {base.equilibre ? (
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "Contrôle du moteur : le bilan est équilibré (actif égal au passif) à chaque clôture.",
              "Engine check: the balance sheet balances (assets equal liabilities) at each closing.",
            )}
          </p>
        ) : null}
      </section>
    </div>
  );
}
