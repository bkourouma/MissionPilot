import type { Metadata } from "next";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { ElementQuestionnaire } from "../../../../components/portail/questionnaires/ElementQuestionnaire";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import {
  hrefPage,
  lireCurseur,
  peut,
  requetePage,
  type PagePortail,
} from "../../../../lib/portail";
import {
  API_QUESTIONNAIRES_PORTAIL,
  CHEMIN_QUESTIONNAIRES_PORTAIL,
  dateDuJour,
  type QuestionnairePortail,
} from "../../../../lib/portail-questionnaires";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";

export const metadata: Metadata = { title: "Questionnaires" };

const CHEMIN = CHEMIN_QUESTIONNAIRES_PORTAIL;

/** Questionnaires adressés à l'utilisateur (dirigeant ou contributeur client), plus récents d'abord. */
export default async function QuestionnairesPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.questionnaires.repondre")) {
    return <NonDisponible titre="Questionnaires" />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PagePortail<QuestionnairePortail>>(
    requetePage(API_QUESTIONNAIRES_PORTAIL, curseur),
  );
  const aujourdhui = dateDuJour(new Date());

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Vos questionnaires"
        soustitre="Les questionnaires que votre cabinet vous a adressés. Vos réponses sont enregistrées au fil de la saisie : vous pouvez vous interrompre et reprendre plus tard, jusqu'à l'envoi."
      />
      {!r.ok ? (
        <EtatErreur
          titre="La liste des questionnaires n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucun questionnaire ne vous a encore été adressé." icone="taches">
          <p>Dès que votre cabinet vous enverra un questionnaire, il apparaîtra ici.</p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {r.donnees.elements.map((q) => (
            <li key={q.id}>
              <ElementQuestionnaire questionnaire={q} aujourdhui={aujourdhui} />
            </li>
          ))}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={
            r.donnees.curseur_suivant ? hrefPage(CHEMIN, r.donnees.curseur_suivant) : null
          }
          hrefDebut={curseur ? CHEMIN : null}
          libelle="Pages des questionnaires"
        />
      ) : null}
    </div>
  );
}
