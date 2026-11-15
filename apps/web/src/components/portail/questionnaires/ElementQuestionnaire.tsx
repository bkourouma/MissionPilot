import Link from "next/link";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { BadgeStatut } from "../../ui/BadgeStatut";
import { Carte } from "../../ui/Carte";
import {
  echeance,
  estModifiable,
  etatQuestionnaire,
  hrefQuestionnaire,
  libelleMode,
  texteSoumission,
  type QuestionnairePortail,
} from "../../../lib/portail-questionnaires";
import { ProgressionQuestionnaire } from "./ProgressionQuestionnaire";
import "./questionnaires.css";

/** Un questionnaire reçu dans la liste : statut, mode, date limite, progression ou envoi. */
export async function ElementQuestionnaire({
  questionnaire: q,
  aujourdhui,
}: {
  questionnaire: QuestionnairePortail;
  /** Date du jour « AAAA-MM-JJ » (calculée côté serveur). */
  aujourdhui: string;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const etat = etatQuestionnaire(q, aujourdhui, langue);
  const ech = echeance(q.date_limite, aujourdhui, langue);
  const soumission = texteSoumission(q, undefined, langue);
  return (
    <Carte
      className="mp-module"
      niveauTitre={2}
      titre={
        <Link href={hrefQuestionnaire(q.id)} className="mp-lien-etendu">
          {q.titre}
        </Link>
      }
      actions={<BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>}
    >
      <div className="mp-pile">
        <p className="mp-pq-meta">
          <span>{libelleMode(q.mode, q.fonction, langue)}</span>
          <span
            className={
              ech?.depassee && q.statut === "envoye" && q.reponse.statut !== "soumise"
                ? "mp-pq-meta__depassee"
                : undefined
            }
          >
            {ech ? ech.texte : t("Sans date limite", "No due date")}
          </span>
        </p>
        {soumission ? (
          <p className="mp-texte-doux mp-texte-petit">{soumission}</p>
        ) : estModifiable(q, aujourdhui) ? (
          <ProgressionQuestionnaire
            progression={q.reponse.progression}
            id={`progression-${q.id}`}
            langue={langue}
          />
        ) : null}
      </div>
    </Carte>
  );
}
