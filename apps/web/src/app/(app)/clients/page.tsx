import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { Tableau } from "../../../components/ui/Tableau";
import { BarreRecherche } from "../../../components/referentiels/BarreRecherche";
import { chargerServeur } from "../../../lib/api-serveur";
import { nomPays } from "../../../lib/cabinet";
import {
  hrefListe,
  lireParametresListe,
  requeteApiListe,
  libelleTaille,
  type Client,
  type PageListe,
} from "../../../lib/clients";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Clients", "Clients") };
}

export default async function PageClients({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("clients.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const peutEcrire = aPermission(utilisateur.roles, "clients.ecrire");
  const params = lireParametresListe(await searchParams);
  const page = await chargerServeur<PageListe<Client>>(`/api/clients?${requeteApiListe(params)}`);
  const filtre = Boolean(params.q) || params.statut !== "actifs";

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Clients", "Clients")}
        soustitre={t(
          "Fiches des entreprises accompagnées par le cabinet et leurs contacts.",
          "Records of the companies supported by the firm, and their contacts.",
        )}
        actions={
          peutEcrire ? (
            <Link href="/clients/nouveau" className={classesBouton("primaire")}>
              <Icone nom="plus" />
              <span>{t("Nouveau client", "New client")}</span>
            </Link>
          ) : null
        }
      />

      <BarreRecherche
        action="/clients"
        params={params}
        libelleRecherche={t("Rechercher un client", "Search for a client")}
        aideRecherche={t(
          "Raison sociale, RCCM, compte contribuable ou secteur.",
          "Company name, RCCM, taxpayer account or industry.",
        )}
      />

      {!page.ok ? (
        <EtatErreur
          titre={t(
            "La liste des clients n'a pas pu être chargée.",
            "The list of clients could not be loaded.",
          )}
          message={page.message}
          hrefReessayer={hrefListe("/clients", params)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? t("Aucun client ne correspond à votre recherche.", "No client matches your search.")
              : t("Aucun client pour l'instant.", "No client yet.")
          }
          icone="immeuble"
          action={
            filtre ? (
              <Link href="/clients" className={classesBouton("secondaire")}>
                {t("Effacer la recherche", "Clear the search")}
              </Link>
            ) : peutEcrire ? (
              <Link href="/clients/nouveau" className={classesBouton("primaire")}>
                {t("Créer le premier client", "Create the first client")}
              </Link>
            ) : null
          }
        >
          {filtre ? (
            <p>
              {t(
                "Vérifiez l'orthographe ou changez le statut affiché.",
                "Check the spelling or change the status shown.",
              )}
            </p>
          ) : null}
        </EtatVide>
      ) : (
        <Tableau
          legende={t("Liste des clients", "List of clients")}
          lignes={page.donnees.elements}
          cleLigne={(c) => c.id}
          colonnes={[
            {
              cle: "raison_sociale",
              entete: t("Raison sociale", "Company name"),
              rendu: (c) => (
                <Link href={`/clients/${c.id}`} className="mp-lien-ligne">
                  {c.raison_sociale}
                </Link>
              ),
            },
            { cle: "secteur", entete: t("Secteur", "Industry"), rendu: (c) => c.secteur ?? "—" },
            { cle: "pays", entete: t("Pays", "Country"), rendu: (c) => nomPays(c.pays, langue) },
            {
              cle: "taille",
              entete: t("Taille", "Size"),
              rendu: (c) => (c.taille ? libelleTaille(c.taille, langue) : "—"),
            },
            {
              cle: "actif",
              entete: t("Statut", "Status"),
              rendu: (c) =>
                c.actif ? (
                  <BadgeStatut tonalite="succes">{t("Actif", "Active")}</BadgeStatut>
                ) : (
                  <BadgeStatut tonalite="neutre">{t("Archivé", "Archived")}</BadgeStatut>
                ),
            },
          ]}
        />
      )}

      {page.ok ? (
        <PaginationCurseur
          libelle={t("Pagination des clients", "Client pagination")}
          hrefDebut={
            params.curseur ? hrefListe("/clients", { ...params, curseur: undefined }) : null
          }
          hrefSuivante={
            page.donnees.curseur_suivant
              ? hrefListe("/clients", { ...params, curseur: page.donnees.curseur_suivant })
              : null
          }
        />
      ) : null}
    </div>
  );
}
