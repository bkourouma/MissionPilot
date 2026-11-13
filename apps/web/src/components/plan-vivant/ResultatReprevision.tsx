import type { Traduire } from "@missionpilot/shared";
import { formaterDateHeure, formaterMontantMineur, type Devise } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import {
  compterSignificatifs,
  formaterSeuil,
  LIBELLE_TRIMESTRE,
  libelleMethode,
  lignesAnnuelles,
  lignesCumul,
  lignesTrimestre,
  mentionProjectionSimplifiee,
  montantOuNonSaisi,
  phraseEcartEbe,
  titreCumul,
  formaterEcart,
  type LigneEcart,
  type Reprevision,
} from "../../lib/plan-vivant";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

/** Colonnes communes des tableaux d'écarts : le marqueur « Significatif » est un texte, jamais seulement une couleur. */
const colonnes = (t: Traduire): readonly ColonneTableau<LigneEcart>[] => [
  { cle: "mesure", entete: t("Mesure", "Measure") },
  { cle: "prevu", entete: t("Plan", "Plan"), alignement: "droite" },
  { cle: "reel", entete: t("Réel", "Actual"), alignement: "droite" },
  { cle: "ecart", entete: t("Écart", "Variance"), alignement: "droite" },
  { cle: "ecartRelatif", entete: t("Écart relatif", "Relative variance"), alignement: "droite" },
  {
    cle: "marqueur",
    entete: t("Seuil", "Threshold"),
    rendu: (l) =>
      l.significatif ? (
        <BadgeStatut tonalite="attention">{l.marqueur}</BadgeStatut>
      ) : (
        <span>{l.marqueur}</span>
      ),
  },
];

/**
 * Résultat d'une re-prévision enregistrée (PLA-18) : tous les chiffres sont ceux du moteur, tels que
 * figés à l'enregistrement. Le plan validé n'est pas modifié ; la trésorerie de clôture est une
 * projection simplifiée.
 */
