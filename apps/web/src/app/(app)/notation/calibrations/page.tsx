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
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import {
  HREF_NOUVELLE_CALIBRATION,
  cheminCalibrations,
  hrefCalibration,
  type ElementCalibration,
  type Page,
} from "../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../lib/notation-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Calibration des évaluateurs", "Rater calibration") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  await exigerLectureNotation();
  const q = await searchParams;
  const curseur = typeof q.curseur === "string" ? q.curseur : "";
  const r = await chargerServeur<Page<ElementCalibration>>(cheminCalibrations(curseur));
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Calibration des évaluateurs", "Rater calibration")}
        soustitre={t(
          "Deux consultants qui évaluent la même entreprise doivent arriver au même niveau : la calibration se mesure et se corrige.",
          "Two consultants assessing the same company should reach the same level: calibration is measured and corrected.",
        )}
        actions={
          <Link href={HREF_NOUVELLE_CALIBRATION} className={classesBouton("primaire")}>
            {t("Nouvelle session", "New session")}
          </Link>
        }
      />
      <Carte titre={t("Sessions de calibrage", "Calibration sessions")}>
        {!r.ok ? (
          <EtatErreur
            titre={t(
              "Les sessions n'ont pas pu être chargées.",
              "The sessions could not be loaded.",
            )}
            message={r.message}
            hrefReessayer="/notation/calibrations"
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t("Aucune session de calibrage.", "No calibration session.")}
            icone="info"
            action={
              <Link href={HREF_NOUVELLE_CALIBRATION} className={classesBouton("primaire")}>
                {t("Créer une session", "Create a session")}
              </Link>
            }
          >
            <p>
              {t(
                "Une session réunit des cas que plusieurs évaluateurs cotent à l'aveugle ; un expert métier la clôt, et l'écart entre évaluateurs est alors mesuré.",
                "A session gathers cases that several raters rate blind; a business expert closes it, and the gap between raters is then measured.",
              )}
            </p>
          </EtatVide>
        ) : (
          <>
            <Tableau
              legende={t("Sessions de calibrage", "Calibration sessions")}
              cleLigne={(s) => s.id}
              lignes={r.donnees.elements}
              colonnes={[
                {
                  cle: "titre",
                  entete: t("Session", "Session"),
                  rendu: (s) => <Link href={hrefCalibration(s.id)}>{s.titre}</Link>,
                },
                { cle: "nombre_cas", entete: t("Cas", "Cases"), alignement: "droite" },
                { cle: "evaluateurs", entete: t("Évaluateurs", "Raters"), alignement: "droite" },
                {
                  cle: "tolerance",
                  entete: t("Tolérance (niveaux)", "Tolerance (levels)"),
                  alignement: "droite",
                },
                {
                  cle: "close",
                  entete: t("État", "Status"),
                  rendu: (s) => (
                    <BadgeStatut tonalite={s.close ? "succes" : "attention"}>
                      {s.close
                        ? t(
                            `Close le ${formaterDate(s.cloturee_le, "UTC", langue)}`,
                            `Closed on ${formaterDate(s.cloturee_le, "UTC", langue)}`,
                          )
                        : t("Ouverte", "Open")}
                    </BadgeStatut>
                  ),
                },
                {
                  cle: "cree_le",
                  entete: t("Créée le", "Created on"),
                  rendu: (s) => formaterDate(s.cree_le, "UTC", langue),
                },
              ]}
            />
            <PaginationCurseur
              hrefSuivante={
                r.donnees.curseur_suivant
                  ? `/notation/calibrations?curseur=${encodeURIComponent(r.donnees.curseur_suivant)}`
                  : null
              }
              hrefDebut={curseur ? "/notation/calibrations" : null}
              libelle={t("Pagination des sessions", "Session pagination")}
            />
          </>
        )}
      </Carte>
    </div>
  );
}
