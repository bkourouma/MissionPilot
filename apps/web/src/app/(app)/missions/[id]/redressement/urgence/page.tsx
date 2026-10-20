import type { Metadata } from "next";
import type { RedUrgenceVue } from "@missionpilot/shared";
import { EtatContexteRed } from "../../../../../../components/redressement/EtatsContexte";
import { HistoriqueUrgences } from "../../../../../../components/redressement/HistoriqueUrgences";
import { QuestionnaireUrgence } from "../../../../../../components/redressement/QuestionnaireUrgence";
import { ResultatUrgence } from "../../../../../../components/redressement/ResultatUrgence";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../../lib/format";
import type { PageCurseur } from "../../../../../../lib/pagination";
import {
  cheminUrgences,
  hrefRedressement,
  raisonSansEcriture,
  TEXTE_URGENCE_INTRO,
} from "../../../../../../lib/redressement";
import {
  chargerContexteRed,
  chargerReferentielRed,
} from "../../../../../../lib/redressement-serveur";

export const metadata: Metadata = { title: "Urgence du redressement" };

/** Questionnaire d'urgence (RED-01) et historique des évaluations. */
export default async function PageUrgence({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefRedressement(id, "urgence")}
      />
    );
  }
  const { mission, dossier, droits } = ctx;
  const [referentiel, page] = await Promise.all([
    chargerReferentielRed(),
    chargerServeur<PageCurseur<RedUrgenceVue>>(cheminUrgences(dossier.id)),
  ]);
  const derniere = page.ok ? (page.donnees.elements[0] ?? null) : null;

  return (
    <div className="mp-red">
      <section className="mp-red-section" aria-labelledby="titre-questionnaire">
        <h2 id="titre-questionnaire" className="mp-red-section__titre">
          Questionnaire d&apos;urgence
        </h2>
        {droits.ecrire ? (
          referentiel.ok ? (
            <QuestionnaireUrgence
              dossierId={dossier.id}
              grille={referentiel.donnees.grille_urgence}
              derniere={derniere}
            />
          ) : (
            <EtatErreur
              titre="Le questionnaire n'a pas pu être chargé."
              message={referentiel.message}
              hrefReessayer={hrefRedressement(id, "urgence")}
            />
          )
        ) : (
          <>
            <p className="mp-texte-doux">{TEXTE_URGENCE_INTRO}</p>
            <Alerte tonalite="info" annonce="aucune">
              <p>{raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles)}</p>
            </Alerte>
            {derniere ? (
              <Carte titre={`Dernière évaluation, le ${formaterDateHeure(derniere.cree_le)}`}>
                <ResultatUrgence resultat={derniere.resultat} />
              </Carte>
            ) : null}
          </>
        )}
      </section>

      <section className="mp-red-section" aria-labelledby="titre-historique-urgence">
        <h2 id="titre-historique-urgence" className="mp-red-section__titre">
          Historique
        </h2>
        {!page.ok ? (
          <EtatErreur
            titre="L'historique n'a pas pu être chargé."
            message={page.message}
            hrefReessayer={hrefRedressement(id, "urgence")}
          />
        ) : (
          <HistoriqueUrgences
            key={derniere?.id ?? "vide"}
            dossierId={dossier.id}
            initial={page.donnees.elements}
            suivant={page.donnees.suivant}
          />
        )}
      </section>
    </div>
  );
}
