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
  mentionAValider,
  type ServiceCandidat,
} from "../../../lib/services-candidats";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Services candidats", "Candidate services") };
}

export default async function PageServicesCandidats({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const preremplissage = lirePreremplissageService(await searchParams);
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
        titre={t("Services candidats", "Candidate services")}
        soustitre={t(
          "Diagnostic flash et business plan bancable : méthodes du standard, prix fixe et création de mission.",
          "Flash diagnostic and bankable business plan: standard methods, fixed price and engagement creation.",
        )}
      />
      <Alerte tonalite="attention" annonce="aucune" titre={mentionAValider(langue)}>
        <p>
          {t(
            "Les méthodes, les types de mission et les prix de départ sont à valider par un expert avant tout usage auprès d'un client.",
            "The methods, engagement types and starting prices must be approved by an expert before any use with a client.",
          )}
        </p>
      </Alerte>

      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les services candidats n'ont pas pu être chargés.",
            "The candidate services could not be loaded.",
          )}
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
