import type { Metadata } from "next";
import "../../../../components/redressement/redressement.css";
import "../../../../components/redressement/tableau.css";
import {
  TableauPortefeuille,
  TableauSynthesePage,
} from "../../../../components/redressement/TableauPortefeuille";
import { Alerte } from "../../../../components/ui/Alerte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Select } from "../../../../components/ui/Select";
import { formaterDate } from "../../../../lib/format";
import { OPTIONS_SECTEURS, OPTIONS_STATUTS_DOSSIER } from "../../../../lib/redressement";
import {
  HREF_TABLEAU_PORTEFEUILLE,
  hrefTableauPortefeuille,
  LIMITES_TABLEAU,
  lireFiltresTableau,
  MENTION_TABLEAU,
  TEXTE_PORTEFEUILLE_PAGE,
  TEXTE_PORTEFEUILLE_VIDE,
  TEXTE_TABLEAU_INTERNE,
} from "../../../../lib/redressement-tableau";
import { chargerTableauPortefeuille } from "../../../../lib/redressement-tableau-serveur";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Tableau de bord du redressement" };

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
  const filtres = lireFiltresTableau(await searchParams);
  const r = await chargerTableauPortefeuille(filtres);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Tableau de bord du redressement"
        soustitre="Voyants de pilotage des dossiers de redressement que vous pouvez consulter."
      />
      <div className="mp-red">
        <p className="mp-texte-doux">{TEXTE_TABLEAU_INTERNE}</p>
        <form
          method="get"
          action={HREF_TABLEAU_PORTEFEUILLE}
          className="mp-filtres"
          aria-label="Filtrer les dossiers du tableau de bord"
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
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
            <Select
              libelle="Dossiers par page"
              name="limite"
              defaultValue={String(filtres.limite)}
              options={LIMITES_TABLEAU.map((n) => ({ valeur: String(n), libelle: String(n) }))}
            />
          </div>
          <button type="submit" className="mp-bouton mp-bouton--secondaire">
            Filtrer
          </button>
        </form>

        {!r.ok ? (
          <EtatErreur
            titre="Le tableau de bord n'a pas pu être chargé."
            message={r.message}
            hrefReessayer={hrefTableauPortefeuille(filtres)}
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucun dossier." icone="attention">
            <p>{TEXTE_PORTEFEUILLE_VIDE}</p>
          </EtatVide>
        ) : (
          <>
            <section className="mp-red-section" aria-label="Synthèse de la page">
              <p className="mp-texte-doux">
                {TEXTE_PORTEFEUILLE_PAGE} Situation au {formaterDate(r.donnees.date_calcul)}.
              </p>
              <TableauSynthesePage synthese={r.donnees.synthese_page} />
            </section>
            <Alerte tonalite="info" annonce="aucune">
              <p>{r.donnees.mention || MENTION_TABLEAU}</p>
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
