"use client";

import type { TypeElementPlan } from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "../../lib/format";
import {
  nomInitiative,
  nomPersonnePlan,
  type OptionInitiative,
  type PersonnePlan,
} from "../../lib/plan-elements";
import {
  libellePerspective,
  libelleStatutInitiative,
  lireListe,
  lireTexte,
} from "../../lib/plan-strategique";
import { useLangue, useT } from "../i18n/FournisseurLangue";

function Swot({ d }: { d: Record<string, unknown> }) {
  const t = useT();
  const cases = [
    ["forces", t("Forces", "Strengths")],
    ["faiblesses", t("Faiblesses", "Weaknesses")],
    ["opportunites", t("Opportunités", "Opportunities")],
    ["menaces", t("Menaces", "Threats")],
  ] as const;
  return (
    <div className="mp-plan-swot">
      {cases.map(([cle, titre]) => {
        const l = lireListe(d, cle);
        return (
          <section key={cle} className="mp-plan-swot__case" aria-label={titre}>
            <h4>{titre}</h4>
            {l.length ? (
              <ul>
                {l.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="mp-texte-doux">{t("Aucun constat.", "No findings.")}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Initiative({
  d,
  devise,
  personnes,
  initiatives,
}: {
  d: Record<string, unknown>;
  devise: Devise;
  personnes: readonly PersonnePlan[];
  initiatives: readonly OptionInitiative[];
}) {
  const t = useT();
  const langue = useLangue();
  const gains = Array.isArray(d.gains_annuels) ? (d.gains_annuels as number[]) : [];
  const dependances = lireListe(d, "dependances");
  return (
    <dl className="mp-liste-def">
      <div>
        <dt>{t("Responsable", "Owner")}</dt>
        <dd>{nomPersonnePlan(d.responsable_id, personnes, langue)}</dd>
      </div>
      <div>
        <dt>{t("Période", "Period")}</dt>
        <dd>
          {lireTexte(d, "debut")
            ? t(
                `Du ${formaterDate(lireTexte(d, "debut"), "UTC", langue)} au `,
                `From ${formaterDate(lireTexte(d, "debut"), "UTC", langue)} to `,
              )
            : t("Jusqu'au ", "Until ")}
          {formaterDate(lireTexte(d, "echeance"), "UTC", langue)}
        </dd>
      </div>
      <div>
        <dt>{t("Budget", "Budget")}</dt>
        <dd>
          {formaterMontantMineur(typeof d.budget === "number" ? d.budget : null, devise, langue)}
        </dd>
      </div>
      <div>
        <dt>{t("Statut", "Status")}</dt>
        <dd>{libelleStatutInitiative(d.statut, langue)}</dd>
      </div>
      <div>
        <dt>{t("Gains nets annuels", "Annual net gains")}</dt>
        <dd>
          {gains.length ? (
            <ol className="mp-liste-simple">
              {gains.map((g, i) => (
                <li key={i}>
                  {`${t("Année", "Year")} ${i + 1}${langue === "en" ? ":" : " :"} ${formaterMontantMineur(g, devise, langue)}`}
                </li>
              ))}
            </ol>
          ) : (
            t(
              "Non estimés : le ROI de l'initiative n'est pas calculé.",
              "Not estimated: the initiative's ROI is not computed.",
            )
          )}
        </dd>
      </div>
      {dependances.length ? (
        <div>
          <dt>{t("Dépend de", "Depends on")}</dt>
          <dd>{dependances.map((id) => nomInitiative(id, initiatives, langue)).join(", ")}</dd>
        </div>
      ) : null}
      {lireTexte(d, "description") ? (
        <div>
          <dt>{t("Description", "Description")}</dt>
          <dd className="mp-plan-element__texte">{lireTexte(d, "description")}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function Objectif({ d }: { d: Record<string, unknown> }) {
  const t = useT();
  const langue = useLangue();
  const lignes: [string, string | null][] = [
    [t("Perspective", "Perspective"), libellePerspective(d.perspective, langue)],
    [t("Indicateur", "Indicator"), lireTexte(d, "indicateur")],
    [t("Cible", "Target"), lireTexte(d, "cible")],
    [
      t("Échéance", "Due date"),
      lireTexte(d, "echeance") ? formaterDate(lireTexte(d, "echeance"), "UTC", langue) : null,
    ],
  ];
  return (
    <>
      <dl className="mp-liste-def">
        {lignes
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {lireTexte(d, "description") ? (
        <p className="mp-plan-element__texte">{lireTexte(d, "description")}</p>
      ) : null}
    </>
  );
}

/** Contenu d'une version, selon le type d'élément (texte brut, jamais de HTML injecté). */
export function ContenuElement({
  type,
  donnees,
  devise,
  personnes,
  initiatives = [],
}: {
  type: TypeElementPlan;
  donnees: Record<string, unknown>;
  devise: Devise;
  personnes: readonly PersonnePlan[];
  /** Initiatives du plan : noms des dépendances d'une initiative (PLA-05). */
  initiatives?: readonly OptionInitiative[];
}) {
  const t = useT();
  switch (type) {
    case "diagnostic":
      return <p className="mp-plan-element__texte">{lireTexte(donnees, "synthese") ?? "—"}</p>;
    case "swot":
      return <Swot d={donnees} />;
    case "vision_mission": {
      const valeurs = lireListe(donnees, "valeurs");
      return (
        <dl className="mp-liste-def">
          <div>
            <dt>{t("Vision", "Vision")}</dt>
            <dd className="mp-plan-element__texte">{lireTexte(donnees, "vision") ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("Mission", "Mission")}</dt>
            <dd className="mp-plan-element__texte">{lireTexte(donnees, "mission") ?? "—"}</dd>
          </div>
          {valeurs.length ? (
            <div>
              <dt>{t("Valeurs", "Values")}</dt>
              <dd>{valeurs.join(" · ")}</dd>
            </div>
          ) : null}
        </dl>
      );
    }
    case "axe":
      return lireTexte(donnees, "description") ? (
        <p className="mp-plan-element__texte">{lireTexte(donnees, "description")}</p>
      ) : null;
    case "objectif":
      return <Objectif d={donnees} />;
    case "initiative":
      return (
        <Initiative d={donnees} devise={devise} personnes={personnes} initiatives={initiatives} />
      );
  }
}
