import type { Metadata } from "next";
import { obtenirT } from "../../../../lib/i18n/serveur";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Indicateurs à renseigner", "Indicators to fill in") };
}

const CHEMIN = CHEMIN_KPI_PORTAIL;

/** KPI dont l'utilisateur est contributeur désigné par le cabinet, par ordre alphabétique. */
export default async function KpiPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSessionPortail();
  const t = await obtenirT();
  if (!peut(utilisateur.roles, "portail.kpi.saisir")) {
    return <NonDisponible titre={t("Indicateurs", "Indicators")} />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PagePortail<KpiPortail>>(requetePage(API_KPI_PORTAIL, curseur));
  const aujourdhui = dateDuJour(new Date());

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Vos indicateurs (KPI)", "Your indicators (KPIs)")}
        soustitre={t(
          "Les indicateurs que votre cabinet vous a confié de renseigner. Ouvrez-en un pour saisir la valeur d'une période et consulter vos saisies.",
          "The indicators your firm has asked you to fill in. Open one to enter the value of a period and view your entries.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "La liste des indicateurs n'a pas pu être chargée.",
            "The list of indicators could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucun indicateur ne vous a encore été confié.",
            "No indicator has been assigned to you yet.",
          )}
          icone="courbe"
        >
          <p>
            {t(
              "Dès que votre cabinet vous désignera pour renseigner un indicateur, il apparaîtra ici.",
              "As soon as your firm designates you to fill in an indicator, it will appear here.",
            )}
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
          libelle={t("Pages des indicateurs", "Indicator pages")}
        />
      ) : null}
    </div>
  );
}
