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
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import type { PageCurseur } from "../../../../../../lib/pagination";
import {
  cheminUrgences,
  hrefRedressement,
  raisonSansEcriture,
  TEXTE_URGENCE_INTRO,
  TEXTE_URGENCE_INTRO_EN,
} from "../../../../../../lib/redressement";
import {
  chargerContexteRed,
  chargerReferentielRed,
} from "../../../../../../lib/redressement-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Urgence du redressement", "Turnaround urgency") };
}

/** Questionnaire d'urgence (RED-01) et historique des évaluations. */
export default async function PageUrgence({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
          {t("Questionnaire d'urgence", "Urgency questionnaire")}
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
              titre={t(
                "Le questionnaire n'a pas pu être chargé.",
                "The questionnaire could not be loaded.",
              )}
              message={referentiel.message}
              hrefReessayer={hrefRedressement(id, "urgence")}
            />
          )
        ) : (
          <>
            <p className="mp-texte-doux">{t(TEXTE_URGENCE_INTRO, TEXTE_URGENCE_INTRO_EN)}</p>
            <Alerte tonalite="info" annonce="aucune">
              <p>{raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles, langue)}</p>
            </Alerte>
            {derniere ? (
              <Carte
                titre={t(
                  `Dernière évaluation, le ${formaterDateHeure(derniere.cree_le)}`,
                  `Latest assessment, on ${formaterDateHeure(derniere.cree_le, undefined, langue)}`,
                )}
              >
                <ResultatUrgence resultat={derniere.resultat} />
              </Carte>
            ) : null}
          </>
        )}
      </section>

      <section className="mp-red-section" aria-labelledby="titre-historique-urgence">
        <h2 id="titre-historique-urgence" className="mp-red-section__titre">
          {t("Historique", "History")}
        </h2>
        {!page.ok ? (
          <EtatErreur
            titre={t("L'historique n'a pas pu être chargé.", "The history could not be loaded.")}
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
