import {
  RED_CLES_RATIO,
  RED_RATIO_LIBELLES,
  type RedCleRatio,
  type RedRatiosVue,
} from "@missionpilot/shared";
import { CLASSE_FIABILITE, STATUT_ETAT } from "../../lib/dossier";
import { formaterDate } from "../../lib/format";
import {
  formaterTendance,
  formaterVariationPoints,
  FORMULES_RATIO,
  libelleStatutRatio,
} from "../../lib/redressement";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

interface LigneRatio {
  cle: RedCleRatio;
}

const MOTIFS_TENDANCE: Record<string, string> = {
  devises_differentes: "Les deux derniers exercices n'ont pas la même devise.",
  exercice_precedent_absent: "Aucun exercice précédent accepté : pas de tendance.",
};

/**
 * Ratios de l'API : une ligne par ratio, une colonne par exercice (du plus récent au plus
 * ancien). Les valeurs (points de base, jours) sont mises en forme sans être recalculées ; un
 * ratio non calculable dit pourquoi et quels postes manquent (jamais compté comme zéro).
 */
export function TableauRatios({ ratios }: { ratios: RedRatiosVue }) {
  const colonnes: ColonneTableau<LigneRatio>[] = [
    {
      cle: "ratio",
      entete: "Ratio",
      rendu: (l) => (
        <>
          <strong>{RED_RATIO_LIBELLES[l.cle]}</strong>
          <span className="mp-red-formule"> — {FORMULES_RATIO[l.cle]}</span>
        </>
      ),
    },
    ...ratios.exercices.map((e): ColonneTableau<LigneRatio> => ({
      cle: `exercice-${e.exercice}`,
      entete: `Exercice ${e.exercice}`,
      alignement: "droite",
      rendu: (l) => (
        <span className="mp-red-valeur">{libelleStatutRatio(l.cle, e.ratios[l.cle])}</span>
      ),
    })),
  ];
  const t = ratios.tendances;
  const classe = CLASSE_FIABILITE[ratios.fiabilite.classe as keyof typeof CLASSE_FIABILITE];
  return (
    <div className="mp-red-section">
      <Tableau
        legende="Ratios par exercice"
        colonnes={colonnes}
        lignes={RED_CLES_RATIO.map((cle) => ({ cle }))}
        cleLigne={(l) => l.cle}
      />

      <div className="mp-red-cartes">
        <Carte titre="Tendances" niveauTitre={3}>
          {t === null ? (
            <p className="mp-texte-doux">Aucune tendance : un seul exercice accepté, ou aucun.</p>
          ) : (
            <dl className="mp-liste-def">
              <div>
                <dt>Croissance du chiffre d&apos;affaires</dt>
                <dd className="mp-red-valeur">{formaterTendance(t.croissance_ca_pb)}</dd>
              </div>
              <div>
                <dt>Évolution de la marge brute</dt>
                <dd className="mp-red-valeur">
                  {formaterVariationPoints(t.variation_marge_brute_pb)}
                </dd>
              </div>
              {t.raison ? (
                <div>
                  <dt>Remarque</dt>
                  <dd>{MOTIFS_TENDANCE[t.raison] ?? t.raison}</dd>
                </div>
              ) : null}
            </dl>
          )}
        </Carte>

        <Carte titre="Fiabilité des comptes" niveauTitre={3}>
          <div className="mp-red-carte-corps">
            {classe ? (
              <p>
                <BadgeStatut tonalite={classe.tonalite}>{classe.libelle}</BadgeStatut>
              </p>
            ) : (
              <p>Classe {ratios.fiabilite.classe}</p>
            )}
            <p className="mp-texte-doux mp-texte-petit">{ratios.fiabilite.points} points sur 100</p>
            {ratios.exercices.some((e) => e.accepte_sous_reserve) ? (
              <ul className="mp-liste-simple">
                {ratios.exercices
                  .filter((e) => e.accepte_sous_reserve)
                  .map((e) => (
                    <li key={e.etat_id}>
                      Exercice {e.exercice} : <strong>Accepté sous réserve</strong>
                      {e.date_cloture ? ` (clôture du ${formaterDate(e.date_cloture)})` : ""}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        </Carte>
      </div>

      {ratios.etats_non_utilises.length > 0 ? (
        <Carte titre="États non utilisés" niveauTitre={3}>
          <p className="mp-texte-doux">
            Un état en revue, rejeté ou remplacé n&apos;entre jamais dans un calcul.
          </p>
          <ul className="mp-liste-simple">
            {ratios.etats_non_utilises.map((e) => {
              const statut = STATUT_ETAT[e.statut as keyof typeof STATUT_ETAT];
              return (
                <li key={e.etat_id}>
                  Exercice {e.exercice} :{" "}
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
