import type { RedScoreVue } from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import {
  AVERTISSEMENT_SEUILS_DEFAUT,
  formaterValeurCritere,
  libelleCritere,
  libelleScore,
  libelleSourceSeuils,
  MENTION_SCORE,
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
export function ScoreAlerte({ score }: { score: RedScoreVue | null }) {
  if (score === null) {
    return (
      <Carte titre="Score d'alerte précoce">
        <div className="mp-red-carte-corps">
          <EtatVide titre="Aucun score d'alerte précoce calculé." icone="attention">
            <p>
              Renseignez les incidents de paiement ci-dessous, puis lancez le calcul : les ratios
              viennent du dernier état accepté.
            </p>
          </EtatVide>
          <p className="mp-texte-doux">{MENTION_SCORE}</p>
        </div>
      </Carte>
    );
  }
  return (
    <Carte titre="Score d'alerte précoce">
      <div className="mp-red-carte-corps">
        <p className="mp-red-chiffre">{libelleScore(score.score, score.niveau)}</p>
        <p>
          <NiveauAlerte niveau={score.niveau} />{" "}
          <BadgeStatut tonalite="neutre" sansIcone>
            Indicatif
          </BadgeStatut>
        </p>
        <p className="mp-texte-doux mp-texte-petit">
          Calculé le {formaterDateHeure(score.cree_le)} par {score.calcule_par.nom} ·{" "}
          {libelleSourceSeuils(score.seuils_source, score.secteur, score.seuils_version)}
        </p>
        {score.seuils_source === "defaut_moteur" ? (
          <Alerte tonalite="attention" annonce="aucune">
            <p>{AVERTISSEMENT_SEUILS_DEFAUT}</p>
          </Alerte>
        ) : null}
        <p>{MENTION_SCORE}</p>
        <Tableau
          legende="Critères de l'alerte précoce"
          colonnes={[
            {
              cle: "critere",
              entete: "Critère",
              rendu: (c: RedScoreVue["resultat"]["criteres"][number]) => libelleCritere(c.critere),
            },
            {
              cle: "valeur",
              entete: "Valeur",
              alignement: "droite",
              rendu: (c) => (
                <span className="mp-red-valeur">{formaterValeurCritere(c.critere, c.valeur)}</span>
              ),
            },
            { cle: "statut", entete: "Voyant", rendu: (c) => <Voyant voyant={c.statut} /> },
            { cle: "poids", entete: "Poids", alignement: "droite", rendu: (c) => c.poids },
            { cle: "motif", entete: "Motif", rendu: (c) => motifCritere(c.motif) },
          ]}
          lignes={score.resultat.criteres}
          cleLigne={(c) => c.critere}
        />
      </div>
    </Carte>
  );
}
