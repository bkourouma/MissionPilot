import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { ReponseQuestionnaire } from "../../../../../components/portail/questionnaires/ReponseQuestionnaire";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { estIdentifiant, peut } from "../../../../../lib/portail";
import {
  aDefinition,
  cheminApiQuestionnaire,
  CHEMIN_QUESTIONNAIRES_PORTAIL,
  dateDuJour,
  hrefQuestionnaire,
  type QuestionnairePortail,
} from "../../../../../lib/portail-questionnaires";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";

export const metadata: Metadata = { title: "Questionnaire" };

/**
 * Réponse à un questionnaire adressé à l'utilisateur. Inexistant, d'autrui ou non adressé : la
 * même page « introuvable » (l'API répond le même 404).
 */
export default async function QuestionnairePortailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.questionnaires.repondre")) {
    return <NonDisponible titre="Questionnaire" />;
  }
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();

  const r = await chargerPortail<QuestionnairePortail>(cheminApiQuestionnaire(id));
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok || !aDefinition(r.donnees)) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Questionnaire"
          retour={{ href: CHEMIN_QUESTIONNAIRES_PORTAIL, libelle: "Vos questionnaires" }}
        />
        <EtatErreur
          titre="Ce questionnaire n'a pas pu être chargé."
          message={
            r.ok
              ? "Le contenu du questionnaire est incomplet. Réessayez dans un instant."
              : r.message
          }
          hrefReessayer={hrefQuestionnaire(id)}
        />
      </div>
    );
  }

  return <ReponseQuestionnaire questionnaire={r.donnees} aujourdhui={dateDuJour(new Date())} />;
}
