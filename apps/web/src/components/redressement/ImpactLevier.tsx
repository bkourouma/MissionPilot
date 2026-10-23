import type { RedImpactLevierVue } from "@missionpilot/shared";
import { formaterMontantMineur, libelleDevise } from "../../lib/format";
import { libelleLevier } from "../../lib/redressement";

/**
 * Impact d'un levier calculé par le moteur : trésorerie dégagée (une fois), gain de résultat
 * annuel, effet de trésorerie la première année, plus ou moins-value (cession), hypothèses et
 * devise. Un ordre de grandeur, jamais une recommandation.
 */
export function ImpactLevier({ impact }: { impact: RedImpactLevierVue }) {
  const m = (v: number) => formaterMontantMineur(v, impact.devise);
  return (
    <div className="mp-red-section">
      <p className="mp-red-section__titre">{libelleLevier(impact.code)}</p>
      <dl className="mp-red-impact">
        <div>
          <dt>Trésorerie dégagée (une fois)</dt>
          <dd>{m(impact.tresorerie_unique)}</dd>
        </div>
        <div>
          <dt>Gain de résultat annuel</dt>
          <dd>{m(impact.resultat_annuel)}</dd>
        </div>
        <div>
          <dt>Effet de trésorerie la première année</dt>
          <dd>{m(impact.tresorerie_annee1)}</dd>
        </div>
        {impact.plus_ou_moins_value !== null ? (
          <div>
            <dt>Plus ou moins-value</dt>
            <dd>{m(impact.plus_ou_moins_value)}</dd>
          </div>
        ) : null}
      </dl>
      <p className="mp-texte-doux mp-texte-petit">Montants en {libelleDevise(impact.devise)}.</p>
      {impact.hypotheses.length > 0 ? (
        <>
          <p className="mp-texte-petit">Hypothèses retenues :</p>
          <ul className="mp-liste-simple mp-texte-petit">
            {impact.hypotheses.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Résumé d'une ligne pour une carte d'action : « Trésorerie 5 000 000 FCFA (une fois) ». */
export function ResumeImpact({ impact }: { impact: RedImpactLevierVue }) {
  const m = (v: number) => formaterMontantMineur(v, impact.devise);
  return (
    <span className="mp-texte-petit">
      Impact : {m(impact.tresorerie_unique)} de trésorerie (une fois), {m(impact.resultat_annuel)}{" "}
      de résultat par an
    </span>
  );
}
