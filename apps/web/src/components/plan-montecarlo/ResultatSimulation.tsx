import {
  formaterDateHeure,
  formaterMontantMineur,
  formaterNombre,
  type Devise,
} from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import {
  CENTILES,
  formaterProbabilite,
  libelleCentile,
  libelleCible,
  libelleLoi,
  lignesTensionParAnnee,
  type SimulationMonteCarlo,
} from "../../lib/plan-montecarlo";
import { Tableau } from "../ui/Tableau";
import { HistogrammeVan } from "./HistogrammeVan";
import { RejeuSimulation } from "./RejeuSimulation";

/**
 * Résultat d'une simulation enregistrée (PLA-16) : tous les chiffres sont ceux du moteur, tels
 * que figés à l'enregistrement. Rappelle la graine et l'empreinte, et propose le rejeu.
 */
export async function ResultatSimulation({
  simulation,
  devise,
}: {
  simulation: SimulationMonteCarlo;
  devise: Devise;
}) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const r = simulation.resultat;
  const m = (v: number) => formaterMontantMineur(v, devise, langue);
  const chiffres: [string, string][] = [
    [t("VAN du scénario de base", "NPV of the base scenario"), m(r.base.van)],
    [t("VAN moyenne simulée", "Simulated mean NPV"), m(r.van.moyenne)],
    [t("Écart-type de la VAN", "Standard deviation of the NPV"), m(r.van.ecartType)],
    [
      t("Probabilité d'une VAN négative", "Probability of a negative NPV"),
      formaterProbabilite(r.probabiliteVanNegative, langue),
    ],
    [
      t("Probabilité de tension de trésorerie", "Probability of cash strain"),
      formaterProbabilite(r.probabiliteTension, langue),
    ],
    [
      t("Tirages valides", "Valid draws"),
      `${formaterNombre(r.tiragesValides, 0, langue)} ${t("sur", "out of")} ${formaterNombre(r.tirages, 0, langue)}`,
    ],
  ];
  return (
    <div className="mp-mc">
      <p className="mp-texte-doux mp-texte-petit">
        {t("Version", "Version")} {simulation.version}{" "}
        {t("du modèle financier · simulée le", "of the financial model · simulated on")}{" "}
        {formaterDateHeure(simulation.cree_le, undefined, langue)} {t("par", "by")}{" "}
        {simulation.auteur_nom} · {t("graine", "seed")} <strong>{simulation.graine}</strong> ·{" "}
        {formaterNombre(simulation.tirages, 0, langue)} {t("tirages", "draws")} ·{" "}
        {t("empreinte", "fingerprint")} <strong>{simulation.empreinte}</strong>
      </p>

      <dl className="mp-mc__chiffres">
        {chiffres.map(([libelle, valeur]) => (
          <div key={libelle} className="mp-mc__chiffre">
            <dt>{libelle}</dt>
            <dd>{valeur}</dd>
          </div>
        ))}
      </dl>
      {r.tiragesRejetes > 0 ? (
        <p className="mp-texte-doux mp-texte-petit">
          {formaterNombre(r.tiragesRejetes, 0, langue)}{" "}
          {t(
            "tirage(s) écarté(s) car une hypothèse sortait de ses bornes de validité : ils sont exclus des statistiques.",
            "draw(s) discarded because an assumption went outside its validity bounds: they are excluded from the statistics.",
          )}
        </p>
      ) : null}
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          "Tension de trésorerie : trésorerie nette de clôture négative au moins une fois sur l'horizon du plan.",
          "Cash strain: negative net closing cash at least once over the plan horizon.",
        )}
      </p>

      <h4 className="mp-plan__intertitre">{t("Distribution de la VAN", "NPV distribution")}</h4>
      <HistogrammeVan resultat={r} devise={devise} idPrefixe={`mc-${simulation.id}`} />

      <Tableau
        legende={t("Percentiles de la VAN", "NPV percentiles")}
        legendeVisible
        cleLigne={(l) => l.cle}
        lignes={CENTILES.map(([cle, libelle]) => ({
          cle,
          libelle: libelleCentile(cle, libelle, langue),
          valeur: r.van.percentiles[cle],
        }))}
        colonnes={[
          {
            cle: "libelle",
            entete: t("Part des tirages en dessous", "Share of draws below"),
          },
          {
            cle: "valeur",
            entete: t("VAN", "NPV"),
            alignement: "droite",
            rendu: (l) => m(l.valeur),
          },
        ]}
      />

      <Tableau
        legende={t(
          "Probabilité de tension de trésorerie, par année",
          "Probability of cash strain, by year",
        )}
        legendeVisible
        cleLigne={(l) => l.cle}
        lignes={lignesTensionParAnnee(r, langue)}
        colonnes={[
          { cle: "annee", entete: t("Année", "Year") },
          {
            cle: "probabilite",
            entete: t("Trésorerie de clôture négative", "Negative closing cash"),
            alignement: "droite",
            rendu: (l) => formaterProbabilite(l.probabilite, langue),
          },
        ]}
      />

      <Tableau
        legende={t("Trésorerie nette minimale sur l'horizon", "Minimum net cash over the horizon")}
        legendeVisible
        cleLigne={(l) => l.cle}
        lignes={[
          {
            cle: "p5",
            libelle: t(
              "Cas défavorable (5 % des tirages en dessous)",
              "Unfavorable case (5% of draws below)",
            ),
            valeur: r.tresorerieMinimale.p5,
          },
          { cle: "p50", libelle: t("Médiane", "Median"), valeur: r.tresorerieMinimale.p50 },
          {
            cle: "p95",
            libelle: t(
              "Cas favorable (95 % des tirages en dessous)",
              "Favorable case (95% of draws below)",
            ),
            valeur: r.tresorerieMinimale.p95,
          },
        ]}
        colonnes={[
          { cle: "libelle", entete: t("Repère", "Benchmark") },
          {
            cle: "valeur",
            entete: t("Trésorerie minimale", "Minimum cash"),
            alignement: "droite",
            rendu: (l) => m(l.valeur),
          },
        ]}
      />

      <div className="mp-mc__reperes">
        <h4 className="mp-plan__intertitre">{t("Lois utilisées", "Distributions used")}</h4>
        <ul className="mp-mc__lois">
          {simulation.hypotheses.map((h) => (
            <li key={h.cible}>
              <strong>{libelleCible(h.cible, langue)}</strong> :{" "}
              {libelleLoi(h.loi, h.cible, langue)}
            </li>
          ))}
        </ul>
      </div>

      <RejeuSimulation planId={simulation.plan_id} simulationId={simulation.id} />
    </div>
  );
}
