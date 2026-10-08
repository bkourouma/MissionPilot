import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../lib/format";
import { ajouterJoursIso, libelleSemaine } from "../../../../lib/semaine";
import { exigerPermission } from "../../../../lib/session";
import { STATUT_FEUILLE, type ResumeFeuille } from "../../../../lib/temps";

export const metadata: Metadata = { title: "Feuilles à valider" };

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

export default async function PageFeuillesAValider({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("temps.valider");
  const brut = (await searchParams).curseur;
  const curseur = typeof brut === "string" && CURSEUR.test(brut) ? brut : "";
  const liste = await chargerServeur<{ elements: ResumeFeuille[]; curseur_suivant: string | null }>(
    `/api/feuilles-temps?vue=a_valider&limite=30${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Feuilles à valider"
        soustitre="Feuilles soumises dont vous décidez au moins une partie (vos missions). Ouvrez une feuille pour valider ou rejeter avec un motif."
      />
      {!liste.ok ? (
        <EtatErreur
          titre="Les feuilles à valider n'ont pas pu être chargées."
          message={liste.message}
          hrefReessayer="/temps/validation"
        />
      ) : liste.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune feuille en attente de votre validation." icone="succes">
          <p>Vous serez notifié dès qu&apos;un membre de vos missions soumettra sa semaine.</p>
        </EtatVide>
      ) : (
        <Tableau
          legende="Feuilles de temps soumises à valider"
          lignes={liste.donnees.elements}
          cleLigne={(f) => f.id}
          colonnes={[
            {
              cle: "collaborateur",
              entete: "Collaborateur",
              rendu: (f) => (
                <Link href={`/temps/feuilles/${f.id}`} className="mp-lien-ligne">
                  {f.collaborateur_nom}
                </Link>
              ),
            },
            {
              cle: "semaine",
              entete: "Semaine",
              rendu: (f) => libelleSemaine(f.semaine, ajouterJoursIso(f.semaine, 6)),
            },
            { cle: "soumise", entete: "Soumise le", rendu: (f) => formaterDateHeure(f.soumise_le) },
            {
              cle: "statut",
              entete: "État",
              rendu: (f) => (
                <BadgeStatut tonalite={STATUT_FEUILLE[f.statut].tonalite}>
                  {f.cycle > 1 ? `Resoumise (${f.cycle}e envoi)` : STATUT_FEUILLE[f.statut].libelle}
                </BadgeStatut>
              ),
            },
          ]}
        />
      )}
      {liste.ok ? (
        <PaginationCurseur
          libelle="Pages des feuilles à valider"
          hrefSuivante={
            liste.donnees.curseur_suivant
              ? `/temps/validation?curseur=${encodeURIComponent(liste.donnees.curseur_suivant)}`
              : null
          }
          hrefDebut={curseur ? "/temps/validation" : null}
        />
      ) : null}
    </div>
  );
}
