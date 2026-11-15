"use client";

import type { RedImpactLevierVue } from "@missionpilot/shared";
import { formaterMontantMineur, libelleDevise } from "../../lib/format";
import { libelleLevier } from "../../lib/redressement";
import { useLangue, useT } from "../i18n/FournisseurLangue";

/**
 * Impact d'un levier calculé par le moteur : trésorerie dégagée (une fois), gain de résultat
 * annuel, effet de trésorerie la première année, plus ou moins-value (cession), hypothèses et
 * devise. Un ordre de grandeur, jamais une recommandation.
 */
export function ImpactLevier({ impact }: { impact: RedImpactLevierVue }) {
  const t = useT();
  const langue = useLangue();
  const m = (v: number) => formaterMontantMineur(v, impact.devise, langue);
  return (
    <div className="mp-red-section">
      <p className="mp-red-section__titre">{libelleLevier(impact.code, langue)}</p>
      <dl className="mp-red-impact">
        <div>
          <dt>{t("Trésorerie dégagée (une fois)", "Cash released (one-off)")}</dt>
          <dd>{m(impact.tresorerie_unique)}</dd>
        </div>
        <div>
          <dt>{t("Gain de résultat annuel", "Annual income gain")}</dt>
          <dd>{m(impact.resultat_annuel)}</dd>
        </div>
        <div>
          <dt>{t("Effet de trésorerie la première année", "Cash effect in the first year")}</dt>
          <dd>{m(impact.tresorerie_annee1)}</dd>
        </div>
        {impact.plus_ou_moins_value !== null ? (
          <div>
            <dt>{t("Plus ou moins-value", "Gain or loss on disposal")}</dt>
            <dd>{m(impact.plus_ou_moins_value)}</dd>
          </div>
        ) : null}
      </dl>
      <p className="mp-texte-doux mp-texte-petit">
        {t("Montants en", "Amounts in")} {libelleDevise(impact.devise)}.
      </p>
      {impact.hypotheses.length > 0 ? (
        <>
          <p className="mp-texte-petit">{t("Hypothèses retenues :", "Assumptions used:")}</p>
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
  const t = useT();
  const langue = useLangue();
  const m = (v: number) => formaterMontantMineur(v, impact.devise, langue);
  return (
    <span className="mp-texte-petit">
      {t("Impact :", "Impact:")} {m(impact.tresorerie_unique)}{" "}
      {t("de trésorerie (une fois),", "of cash (one-off),")} {m(impact.resultat_annuel)}{" "}
      {t("de résultat par an", "of income per year")}
    </span>
  );
}
