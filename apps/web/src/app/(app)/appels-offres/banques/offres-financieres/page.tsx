import type { Metadata } from "next";
import Link from "next/link";
import { FormulaireOffreFinanciere } from "../../../../../components/banque-ao/FormulairesOffres";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { lireCurseur } from "../../../../../lib/agents";
import {
  droitsBanqueAo,
  hrefListe,
  RACINE_BANQUES,
  type OffreFinanciereResume,
} from "../../../../../lib/banque-ao";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDate, formaterMontantMineur } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Offres financières", "Financial bids") };
}

type Parametres = Promise<Record<string, string | string[] | undefined>>;

/** Offres financières (AO-07) : taux journaliers confidentiels, réservées à `finance.lire`. */
export default async function PageOffresFinancieres({
  searchParams,
}: {
  searchParams: Parametres;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("finance.lire");
  const droits = droitsBanqueAo(utilisateur.roles);
  const curseur = lireCurseur((await searchParams).curseur);
  const q = new URLSearchParams({ limite: "30" });
  if (curseur) q.set("curseur", curseur);
  const r = await chargerServeur<{
    elements: OffreFinanciereResume[];
    curseur_suivant: string | null;
  }>(`/api/banque-ao/offres-financieres?${q}`);
  const chemin = `${RACINE_BANQUES}/offres-financieres`;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Offres financières", "Financial bids")}
        soustitre={t(
          "Jours par expert, taux journaliers, per diem, débours et taxes, calculés par le moteur de l'application avec des arrondis exacts. Données confidentielles du cabinet.",
          "Days per expert, daily rates, per diem, expenses and taxes, computed by the application's engine with exact rounding. Confidential firm data.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          hrefReessayer={chemin}
          titre={t("Les offres n'ont pas pu être chargées.", "The bids could not be loaded.")}
          message={r.message}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={t("Aucune offre financière.", "No financial bids.")} />
      ) : (
        <>
          <Tableau
            legende={t("Offres financières", "Financial bids")}
            cleLigne={(o) => o.id}
            lignes={r.donnees.elements}
            colonnes={[
              {
                cle: "titre",
                entete: t("Offre", "Bid"),
                rendu: (o) => <Link href={`${chemin}/${o.id}`}>{o.titre}</Link>,
              },
              { cle: "version", entete: "Version", alignement: "droite" },
              {
                cle: "total_ht",
                entete: t("Total HT", "Total excl. tax"),
                alignement: "droite",
                rendu: (o) => formaterMontantMineur(o.total_ht, o.devise, langue),
              },
              {
                cle: "total_ttc",
                entete: t("Total TTC", "Total incl. tax"),
                alignement: "droite",
                rendu: (o) => formaterMontantMineur(o.total_ttc, o.devise, langue),
              },
              {
                cle: "cree_le",
                entete: t("Créée le", "Created on"),
                rendu: (o) => formaterDate(o.cree_le, "UTC", langue),
              },
            ]}
          />
          <PaginationCurseur
            hrefSuivante={
              r.donnees.curseur_suivant
                ? hrefListe(chemin, new URLSearchParams(), r.donnees.curseur_suivant)
                : null
            }
            hrefDebut={curseur ? chemin : null}
          />
        </>
      )}
      {droits.ecrireFinance ? (
        <Carte titre={t("Nouvelle offre financière", "New financial bid")}>
          <FormulaireOffreFinanciere />
        </Carte>
      ) : null}
    </div>
  );
}
