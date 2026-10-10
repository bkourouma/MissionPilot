import Link from "next/link";
import type { Metadata } from "next";
import "../../../../components/notation/notation.css";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate } from "../../../../lib/format";
import {
  HREF_NOUVELLE_CALIBRATION,
  cheminCalibrations,
  hrefCalibration,
  type ElementCalibration,
  type Page,
} from "../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../lib/notation-serveur";

export const metadata: Metadata = { title: "Calibration des évaluateurs" };

/**
 * Sessions de calibrage entre évaluateurs (NOT-13) : double cotation d'un échantillon de cas,
 * écart mesuré par le moteur, clôture par un expert métier. La cotation est à l'aveugle tant que
 * la session est ouverte : un expert métier ne voit les cotations des autres et la mesure que
 * pour les cas qu'il a lui-même cotés, tous les autres rôles attendent la clôture.
 */
export default async function PageCalibrations({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerLectureNotation();
  const q = await searchParams;
  const curseur = typeof q.curseur === "string" ? q.curseur : "";
  const r = await chargerServeur<Page<ElementCalibration>>(cheminCalibrations(curseur));
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Calibration des évaluateurs"
        soustitre="Deux consultants qui évaluent la même entreprise doivent arriver au même niveau : la calibration se mesure et se corrige."
        actions={
          <Link href={HREF_NOUVELLE_CALIBRATION} className={classesBouton("primaire")}>
            Nouvelle session
          </Link>
        }
      />
      <Carte titre="Sessions de calibrage">
        {!r.ok ? (
          <EtatErreur
            titre="Les sessions n'ont pas pu être chargées."
            message={r.message}
            hrefReessayer="/notation/calibrations"
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide
            titre="Aucune session de calibrage."
            icone="info"
            action={
              <Link href={HREF_NOUVELLE_CALIBRATION} className={classesBouton("primaire")}>
                Créer une session
              </Link>
            }
          >
            <p>
              Une session réunit des cas que plusieurs évaluateurs cotent à l&apos;aveugle ; un
              expert métier la clôt, et l&apos;écart entre évaluateurs est alors mesuré.
            </p>
          </EtatVide>
        ) : (
          <>
            <Tableau
              legende="Sessions de calibrage"
              cleLigne={(s) => s.id}
              lignes={r.donnees.elements}
              colonnes={[
                {
                  cle: "titre",
                  entete: "Session",
                  rendu: (s) => <Link href={hrefCalibration(s.id)}>{s.titre}</Link>,
                },
                { cle: "nombre_cas", entete: "Cas", alignement: "droite" },
                { cle: "evaluateurs", entete: "Évaluateurs", alignement: "droite" },
                { cle: "tolerance", entete: "Tolérance (niveaux)", alignement: "droite" },
                {
                  cle: "close",
                  entete: "État",
                  rendu: (s) => (
                    <BadgeStatut tonalite={s.close ? "succes" : "attention"}>
                      {s.close ? `Close le ${formaterDate(s.cloturee_le)}` : "Ouverte"}
                    </BadgeStatut>
                  ),
                },
                { cle: "cree_le", entete: "Créée le", rendu: (s) => formaterDate(s.cree_le) },
              ]}
            />
            <PaginationCurseur
              hrefSuivante={
                r.donnees.curseur_suivant
                  ? `/notation/calibrations?curseur=${encodeURIComponent(r.donnees.curseur_suivant)}`
                  : null
              }
              hrefDebut={curseur ? "/notation/calibrations" : null}
              libelle="Pagination des sessions"
            />
          </>
        )}
      </Carte>
    </div>
  );
}
