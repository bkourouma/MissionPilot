import type { Metadata } from "next";
import "../../../../components/redressement/redressement.css";
import "../../../../components/redressement/tableau.css";
import {
  TableauPortefeuille,
  TableauSynthesePage,
} from "../../../../components/redressement/TableauPortefeuille";
import Link from "next/link";
import { Alerte } from "../../../../components/ui/Alerte";
import { classesBouton } from "../../../../components/ui/Bouton";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Select } from "../../../../components/ui/Select";
import { formaterDate } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { optionsSecteurs, optionsStatutsDossier } from "../../../../lib/redressement";
import {
  HREF_TABLEAU_PORTEFEUILLE,
  hrefTableauPortefeuille,
  LIMITES_TABLEAU,
  lireFiltresTableau,
  textesTableau,
} from "../../../../lib/redressement-tableau";
import { chargerTableauPortefeuille } from "../../../../lib/redressement-tableau-serveur";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Tableau de bord du redressement", "Turnaround dashboard") };
}

/**
 * Portefeuille de pilotage (RED-15, interne) : voyant, trois motifs au plus et indicateurs des
 * dossiers visibles. La synthèse porte sur la page affichée ; l'ordre de l'API est conservé.
 */
export default async function PagePortefeuilleTableau({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("redressement.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const tx = textesTableau(langue);
  const filtres = lireFiltresTableau(await searchParams);
  const r = await chargerTableauPortefeuille(filtres);
  const filtresActifs = Boolean(filtres.statut || filtres.secteur);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Tableau de bord du redressement", "Turnaround dashboard")}
        soustitre={t(
          "Voyants de pilotage des dossiers de redressement que vous pouvez consulter.",
          "Steering lights of the turnaround files you can view.",
        )}
      />
      <div className="mp-red">
        <p className="mp-texte-doux">{tx.interne}</p>
        <form
          method="get"
          action={HREF_TABLEAU_PORTEFEUILLE}
          className="mp-filtres"
          aria-label={t("Filtrer les dossiers du tableau de bord", "Filter the dashboard files")}
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
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
            <Select
              libelle={t("Dossiers par page", "Files per page")}
              name="limite"
              defaultValue={String(filtres.limite)}
              options={LIMITES_TABLEAU.map((n) => ({ valeur: String(n), libelle: String(n) }))}
            />
          </div>
          <div className="mp-actions-formulaire">
            <button type="submit" className="mp-bouton mp-bouton--secondaire">
              {t("Filtrer", "Filter")}
            </button>
            {filtresActifs ? (
              <Link href={HREF_TABLEAU_PORTEFEUILLE} className={classesBouton("discret")}>
                {t("Réinitialiser les filtres", "Reset filters")}
              </Link>
            ) : null}
          </div>
        </form>

        {!r.ok ? (
          <EtatErreur
            titre={t(
              "Le tableau de bord n'a pas pu être chargé.",
              "The dashboard could not be loaded.",
            )}
            message={r.message}
            hrefReessayer={hrefTableauPortefeuille(filtres)}
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t("Aucun dossier.", "No file.")}
            icone="attention"
            action={
              <Link
                href={filtresActifs ? HREF_TABLEAU_PORTEFEUILLE : "/redressement"}
                className={classesBouton("secondaire")}
              >
                {filtresActifs
                  ? t("Réinitialiser les filtres", "Reset filters")
                  : t("Voir les dossiers", "View files")}
              </Link>
            }
          >
            <p>{tx.portefeuilleVide}</p>
          </EtatVide>
        ) : (
          <>
            <section
              className="mp-red-section"
              aria-label={t("Synthèse de la page", "Page summary")}
            >
              <p className="mp-texte-doux">
                {tx.portefeuillePage}{" "}
                {t(
                  `Situation au ${formaterDate(r.donnees.date_calcul)}.`,
                  `Position as of ${formaterDate(r.donnees.date_calcul, "UTC", langue)}.`,
                )}
              </p>
              <TableauSynthesePage synthese={r.donnees.synthese_page} />
            </section>
            <Alerte tonalite="info" annonce="aucune">
              <p>{r.donnees.mention || tx.mention}</p>
            </Alerte>
            <TableauPortefeuille elements={r.donnees.elements} />
          </>
        )}
        {r.ok ? (
          <PaginationCurseur
            hrefSuivante={
              r.donnees.suivant
                ? hrefTableauPortefeuille({ ...filtres, curseur: r.donnees.suivant })
                : null
            }
            hrefDebut={
              filtres.curseur ? hrefTableauPortefeuille({ ...filtres, curseur: undefined }) : null
            }
          />
        ) : null}
      </div>
    </div>
  );
}
