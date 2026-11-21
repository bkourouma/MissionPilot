import Link from "next/link";
import type { Metadata } from "next";
import type { RedDossierResume } from "@missionpilot/shared";
import "../../../components/redressement/redressement.css";
import { Voyant, NiveauAlerte } from "../../../components/redressement/Voyant";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { Select } from "../../../components/ui/Select";
import { Tableau } from "../../../components/ui/Tableau";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDate } from "../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import type { PageCurseur } from "../../../lib/pagination";
import {
  cheminDossiersRed,
  hrefPortefeuille,
  hrefRedressement,
  libelleSecteur,
  libelleStatutDossier,
  lireFiltresPortefeuille,
  optionsSecteurs,
  optionsStatutsDossier,
  tonaliteStatutDossier,
} from "../../../lib/redressement";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Redressement", "Turnaround") };
}

/**
 * Portefeuille des dossiers de redressement (missions visibles seulement) : dossier, client,
 * secteur, statut, dernier voyant d'urgence, dernier niveau d'alerte (toujours « Indicatif ») et
 * date d'ouverture. Filtres dans l'URL ; pagination par curseur.
 */
export default async function PagePortefeuilleRedressement({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("redressement.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const filtres = lireFiltresPortefeuille(await searchParams);
  const r = await chargerServeur<PageCurseur<RedDossierResume>>(cheminDossiersRed(filtres));
  const filtresActifs = Boolean(filtres.q || filtres.statut || filtres.secteur);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Redressement", "Turnaround")}
        soustitre={t(
          "Redressement : score d'alerte précoce indicatif, trésorerie à 13 semaines, créanciers et plan d'actions.",
          "Turnaround: indicative early-warning score, 13-week cash forecast, creditors and action plan.",
        )}
      />
      <div className="mp-red">
        <form
          method="get"
          action="/redressement"
          className="mp-filtres"
          aria-label={t("Filtrer les dossiers de redressement", "Filter turnaround files")}
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
            <Champ
              libelle={t("Rechercher", "Search")}
              name="q"
              defaultValue={filtres.q}
              maxLength={100}
            />
            <Select
              libelle={t("Statut", "Status")}
              name="statut"
              invite={t("Tous les statuts", "All statuses")}
              defaultValue={filtres.statut}
              options={optionsStatutsDossier(langue)}
            />
            <Select
              libelle={t("Secteur", "Sector")}
              name="secteur"
              invite={t("Tous les secteurs", "All sectors")}
              defaultValue={filtres.secteur}
              options={optionsSecteurs(langue)}
            />
          </div>
          <div className="mp-actions-formulaire">
            <button type="submit" className="mp-bouton mp-bouton--secondaire">
              {t("Filtrer", "Filter")}
            </button>
            {filtresActifs ? (
              <Link href="/redressement" className={classesBouton("discret")}>
                {t("Réinitialiser les filtres", "Reset filters")}
              </Link>
            ) : null}
          </div>
        </form>

        {!r.ok ? (
          <EtatErreur
            titre={t(
              "La liste des dossiers n'a pas pu être chargée.",
              "The list of files could not be loaded.",
            )}
            message={r.message}
            hrefReessayer={hrefPortefeuille(filtres)}
          />
        ) : r.donnees.elements.length === 0 ? (
          filtresActifs ? (
            <EtatVide
              titre={t("Aucun dossier ne correspond.", "No file matches.")}
              icone="attention"
              action={
                <Link href="/redressement" className={classesBouton("secondaire")}>
                  {t("Réinitialiser les filtres", "Reset filters")}
                </Link>
              }
            >
              <p>
                {t(
                  "Modifiez la recherche, le statut ou le secteur pour élargir la liste.",
                  "Change the search, status or sector to widen the list.",
                )}
              </p>
            </EtatVide>
          ) : (
            <EtatVide
              titre={t("Aucun dossier de redressement.", "No turnaround file.")}
              icone="attention"
              action={
                <Link href="/missions" className={classesBouton("secondaire")}>
                  {t("Voir les missions", "View engagements")}
                </Link>
              }
            >
              <p>
                {t(
                  "Ouvrez-en un depuis l'onglet « Redressement » d'une mission.",
                  'Open one from the "Turnaround" tab of an engagement.',
                )}
              </p>
            </EtatVide>
          )
        ) : (
          <Tableau
            legende={t("Dossiers de redressement", "Turnaround files")}
            colonnes={[
              {
                cle: "dossier",
                entete: t("Dossier", "File"),
                rendu: (d: RedDossierResume) => (
                  <Link href={hrefRedressement(d.mission.id)}>{d.intitule}</Link>
                ),
              },
              { cle: "client", entete: "Client", rendu: (d) => d.client.raison_sociale },
              {
                cle: "secteur",
                entete: t("Secteur", "Sector"),
                rendu: (d) => libelleSecteur(d.secteur, langue),
              },
              {
                cle: "statut",
                entete: t("Statut", "Status"),
                rendu: (d) => (
                  <BadgeStatut tonalite={tonaliteStatutDossier(d.statut)}>
                    {libelleStatutDossier(d.statut, langue)}
                  </BadgeStatut>
                ),
              },
              {
                cle: "urgence",
                entete: t("Dernier voyant d'urgence", "Latest urgency indicator"),
                rendu: (d) =>
                  d.dernier_voyant_urgence ? <Voyant voyant={d.dernier_voyant_urgence} /> : "—",
              },
              {
                cle: "alerte",
                entete: t("Dernier niveau d'alerte", "Latest alert level"),
                rendu: (d) =>
                  d.dernier_niveau_alerte ? (
                    <>
                      <NiveauAlerte niveau={d.dernier_niveau_alerte} />{" "}
                      <span className="mp-texte-doux mp-texte-petit">
                        {t("Indicatif", "Indicative")}
                      </span>
                    </>
                  ) : (
                    "—"
                  ),
              },
              {
                cle: "ouvert",
                entete: t("Ouvert le", "Opened on"),
                rendu: (d) => formaterDate(d.ouvert_le, "UTC", langue),
              },
            ]}
            lignes={r.donnees.elements}
            cleLigne={(d) => d.id}
          />
        )}
        {r.ok ? (
          <PaginationCurseur
            hrefSuivante={
              r.donnees.suivant
                ? hrefPortefeuille({ ...filtres, curseur: r.donnees.suivant })
                : null
            }
            hrefDebut={
              filtres.curseur ? hrefPortefeuille({ ...filtres, curseur: undefined }) : null
            }
          />
        ) : null}
      </div>
    </div>
  );
}
