import { useT } from "../../i18n/FournisseurLangue";
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
  const t = useT();
  if (mode === "collectif") {
    return (
      <Alerte
        tonalite="info"
        annonce="aucune"
        titre={t(
          "Réponse partagée par votre entreprise : elle sera verrouillée à la première soumission",
          "Response shared by your company: it will be locked on the first submission",
        )}
      >
        <p>
          {t(
            "Vos collègues désignés complètent la même réponse que vous. Les réponses de chacun s'ajoutent ; sur une même question, la dernière réponse enregistrée l'emporte. Dès que l'un de vous l'envoie, plus personne ne peut la modifier.",
            "Your designated colleagues complete the same response as you. Everyone's responses add up; on the same question, the last saved response wins. As soon as one of you sends it, nobody can edit it anymore.",
          )}
        </p>
        {onActualiser ? (
          <div className="mp-pq-bandeau__action">
            <Bouton
              variante="secondaire"
              icone="personnes"
              onClick={onActualiser}
              chargement={actualisation}
              texteChargement={t("Mise à jour en cours…", "Updating…")}
            >
              {t(
                "Voir les dernières réponses de vos collègues",
                "See your colleagues' latest responses",
              )}
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
        titre={
          fonction
            ? t(`Vous répondez en tant que : ${fonction}`, `You are responding as: ${fonction}`)
            : t("Réponse par fonction", "Response by role")
        }
      >
        <p>
          {fonction
            ? t(
                "Vos réponses sont personnelles et seront rattachées à cette fonction. Si elle ne correspond pas à votre poste, signalez-le à votre interlocuteur au cabinet.",
                "Your responses are personal and will be attached to this role. If it does not match your position, let your point of contact at the firm know.",
              )
            : t(
                "Votre fonction n'est pas renseignée : signalez-le à votre interlocuteur au cabinet avant de répondre.",
                "Your role is not set: let your point of contact at the firm know before responding.",
              )}
        </p>
      </Alerte>
    );
  }
  return null;
}
