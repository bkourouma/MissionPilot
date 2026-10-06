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
  TAILLE_LIBELLES,
  type Client,
  type PageListe,
} from "../../../lib/clients";
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Clients" };

export default async function PageClients({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("clients.lire");
  const peutEcrire = aPermission(utilisateur.roles, "clients.ecrire");
  const params = lireParametresListe(await searchParams);
  const page = await chargerServeur<PageListe<Client>>(`/api/clients?${requeteApiListe(params)}`);
  const filtre = Boolean(params.q) || params.statut !== "actifs";

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Clients"
        soustitre="Fiches des entreprises accompagnées par le cabinet et leurs contacts."
        actions={
          peutEcrire ? (
            <Link href="/clients/nouveau" className={classesBouton("primaire")}>
              <Icone nom="plus" />
              <span>Nouveau client</span>
            </Link>
          ) : null
        }
      />

      <BarreRecherche
        action="/clients"
        params={params}
        libelleRecherche="Rechercher un client"
        aideRecherche="Raison sociale, RCCM, compte contribuable ou secteur."
      />

      {!page.ok ? (
        <EtatErreur
          titre="La liste des clients n'a pas pu être chargée."
          message={page.message}
          hrefReessayer={hrefListe("/clients", params)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? "Aucun client ne correspond à votre recherche."
              : "Aucun client pour l'instant."
          }
          icone="immeuble"
          action={
            filtre ? (
              <Link href="/clients" className={classesBouton("secondaire")}>
                Effacer la recherche
              </Link>
            ) : peutEcrire ? (
              <Link href="/clients/nouveau" className={classesBouton("primaire")}>
                Créer le premier client
              </Link>
            ) : null
          }
        >
          {filtre ? <p>Vérifiez l&apos;orthographe ou changez le statut affiché.</p> : null}
        </EtatVide>
      ) : (
        <Tableau
          legende="Liste des clients"
          lignes={page.donnees.elements}
          cleLigne={(c) => c.id}
          colonnes={[
            {
              cle: "raison_sociale",
              entete: "Raison sociale",
              rendu: (c) => (
                <Link href={`/clients/${c.id}`} className="mp-lien-ligne">
                  {c.raison_sociale}
                </Link>
              ),
            },
            { cle: "secteur", entete: "Secteur", rendu: (c) => c.secteur ?? "—" },
            { cle: "pays", entete: "Pays", rendu: (c) => nomPays(c.pays) },
            {
              cle: "taille",
              entete: "Taille",
              rendu: (c) => (c.taille ? TAILLE_LIBELLES[c.taille] : "—"),
            },
            {
              cle: "actif",
              entete: "Statut",
              rendu: (c) =>
                c.actif ? (
                  <BadgeStatut tonalite="succes">Actif</BadgeStatut>
                ) : (
                  <BadgeStatut tonalite="neutre">Archivé</BadgeStatut>
                ),
            },
          ]}
        />
      )}

      {page.ok ? (
        <PaginationCurseur
          libelle="Pagination des clients"
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
