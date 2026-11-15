import Link from "next/link";
import type { Metadata } from "next";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Tableau } from "../../../../components/ui/Tableau";
import { formaterDate } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import {
  designationFacturePortail,
  etatPaiement,
  hrefPage,
  lireCurseur,
  montantPortail,
  peut,
  requetePage,
  type FacturePortail,
  type PagePortail,
} from "../../../../lib/portail";
import { CHEMIN_PORTAIL } from "../../../../lib/portail-routes";
import { chargerPortail, obtenirSessionPortail } from "../../../../lib/portail-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Factures", "Invoices") };
}

const CHEMIN = `${CHEMIN_PORTAIL}/factures`;

/** Factures émises (et avoirs) des missions dont le cabinet partage la facturation. */
export default async function FacturesPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.factures.lire")) {
    return <NonDisponible titre={t("Factures", "Invoices")} />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PagePortail<FacturePortail>>(
    requetePage("/api/portail/factures", curseur),
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Vos factures", "Your invoices")}
        soustitre={t(
          "Les factures émises par votre cabinet pour les missions partagées, des plus récentes aux plus anciennes. Ouvrez une facture pour voir son détail et son document.",
          "The invoices issued by your firm for the shared engagements, from most recent to oldest. Open an invoice to see its details and its document.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "La liste des factures n'a pas pu être chargée.",
            "The list of invoices could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucune facture n'a encore été partagée avec vous.",
            "No invoice has been shared with you yet.",
          )}
          icone="facture"
        >
          <p>
            {t(
              "Les factures émises par votre cabinet apparaîtront ici lorsqu'il les partagera.",
              "Invoices issued by your firm will appear here when it shares them.",
            )}
          </p>
        </EtatVide>
      ) : (
        <Tableau
          legende={t("Factures et avoirs", "Invoices and credit notes")}
          lignes={r.donnees.elements}
          cleLigne={(f) => f.id}
          colonnes={[
            {
              cle: "facture",
              entete: t("Facture", "Invoice"),
              rendu: (f) => (
                <Link href={`${CHEMIN}/${encodeURIComponent(f.id)}`} className="mp-sans-coupure">
                  {designationFacturePortail(f, langue)}
                </Link>
              ),
            },
            {
              cle: "mission",
              entete: t("Mission", "Engagement"),
              rendu: (f) => f.mission.intitule,
            },
            {
              cle: "emission",
              entete: t("Émise le", "Issued on"),
              rendu: (f) => formaterDate(f.date_emission, "UTC", langue),
            },
            {
              cle: "echeance",
              entete: t("Échéance", "Due date"),
              rendu: (f) => (f.date_echeance ? formaterDate(f.date_echeance, "UTC", langue) : "—"),
            },
            {
              cle: "net",
              entete: t("Net à payer", "Net payable"),
              alignement: "droite",
              rendu: (f) => (
                <span className="mp-montant">
                  {montantPortail(f.net_a_payer, f.devise, langue)}
                </span>
              ),
            },
            {
              cle: "paiement",
              entete: t("Paiement", "Payment"),
              rendu: (f) => {
                const p = etatPaiement(f, langue);
                return <BadgeStatut tonalite={p.tonalite}>{p.libelle}</BadgeStatut>;
              },
            },
          ]}
        />
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={
            r.donnees.curseur_suivant ? hrefPage(CHEMIN, r.donnees.curseur_suivant) : null
          }
          hrefDebut={curseur ? CHEMIN : null}
          libelle={t("Pages des factures", "Invoice pages")}
        />
      ) : null}
    </div>
  );
}
