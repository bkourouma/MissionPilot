import type { Metadata } from "next";
import "../../../../../../components/redressement/cloture.css";
import { EtatContexteRed } from "../../../../../../components/redressement/EtatsContexte";
import { SuiviAlertes } from "../../../../../../components/redressement/SuiviAlertes";
import { SuiviCreation } from "../../../../../../components/redressement/SuiviCreation";
import { SuiviJalon } from "../../../../../../components/redressement/SuiviJalon";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { formaterDate } from "../../../../../../lib/format";
import { aujourdhui } from "../../../../../../lib/periode";
import { hrefRedressement } from "../../../../../../lib/redressement";
import {
  etatSuivi,
  MENTION_SUIVI,
  peutEcrireSuivi,
  TEXTE_SUIVI_A_CREER,
  TEXTE_SUIVI_LECTURE_SEULE,
  TEXTE_SUIVI_NON_CLOS,
} from "../../../../../../lib/redressement-suivi";
import { chargerSuiviDossier } from "../../../../../../lib/redressement-suivi-serveur";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";

export const metadata: Metadata = { title: "Suivi post-mission du redressement" };

/**
 * Suivi post-mission (RED-09), interne au cabinet : jalons après la clôture du dossier, alertes
 * calculées à chaque lecture, relevés comparés à la référence de clôture. Tant que le dossier
 * n'est pas clos, l'écran l'explique. L'API reste seule juge des droits et de l'état du dossier.
 */
export default async function PageSuivi({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefRedressement(id, "suivi")}
      />
    );
  }
  const { mission, dossier, session } = ctx;
  const retour = hrefRedressement(id, "suivi");
  const charge = await chargerSuiviDossier(dossier.id);
  if (!charge.ok) {
    return (
      <div className="mp-red">
        <EtatErreur
          titre="Le suivi n'a pas pu être chargé."
          message={charge.message}
          hrefReessayer={retour}
        />
      </div>
    );
  }
  const suivi = charge.donnees;
  const etat = etatSuivi(suivi);
  const peutEcrire = peutEcrireSuivi(session.utilisateur.roles, session.utilisateur.id, mission);
  const jour = aujourdhui();

  return (
    <div className="mp-red">
      <section className="mp-red-section" aria-labelledby="titre-suivi">
        <h2 id="titre-suivi" className="mp-red-section__titre">
          Suivi post-mission
        </h2>
        <Alerte tonalite="info" annonce="aucune">
          <p>{MENTION_SUIVI}</p>
        </Alerte>

        {etat === "non_clos" ? (
          <EtatVide titre="Le dossier n'est pas clos." icone="info">
            <p>{TEXTE_SUIVI_NON_CLOS}</p>
          </EtatVide>
        ) : etat === "a_creer" ? (
          <>
            <EtatVide titre="Aucun suivi défini." icone="info">
              <p>{TEXTE_SUIVI_A_CREER}</p>
            </EtatVide>
            {peutEcrire ? (
              <Carte titre="Créer le suivi" niveauTitre={3}>
                <SuiviCreation dossierId={dossier.id} />
              </Carte>
            ) : (
              <p className="mp-texte-doux">{TEXTE_SUIVI_LECTURE_SEULE}</p>
            )}
          </>
        ) : (
          <>
            <p className="mp-texte-doux">
              {suivi.plan
                ? `Dossier clos le ${formaterDate(suivi.plan.date_cloture)} ; situation au ${formaterDate(suivi.date_reference)}.`
                : null}
            </p>
            {peutEcrire ? null : <p className="mp-texte-doux">{TEXTE_SUIVI_LECTURE_SEULE}</p>}
          </>
        )}
      </section>

      {etat === "actif" ? (
        <>
          <SuiviAlertes suivi={suivi} />
          <section className="mp-red-section" aria-labelledby="titre-jalons">
            <h2 id="titre-jalons" className="mp-red-section__titre">
              Jalons
            </h2>
            {suivi.jalons.map((j) => (
              <SuiviJalon
                key={j.id}
                dossierId={dossier.id}
                jalon={j}
                jalons={suivi.jalons}
                peutEcrire={peutEcrire}
                aujourdhui={jour}
              />
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}
