import Link from "next/link";
import type { Metadata } from "next";
import { NonDisponible } from "../../../../components/portail/NonDisponible";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Tableau } from "../../../../components/ui/Tableau";
import { formaterDate } from "../../../../lib/format";
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

export const metadata: Metadata = { title: "Factures" };

const CHEMIN = `${CHEMIN_PORTAIL}/factures`;

/** Factures émises (et avoirs) des missions dont le cabinet partage la facturation. */
export default async function FacturesPortail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.factures.lire")) {
    return <NonDisponible titre="Factures" />;
  }
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerPortail<PagePortail<FacturePortail>>(
    requetePage("/api/portail/factures", curseur),
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Vos factures"
        soustitre="Les factures émises par votre cabinet pour les missions partagées, des plus récentes aux plus anciennes. Ouvrez une facture pour voir son détail et son document."
      />
      {!r.ok ? (
        <EtatErreur
          titre="La liste des factures n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefPage(CHEMIN, curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune facture n'a encore été partagée avec vous." icone="facture">
          <p>
            Les factures émises par votre cabinet apparaîtront ici lorsqu&apos;il les partagera.
          </p>
        </EtatVide>
      ) : (
        <Tableau
          legende="Factures et avoirs"
          lignes={r.donnees.elements}
          cleLigne={(f) => f.id}
          colonnes={[
            {
              cle: "facture",
              entete: "Facture",
              rendu: (f) => (
                <Link href={`${CHEMIN}/${encodeURIComponent(f.id)}`} className="mp-sans-coupure">
                  {designationFacturePortail(f)}
                </Link>
              ),
            },
            { cle: "mission", entete: "Mission", rendu: (f) => f.mission.intitule },
            { cle: "emission", entete: "Émise le", rendu: (f) => formaterDate(f.date_emission) },
            {
              cle: "echeance",
              entete: "Échéance",
              rendu: (f) => (f.date_echeance ? formaterDate(f.date_echeance) : "—"),
            },
            {
              cle: "net",
              entete: "Net à payer",
              alignement: "droite",
              rendu: (f) => (
                <span className="mp-montant">{montantPortail(f.net_a_payer, f.devise)}</span>
              ),
            },
            {
              cle: "paiement",
              entete: "Paiement",
              rendu: (f) => {
                const p = etatPaiement(f);
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
          libelle="Pages des factures"
        />
      ) : null}
    </div>
  );
}
