import Link from "next/link";
import type { Metadata } from "next";
import type { RedDossierResume } from "@missionpilot/shared";
import "../../../components/redressement/redressement.css";
import { Voyant, NiveauAlerte } from "../../../components/redressement/Voyant";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Champ } from "../../../components/ui/Champ";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { Select } from "../../../components/ui/Select";
import { Tableau } from "../../../components/ui/Tableau";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDate } from "../../../lib/format";
import type { PageCurseur } from "../../../lib/pagination";
import {
  cheminDossiersRed,
  hrefPortefeuille,
  hrefRedressement,
  libelleSecteur,
  libelleStatutDossier,
  lireFiltresPortefeuille,
  OPTIONS_SECTEURS,
  OPTIONS_STATUTS_DOSSIER,
  tonaliteStatutDossier,
} from "../../../lib/redressement";
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Redressement" };

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
  const filtres = lireFiltresPortefeuille(await searchParams);
  const r = await chargerServeur<PageCurseur<RedDossierResume>>(cheminDossiersRed(filtres));

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Redressement"
        soustitre="Redressement : score d'alerte précoce indicatif, trésorerie à 13 semaines, créanciers et plan d'actions."
      />
      <div className="mp-red">
        <form
          method="get"
          action="/redressement"
          className="mp-filtres"
          aria-label="Filtrer les dossiers de redressement"
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
            <Champ libelle="Rechercher" name="q" defaultValue={filtres.q} maxLength={100} />
            <Select
              libelle="Statut"
              name="statut"
              invite="Tous les statuts"
              defaultValue={filtres.statut}
              options={OPTIONS_STATUTS_DOSSIER}
            />
            <Select
              libelle="Secteur"
              name="secteur"
              invite="Tous les secteurs"
              defaultValue={filtres.secteur}
              options={OPTIONS_SECTEURS}
            />
          </div>
          <button type="submit" className="mp-bouton mp-bouton--secondaire">
            Filtrer
          </button>
        </form>

        {!r.ok ? (
          <EtatErreur
            titre="La liste des dossiers n'a pas pu être chargée."
            message={r.message}
            hrefReessayer={hrefPortefeuille(filtres)}
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucun dossier de redressement." icone="attention">
            <p>
              Aucun dossier de redressement. Ouvrez-en un depuis l&apos;onglet « Redressement »
              d&apos;une mission.
            </p>
          </EtatVide>
        ) : (
          <Tableau
            legende="Dossiers de redressement"
            colonnes={[
              {
                cle: "dossier",
                entete: "Dossier",
                rendu: (d: RedDossierResume) => (
                  <Link href={hrefRedressement(d.mission.id)}>{d.intitule}</Link>
                ),
              },
              { cle: "client", entete: "Client", rendu: (d) => d.client.raison_sociale },
              { cle: "secteur", entete: "Secteur", rendu: (d) => libelleSecteur(d.secteur) },
              {
                cle: "statut",
                entete: "Statut",
                rendu: (d) => (
                  <BadgeStatut tonalite={tonaliteStatutDossier(d.statut)}>
                    {libelleStatutDossier(d.statut)}
                  </BadgeStatut>
                ),
              },
              {
                cle: "urgence",
                entete: "Dernier voyant d'urgence",
                rendu: (d) =>
                  d.dernier_voyant_urgence ? <Voyant voyant={d.dernier_voyant_urgence} /> : "—",
              },
              {
                cle: "alerte",
                entete: "Dernier niveau d'alerte",
                rendu: (d) =>
                  d.dernier_niveau_alerte ? (
                    <>
                      <NiveauAlerte niveau={d.dernier_niveau_alerte} />{" "}
                      <span className="mp-texte-doux mp-texte-petit">Indicatif</span>
                    </>
                  ) : (
                    "—"
                  ),
              },
              { cle: "ouvert", entete: "Ouvert le", rendu: (d) => formaterDate(d.ouvert_le) },
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
