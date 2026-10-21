import {
  formaterDateHeure,
  formaterMontantMineur,
  formaterNombre,
  type Devise,
} from "../../lib/format";
import {
  CENTILES,
  CIBLE_MONTE_CARLO_LIBELLES,
  formaterProbabilite,
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
export function ResultatSimulation({
  simulation,
  devise,
}: {
  simulation: SimulationMonteCarlo;
  devise: Devise;
}) {
  const r = simulation.resultat;
  const m = (v: number) => formaterMontantMineur(v, devise);
  const chiffres: [string, string][] = [
    ["VAN du scénario de base", m(r.base.van)],
    ["VAN moyenne simulée", m(r.van.moyenne)],
    ["Écart-type de la VAN", m(r.van.ecartType)],
    ["Probabilité d'une VAN négative", formaterProbabilite(r.probabiliteVanNegative)],
    ["Probabilité de tension de trésorerie", formaterProbabilite(r.probabiliteTension)],
    [
      "Tirages valides",
      `${formaterNombre(r.tiragesValides, 0)} sur ${formaterNombre(r.tirages, 0)}`,
    ],
  ];
  return (
    <div className="mp-mc">
      <p className="mp-texte-doux mp-texte-petit">
        Version {simulation.version} du modèle financier · simulée le{" "}
        {formaterDateHeure(simulation.cree_le)} par {simulation.auteur_nom} · graine{" "}
        <strong>{simulation.graine}</strong> · {formaterNombre(simulation.tirages, 0)} tirages ·
        empreinte <strong>{simulation.empreinte}</strong>
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
          {formaterNombre(r.tiragesRejetes, 0)} tirage(s) écarté(s) car une hypothèse sortait de ses
          bornes de validité : ils sont exclus des statistiques.
        </p>
      ) : null}
      <p className="mp-texte-doux mp-texte-petit">
        Tension de trésorerie : trésorerie nette de clôture négative au moins une fois sur
        l&apos;horizon du plan.
      </p>

      <h4 className="mp-plan__intertitre">Distribution de la VAN</h4>
      <HistogrammeVan resultat={r} devise={devise} idPrefixe={`mc-${simulation.id}`} />

      <Tableau
        legende="Percentiles de la VAN"
        legendeVisible
        cleLigne={(l) => l.cle}
        lignes={CENTILES.map(([cle, libelle]) => ({
          cle,
          libelle,
          valeur: r.van.percentiles[cle],
        }))}
        colonnes={[
          { cle: "libelle", entete: "Part des tirages en dessous" },
          { cle: "valeur", entete: "VAN", alignement: "droite", rendu: (l) => m(l.valeur) },
        ]}
      />

      <Tableau
        legende="Probabilité de tension de trésorerie, par année"
        legendeVisible
        cleLigne={(l) => l.cle}
        lignes={lignesTensionParAnnee(r)}
        colonnes={[
          { cle: "annee", entete: "Année" },
          {
            cle: "probabilite",
            entete: "Trésorerie de clôture négative",
            alignement: "droite",
            rendu: (l) => formaterProbabilite(l.probabilite),
          },
        ]}
      />

      <Tableau
        legende="Trésorerie nette minimale sur l'horizon"
        legendeVisible
        cleLigne={(l) => l.cle}
        lignes={[
          {
            cle: "p5",
            libelle: "Cas défavorable (5 % des tirages en dessous)",
            valeur: r.tresorerieMinimale.p5,
          },
          { cle: "p50", libelle: "Médiane", valeur: r.tresorerieMinimale.p50 },
          {
            cle: "p95",
            libelle: "Cas favorable (95 % des tirages en dessous)",
            valeur: r.tresorerieMinimale.p95,
          },
        ]}
        colonnes={[
          { cle: "libelle", entete: "Repère" },
          {
            cle: "valeur",
            entete: "Trésorerie minimale",
            alignement: "droite",
            rendu: (l) => m(l.valeur),
          },
        ]}
      />

      <div className="mp-mc__reperes">
        <h4 className="mp-plan__intertitre">Lois utilisées</h4>
        <ul className="mp-mc__lois">
          {simulation.hypotheses.map((h) => (
            <li key={h.cible}>
              <strong>{CIBLE_MONTE_CARLO_LIBELLES[h.cible]}</strong> : {libelleLoi(h.loi, h.cible)}
            </li>
          ))}
        </ul>
      </div>

      <RejeuSimulation planId={simulation.plan_id} simulationId={simulation.id} />
    </div>
  );
}
