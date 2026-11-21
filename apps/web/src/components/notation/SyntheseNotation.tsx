import { formaterDateHeure } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  dimensionsNonNotables,
  detailClasse,
  formaterCouverture,
  formaterScore,
  libelleSecteur,
  libelleStatutVersion,
  libelleStrategie,
  LISTE_CLASSES,
  nomGrilleGenerique,
  pluriel,
  tonaliteStatutVersion,
  type VueVersionNotation,
} from "../../lib/notation";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Calcule } from "../ui/Calcule";
import { BadgeClasse } from "./BadgeClasse";

export interface SyntheseNotationProps {
  vue: VueVersionNotation;
  /** Titre du questionnaire noté, s'il est connu. */
  titreQuestionnaire: string | null;
  derniere: boolean;
}

/**
 * Score global, classe (lettre et libellé), statut et contexte du calcul figé. Tous les
 * chiffres sont ceux de l'API (moteur) : aucun n'est recalculé ici.
 */
export async function SyntheseNotation({
  vue,
  titreQuestionnaire,
  derniere,
}: SyntheseNotationProps) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const s = vue.score;
  const nonNotables = dimensionsNonNotables(vue);
  const ajuste = vue.ajustements.length > 0;
  const couverture = formaterCouverture(vue.resultat.couverture, langue);
  return (
    <div className="mp-notation__section">
      <div className="mp-notation-score">
        <p className="mp-notation-score__valeur">
          {s.notable ? (
            <>
              <span>{formaterScore(s.score, langue)}</span>
              <span className="mp-notation-score__sur">{t("sur 100", "out of 100")}</span>
            </>
          ) : (
            <span className="mp-notation-score__sur">
              {t("Score global non notable", "Overall score not rated")}
            </span>
          )}
        </p>
        <BadgeClasse classe={s.notable ? s.classe : null} grand />
        <Calcule />
        <BadgeStatut tonalite={tonaliteStatutVersion(vue.statut)}>
          {libelleStatutVersion(vue.statut, langue)}
        </BadgeStatut>
      </div>

      {!s.notable ? (
        <Alerte
          tonalite="attention"
          titre={t("Score global non notable", "Overall score not rated")}
          annonce="aucune"
        >
          <p>
            {t(
              `Les dimensions notables ne pèsent que ${couverture} du poids total, sous le minimum requis (la moitié). Complétez les réponses du questionnaire puis relancez un calcul : cette version ne peut pas être soumise en revue.`,
              `The rated dimensions weigh only ${couverture} of the total weight, below the required minimum (half). Complete the questionnaire answers, then run a new computation: this version cannot be submitted for review.`,
            )}
          </p>
        </Alerte>
      ) : null}
      {nonNotables.length > 0 ? (
        <Alerte
          tonalite="info"
          titre={t(
            "Dimension non notable : réponses insuffisantes",
            "Dimension not rated: insufficient answers",
          )}
          annonce="aucune"
        >
          <p>
            {nonNotables.length > 1
              ? t(
                  "Faute de réponses suffisantes (moins de la moitié du poids de leurs questions), ces dimensions ne reçoivent pas de score",
                  "For lack of sufficient answers (less than half of the weight of their questions), these dimensions receive no score",
                )
              : t(
                  "Faute de réponses suffisantes (moins de la moitié du poids de leurs questions), cette dimension ne reçoit pas de score",
                  "For lack of sufficient answers (less than half of the weight of its questions), this dimension receives no score",
                )}{" "}
            : {nonNotables.map((d) => d.libelle).join(", ")}.
          </p>
        </Alerte>
      ) : null}
      {!derniere ? (
        <Alerte
          tonalite="info"
          titre={t("Version antérieure, en lecture seule", "Earlier version, read-only")}
          annonce="aucune"
        >
          <p>
            {t(
              "Une version plus récente existe : les actions portent sur la dernière version.",
              "A more recent version exists: actions apply to the latest version.",
            )}
          </p>
        </Alerte>
      ) : null}

      <dl className="mp-liste-def mp-liste-def--compacte">
        <div>
          <dt>{t("Version", "Version")}</dt>
          <dd>
            {t(
              `Version ${vue.numero}, calculée le ${formaterDateHeure(vue.calcule_le, "Africa/Abidjan", langue)} par ${vue.calcule_par.nom ?? "un membre du cabinet"}`,
              `Version ${vue.numero}, computed on ${formaterDateHeure(vue.calcule_le, "Africa/Abidjan", langue)} by ${vue.calcule_par.nom ?? "a firm member"}`,
            )}
          </dd>
        </div>
        {ajuste ? (
          <div>
            <dt>{t("Avant ajustements", "Before adjustments")}</dt>
            <dd>
              {t("Score calculé", "Computed score")} :{" "}
              {s.score_calcule === null
                ? t("non notable", "not rated")
                : formaterScore(s.score_calcule, langue)}{" "}
              (
              {langue === "en"
                ? pluriel(vue.ajustements.length, "reasoned adjustment", "reasoned adjustments")
                : pluriel(vue.ajustements.length, "ajustement motivé", "ajustements motivés")}
              )
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{t("Questionnaire", "Questionnaire")}</dt>
          <dd>
            {titreQuestionnaire ?? t("Questionnaire de la mission", "Engagement questionnaire")} —{" "}
            {langue === "en"
              ? pluriel(vue.reponses_utilisees, "submitted answer used", "submitted answers used")
              : pluriel(
                  vue.reponses_utilisees,
                  "réponse soumise utilisée",
                  "réponses soumises utilisées",
                )}
          </dd>
        </div>
        <div>
          <dt>{t("Grille", "Framework")}</dt>
          <dd>
            {vue.grille.generique
              ? nomGrilleGenerique(langue)
              : t(
                  `${vue.grille.titre} (${vue.grille.code}, version ${vue.grille.version})`,
                  `${vue.grille.titre} (${vue.grille.code}, version ${vue.grille.version})`,
                )}
          </dd>
        </div>
        <div>
          <dt>{t("Pondérations", "Weightings")}</dt>
          <dd>{libelleSecteur(vue.secteur, [], langue)}</dd>
        </div>
        <div>
          <dt>{t("Réponses manquantes", "Missing answers")}</dt>
          <dd>{libelleStrategie(vue.strategie, langue)}</dd>
        </div>
        <div>
          <dt>{t("Couverture", "Coverage")}</dt>
          <dd>
            {t(
              `${couverture} du poids des dimensions est notable`,
              `${couverture} of the dimension weight is rated`,
            )}
          </dd>
        </div>
      </dl>

      <details className="mp-details">
        <summary>{t("Barème des classes", "Class scale")}</summary>
        <ul className="mp-notation-bareme">
          {LISTE_CLASSES.map((c) => (
            <li key={c}>
              <BadgeClasse classe={c} />
              <span>
                {t("score", "score")} {detailClasse(c, langue).plage}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
