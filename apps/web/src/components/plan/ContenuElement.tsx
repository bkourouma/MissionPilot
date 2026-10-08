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

function Swot({ d }: { d: Record<string, unknown> }) {
  const cases = [
    ["forces", "Forces"],
    ["faiblesses", "Faiblesses"],
    ["opportunites", "Opportunités"],
    ["menaces", "Menaces"],
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
              <p className="mp-texte-doux">Aucun constat.</p>
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
  const gains = Array.isArray(d.gains_annuels) ? (d.gains_annuels as number[]) : [];
  const dependances = lireListe(d, "dependances");
  return (
    <dl className="mp-liste-def">
      <div>
        <dt>Responsable</dt>
        <dd>{nomPersonnePlan(d.responsable_id, personnes)}</dd>
      </div>
      <div>
        <dt>Période</dt>
        <dd>
          {lireTexte(d, "debut") ? `Du ${formaterDate(lireTexte(d, "debut"))} au ` : "Jusqu'au "}
          {formaterDate(lireTexte(d, "echeance"))}
        </dd>
      </div>
      <div>
        <dt>Budget</dt>
        <dd>{formaterMontantMineur(typeof d.budget === "number" ? d.budget : null, devise)}</dd>
      </div>
      <div>
        <dt>Statut</dt>
        <dd>{libelleStatutInitiative(d.statut)}</dd>
      </div>
      <div>
        <dt>Gains nets annuels</dt>
        <dd>
          {gains.length ? (
            <ol className="mp-liste-simple">
              {gains.map((g, i) => (
                <li key={i}>{`Année ${i + 1} : ${formaterMontantMineur(g, devise)}`}</li>
              ))}
            </ol>
          ) : (
            "Non estimés : le ROI de l'initiative n'est pas calculé."
          )}
        </dd>
      </div>
      {dependances.length ? (
        <div>
          <dt>Dépend de</dt>
          <dd>{dependances.map((id) => nomInitiative(id, initiatives)).join(", ")}</dd>
        </div>
      ) : null}
      {lireTexte(d, "description") ? (
        <div>
          <dt>Description</dt>
          <dd className="mp-plan-element__texte">{lireTexte(d, "description")}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function Objectif({ d }: { d: Record<string, unknown> }) {
  const lignes: [string, string | null][] = [
    ["Perspective", libellePerspective(d.perspective)],
    ["Indicateur", lireTexte(d, "indicateur")],
    ["Cible", lireTexte(d, "cible")],
    ["Échéance", lireTexte(d, "echeance") ? formaterDate(lireTexte(d, "echeance")) : null],
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
            <dt>Vision</dt>
            <dd className="mp-plan-element__texte">{lireTexte(donnees, "vision") ?? "—"}</dd>
          </div>
          <div>
            <dt>Mission</dt>
            <dd className="mp-plan-element__texte">{lireTexte(donnees, "mission") ?? "—"}</dd>
          </div>
          {valeurs.length ? (
            <div>
              <dt>Valeurs</dt>
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
