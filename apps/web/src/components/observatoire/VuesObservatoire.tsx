import type {
  ObservatoireAgregats,
  ObservatoireMargePubliee,
  ObservatoireResumeContributions,
  ObservatoireStatistiquesPubliees,
} from "@missionpilot/shared";
import {
  formaterEntier,
  formaterPeriode,
  indexerCases,
  libelleCase,
  libelleEffectifMinimum,
  libelleSecteur,
  libelleTaille,
  lignesRepartition,
  PRINCIPES_OBSERVATOIRE,
  trouverCase,
} from "../../lib/observatoire";
import { formaterDate } from "../../lib/format";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau } from "../ui/Tableau";

/* Vues de l'observatoire : aucun calcul, les valeurs sont celles de l'API (déjà arrondies). */

export function PrincipesObservatoire() {
  return (
    <Carte titre="Le principe de l'observatoire" niveauTitre={2}>
      <ul className="mp-observatoire__principes">
        {PRINCIPES_OBSERVATOIRE.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </Carte>
  );
}

function Statistiques({ s }: { s: ObservatoireStatistiquesPubliees }) {
  return (
    <dl className="mp-observatoire__stats">
      <div>
        <dt>Effectif</dt>
        <dd>{libelleEffectifMinimum(s.effectif_minimum)}</dd>
      </div>
      <div>
        <dt>Moyenne</dt>
        <dd>{formaterEntier(s.moyenne)}</dd>
      </div>
      <div>
        <dt>Médiane</dt>
        <dd>{formaterEntier(s.mediane)}</dd>
      </div>
      {s.q1 !== null && s.q3 !== null ? (
        <div>
          <dt>Quartiles</dt>
          <dd>
            {formaterEntier(s.q1)} à {formaterEntier(s.q3)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function GrilleAgregats({ agregats }: { agregats: ObservatoireAgregats }) {
  const index = indexerCases(agregats.cases);
  return (
    <div
      className="mp-tableau"
      role="region"
      aria-label="Score global par secteur et taille"
      tabIndex={0}
    >
      <table className="mp-tableau__table">
        <caption className="mp-visuellement-cache">
          Score global moyen et médian par secteur et par taille d'entreprise. Les cases à effectif
          insuffisant ne portent aucun chiffre.
        </caption>
        <thead>
          <tr>
            <th scope="col">Secteur</th>
            {agregats.tailles.map((t) => (
              <th key={t} scope="col">
                {libelleTaille(t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {agregats.secteurs.map((secteur) => (
            <tr key={secteur}>
              <th scope="row">{libelleSecteur(secteur)}</th>
              {agregats.tailles.map((taille) => {
                const c = trouverCase(index, secteur, taille);
                return (
                  <td key={taille} data-libelle={libelleTaille(taille)}>
                    {c && c.statut === "publiee" ? (
                      <div aria-label={libelleCase(c)}>
                        <Statistiques s={c} />
                        {c.repartition ? <Repartition repartition={c.repartition} /> : null}
                      </div>
                    ) : (
                      <BadgeStatut tonalite="neutre">Effectif insuffisant</BadgeStatut>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Repartition({ repartition }: { repartition: number[] }) {
  return (
    <details className="mp-observatoire__repartition">
      <summary>Répartition par tranche de score</summary>
      <ul>
        {lignesRepartition(repartition).map((l) => (
          <li key={l.tranche}>
            {l.tranche} : {formaterEntier(l.pourcentage)} %
          </li>
        ))}
      </ul>
    </details>
  );
}

type LigneMarge = { libelle: string; marge: ObservatoireMargePubliee };

function TableauMarges({ legende, lignes }: { legende: string; lignes: LigneMarge[] }) {
  return (
    <Tableau<LigneMarge>
      legende={legende}
      legendeVisible
      lignes={lignes}
      cleLigne={(l) => l.libelle}
      messageVide="Aucune marge publiée."
      colonnes={[
        { cle: "libelle", entete: "Groupe", rendu: (l) => l.libelle },
        {
          cle: "effectif",
          entete: "Effectif",
          rendu: (l) => libelleEffectifMinimum(l.marge.effectif_minimum),
        },
        {
          cle: "cases",
          entete: "Cases publiées",
          alignement: "droite",
          rendu: (l) => formaterEntier(l.marge.cases_publiees),
        },
        {
          cle: "moyenne",
          entete: "Moyenne",
          alignement: "droite",
          rendu: (l) => formaterEntier(l.marge.moyenne),
        },
        {
          cle: "mediane",
          entete: "Médiane",
          alignement: "droite",
          rendu: (l) => formaterEntier(l.marge.mediane),
        },
      ]}
    />
  );
}

export function MargesAgregats({ agregats }: { agregats: ObservatoireAgregats }) {
  const { ensemble, par_secteur, par_taille } = agregats.marges;
  return (
    <div className="mp-observatoire__marges">
      {ensemble ? (
        <Carte titre="Ensemble des cases publiées" niveauTitre={3}>
          <Statistiques s={ensemble} />
        </Carte>
      ) : null}
      <TableauMarges
        legende="Marges par secteur"
        lignes={par_secteur.map((m) => ({ libelle: libelleSecteur(m.secteur), marge: m }))}
      />
      <TableauMarges
        legende="Marges par taille"
        lignes={par_taille.map((m) => ({ libelle: libelleTaille(m.taille), marge: m }))}
      />
    </div>
  );
}

export function ResumeContributions({ resume }: { resume: ObservatoireResumeContributions }) {
  const versement = (titre: string, v: ObservatoireResumeContributions["retenu"], vide: string) => (
    <div>
      <dt>{titre}</dt>
      <dd>
        {v
          ? `${formaterEntier(v.nombre)} entreprise${v.nombre > 1 ? "s" : ""}, versées le ${formaterDate(v.verse_le)} (${formaterPeriode(v.periode)})`
          : vide}
      </dd>
    </div>
  );
  return (
    <dl className="mp-observatoire__resume">
      {versement("En attente (mois courant)", resume.en_attente, "Aucun versement ce mois-ci.")}
      {versement(
        "Retenu dans les agrégats",
        resume.retenu,
        "Aucun versement retenu pour l'instant.",
      )}
    </dl>
  );
}
