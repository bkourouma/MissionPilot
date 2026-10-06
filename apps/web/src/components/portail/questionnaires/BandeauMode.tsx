import { Alerte } from "../../ui/Alerte";
import { Bouton } from "../../ui/Bouton";
import "./questionnaires.css";

export interface BandeauModeProps {
  mode: string;
  fonction: string | null;
  /** Mode collectif, saisie ouverte : relire la réponse partagée (saisies des collègues). */
  onActualiser?: () => void;
  actualisation?: boolean;
}

/**
 * Règles du mode de réponse, rappelées en tête du questionnaire (DECISIONS.md, V2) : réponse
 * partagée verrouillée à la première soumission (collectif), fonction du répondant (par
 * fonction). Message statique : il n'est pas annoncé, il se lit dans l'ordre de la page.
 */
export function BandeauMode({ mode, fonction, onActualiser, actualisation }: BandeauModeProps) {
  if (mode === "collectif") {
    return (
      <Alerte
        tonalite="info"
        annonce="aucune"
        titre="Réponse partagée par votre entreprise : elle sera verrouillée à la première soumission"
      >
        <p>
          Vos collègues désignés complètent la même réponse que vous. Les réponses de chacun
          s&apos;ajoutent ; sur une même question, la dernière réponse enregistrée l&apos;emporte.
          Dès que l&apos;un de vous l&apos;envoie, plus personne ne peut la modifier.
        </p>
        {onActualiser ? (
          <div className="mp-pq-bandeau__action">
            <Bouton
              variante="secondaire"
              icone="personnes"
              onClick={onActualiser}
              chargement={actualisation}
              texteChargement="Mise à jour en cours…"
            >
              Voir les dernières réponses de vos collègues
            </Bouton>
          </div>
        ) : null}
      </Alerte>
    );
  }
  if (mode === "par_fonction") {
    return (
      <Alerte
        tonalite="info"
        annonce="aucune"
        titre={fonction ? `Vous répondez en tant que : ${fonction}` : "Réponse par fonction"}
      >
        <p>
          {fonction
            ? "Vos réponses sont personnelles et seront rattachées à cette fonction. Si elle ne correspond pas à votre poste, signalez-le à votre interlocuteur au cabinet."
            : "Votre fonction n'est pas renseignée : signalez-le à votre interlocuteur au cabinet avant de répondre."}
        </p>
      </Alerte>
    );
  }
  return null;
}
