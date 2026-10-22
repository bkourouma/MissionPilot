import type { OptionSelect } from "../ui/Select";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import {
  formaterPrixService,
  libelleMessageCoherence,
  MENTION_A_VALIDER,
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
export function CarteService({
  service,
  clients,
  peutGerer,
  peutCreerMission,
  clientInitial = null,
}: CarteServiceProps) {
  const obstacle = obstacleCreationMission(service);
  const { coherence, methode } = service;
  return (
    <Carte
      titre={service.libelle}
      niveauTitre={2}
      actions={<BadgeStatut tonalite="attention">{MENTION_A_VALIDER}</BadgeStatut>}
    >
      <div className="mp-pile">
        {service.description ? <p>{service.description}</p> : null}
        <dl className="mp-liste-def">
          <div>
            <dt>Méthode du standard</dt>
            <dd>
              {methode ? `${methode.libelle} — version ${methode.version} publiée` : "Aucune"}
              {coherence ? (
                <>
                  {" "}
                  <BadgeStatut tonalite={coherence.valide ? "succes" : "danger"}>
                    {coherence.valide ? "Cohérente" : "Incohérente"}
                  </BadgeStatut>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Type de mission</dt>
            <dd>
              {service.type_mission ? (
                <>
                  Activé{" "}
                  {service.type_mission.a_valider ? (
                    <BadgeStatut tonalite="attention">Valeurs de départ à valider</BadgeStatut>
                  ) : null}
                </>
              ) : (
                "Non activé"
              )}
              {!service.type_mission && peutGerer ? <ActivationService service={service} /> : null}
            </dd>
          </div>
          <div>
            <dt>Prix fixe</dt>
            <dd>
              {formaterPrixService(service.prix)}{" "}
              {service.prix.a_fixer ? null : service.prix.personnalise ? (
                <BadgeStatut tonalite="succes">Validé par le cabinet</BadgeStatut>
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
              <li key={e}>{libelleMessageCoherence(e)}</li>
            ))}
          </ul>
        ) : null}
        {coherence && coherence.avertissements.length > 0 ? (
          <ul className="mp-texte-doux">
            {coherence.avertissements.map((e) => (
              <li key={e}>{libelleMessageCoherence(e)}</li>
            ))}
          </ul>
        ) : null}

        {peutGerer ? (
          <section aria-label={`Prix fixe — ${service.libelle}`} className="mp-pile">
            <h3 className="mp-carte__titre">Prix fixe</h3>
            <FormulairePrix service={service} />
          </section>
        ) : null}

        <section aria-label={`Créer une mission — ${service.libelle}`} className="mp-pile">
          <h3 className="mp-carte__titre">Créer une mission</h3>
          {!peutCreerMission ? (
            <p className="mp-texte-doux">
              Votre rôle ne permet pas de créer et de planifier une mission.
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
