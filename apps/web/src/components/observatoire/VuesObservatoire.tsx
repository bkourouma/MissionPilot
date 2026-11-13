import type {
  Langue,
  ObservatoireAgregats,
  ObservatoireMargePubliee,
  ObservatoireResumeContributions,
  ObservatoireStatistiquesPubliees,
  Traduire,
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
  principesObservatoire,
  trouverCase,
} from "../../lib/observatoire";
import { formaterDate } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau } from "../ui/Tableau";

/* Vues de l'observatoire : aucun calcul, les valeurs sont celles de l'API (déjà arrondies). */

export async function PrincipesObservatoire() {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <Carte titre={t("Le principe de l'observatoire", "How the observatory works")} niveauTitre={2}>
      <ul className="mp-observatoire__principes">
        {principesObservatoire(langue).map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </Carte>
  );
}

function Statistiques({
  s,
  t,
  langue,
}: {
  s: ObservatoireStatistiquesPubliees;
  t: Traduire;
  langue: Langue;
}) {
  return (
    <dl className="mp-observatoire__stats">
      <div>
        <dt>{t("Effectif", "Headcount")}</dt>
        <dd>{libelleEffectifMinimum(s.effectif_minimum, langue)}</dd>
      </div>
      <div>
        <dt>{t("Moyenne", "Average")}</dt>
        <dd>{formaterEntier(s.moyenne, langue)}</dd>
      </div>
      <div>
        <dt>{t("Médiane", "Median")}</dt>
        <dd>{formaterEntier(s.mediane, langue)}</dd>
      </div>
      {s.q1 !== null && s.q3 !== null ? (
        <div>
          <dt>{t("Quartiles", "Quartiles")}</dt>
          <dd>
            {formaterEntier(s.q1, langue)} {t("à", "to")} {formaterEntier(s.q3, langue)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export async function GrilleAgregats({ agregats }: { agregats: ObservatoireAgregats }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const index = indexerCases(agregats.cases);
  return (
    <div
      className="mp-tableau"
      role="region"
      aria-label={t("Score global par secteur et taille", "Overall score by sector and size")}
      tabIndex={0}
    >
      <table className="mp-tableau__table">
        <caption className="mp-visuellement-cache">
          {t(
            "Score global moyen et médian par secteur et par taille d'entreprise. Les cases à effectif insuffisant ne portent aucun chiffre.",
            "Average and median overall score by sector and company size. Cells with an insufficient headcount carry no figure.",
          )}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("Secteur", "Sector")}</th>
            {agregats.tailles.map((taille) => (
              <th key={taille} scope="col">
                {libelleTaille(taille, langue)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {agregats.secteurs.map((secteur) => (
            <tr key={secteur}>
              <th scope="row">{libelleSecteur(secteur, langue)}</th>
              {agregats.tailles.map((taille) => {
                const c = trouverCase(index, secteur, taille);
                return (
                  <td key={taille} data-libelle={libelleTaille(taille, langue)}>
                    {c && c.statut === "publiee" ? (
                      <div aria-label={libelleCase(c, langue)}>
                        <Statistiques s={c} t={t} langue={langue} />
                        {c.repartition ? (
                          <Repartition repartition={c.repartition} t={t} langue={langue} />
                        ) : null}
                      </div>
                    ) : (
                      <BadgeStatut tonalite="neutre">
                        {t("Effectif insuffisant", "Insufficient headcount")}
                      </BadgeStatut>
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

function Repartition({
  repartition,
  t,
  langue,
}: {
  repartition: number[];
  t: Traduire;
  langue: Langue;
}) {
  return (
    <details className="mp-observatoire__repartition">
      <summary>{t("Répartition par tranche de score", "Distribution by score band")}</summary>
      <ul>
        {lignesRepartition(repartition).map((l) => (
          <li key={l.tranche}>
            {l.tranche} : {formaterEntier(l.pourcentage, langue)} {langue === "en" ? "%" : "%"}
          </li>
        ))}
      </ul>
    </details>
  );
}

type LigneMarge = { libelle: string; marge: ObservatoireMargePubliee };

function TableauMarges({
  legende,
  lignes,
  t,
  langue,
}: {
  legende: string;
  lignes: LigneMarge[];
  t: Traduire;
  langue: Langue;
}) {
  return (
    <Tableau<LigneMarge>
      legende={legende}
      legendeVisible
      lignes={lignes}
      cleLigne={(l) => l.libelle}
      messageVide={t("Aucune marge publiée.", "No margin published.")}
      colonnes={[
        { cle: "libelle", entete: t("Groupe", "Group"), rendu: (l) => l.libelle },
        {
          cle: "effectif",
          entete: t("Effectif", "Headcount"),
          rendu: (l) => libelleEffectifMinimum(l.marge.effectif_minimum, langue),
        },
        {
          cle: "cases",
          entete: t("Cases publiées", "Published cells"),
          alignement: "droite",
          rendu: (l) => formaterEntier(l.marge.cases_publiees, langue),
        },
        {
          cle: "moyenne",
          entete: t("Moyenne", "Average"),
          alignement: "droite",
          rendu: (l) => formaterEntier(l.marge.moyenne, langue),
        },
        {
          cle: "mediane",
          entete: t("Médiane", "Median"),
          alignement: "droite",
          rendu: (l) => formaterEntier(l.marge.mediane, langue),
        },
      ]}
    />
  );
}

export async function MargesAgregats({ agregats }: { agregats: ObservatoireAgregats }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { ensemble, par_secteur, par_taille } = agregats.marges;
  return (
    <div className="mp-observatoire__marges">
      {ensemble ? (
        <Carte titre={t("Ensemble des cases publiées", "All published cells")} niveauTitre={3}>
          <Statistiques s={ensemble} t={t} langue={langue} />
        </Carte>
      ) : null}
      <TableauMarges
        legende={t("Marges par secteur", "Margins by sector")}
        lignes={par_secteur.map((m) => ({ libelle: libelleSecteur(m.secteur, langue), marge: m }))}
        t={t}
        langue={langue}
      />
      <TableauMarges
        legende={t("Marges par taille", "Margins by size")}
        lignes={par_taille.map((m) => ({ libelle: libelleTaille(m.taille, langue), marge: m }))}
        t={t}
        langue={langue}
      />
    </div>
  );
}

export async function ResumeContributions({ resume }: { resume: ObservatoireResumeContributions }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const versement = (titre: string, v: ObservatoireResumeContributions["retenu"], vide: string) => (
    <div>
      <dt>{titre}</dt>
      <dd>
        {v
          ? t(
              `${formaterEntier(v.nombre, langue)} entreprise${v.nombre > 1 ? "s" : ""}, versées le ${formaterDate(v.verse_le, "UTC", langue)} (${formaterPeriode(v.periode, langue)})`,
              `${formaterEntier(v.nombre, langue)} ${v.nombre > 1 ? "companies" : "company"}, contributed on ${formaterDate(v.verse_le, "UTC", langue)} (${formaterPeriode(v.periode, langue)})`,
            )
          : vide}
      </dd>
    </div>
  );
  return (
    <dl className="mp-observatoire__resume">
      {versement(
        t("En attente (mois courant)", "Pending (current month)"),
        resume.en_attente,
        t("Aucun versement ce mois-ci.", "No contribution this month."),
      )}
      {versement(
        t("Retenu dans les agrégats", "Included in the aggregates"),
        resume.retenu,
        t("Aucun versement retenu pour l'instant.", "No contribution included for now."),
      )}
    </dl>
  );
}
