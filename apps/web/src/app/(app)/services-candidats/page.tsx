import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { CarteService } from "../../../components/services-candidats/CarteService";
import { Alerte } from "../../../components/ui/Alerte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { chargerClientsActifs } from "../../../lib/referentiels-serveur";
import {
  lirePreremplissageService,
  MENTION_A_VALIDER,
  type ServiceCandidat,
} from "../../../lib/services-candidats";
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Services candidats" };

export default async function PageServicesCandidats({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const preremplissage = lirePreremplissageService(await searchParams);
  const { utilisateur } = await exigerPermission("services_candidats.lire");
  const roles = utilisateur.roles;
  const peutGerer = aPermission(roles, "services_candidats.gerer");
  const peutCreerMission =
    aPermission(roles, "mission.creer") &&
    aPermission(roles, "mission.planifier") &&
    aPermission(roles, "standard.lire");
  const [r, clients] = await Promise.all([
    chargerServeur<{ elements: ServiceCandidat[] }>("/api/services-candidats"),
    peutCreerMission ? chargerClientsActifs(roles) : Promise.resolve([]),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Services candidats"
        soustitre="Diagnostic flash et business plan bancable : méthodes du standard, prix fixe et création de mission."
      />
      <Alerte tonalite="attention" annonce="aucune" titre={MENTION_A_VALIDER}>
        <p>
          Les méthodes, les types de mission et les prix de départ sont à valider par un expert
          avant tout usage auprès d&apos;un client.
        </p>
      </Alerte>

      {!r.ok ? (
        <EtatErreur
          titre="Les services candidats n'ont pas pu être chargés."
          message={r.message}
          hrefReessayer="/services-candidats"
        />
      ) : (
        <div className="mp-pile">
          {r.donnees.elements.map((service) => (
            <CarteService
              key={service.code}
              service={service}
              clients={clients}
              peutGerer={peutGerer}
              peutCreerMission={peutCreerMission}
              clientInitial={
                preremplissage.service === null || preremplissage.service === service.code
                  ? preremplissage.client
                  : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
