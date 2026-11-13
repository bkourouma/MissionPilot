import type { Metadata } from "next";
import "../../../../components/notation-augmentee/notation-augmentee.css";
import { FormulaireParametresConfiance } from "../../../../components/notation-augmentee/FormulaireParametresConfiance";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import {
  CHEMIN_PARAMETRES_NOTATION,
  HREF_PARAMETRES_NOTATION,
  REPONDANTS_CIBLE_PLANCHER,
  SEUIL_CONFIANCE_PLANCHER,
  droitsParametres,
  formaterSeuil,
  type ParametresNotation,
} from "../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../lib/notation-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Paramètres de la notation", "Rating settings") };
}

/**
 * Paramètres de l'indice de confiance du cabinet (NOT-11) : seuil sous lequel une notation ne se
 * publie pas et nombre de répondants cible. Lecture pour qui voit la notation ; modification par
 * `cabinet.gerer`, jamais par un compte qui cumule le rôle d'expert métier (séparation des tâches :
 * qui publie ne règle pas le seuil qu'il doit franchir). L'API reste seule juge.
 */
export default async function PageParametresNotation() {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerLectureNotation();
  const r = await chargerServeur<ParametresNotation>(CHEMIN_PARAMETRES_NOTATION);
  const droits = droitsParametres(utilisateur.roles, langue);
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Notation", "Rating")}
        soustitre={t(
          "Indice de confiance des notations : une note n'est publiable que si son indice (couverture des items, nombre de répondants, solidité des preuves) atteint le seuil du cabinet.",
          "Rating confidence index: a rating can be published only if its index (item coverage, number of respondents, evidence strength) reaches the firm's threshold.",
        )}
      />
      <Carte titre={t("Indice de confiance", "Confidence index")}>
        {!r.ok ? (
          <EtatErreur
            titre={t(
              "Les paramètres n'ont pas pu être chargés.",
              "The settings could not be loaded.",
            )}
            message={r.message}
            hrefReessayer={HREF_PARAMETRES_NOTATION}
          />
        ) : (
          <div className="mp-pile">
            <dl className="mp-liste-def mp-liste-def--compacte">
              <div>
                <dt>{t("Seuil de confiance", "Confidence threshold")}</dt>
                <dd>{formaterSeuil(r.donnees.seuil_confiance, langue)}</dd>
              </div>
              <div>
                <dt>{t("Répondants cibles", "Target respondents")}</dt>
                <dd>{r.donnees.repondants_cible}</dd>
              </div>
              <div>
                <dt>{t("Origine", "Origin")}</dt>
                <dd>
                  {r.donnees.par_defaut
                    ? t(
                        "Valeurs par défaut de la plateforme (aucun réglage enregistré)",
                        "Platform default values (no setting saved)",
                      )
                    : t(
                        `Réglage du cabinet, modifié le ${formaterDateHeure(r.donnees.modifie_le, "Africa/Abidjan", langue)}`,
                        `Firm setting, modified on ${formaterDateHeure(r.donnees.modifie_le, "Africa/Abidjan", langue)}`,
                      )}
                </dd>
              </div>
            </dl>
            <p className="mp-texte-doux">
              {t(
                `Planchers imposés : seuil de ${formaterSeuil(SEUIL_CONFIANCE_PLANCHER)} au moins et ${REPONDANTS_CIBLE_PLANCHER} répondants cibles au moins. Ils empêchent de vider la garde de publication de sa substance. Les valeurs par défaut et les planchers sont à calibrer au pilote.`,
                `Mandatory floors: a threshold of at least ${formaterSeuil(SEUIL_CONFIANCE_PLANCHER, langue)} and at least ${REPONDANTS_CIBLE_PLANCHER} target respondents. They keep the publication guard from being emptied of its substance. Default values and floors are to be calibrated during the pilot.`,
              )}
            </p>
            {droits.modifier ? (
              <FormulaireParametresConfiance
                parametres={r.donnees}
                avertissement={droits.avertissement}
              />
            ) : (
              <Alerte tonalite="info" annonce="aucune">
                <p>{droits.explication}</p>
              </Alerte>
            )}
          </div>
        )}
      </Carte>
    </div>
  );
}
