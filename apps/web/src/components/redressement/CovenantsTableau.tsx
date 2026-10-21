import {
  RED_COVENANT_FREQUENCE_LIBELLES,
  type RedCovenantsVue,
  type RedCovenantVue,
} from "@missionpilot/shared";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import {
  formaterMargeCovenant,
  formaterValeurCovenant,
  libelleExigenceCovenant,
  libelleRaisonCovenant,
  libelleRatioCovenant,
  libelleStatutCovenant,
  MENTION_COVENANT,
  TEXTE_COVENANTS_ABSENTS,
  tonaliteStatutCovenant,
} from "../../lib/redressement-financement";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { EtatVide } from "../ui/EtatListe";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

/**
 * Covenants de la version courante : exigence saisie, valeur du dernier exercice accepté, marge
 * et statut. Le statut est un constat arithmétique (valeur contre seuil), jamais une
 * qualification juridique : la mention fixe de l'API accompagne toujours l'évaluation. Valeurs,
 * marges et statuts viennent de l'API (moteur).
 */
export function CovenantsTableau({ vue }: { vue: RedCovenantsVue }) {
  const { version, exercice, synthese } = vue;
  if (version === null || version.covenants.length === 0) {
    return (
      <EtatVide titre="Aucun covenant." icone="info">
        <p>{TEXTE_COVENANTS_ABSENTS}</p>
      </EtatVide>
    );
  }
  const colonnes: ColonneTableau<RedCovenantVue>[] = [
    {
      cle: "ratio",
      entete: "Ratio",
      rendu: (c) => (
        <>
          <strong>{libelleRatioCovenant(c.ratio)}</strong>
          {c.preteur ? <span className="mp-texte-doux"> · {c.preteur}</span> : null}
        </>
      ),
    },
    { cle: "exigence", entete: "Exigence", rendu: (c) => libelleExigenceCovenant(c) },
    {
      cle: "frequence",
      entete: "Fréquence",
      rendu: (c) => RED_COVENANT_FREQUENCE_LIBELLES[c.frequence],
    },
    {
      cle: "valeur",
      entete: "Valeur",
      alignement: "droite",
      rendu: (c) => (
        <span className="mp-red-valeur">
          {formaterValeurCovenant(c.ratio, c.evaluation.valeur_pb)}
        </span>
      ),
    },
    {
      cle: "marge",
      entete: "Marge",
      alignement: "droite",
      rendu: (c) => (
        <span className="mp-red-valeur">
          {formaterMargeCovenant(c.ratio, c.evaluation.marge_pb)}
        </span>
      ),
    },
    {
      cle: "statut",
      entete: "Statut",
      rendu: (c) => (
        <>
          <BadgeStatut tonalite={tonaliteStatutCovenant(c.evaluation.statut)}>
            {libelleStatutCovenant(c.evaluation.statut)}
          </BadgeStatut>
          {c.evaluation.raison !== null ? (
            <span className="mp-texte-doux mp-texte-petit mp-fin-raison">
              {libelleRaisonCovenant(c)}
            </span>
          ) : null}
        </>
      ),
    },
  ];
  return (
    <div className="mp-fin-bloc">
      <p className="mp-texte-doux">
        Version {version.version}, par {version.cree_par.nom} le{" "}
        {formaterDateHeure(version.cree_le)}.
        {exercice
          ? ` Exercice évalué : ${exercice.exercice} (clôture du ${formaterDate(exercice.date_cloture)})${exercice.accepte_sous_reserve ? ", accepté sous réserve" : ""}.`
          : ""}
      </p>
      {synthese ? (
        <p className="mp-texte-doux" aria-live="polite">
          {synthese.respectes} seuil(s) respecté(s), {synthese.en_defaut} seuil(s) non atteint(s),{" "}
          {synthese.non_calculables} non calculable(s) sur {synthese.nombre}.
        </p>
      ) : null}
      <Tableau
        legende="Covenants de la version courante"
        colonnes={colonnes}
        lignes={version.covenants}
        cleLigne={(c) => c.id}
      />
      <Alerte tonalite="info" annonce="aucune">
        <p>{MENTION_COVENANT}</p>
      </Alerte>
    </div>
  );
}
