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
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Dossiers clients" };

/** Dossiers clients visibles (clients dont on voit au moins une mission, ou tous). */
export default async function PageDossiers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("dossier.lire");
  const params = lireParametresDossiers(await searchParams);
  const page = await chargerServeur<{ elements: DossierResume[]; curseur_suivant: string | null }>(
    `/api/dossiers?${requeteDossiers(params)}`,
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Dossiers clients"
        soustitre="Ce que le cabinet sait de chaque client : faits datés et sourcés, finances contrôlées, fiabilité, frise."
      />
      <form
        method="get"
        action="/dossiers"
        className="mp-filtres"
        role="search"
        aria-label="Rechercher un dossier"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle="Rechercher un dossier"
            type="search"
            name="q"
            maxLength={100}
            defaultValue={params.q}
            aide="Raison sociale ou secteur."
            autoComplete="off"
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="recherche" />
            <span>Rechercher</span>
          </button>
        </div>
      </form>
      {!page.ok ? (
        <EtatErreur
          titre="La liste des dossiers n'a pas pu être chargée."
          message={page.message}
          hrefReessayer={hrefDossiers(params)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            params.q ? "Aucun dossier ne correspond à votre recherche." : "Aucun dossier visible."
          }
          icone="trombone"
          action={
            params.q ? (
              <Link href="/dossiers" className={classesBouton("secondaire")}>
                Effacer la recherche
              </Link>
            ) : null
          }
        >
          {params.q ? null : (
            <p>Un dossier s&apos;ouvre pour chaque client dont vous voyez au moins une mission.</p>
          )}
        </EtatVide>
      ) : (
        <Tableau
          legende="Dossiers clients"
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
            { cle: "secteur", entete: "Secteur", rendu: (d) => d.secteur ?? "—" },
            { cle: "pays", entete: "Pays", rendu: (d) => nomPays(d.pays) },
            {
              cle: "propositions",
              entete: "Faits à confirmer",
              alignement: "droite",
              rendu: (d) =>
                d.propositions > 0 ? (
                  <BadgeStatut tonalite="attention">
                    {formaterNombre(d.propositions, 0)}
                  </BadgeStatut>
                ) : (
                  "—"
                ),
            },
            {
              cle: "etats_en_revue",
              entete: "États en revue",
              alignement: "droite",
              rendu: (d) =>
                d.etats_en_revue > 0 ? (
                  <BadgeStatut tonalite="attention">
                    {formaterNombre(d.etats_en_revue, 0)}
                  </BadgeStatut>
                ) : (
                  "—"
                ),
            },
            {
              cle: "dernier_fait_le",
              entete: "Dernier fait",
              rendu: (d) => formaterDate(d.dernier_fait_le),
            },
          ]}
        />
      )}
      {page.ok ? (
        <PaginationCurseur
          libelle="Pagination des dossiers"
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
