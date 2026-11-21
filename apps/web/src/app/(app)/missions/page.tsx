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
import { chargerToutesLesPages, LIMITE_PAGE_MAX } from "../../../lib/pagination";
import { libelleMode } from "../../../lib/catalogue";
import { formaterDate } from "../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import {
  filtrerParDirecteur,
  hrefMissions,
  lireFiltresMissions,
  libelleStatutMission,
  optionsStatutsMission,
  requeteMissions,
  STATUT_MISSION,
  type Mission,
} from "../../../lib/missions";
import { nomPersonne, optionsPersonnes } from "../../../lib/personnes";
import { chargerClientsActifs, chargerPersonnes } from "../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Missions", "Engagements") };
}

export default async function PageMissions({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("mission.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const roles = utilisateur.roles;
  const peutCreer = aPermission(roles, "mission.creer");
  const filtres = lireFiltresMissions(await searchParams);
  const [liste, clients, personnes] = await Promise.all([
    chargerToutesLesPages<Mission>(chargerServeur, `/api/missions?${requeteMissions(filtres)}`, {
      limiteMax: LIMITE_PAGE_MAX,
    }),
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
      entete: t("Mission", "Engagement"),
      rendu: (m) => (
        <Link href={`/missions/${m.id}`} className="mp-lien-ligne">
          {m.intitule}
        </Link>
      ),
    },
    { cle: "client", entete: t("Client", "Client"), rendu: (m) => m.client_raison_sociale },
    {
      cle: "statut",
      entete: t("Statut", "Status"),
      rendu: (m) => (
        <BadgeStatut tonalite={STATUT_MISSION[m.statut].tonalite}>
          {libelleStatutMission(m.statut, langue)}
        </BadgeStatut>
      ),
    },
    ...(personnes.length > 0
      ? [
          {
            cle: "directeur",
            entete: t("Directeur", "Director"),
            rendu: (m: Mission) => nomPersonne(m.directeur_id, personnes, langue),
          },
        ]
      : []),
    {
      cle: "periode",
      entete: t("Période", "Period"),
      rendu: (m) =>
        m.date_debut || m.date_fin
          ? `${formaterDate(m.date_debut, "UTC", langue)} → ${formaterDate(m.date_fin, "UTC", langue)}`
          : t("Non planifiée", "Not scheduled"),
    },
    {
      cle: "mode",
      entete: t("Facturation", "Billing"),
      rendu: (m) => libelleMode(m.mode_facturation, langue),
    },
  ];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Missions", "Engagements")}
        soustitre={
          toutes
            ? t(
                "Toutes les missions du cabinet : fiche, découpage, planning et budget.",
                "All the firm's engagements: sheet, work breakdown, schedule and budget.",
              )
            : t(
                "Les missions que vous dirigez, pilotez ou auxquelles vous participez.",
                "The engagements you direct, manage or take part in.",
              )
        }
        actions={
          peutCreer ? (
            <Link href="/missions/nouvelle" className={classesBouton("primaire")}>
              <Icone nom="plus" />
              <span>{t("Nouvelle mission", "New engagement")}</span>
            </Link>
          ) : null
        }
      />

      <form
        method="get"
        action="/missions"
        className="mp-filtres"
        role="search"
        aria-label={t("Rechercher une mission", "Search for an engagement")}
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle={t("Rechercher", "Search")}
            type="search"
            name="q"
            maxLength={100}
            defaultValue={filtres.q}
            aide={t("Intitulé ou client.", "Title or client.")}
            autoComplete="off"
          />
          <Select
            libelle={t("Statut", "Status")}
            name="statut"
            options={optionsStatutsMission(langue)}
            invite={t("Tous les statuts", "All statuses")}
            defaultValue={filtres.statut}
          />
          {clients.length > 0 ? (
            <Select
              libelle={t("Client", "Client")}
              name="client_id"
              options={clients}
              invite={t("Tous les clients", "All clients")}
              defaultValue={filtres.client_id}
            />
          ) : null}
          {personnes.length > 0 ? (
            <Select
              libelle={t("Directeur de mission", "Engagement director")}
              name="directeur_id"
              options={optionsPersonnes(personnes)}
              invite={t("Tous les directeurs", "All directors")}
              defaultValue={filtres.directeur_id}
            />
          ) : null}
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="recherche" />
            <span>{t("Rechercher", "Search")}</span>
          </button>
          {filtre ? (
            <Link href="/missions" className={classesBouton("discret")}>
              {t("Effacer les filtres", "Clear filters")}
            </Link>
          ) : null}
        </div>
      </form>

      {!liste.ok ? (
        <EtatErreur
          titre={t(
            "La liste des missions n'a pas pu être chargée.",
            "The list of engagements could not be loaded.",
          )}
          message={liste.message}
          hrefReessayer={hrefMissions(filtres)}
        />
      ) : missions.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? t(
                  "Aucune mission ne correspond à ces critères.",
                  "No engagement matches these criteria.",
                )
              : t("Aucune mission pour l'instant.", "No engagements yet.")
          }
          icone="dossier"
          action={
            filtre ? (
              <Link href="/missions" className={classesBouton("secondaire")}>
                {t("Effacer les filtres", "Clear filters")}
              </Link>
            ) : peutCreer ? (
              <Link href="/missions/nouvelle" className={classesBouton("primaire")}>
                {t("Créer une mission", "Create an engagement")}
              </Link>
            ) : null
          }
        >
          {filtre ? null : (
            <p>
              {t(
                "Une mission naît d'une proposition acceptée (Pipeline) ou d'un type du catalogue.",
                "An engagement comes from an accepted proposal (Pipeline) or from a catalog type.",
              )}
            </p>
          )}
        </EtatVide>
      ) : (
        <>
          <p className="mp-texte-doux" role="status">
            {missions.length === 1
              ? t(
                  filtre ? "1 mission trouvée." : "1 mission.",
                  filtre ? "1 engagement found." : "1 engagement.",
                )
              : t(
                  `${missions.length} missions${filtre ? " trouvées" : ""}.`,
                  `${missions.length} engagements${filtre ? " found" : ""}.`,
                )}
          </p>
          <Tableau
            legende={t("Liste des missions", "List of engagements")}
            lignes={missions}
            cleLigne={(m) => m.id}
            colonnes={colonnes}
          />
        </>
      )}
    </div>
  );
}
