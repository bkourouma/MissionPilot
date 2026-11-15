import type { Metadata } from "next";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { ElementQuestionnaire } from "../../../../components/portail/questionnaires/ElementQuestionnaire";
import { obtenirT } from "../../../../lib/i18n/serveur";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Questionnaires", "Questionnaires") };
}

const CHEMIN = CHEMIN_QUESTIONNAIRES_PORTAIL;

/** Questionnaires adressés à l'utilisateur (dirigeant ou contributeur client), plus récents d'abord. */
export default async function QuestionnairesPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.questionnaires.repondre")) {
    return <NonDisponible titre={t("Questionnaires", "Questionnaires")} />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PagePortail<QuestionnairePortail>>(
    requetePage(API_QUESTIONNAIRES_PORTAIL, curseur),
  );
  const aujourdhui = dateDuJour(new Date());

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Vos questionnaires", "Your questionnaires")}
        soustitre={t(
          "Les questionnaires que votre cabinet vous a adressés. Vos réponses sont enregistrées au fil de la saisie : vous pouvez vous interrompre et reprendre plus tard, jusqu'à l'envoi.",
          "The questionnaires your firm has sent you. Your responses are saved as you type: you can stop and resume later, until you send them.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "La liste des questionnaires n'a pas pu être chargée.",
            "The list of questionnaires could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucun questionnaire ne vous a encore été adressé.",
            "No questionnaire has been sent to you yet.",
          )}
          icone="taches"
        >
          <p>
            {t(
              "Dès que votre cabinet vous enverra un questionnaire, il apparaîtra ici.",
              "As soon as your firm sends you a questionnaire, it will appear here.",
            )}
          </p>
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
          libelle={t("Pages des questionnaires", "Questionnaire pages")}
        />
      ) : null}
    </div>
  );
}
