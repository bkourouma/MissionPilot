import type { Metadata } from "next";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { ElementKpiPortail } from "../../../../components/portail/kpi/ElementKpiPortail";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import {
  hrefPage,
  lireCurseur,
  peut,
  requetePage,
  type PagePortail,
} from "../../../../lib/portail";
import { API_KPI_PORTAIL, CHEMIN_KPI_PORTAIL, type KpiPortail } from "../../../../lib/portail-kpi";
import { dateDuJour } from "../../../../lib/portail-questionnaires";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";

export const metadata: Metadata = { title: "Indicateurs à renseigner" };

const CHEMIN = CHEMIN_KPI_PORTAIL;

/** KPI dont l'utilisateur est contributeur désigné par le cabinet, par ordre alphabétique. */
export default async function KpiPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.kpi.saisir")) {
    return <NonDisponible titre="Indicateurs" />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PagePortail<KpiPortail>>(requetePage(API_KPI_PORTAIL, curseur));
  const aujourdhui = dateDuJour(new Date());

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Vos indicateurs (KPI)"
        soustitre="Les indicateurs que votre cabinet vous a confié de renseigner. Ouvrez-en un pour saisir la valeur d'une période et consulter vos saisies."
      />
      {!r.ok ? (
        <EtatErreur
          titre="La liste des indicateurs n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucun indicateur ne vous a encore été confié." icone="courbe">
          <p>
            Dès que votre cabinet vous désignera pour renseigner un indicateur, il apparaîtra ici.
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {r.donnees.elements.map((k) => (
            <li key={k.id}>
              <ElementKpiPortail kpi={k} aujourdhui={aujourdhui} />
            </li>
          ))}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={
            r.donnees.curseur_suivant ? hrefPage(CHEMIN, r.donnees.curseur_suivant) : null
          }
          hrefDebut={curseur ? CHEMIN : null}
          libelle="Pages des indicateurs"
        />
      ) : null}
    </div>
  );
}
