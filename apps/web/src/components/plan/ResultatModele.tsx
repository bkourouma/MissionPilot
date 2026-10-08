import type { Devise } from "../../lib/format";
import {
  ALERTES_PLAN,
  alertesParScenario,
  descriptionEcarts,
  ETATS_FINANCIERS,
  indicateursCles,
  lignesScenarios,
  MENTION_RATIOS,
  MENTION_SYSCOHADA,
  SCENARIOS,
  SCENARIO_LIBELLES,
  texteAlerte,
  titreAlertesScenario,
  type CodeAlertePlan,
  type ResultatScenarios,
} from "../../lib/plan-modele";
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
  const groupes = alertesParScenario(resultat);
  if (groupes.length === 0) {
    return (
      <Alerte tonalite="succes" titre="Aucune alerte" annonce="aucune">
        <p>
          Trésorerie, capitaux propres et équilibre du bilan restent dans les seuils pour les trois
          scénarios.
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
            titre={titreAlertesScenario(scenario, alertes)}
            annonce="aucune"
          >
            <ul className="mp-plan-alertes">
              {alertes.map((a) => (
                <li key={`${a.code}-${a.annee}`}>{texteAlerte(a, devise)}</li>
              ))}
            </ul>
            {codes.map((c) => {
              const info = ALERTES_PLAN[c as CodeAlertePlan];
              return info ? (
                <p key={c} className="mp-texte-petit">
                  <strong>{info.libelle} :</strong> {info.explication}
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
  const cles = indicateursCles(resultat.base.synthese, devise);
  return (
    <ul className="mp-plan-cles" aria-label="Indicateurs clés du scénario de base">
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
  const lignes = lignesScenarios(resultat.synthese, devise);
  const id = `${idPrefixe}-scenarios`;
  return (
    <div className="mp-plan-etat" role="region" aria-labelledby={id} tabIndex={0}>
      <table>
        <caption id={id}>Scénarios base, optimiste et pessimiste</caption>
        <thead>
          <tr>
            <th scope="col">Indicateur</th>
            {SCENARIOS.map((s) => (
              <th key={s} scope="col">
                {SCENARIO_LIBELLES[s]}
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
            <th scope="row">Écarts appliqués aux hypothèses</th>
            <td className="mp-plan-etat__texte">Hypothèses saisies</td>
            <td className="mp-plan-etat__texte">{descriptionEcarts(resultat.ecarts?.optimiste)}</td>
            <td className="mp-plan-etat__texte">
              {descriptionEcarts(resultat.ecarts?.pessimiste)}
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
  const T = `h${niveauTitre}` as const;
  const base = resultat.base;
  return (
    <div className="mp-plan">
      <section className="mp-plan__section" aria-labelledby={`${idPrefixe}-t-alertes`}>
        <T id={`${idPrefixe}-t-alertes`} className="mp-plan__intertitre">
          Alertes
        </T>
        <AlertesModele resultat={resultat} devise={devise} />
      </section>
      <section className="mp-plan__section" aria-labelledby={`${idPrefixe}-t-cles`}>
        <T id={`${idPrefixe}-t-cles`} className="mp-plan__intertitre">
          Indicateurs clés (scénario de base)
        </T>
        <IndicateursCles resultat={resultat} devise={devise} />
      </section>
      <section className="mp-plan__section" aria-labelledby={`${idPrefixe}-t-scenarios`}>
        <T id={`${idPrefixe}-t-scenarios`} className="mp-plan__intertitre">
          Trois scénarios côte à côte
        </T>
        <TableauScenarios resultat={resultat} devise={devise} idPrefixe={idPrefixe} />
      </section>
      <section className="mp-plan__section" aria-labelledby={`${idPrefixe}-t-tresorerie`}>
        <T id={`${idPrefixe}-t-tresorerie`} className="mp-plan__intertitre">
          Trésorerie
        </T>
        <GraphiqueTresorerie
          resultat={resultat}
          devise={devise}
          idPrefixe={`${idPrefixe}-graphique`}
        />
      </section>
      <section className="mp-plan__section" aria-labelledby={`${idPrefixe}-t-etats`}>
        <T id={`${idPrefixe}-t-etats`} className="mp-plan__intertitre">
          États financiers prévisionnels (scénario de base)
        </T>
        <p className="mp-texte-doux mp-texte-petit">{MENTION_SYSCOHADA}</p>
        {ETATS_FINANCIERS.map((e) => (
          <TableauEtat
            key={e.cle}
            titre={e.titre}
            lignes={e.lignes}
            annees={base.annees}
            devise={devise}
            idPrefixe={`${idPrefixe}-${e.cle}`}
          />
        ))}
        <p className="mp-texte-doux mp-texte-petit">{MENTION_RATIOS}</p>
        {base.equilibre ? (
          <p className="mp-texte-doux mp-texte-petit">
            Contrôle du moteur : le bilan est équilibré (actif égal au passif) à chaque clôture.
          </p>
        ) : null}
      </section>
    </div>
  );
}
