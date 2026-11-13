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
  libelleStatutOffre,
  RACINE_BANQUES,
  tonaliteStatutOffre,
  type OffreTechniqueResume,
} from "../../../../../lib/banque-ao";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { chargerChoixOffreTechnique } from "../../../../../lib/appels-offres-serveur";
import { formaterDate } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { obtenirSession } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Offres techniques", "Technical bids") };
}

type Parametres = Promise<Record<string, string | string[] | undefined>>;

/** Offres techniques (AO-06) : brouillons IA ou gabarits, modifiés puis validés par un humain. */
export default async function PageOffresTechniques({ searchParams }: { searchParams: Parametres }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
  const choix = droits.gerer ? await chargerChoixOffreTechnique() : { cv: [], fiches: [] };

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Offres techniques", "Technical bids")}
        soustitre={t(
          "Compréhension des termes de référence, méthodologie, planning et organisation. L'IA propose un brouillon ; rien n'est utilisable avant la validation d'un consultant. Le planning et l'équipe viennent de la méthode du cabinet et de la banque de CV, jamais du modèle.",
          "Understanding of the terms of reference, methodology, schedule and organization. The AI proposes a draft; nothing is usable until a consultant approves it. The schedule and team come from the firm's method and the CV bank, never from the model.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          hrefReessayer={chemin}
          titre={t("Les offres n'ont pas pu être chargées.", "The bids could not be loaded.")}
          message={r.message}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={t("Aucune offre technique.", "No technical bids.")} />
      ) : (
        <>
          <Tableau
            legende={t("Offres techniques", "Technical bids")}
            cleLigne={(o) => o.id}
            lignes={r.donnees.elements}
            colonnes={[
              {
                cle: "titre",
                entete: t("Offre", "Bid"),
                rendu: (o) => <Link href={`${chemin}/${o.id}`}>{o.titre}</Link>,
              },
              {
                cle: "statut",
                entete: t("Statut", "Status"),
                rendu: (o) => (
                  <BadgeStatut tonalite={tonaliteStatutOffre(o.statut)}>
                    {libelleStatutOffre(o.statut, langue)}
                  </BadgeStatut>
                ),
              },
              { cle: "version", entete: "Version", alignement: "droite" },
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
      {droits.gerer ? (
        <Carte titre={t("Rédiger une offre technique", "Draft a technical bid")}>
          <FormulaireOffreTechnique
            redigerIa={droits.redigerIa}
            lierMethode={droits.lierMethode}
            cvChoix={choix.cv}
            fichesChoix={choix.fiches}
          />
        </Carte>
      ) : null}
    </div>
  );
}
