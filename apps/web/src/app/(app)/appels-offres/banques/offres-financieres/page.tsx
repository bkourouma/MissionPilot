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
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Offres financières" };

type Parametres = Promise<Record<string, string | string[] | undefined>>;

/** Offres financières (AO-07) : taux journaliers confidentiels, réservées à `finance.lire`. */
export default async function PageOffresFinancieres({
  searchParams,
}: {
  searchParams: Parametres;
}) {
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
        titre="Offres financières"
        soustitre="Jours par expert, taux journaliers, per diem, débours et taxes, calculés par le moteur de l'application avec des arrondis exacts. Données confidentielles du cabinet."
      />
      {!r.ok ? (
        <EtatErreur
          hrefReessayer={chemin}
          titre="Les offres n'ont pas pu être chargées."
          message={r.message}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune offre financière." />
      ) : (
        <>
          <Tableau
            legende="Offres financières"
            cleLigne={(o) => o.id}
            lignes={r.donnees.elements}
            colonnes={[
              {
                cle: "titre",
                entete: "Offre",
                rendu: (o) => <Link href={`${chemin}/${o.id}`}>{o.titre}</Link>,
              },
              { cle: "version", entete: "Version", alignement: "droite" },
              {
                cle: "total_ht",
                entete: "Total HT",
                alignement: "droite",
                rendu: (o) => formaterMontantMineur(o.total_ht, o.devise),
              },
              {
                cle: "total_ttc",
                entete: "Total TTC",
                alignement: "droite",
                rendu: (o) => formaterMontantMineur(o.total_ttc, o.devise),
              },
              { cle: "cree_le", entete: "Créée le", rendu: (o) => formaterDate(o.cree_le) },
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
        <Carte titre="Nouvelle offre financière">
          <FormulaireOffreFinanciere />
        </Carte>
      ) : null}
    </div>
  );
}
