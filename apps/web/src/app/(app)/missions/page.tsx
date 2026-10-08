import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { Select } from "../../../components/ui/Select";
import { Tableau, type ColonneTableau } from "../../../components/ui/Tableau";
import { chargerServeur } from "../../../lib/api-serveur";
import { chargerToutesLesPages } from "../../../lib/pagination";
import { MODE_LIBELLES } from "../../../lib/catalogue";
import { formaterDate } from "../../../lib/format";
import {
  filtrerParDirecteur,
  hrefMissions,
  lireFiltresMissions,
  OPTIONS_STATUTS_MISSION,
  requeteMissions,
  STATUT_MISSION,
  type Mission,
} from "../../../lib/missions";
import { nomPersonne, optionsPersonnes } from "../../../lib/personnes";
import { chargerClientsActifs, chargerPersonnes } from "../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Missions" };

export default async function PageMissions({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("mission.lire");
  const roles = utilisateur.roles;
  const peutCreer = aPermission(roles, "mission.creer");
  const filtres = lireFiltresMissions(await searchParams);
  const [liste, clients, personnes] = await Promise.all([
    chargerToutesLesPages<Mission>(chargerServeur, `/api/missions?${requeteMissions(filtres)}`),
    chargerClientsActifs(roles),
    chargerPersonnes(roles),
  ]);
  const filtre = Boolean(filtres.q || filtres.statut || filtres.client_id || filtres.directeur_id);
  const missions = liste.ok
    ? filtrerParDirecteur(liste.donnees.elements, filtres.directeur_id)
    : [];
  const toutes = aPermission(roles, "mission.lire_toutes");

  const colonnes: ColonneTableau<Mission>[] = [
    {
      cle: "intitule",
      entete: "Mission",
      rendu: (m) => (
        <Link href={`/missions/${m.id}`} className="mp-lien-ligne">
          {m.intitule}
        </Link>
      ),
    },
    { cle: "client", entete: "Client", rendu: (m) => m.client_raison_sociale },
    {
      cle: "statut",
      entete: "Statut",
      rendu: (m) => (
        <BadgeStatut tonalite={STATUT_MISSION[m.statut].tonalite}>
          {STATUT_MISSION[m.statut].libelle}
        </BadgeStatut>
      ),
    },
    ...(personnes.length > 0
      ? [
          {
            cle: "directeur",
            entete: "Directeur",
            rendu: (m: Mission) => nomPersonne(m.directeur_id, personnes),
          },
        ]
      : []),
    {
      cle: "periode",
      entete: "Période",
      rendu: (m) =>
        m.date_debut || m.date_fin
          ? `${formaterDate(m.date_debut)} → ${formaterDate(m.date_fin)}`
          : "Non planifiée",
    },
    { cle: "mode", entete: "Facturation", rendu: (m) => MODE_LIBELLES[m.mode_facturation] },
  ];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Missions"
        soustitre={
          toutes
            ? "Toutes les missions du cabinet : fiche, découpage, planning et budget."
            : "Les missions que vous dirigez, pilotez ou auxquelles vous participez."
        }
        actions={
          peutCreer ? (
            <Link href="/missions/nouvelle" className={classesBouton("primaire")}>
              <Icone nom="plus" />
              <span>Nouvelle mission</span>
            </Link>
          ) : null
        }
      />

      <form
        method="get"
        action="/missions"
        className="mp-filtres"
        role="search"
        aria-label="Rechercher une mission"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle="Rechercher"
            type="search"
            name="q"
            maxLength={100}
            defaultValue={filtres.q}
            aide="Intitulé ou client."
            autoComplete="off"
          />
          <Select
            libelle="Statut"
            name="statut"
            options={OPTIONS_STATUTS_MISSION}
            invite="Tous les statuts"
            defaultValue={filtres.statut}
          />
          {clients.length > 0 ? (
            <Select
              libelle="Client"
              name="client_id"
              options={clients}
              invite="Tous les clients"
              defaultValue={filtres.client_id}
            />
          ) : null}
          {personnes.length > 0 ? (
            <Select
              libelle="Directeur de mission"
              name="directeur_id"
              options={optionsPersonnes(personnes)}
              invite="Tous les directeurs"
              defaultValue={filtres.directeur_id}
            />
          ) : null}
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="recherche" />
            <span>Rechercher</span>
          </button>
          {filtre ? (
            <Link href="/missions" className={classesBouton("discret")}>
              Effacer les filtres
            </Link>
          ) : null}
        </div>
      </form>

      {!liste.ok ? (
        <EtatErreur
          titre="La liste des missions n'a pas pu être chargée."
          message={liste.message}
          hrefReessayer={hrefMissions(filtres)}
        />
      ) : missions.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? "Aucune mission ne correspond à ces critères."
              : "Aucune mission pour l'instant."
          }
          icone="dossier"
          action={
            filtre ? (
              <Link href="/missions" className={classesBouton("secondaire")}>
                Effacer les filtres
              </Link>
            ) : peutCreer ? (
              <Link href="/missions/nouvelle" className={classesBouton("primaire")}>
                Créer une mission
              </Link>
            ) : null
          }
        >
          {filtre ? null : (
            <p>
              Une mission naît d&apos;une proposition acceptée (Pipeline) ou d&apos;un type du
              catalogue.
            </p>
          )}
        </EtatVide>
      ) : (
        <Tableau
          legende="Liste des missions"
          lignes={missions}
          cleLigne={(m) => m.id}
          colonnes={colonnes}
        />
      )}
    </div>
  );
}
