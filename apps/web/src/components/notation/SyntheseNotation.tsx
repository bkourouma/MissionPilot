import { formaterDateHeure } from "../../lib/format";
import {
  CLASSES,
  dimensionsNonNotables,
  formaterCouverture,
  formaterScore,
  NOM_GRILLE_GENERIQUE,
  libelleSecteur,
  libelleStatutVersion,
  libelleStrategie,
  LISTE_CLASSES,
  pluriel,
  tonaliteStatutVersion,
  type VueVersionNotation,
} from "../../lib/notation";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { BadgeClasse } from "./BadgeClasse";

export interface SyntheseNotationProps {
  vue: VueVersionNotation;
  /** Titre du questionnaire noté, s'il est connu. */
  titreQuestionnaire: string | null;
  derniere: boolean;
}

/**
 * Score global, classe (lettre et libellé), statut et contexte du calcul figé. Tous les
 * chiffres sont ceux de l'API (moteur) : aucun n'est recalculé ici.
 */
export function SyntheseNotation({ vue, titreQuestionnaire, derniere }: SyntheseNotationProps) {
  const s = vue.score;
  const nonNotables = dimensionsNonNotables(vue);
  const ajuste = vue.ajustements.length > 0;
  return (
    <div className="mp-notation__section">
      <div className="mp-notation-score">
        <p className="mp-notation-score__valeur">
          {s.notable ? (
            <>
              <span>{formaterScore(s.score)}</span>
              <span className="mp-notation-score__sur">sur 100</span>
            </>
          ) : (
            <span className="mp-notation-score__sur">Score global non notable</span>
          )}
        </p>
        <BadgeClasse classe={s.notable ? s.classe : null} grand />
        <BadgeStatut tonalite={tonaliteStatutVersion(vue.statut)}>
          {libelleStatutVersion(vue.statut)}
        </BadgeStatut>
      </div>

      {!s.notable ? (
        <Alerte tonalite="attention" titre="Score global non notable" annonce="aucune">
          <p>
            Les dimensions notables ne pèsent que {formaterCouverture(vue.resultat.couverture)} du
            poids total, sous le minimum requis (la moitié). Complétez les réponses du questionnaire
            puis relancez un calcul : cette version ne peut pas être soumise en revue.
          </p>
        </Alerte>
      ) : null}
      {nonNotables.length > 0 ? (
        <Alerte
          tonalite="info"
          titre="Dimension non notable : réponses insuffisantes"
          annonce="aucune"
        >
          <p>
            Faute de réponses suffisantes (moins de la moitié du poids de leurs questions),{" "}
            {nonNotables.length > 1
              ? "ces dimensions ne reçoivent pas de score"
              : "cette dimension ne reçoit pas de score"}{" "}
            : {nonNotables.map((d) => d.libelle).join(", ")}.
          </p>
        </Alerte>
      ) : null}
      {!derniere ? (
        <Alerte tonalite="info" titre="Version antérieure, en lecture seule" annonce="aucune">
          <p>Une version plus récente existe : les actions portent sur la dernière version.</p>
        </Alerte>
      ) : null}

      <dl className="mp-liste-def mp-liste-def--compacte">
        <div>
          <dt>Version</dt>
          <dd>
            Version {vue.numero}, calculée le {formaterDateHeure(vue.calcule_le)} par{" "}
            {vue.calcule_par.nom ?? "un membre du cabinet"}
          </dd>
        </div>
        {ajuste ? (
          <div>
            <dt>Avant ajustements</dt>
            <dd>
              Score calculé :{" "}
              {s.score_calcule === null ? "non notable" : formaterScore(s.score_calcule)} (
              {pluriel(vue.ajustements.length, "ajustement motivé", "ajustements motivés")})
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Questionnaire</dt>
          <dd>
            {titreQuestionnaire ?? "Questionnaire de la mission"} —{" "}
            {pluriel(
              vue.reponses_utilisees,
              "réponse soumise utilisée",
              "réponses soumises utilisées",
            )}
          </dd>
        </div>
        <div>
          <dt>Grille</dt>
          <dd>
            {vue.grille.generique
              ? NOM_GRILLE_GENERIQUE
              : `${vue.grille.titre} (${vue.grille.code}, version ${vue.grille.version})`}
          </dd>
        </div>
        <div>
          <dt>Pondérations</dt>
          <dd>{libelleSecteur(vue.secteur)}</dd>
        </div>
        <div>
          <dt>Réponses manquantes</dt>
          <dd>{libelleStrategie(vue.strategie)}</dd>
        </div>
        <div>
          <dt>Couverture</dt>
          <dd>{formaterCouverture(vue.resultat.couverture)} du poids des dimensions est notable</dd>
        </div>
      </dl>

      <details className="mp-details">
        <summary>Barème des classes</summary>
        <ul className="mp-notation-bareme">
          {LISTE_CLASSES.map((c) => (
            <li key={c}>
              <BadgeClasse classe={c} />
              <span>score {CLASSES[c].plage}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
