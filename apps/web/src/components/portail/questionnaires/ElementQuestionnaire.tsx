import Link from "next/link";
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
export function ElementQuestionnaire({
  questionnaire: q,
  aujourdhui,
}: {
  questionnaire: QuestionnairePortail;
  /** Date du jour « AAAA-MM-JJ » (calculée côté serveur). */
  aujourdhui: string;
}) {
  const etat = etatQuestionnaire(q, aujourdhui);
  const ech = echeance(q.date_limite, aujourdhui);
  const soumission = texteSoumission(q);
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
          <span>{libelleMode(q.mode, q.fonction)}</span>
          <span className={ech?.depassee && estModifiable(q) ? "mp-pq-meta__depassee" : undefined}>
            {ech ? ech.texte : "Sans date limite"}
          </span>
        </p>
        {soumission ? (
          <p className="mp-texte-doux mp-texte-petit">{soumission}</p>
        ) : estModifiable(q) ? (
          <ProgressionQuestionnaire
            progression={q.reponse.progression}
            id={`progression-${q.id}`}
          />
        ) : null}
      </div>
    </Carte>
  );
}
