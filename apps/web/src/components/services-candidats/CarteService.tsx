import type { OptionSelect } from "../ui/Select";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  formaterPrixService,
  libelleMessageCoherence,
  mentionAValider,
  obstacleCreationMission,
  type ServiceCandidat,
} from "../../lib/services-candidats";
import { ActivationService } from "./ActivationService";
import { FormulaireMissionService } from "./FormulaireMissionService";
import { FormulairePrix } from "./FormulairePrix";

export interface CarteServiceProps {
  service: ServiceCandidat;
  clients: readonly OptionSelect[];
  /** `services_candidats.gerer` : prix fixe. */
  peutGerer: boolean;
  /** `mission.creer`, `mission.planifier` et `standard.lire`. */
  peutCreerMission: boolean;
  /** Client préchoisi par le lien `?client=` (ignoré s'il n'est pas dans la liste). */
  clientInitial?: string | null;
}

/** Carte d'un service candidat : contenu du standard, type de mission, prix fixe, création. */
export async function CarteService({
  service,
  clients,
  peutGerer,
  peutCreerMission,
  clientInitial = null,
}: CarteServiceProps) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const obstacle = obstacleCreationMission(service, langue);
  const { coherence, methode } = service;
  return (
    <Carte
      titre={service.libelle}
      niveauTitre={2}
      actions={<BadgeStatut tonalite="attention">{mentionAValider(langue)}</BadgeStatut>}
    >
      <div className="mp-pile">
        {service.description ? <p>{service.description}</p> : null}
        <dl className="mp-liste-def">
          <div>
            <dt>{t("Méthode du standard", "Standard method")}</dt>
            <dd>
              {methode
                ? t(
                    `${methode.libelle} — version ${methode.version} publiée`,
                    `${methode.libelle} — version ${methode.version} published`,
                  )
                : t("Aucune", "None")}
              {coherence ? (
                <>
                  {" "}
                  <BadgeStatut tonalite={coherence.valide ? "succes" : "danger"}>
                    {coherence.valide
                      ? t("Cohérente", "Consistent")
                      : t("Incohérente", "Inconsistent")}
                  </BadgeStatut>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t("Type de mission", "Engagement type")}</dt>
            <dd>
              {service.type_mission ? (
                <>
                  {t("Activé", "Enabled")}{" "}
                  {service.type_mission.a_valider ? (
                    <BadgeStatut tonalite="attention">
                      {t("Valeurs de départ à valider", "Starting values pending approval")}
                    </BadgeStatut>
                  ) : null}
                </>
              ) : (
                t("Non activé", "Not enabled")
              )}
              {!service.type_mission && peutGerer ? <ActivationService service={service} /> : null}
            </dd>
          </div>
          <div>
            <dt>{t("Prix fixe", "Fixed price")}</dt>
            <dd>
              {formaterPrixService(service.prix, langue)}{" "}
              {service.prix.a_fixer ? null : service.prix.personnalise ? (
                <BadgeStatut tonalite="succes">
                  {t("Validé par le cabinet", "Approved by the firm")}
                </BadgeStatut>
              ) : null}
              {service.prix.commentaire ? (
                <>
                  {" "}
                  <BadgeStatut tonalite="neutre">{service.prix.commentaire}</BadgeStatut>
                </>
              ) : null}
            </dd>
          </div>
        </dl>
        {coherence && coherence.erreurs.length > 0 ? (
          <ul className="mp-texte-doux">
            {coherence.erreurs.map((e) => (
              <li key={e}>{libelleMessageCoherence(e, langue)}</li>
            ))}
          </ul>
        ) : null}
        {coherence && coherence.avertissements.length > 0 ? (
          <ul className="mp-texte-doux">
            {coherence.avertissements.map((e) => (
              <li key={e}>{libelleMessageCoherence(e, langue)}</li>
            ))}
          </ul>
        ) : null}

        {peutGerer ? (
          <section
            aria-label={`${t("Prix fixe", "Fixed price")} — ${service.libelle}`}
            className="mp-pile"
          >
            <h3 className="mp-carte__titre">{t("Prix fixe", "Fixed price")}</h3>
            <FormulairePrix service={service} />
          </section>
        ) : null}

        <section
          aria-label={`${t("Créer une mission", "Create an engagement")} — ${service.libelle}`}
          className="mp-pile"
        >
          <h3 className="mp-carte__titre">{t("Créer une mission", "Create an engagement")}</h3>
          {!peutCreerMission ? (
            <p className="mp-texte-doux">
              {t(
                "Votre rôle ne permet pas de créer et de planifier une mission.",
                "Your role does not allow creating and planning an engagement.",
              )}
            </p>
          ) : obstacle ? (
            <p className="mp-texte-doux" role="status">
              {obstacle}
            </p>
          ) : (
            <FormulaireMissionService
              service={service}
              clients={clients}
              clientInitial={clientInitial}
            />
          )}
        </section>
      </div>
    </Carte>
  );
}
