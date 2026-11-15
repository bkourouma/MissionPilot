import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { Tableau } from "../../../components/ui/Tableau";
import { chargerServeur } from "../../../lib/api-serveur";
import { nomPays } from "../../../lib/cabinet";
import {
  hrefDossiers,
  lireParametresDossiers,
  requeteDossiers,
  type DossierResume,
} from "../../../lib/dossier";
import { formaterDate, formaterNombre } from "../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Dossiers clients", "Client files") };
}

/** Dossiers clients visibles (clients dont on voit au moins une mission, ou tous). */
export default async function PageDossiers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("dossier.lire");
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const params = lireParametresDossiers(await searchParams);
  const page = await chargerServeur<{ elements: DossierResume[]; curseur_suivant: string | null }>(
    `/api/dossiers?${requeteDossiers(params)}`,
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Dossiers clients", "Client files")}
        soustitre={t(
          "Ce que le cabinet sait de chaque client : faits datés et sourcés, finances contrôlées, fiabilité, frise.",
          "What the firm knows about each client: dated, sourced facts, checked finances, reliability, timeline.",
        )}
      />
      <form
        method="get"
        action="/dossiers"
        className="mp-filtres"
        role="search"
        aria-label={t("Rechercher un dossier", "Search for a file")}
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle={t("Rechercher un dossier", "Search for a file")}
            type="search"
            name="q"
            maxLength={100}
            defaultValue={params.q}
            aide={t("Raison sociale ou secteur.", "Company name or sector.")}
            autoComplete="off"
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="recherche" />
            <span>{t("Rechercher", "Search")}</span>
          </button>
        </div>
      </form>
      {!page.ok ? (
        <EtatErreur
          titre={t(
            "La liste des dossiers n'a pas pu être chargée.",
            "The list of files could not be loaded.",
          )}
          message={page.message}
          hrefReessayer={hrefDossiers(params)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            params.q
              ? t("Aucun dossier ne correspond à votre recherche.", "No file matches your search.")
              : t("Aucun dossier visible.", "No visible file.")
          }
          icone="trombone"
          action={
            params.q ? (
              <Link href="/dossiers" className={classesBouton("secondaire")}>
                {t("Effacer la recherche", "Clear the search")}
              </Link>
            ) : null
          }
        >
          {params.q ? null : (
            <p>
              {t(
                "Un dossier s'ouvre pour chaque client dont vous voyez au moins une mission.",
                "A file is opened for each client for which you see at least one engagement.",
              )}
            </p>
          )}
        </EtatVide>
      ) : (
        <Tableau
          legende={t("Dossiers clients", "Client files")}
          lignes={page.donnees.elements}
          cleLigne={(d) => d.id}
          colonnes={[
            {
              cle: "raison_sociale",
              entete: "Client",
              rendu: (d) => (
                <Link href={`/dossiers/${d.id}`} className="mp-lien-ligne">
                  {d.raison_sociale}
                </Link>
              ),
            },
            { cle: "secteur", entete: t("Secteur", "Sector"), rendu: (d) => d.secteur ?? "—" },
            { cle: "pays", entete: t("Pays", "Country"), rendu: (d) => nomPays(d.pays, langue) },
            {
              cle: "propositions",
              entete: t("Faits à confirmer", "Facts to confirm"),
              alignement: "droite",
              rendu: (d) =>
                d.propositions > 0 ? (
                  <BadgeStatut tonalite="attention">
                    {formaterNombre(d.propositions, 0, langue)}
                  </BadgeStatut>
                ) : (
                  "—"
                ),
            },
            {
              cle: "etats_en_revue",
              entete: t("États en revue", "Statements under review"),
              alignement: "droite",
              rendu: (d) =>
                d.etats_en_revue > 0 ? (
                  <BadgeStatut tonalite="attention">
                    {formaterNombre(d.etats_en_revue, 0, langue)}
                  </BadgeStatut>
                ) : (
                  "—"
                ),
            },
            {
              cle: "dernier_fait_le",
              entete: t("Dernier fait", "Latest fact"),
              rendu: (d) => formaterDate(d.dernier_fait_le, "UTC", langue),
            },
          ]}
        />
      )}
      {page.ok ? (
        <PaginationCurseur
          libelle={t("Pagination des dossiers", "Files pagination")}
          hrefDebut={params.curseur ? hrefDossiers({ ...params, curseur: undefined }) : null}
          hrefSuivante={
            page.donnees.curseur_suivant
              ? hrefDossiers({ ...params, curseur: page.donnees.curseur_suivant })
              : null
          }
        />
      ) : null}
    </div>
  );
}
