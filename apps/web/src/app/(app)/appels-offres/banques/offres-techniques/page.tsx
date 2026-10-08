import type { Metadata } from "next";
import Link from "next/link";
import { FormulaireOffreTechnique } from "../../../../../components/banque-ao/FormulairesOffres";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { lireCurseur } from "../../../../../lib/agents";
import {
  droitsBanqueAo,
  hrefListe,
  LIBELLES_STATUT_OFFRE,
  RACINE_BANQUES,
  tonaliteStatutOffre,
  type OffreTechniqueResume,
} from "../../../../../lib/banque-ao";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../lib/format";
import { obtenirSession } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Offres techniques" };

type Parametres = Promise<Record<string, string | string[] | undefined>>;

/** Offres techniques (AO-06) : brouillons IA ou gabarits, modifiés puis validés par un humain. */
export default async function PageOffresTechniques({ searchParams }: { searchParams: Parametres }) {
  const { utilisateur } = await obtenirSession();
  const droits = droitsBanqueAo(utilisateur.roles);
  const curseur = lireCurseur((await searchParams).curseur);
  const q = new URLSearchParams({ limite: "30" });
  if (curseur) q.set("curseur", curseur);
  const r = await chargerServeur<{
    elements: OffreTechniqueResume[];
    curseur_suivant: string | null;
  }>(`/api/banque-ao/offres-techniques?${q}`);
  const chemin = `${RACINE_BANQUES}/offres-techniques`;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Offres techniques"
        soustitre="Compréhension des termes de référence, méthodologie, planning et organisation. L'IA propose un brouillon ; rien n'est utilisable avant la validation d'un consultant. Le planning et l'équipe viennent de la méthode du cabinet et de la banque de CV, jamais du modèle."
      />
      {!r.ok ? (
        <EtatErreur
          hrefReessayer={chemin}
          titre="Les offres n'ont pas pu être chargées."
          message={r.message}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune offre technique." />
      ) : (
        <>
          <Tableau
            legende="Offres techniques"
            cleLigne={(o) => o.id}
            lignes={r.donnees.elements}
            colonnes={[
              {
                cle: "titre",
                entete: "Offre",
                rendu: (o) => <Link href={`${chemin}/${o.id}`}>{o.titre}</Link>,
              },
              {
                cle: "statut",
                entete: "Statut",
                rendu: (o) => (
                  <BadgeStatut tonalite={tonaliteStatutOffre(o.statut)}>
                    {LIBELLES_STATUT_OFFRE[o.statut]}
                  </BadgeStatut>
                ),
              },
              { cle: "version", entete: "Version", alignement: "droite" },
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
      {droits.gerer ? (
        <Carte titre="Rédiger une offre technique">
          <FormulaireOffreTechnique redigerIa={droits.redigerIa} lierMethode={droits.lierMethode} />
        </Carte>
      ) : null}
    </div>
  );
}
