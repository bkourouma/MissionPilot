import { creerTraduire, type RedScoreVue } from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import {
  AVERTISSEMENT_SEUILS_DEFAUT,
  AVERTISSEMENT_SEUILS_DEFAUT_EN,
  formaterValeurCritere,
  libelleCritere,
  libelleScore,
  libelleSourceSeuils,
  MENTION_SCORE,
  MENTION_SCORE_EN,
  motifCritere,
} from "../../lib/redressement";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { EtatVide } from "../ui/EtatListe";
import { Tableau } from "../ui/Tableau";
import { NiveauAlerte, Voyant } from "./Voyant";

/**
 * Dernier score d'alerte précoce (RED-10) : score sur 100 ou « Données insuffisantes », niveau,
 * source des seuils et tableau des douze critères. Le score est calculé par le moteur sur les
 * seuils conservés avec lui ; la mention « Indicatif » est fixe et jamais masquée.
 */
export async function ScoreAlerte({ score }: { score: RedScoreVue | null }) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  if (score === null) {
    return (
      <Carte titre={t("Score d'alerte précoce", "Early-warning score")}>
        <div className="mp-red-carte-corps">
          <EtatVide
            titre={t("Aucun score d'alerte précoce calculé.", "No early-warning score computed.")}
            icone="attention"
          >
            <p>
              {t(
                "Renseignez les incidents de paiement ci-dessous, puis lancez le calcul : les ratios viennent du dernier état accepté.",
                "Fill in the payment incidents below, then run the computation: the ratios come from the latest accepted statement.",
              )}
            </p>
          </EtatVide>
          <p className="mp-texte-doux">{t(MENTION_SCORE, MENTION_SCORE_EN)}</p>
        </div>
      </Carte>
    );
  }
  return (
    <Carte titre={t("Score d'alerte précoce", "Early-warning score")}>
      <div className="mp-red-carte-corps">
        <p className="mp-red-chiffre">{libelleScore(score.score, score.niveau, langue)}</p>
        <p>
          <NiveauAlerte niveau={score.niveau} />{" "}
          <BadgeStatut tonalite="neutre" sansIcone>
            {t("Indicatif", "Indicative")}
          </BadgeStatut>
        </p>
        <p className="mp-texte-doux mp-texte-petit">
          {t("Calculé le", "Computed on")} {formaterDateHeure(score.cree_le, undefined, langue)}{" "}
          {t("par", "by")} {score.calcule_par.nom} ·{" "}
          {libelleSourceSeuils(score.seuils_source, score.secteur, score.seuils_version, langue)}
        </p>
        {score.seuils_source === "defaut_moteur" ? (
          <Alerte tonalite="attention" annonce="aucune">
            <p>{t(AVERTISSEMENT_SEUILS_DEFAUT, AVERTISSEMENT_SEUILS_DEFAUT_EN)}</p>
          </Alerte>
        ) : null}
        <p>{t(MENTION_SCORE, MENTION_SCORE_EN)}</p>
        <Tableau
          legende={t("Critères de l'alerte précoce", "Early-warning criteria")}
          colonnes={[
            {
              cle: "critere",
              entete: t("Critère", "Criterion"),
              rendu: (c: RedScoreVue["resultat"]["criteres"][number]) =>
                libelleCritere(c.critere, langue),
            },
            {
              cle: "valeur",
              entete: t("Valeur", "Value"),
              alignement: "droite",
              rendu: (c) => (
                <span className="mp-red-valeur">
                  {formaterValeurCritere(c.critere, c.valeur, langue)}
                </span>
              ),
            },
            {
              cle: "statut",
              entete: t("Voyant", "Indicator"),
              rendu: (c) => <Voyant voyant={c.statut} />,
            },
            {
              cle: "poids",
              entete: t("Poids", "Weight"),
              alignement: "droite",
              rendu: (c) => c.poids,
            },
            {
              cle: "motif",
              entete: t("Motif", "Reason"),
              rendu: (c) => motifCritere(c.motif, langue),
            },
          ]}
          lignes={score.resultat.criteres}
          cleLigne={(c) => c.critere}
        />
      </div>
    </Carte>
  );
}
