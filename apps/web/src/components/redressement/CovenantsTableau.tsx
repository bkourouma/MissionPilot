import type { RedCovenantsVue, RedCovenantVue } from "@missionpilot/shared";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  formaterMargeCovenant,
  formaterValeurCovenant,
  libelleExigenceCovenant,
  libelleFrequenceCovenant,
  libelleRaisonCovenantLangue,
  libelleRatioCovenant,
  libelleStatutCovenant,
  mentionCovenant,
  textesFinancement,
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
export async function CovenantsTableau({ vue }: { vue: RedCovenantsVue }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { version, exercice, synthese } = vue;
  if (version === null || version.covenants.length === 0) {
    return (
      <EtatVide titre={t("Aucun covenant.", "No covenant.")} icone="info">
        <p>{textesFinancement(langue).covenantsAbsents}</p>
      </EtatVide>
    );
  }
  const colonnes: ColonneTableau<RedCovenantVue>[] = [
    {
      cle: "ratio",
      entete: "Ratio",
      rendu: (c) => (
        <>
          <strong>{libelleRatioCovenant(c.ratio, langue)}</strong>
          {c.preteur ? <span className="mp-texte-doux"> · {c.preteur}</span> : null}
        </>
      ),
    },
    {
      cle: "exigence",
      entete: t("Exigence", "Requirement"),
      rendu: (c) => libelleExigenceCovenant(c, langue),
    },
    {
      cle: "frequence",
      entete: t("Fréquence", "Frequency"),
      rendu: (c) => libelleFrequenceCovenant(c.frequence, langue),
    },
    {
      cle: "valeur",
      entete: t("Valeur", "Value"),
      alignement: "droite",
      rendu: (c) => (
        <span className="mp-red-valeur">
          {formaterValeurCovenant(c.ratio, c.evaluation.valeur_pb, langue)}
        </span>
      ),
    },
    {
      cle: "marge",
      entete: t("Marge", "Margin"),
      alignement: "droite",
      rendu: (c) => (
        <span className="mp-red-valeur">
          {formaterMargeCovenant(c.ratio, c.evaluation.marge_pb, langue)}
        </span>
      ),
    },
    {
      cle: "statut",
      entete: t("Statut", "Status"),
      rendu: (c) => (
        <>
          <BadgeStatut tonalite={tonaliteStatutCovenant(c.evaluation.statut)}>
            {libelleStatutCovenant(c.evaluation.statut, langue)}
          </BadgeStatut>
          {c.evaluation.raison !== null ? (
            <span className="mp-texte-doux mp-texte-petit mp-fin-raison">
              {libelleRaisonCovenantLangue(c, langue)}
            </span>
          ) : null}
        </>
      ),
    },
  ];
  const creeLe = formaterDateHeure(version.cree_le, undefined, langue);
  return (
    <div className="mp-fin-bloc">
      <p className="mp-texte-doux">
        {t(
          `Version ${version.version}, par ${version.cree_par.nom} le ${creeLe}.`,
          `Version ${version.version}, by ${version.cree_par.nom} on ${creeLe}.`,
        )}
        {exercice
          ? t(
              ` Exercice évalué : ${exercice.exercice} (clôture du ${formaterDate(exercice.date_cloture)})${exercice.accepte_sous_reserve ? ", accepté sous réserve" : ""}.`,
              ` Fiscal year assessed: ${exercice.exercice} (closing on ${formaterDate(exercice.date_cloture, "UTC", langue)})${exercice.accepte_sous_reserve ? ", accepted with reservations" : ""}.`,
            )
          : ""}
      </p>
      {synthese ? (
        <p className="mp-texte-doux" aria-live="polite">
          {t(
            `${synthese.respectes} seuil(s) respecté(s), ${synthese.en_defaut} seuil(s) non atteint(s), ${synthese.non_calculables} non calculable(s) sur ${synthese.nombre}.`,
            `${synthese.respectes} threshold(s) met, ${synthese.en_defaut} threshold(s) not reached, ${synthese.non_calculables} not computable out of ${synthese.nombre}.`,
          )}
        </p>
      ) : null}
      <Tableau
        legende={t("Covenants de la version courante", "Covenants of the current version")}
        colonnes={colonnes}
        lignes={version.covenants}
        cleLigne={(c) => c.id}
      />
      <Alerte tonalite="info" annonce="aucune">
        <p>{mentionCovenant(langue)}</p>
      </Alerte>
    </div>
  );
}
