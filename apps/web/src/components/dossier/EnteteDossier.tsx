import type { ReactNode } from "react";
import { BadgeStatut } from "../ui/BadgeStatut";
import { EnteteDePage } from "../ui/EnteteDePage";
import { Onglets } from "../ui/Onglets";
import { nomPays } from "../../lib/cabinet";
import { obtenirLangue } from "../../lib/i18n/serveur";
import {
  classeFiabilite,
  ongletsDossier,
  type ClientDossier,
  type Fiabilite,
} from "../../lib/dossier";

/** En-tête commun des pages d'un dossier : client, classe de fiabilité, onglets. */
export async function EnteteDossier({
  client,
  fiabilite,
  actions,
}: {
  client: ClientDossier;
  fiabilite?: Fiabilite;
  actions?: ReactNode;
}) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  return (
    <>
      <EnteteDePage
        titre={client.raison_sociale}
        retour={{ href: "/dossiers", libelle: t("Dossiers clients", "Client files") }}
        soustitre={[client.secteur, nomPays(client.pays, langue)].filter(Boolean).join(" · ")}
        badges={
          <>
            {client.actif ? null : (
              <BadgeStatut tonalite="neutre">{t("Client archivé", "Archived client")}</BadgeStatut>
            )}
            {fiabilite ? (
              <BadgeStatut tonalite={classeFiabilite(fiabilite.classe, langue).tonalite}>
                {t("Fiabilité", "Reliability")} {classeFiabilite(fiabilite.classe, langue).libelle}
              </BadgeStatut>
            ) : null}
            {fiabilite?.analyses_indicatives ? (
              <BadgeStatut tonalite="attention">
                {t("Analyses indicatives", "Indicative analyses")}
              </BadgeStatut>
            ) : null}
          </>
        }
        actions={actions}
      />
      <Onglets
        libelle={t("Sections du dossier", "File sections")}
        pages={ongletsDossier(client.id, langue)}
      />
    </>
  );
}