export async function ResultatReprevision({
  reprevision,
  devise,
}: {
  reprevision: Reprevision;
  devise: Devise;
}) {
  const langue = await obtenirLangue();
  const t: Traduire = (fr, en) => (langue === "en" ? en : fr);
  const COLONNES = colonnes(t);
  const r = reprevision.resultat;
  const m = (v: number | null) => montantOuNonSaisi(v, devise, langue);
  const annuelles = lignesAnnuelles(r.ecartsAnnuels, devise, langue);
  const nbSignificatifs = compterSignificatifs(annuelles);

  return (
    <div className="mp-pv">
      <p>
        {langue === "en"
          ? `Re-forecast ${reprevision.version} for fiscal year ${reprevision.exercice}, computed on ${formaterDateHeure(reprevision.cree_le, undefined, langue)} by ${reprevision.auteur_nom} on version ${reprevision.modele_version} of the model (approved) and ${reprevision.dernier_trimestre} actual quarter(s). Method: ${libelleMethode(reprevision.methode, langue).toLowerCase()}; significant variance threshold: ${formaterSeuil(reprevision.seuil_pour_mille, langue)}.`
          : `Re-prévision ${reprevision.version} de l'exercice ${reprevision.exercice}, calculée le ${formaterDateHeure(reprevision.cree_le)} par ${reprevision.auteur_nom} sur la version ${reprevision.modele_version} du modèle (validée) et ${reprevision.dernier_trimestre} trimestre(s) réalisé(s). Méthode : ${libelleMethode(reprevision.methode).toLowerCase()} ; seuil d'un écart significatif : ${formaterSeuil(reprevision.seuil_pour_mille)}.`}
      </p>

      <h4 className="mp-pv__intertitre">
        {t("Re-prévision annuelle comparée au plan", "Annual re-forecast compared with the plan")}
      </h4>
      <dl className="mp-pv__resume">
        <div className="mp-pv__chiffre">
          <dt>{t("Chiffre d'affaires re-prévu", "Re-forecast revenue")}</dt>
          <dd>{m(r.reprevision.chiffreAffaires)}</dd>
        </div>
        <div className="mp-pv__chiffre">
          <dt>{t("EBE re-prévu", "Re-forecast EBITDA")}</dt>
          <dd>{m(r.reprevision.excedentBrutExploitation)}</dd>
        </div>
        <div className="mp-pv__chiffre">
          <dt>{t("Résultat net re-prévu", "Re-forecast net income")}</dt>
          <dd>{m(r.reprevision.resultatNet)}</dd>
        </div>
        <div className="mp-pv__chiffre">
          <dt>
            {t(
              "Trésorerie de clôture re-prévue (projection simplifiée)",
              "Re-forecast closing cash (simplified projection)",
            )}
          </dt>
          <dd>{m(r.reprevision.tresorerieCloture)}</dd>
        </div>
      </dl>
      <p className="mp-texte-doux">{mentionProjectionSimplifiee(langue)}</p>
      <Tableau
        legende={t(
          "Exercice : re-prévision annuelle comparée au plan",
          "Fiscal year: annual re-forecast compared with the plan",
        )}
        legendeVisible
        cleLigne={(l) => l.cle}
        lignes={annuelles}
        colonnes={COLONNES}
      />
      <p className="mp-visuellement-cache" role="status">
        {nbSignificatifs === 0
          ? t("Aucun écart annuel significatif.", "No significant annual variance.")
          : t(
              `${nbSignificatifs} écart(s) annuel(s) significatif(s).`,
              `${nbSignificatifs} significant annual variance(s).`,
            )}
      </p>

      <h4 className="mp-pv__intertitre">{t("Écarts par trimestre", "Variances by quarter")}</h4>
      {r.ecartsTrimestres.map((e) => (
        <Tableau
          key={e.trimestre}
          legende={`${LIBELLE_TRIMESTRE(e.trimestre, langue)} : ${t("plan et réel", "plan and actual")}`}
          legendeVisible
          cleLigne={(l) => l.cle}
          lignes={lignesTrimestre(e, devise, langue)}
          colonnes={COLONNES}
        />
      ))}

      <h4 className="mp-pv__intertitre">{t("Écarts cumulés", "Cumulative variances")}</h4>
      {r.ecartsCumules.map((e) => (
        <Tableau
          key={e.trimestre}
          legende={titreCumul(e.trimestre, langue)}
          legendeVisible
          cleLigne={(l) => l.cle}
          lignes={lignesCumul(e, devise, langue)}
          colonnes={COLONNES}
        />
      ))}

      <h4 className="mp-pv__intertitre">
        {t("Explication de l'écart d'EBE", "Explanation of the EBITDA variance")}
      </h4>
      <div className="mp-pv__ebe">
        <p>{phraseEcartEbe(r.explicationEbe, r.trimestresRealises, devise, langue)}</p>
        {r.explicationEbe ? (
          <dl className="mp-pv__resume">
            <div className="mp-pv__chiffre">
              <dt>{t("Écart d'EBE cumulé", "Cumulative EBITDA variance")}</dt>
              <dd>{formaterEcart(r.explicationEbe.ecartEbe, devise, langue)}</dd>
            </div>
            <div className="mp-pv__chiffre">
              <dt>{t("dont effet volume", "of which volume effect")}</dt>
              <dd>{formaterEcart(r.explicationEbe.effetVolume, devise, langue)}</dd>
            </div>
            <div className="mp-pv__chiffre">
              <dt>{t("dont effet de marge", "of which margin effect")}</dt>
              <dd>{formaterEcart(r.explicationEbe.effetMarge, devise, langue)}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      <details>
        <summary>
          {t("Réalisés utilisés par cette re-prévision", "Actuals used by this re-forecast")}
        </summary>
        <ul className="mp-pv__historique">
          {reprevision.entrees.map((e) => (
            <li key={e.trimestre}>
              {LIBELLE_TRIMESTRE(e.trimestre, langue)} ({t("version", "version")} {e.version}{" "}
              {t("du réalisé", "of the actuals")}) : {t("chiffre d'affaires", "revenue")}{" "}
              {formaterMontantMineur(e.chiffreAffaires, devise, langue)}, EBE{" "}
              {formaterMontantMineur(e.excedentBrutExploitation, devise, langue)},{" "}
              {t("résultat net", "net income")} {montantOuNonSaisi(e.resultatNet, devise, langue)},{" "}
              {t("trésorerie", "cash")} {montantOuNonSaisi(e.tresorerieFin, devise, langue)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
