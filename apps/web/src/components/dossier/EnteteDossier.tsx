import type { ReactNode } from "react";
import { BadgeStatut } from "../ui/BadgeStatut";
import { EnteteDePage } from "../ui/EnteteDePage";
import { Onglets } from "../ui/Onglets";
import { nomPays } from "../../lib/cabinet";
import {
  CLASSE_FIABILITE,
  ongletsDossier,
  type ClientDossier,
  type Fiabilite,
} from "../../lib/dossier";

/** En-tête commun des pages d'un dossier : client, classe de fiabilité, onglets. */
export function EnteteDossier({
  client,
  fiabilite,
  actions,
}: {
  client: ClientDossier;
  fiabilite?: Fiabilite;
  actions?: ReactNode;
}) {
  return (
    <>
      <EnteteDePage
        titre={client.raison_sociale}
        retour={{ href: "/dossiers", libelle: "Dossiers clients" }}
        soustitre={[client.secteur, nomPays(client.pays)].filter(Boolean).join(" · ")}
        badges={
          <>
            {client.actif ? null : <BadgeStatut tonalite="neutre">Client archivé</BadgeStatut>}
            {fiabilite ? (
              <BadgeStatut tonalite={CLASSE_FIABILITE[fiabilite.classe].tonalite}>
                Fiabilité {CLASSE_FIABILITE[fiabilite.classe].libelle}
              </BadgeStatut>
            ) : null}
            {fiabilite?.analyses_indicatives ? (
              <BadgeStatut tonalite="attention">Analyses indicatives</BadgeStatut>
            ) : null}
          </>
        }
        actions={actions}
      />
      <Onglets libelle="Sections du dossier" pages={ongletsDossier(client.id)} />
    </>
  );
}
