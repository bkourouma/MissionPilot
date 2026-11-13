import { RED_CLES_RATIO, type RedCleRatio, type RedRatiosVue } from "@missionpilot/shared";
import { classeFiabilite, statutEtat } from "../../lib/dossier";
import { formaterDate } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  formaterTendance,
  formaterVariationPoints,
  formuleRatio,
  libelleStatutRatio,
} from "../../lib/redressement";
import { libelleRatioCloture } from "../../lib/redressement-cloture";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

interface LigneRatio {
  cle: RedCleRatio;
}

/**
 * Ratios de l'API : une ligne par ratio, une colonne par exercice (du plus récent au plus
 * ancien). Les valeurs (points de base, jours) sont mises en forme sans être recalculées ; un
 * ratio non calculable dit pourquoi et quels postes manquent (jamais compté comme zéro).
 */
export async function TableauRatios({ ratios }: { ratios: RedRatiosVue }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const MOTIFS_TENDANCE: Record<string, string> = {
    devises_differentes: t(
      "Les deux derniers exercices n'ont pas la même devise.",
      "The last two fiscal years do not have the same currency.",
    ),
    exercice_precedent_absent: t(
      "Aucun exercice précédent accepté : pas de tendance.",
      "No previous accepted fiscal year: no trend.",
    ),
  };
  const colonnes: ColonneTableau<LigneRatio>[] = [
    {
      cle: "ratio",
      entete: "Ratio",
      rendu: (l) => (
        <>
          <strong>{libelleRatioCloture(l.cle, langue)}</strong>
          <span className="mp-red-formule"> — {formuleRatio(l.cle, langue)}</span>
        </>
      ),
    },
    ...ratios.exercices.map((e): ColonneTableau<LigneRatio> => ({
      cle: `exercice-${e.exercice}`,
      entete: t(`Exercice ${e.exercice}`, `Fiscal year ${e.exercice}`),
      alignement: "droite",
      rendu: (l) => (
        <span className="mp-red-valeur">{libelleStatutRatio(l.cle, e.ratios[l.cle], langue)}</span>
      ),
    })),
  ];
  const tend = ratios.tendances;
  const classe = classeFiabilite(ratios.fiabilite.classe as "A" | "B" | "C" | "D", langue);
  return (
    <div className="mp-red-section">
      <Tableau
        legende={t("Ratios par exercice", "Ratios by fiscal year")}
        colonnes={colonnes}
        lignes={RED_CLES_RATIO.map((cle) => ({ cle }))}
        cleLigne={(l) => l.cle}
      />

      <div className="mp-red-cartes">
        <Carte titre={t("Tendances", "Trends")} niveauTitre={3}>
          {tend === null ? (
            <p className="mp-texte-doux">
              {t(
                "Aucune tendance : un seul exercice accepté, ou aucun.",
                "No trend: only one accepted fiscal year, or none.",
              )}
            </p>
          ) : (
            <dl className="mp-liste-def">
              <div>
                <dt>{t("Croissance du chiffre d'affaires", "Revenue growth")}</dt>
                <dd className="mp-red-valeur">{formaterTendance(tend.croissance_ca_pb, langue)}</dd>
              </div>
              <div>
                <dt>{t("Évolution de la marge brute", "Change in gross margin")}</dt>
                <dd className="mp-red-valeur">
                  {formaterVariationPoints(tend.variation_marge_brute_pb, langue)}
                </dd>
              </div>
              {tend.raison ? (
                <div>
                  <dt>{t("Remarque", "Note")}</dt>
                  <dd>{MOTIFS_TENDANCE[tend.raison] ?? tend.raison}</dd>
                </div>
              ) : null}
            </dl>
          )}
        </Carte>

        <Carte titre={t("Fiabilité des comptes", "Accounts reliability")} niveauTitre={3}>
          <div className="mp-red-carte-corps">
            {classe ? (
              <p>
                <BadgeStatut tonalite={classe.tonalite}>{classe.libelle}</BadgeStatut>
              </p>
            ) : (
              <p>
                {t("Classe", "Class")} {ratios.fiabilite.classe}
              </p>
            )}
            <p className="mp-texte-doux mp-texte-petit">
              {t(
                `${ratios.fiabilite.points} points sur 100`,
                `${ratios.fiabilite.points} points out of 100`,
              )}
            </p>
            {ratios.exercices.some((e) => e.accepte_sous_reserve) ? (
              <ul className="mp-liste-simple">
                {ratios.exercices
                  .filter((e) => e.accepte_sous_reserve)
                  .map((e) => (
                    <li key={e.etat_id}>
                      {t("Exercice", "Fiscal year")} {e.exercice}
                      {t(" : ", ": ")}
                      <strong>{t("Accepté sous réserve", "Accepted with reservations")}</strong>
                      {e.date_cloture
                        ? t(
                            ` (clôture du ${formaterDate(e.date_cloture)})`,
                            ` (closing on ${formaterDate(e.date_cloture, "UTC", langue)})`,
                          )
                        : ""}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        </Carte>
      </div>

      {ratios.etats_non_utilises.length > 0 ? (
        <Carte titre={t("États non utilisés", "Statements not used")} niveauTitre={3}>
          <p className="mp-texte-doux">
            {t(
              "Un état en revue, rejeté ou remplacé n'entre jamais dans un calcul.",
              "A statement under review, rejected or replaced never enters a computation.",
            )}
          </p>
          <ul className="mp-liste-simple">
            {ratios.etats_non_utilises.map((e) => {
              const statut = statutEtat(
                e.statut as "en_revue" | "accepte" | "rejete" | "remplace",
                langue,
              );
              return (
                <li key={e.etat_id}>
                  {t("Exercice", "Fiscal year")} {e.exercice}
                  {t(" : ", ": ")}
                  {statut ? (
                    <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
                  ) : (
                    e.statut
                  )}
                </li>
              );
            })}
          </ul>
        </Carte>
      ) : null}
    </div>
  );
}
