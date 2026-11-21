import Link from "next/link";
import type { Metadata } from "next";
import { creerTraduire } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../components/ui/Bouton";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Tableau } from "../../../../components/ui/Tableau";
import { obtenirLangue } from "../../../../lib/i18n/serveur";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../lib/format";
import { ajouterJoursIso, libelleSemaine } from "../../../../lib/semaine";
import { exigerPermission } from "../../../../lib/session";
import { statutFeuille, type ResumeFeuille } from "../../../../lib/temps";

export async function generateMetadata(): Promise<Metadata> {
  const t = creerTraduire(await obtenirLangue());
  return { title: t("Feuilles à valider", "Timesheets to approve") };
}

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

export default async function PageFeuillesAValider({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("temps.valider");
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const brut = (await searchParams).curseur;
  const curseur = typeof brut === "string" && CURSEUR.test(brut) ? brut : "";
  const liste = await chargerServeur<{ elements: ResumeFeuille[]; curseur_suivant: string | null }>(
    `/api/feuilles-temps?vue=a_valider&limite=30${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Feuilles à valider", "Timesheets to approve")}
        soustitre={t(
          "Feuilles soumises dont vous décidez au moins une partie (vos missions). Ouvrez une feuille pour valider ou rejeter avec un motif.",
          "Submitted timesheets of which you decide at least one part (your engagements). Open a timesheet to approve or reject it with a reason.",
        )}
      />
      {!liste.ok ? (
        <EtatErreur
          titre={t(
            "Les feuilles à valider n'ont pas pu être chargées.",
            "The timesheets to approve could not be loaded.",
          )}
          message={liste.message}
          hrefReessayer="/temps/validation"
        />
      ) : liste.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucune feuille en attente de votre validation.",
            "No timesheet awaiting your approval.",
          )}
          icone="succes"
        >
          <p>
            {t(
              "Vous serez notifié dès qu'un membre de vos missions soumettra sa semaine.",
              "You will be notified as soon as a member of your engagements submits their week.",
            )}
          </p>
        </EtatVide>
      ) : (
        <>
          <p className="mp-resume-file" role="status">
            {liste.donnees.curseur_suivant
              ? t(
                  `${liste.donnees.elements.length} feuilles affichées, d'autres suivent.`,
                  `${liste.donnees.elements.length} timesheets shown, more to come.`,
                )
              : liste.donnees.elements.length === 1
                ? t("1 feuille à traiter.", "1 timesheet to review.")
                : t(
                    `${liste.donnees.elements.length} feuilles à traiter.`,
                    `${liste.donnees.elements.length} timesheets to review.`,
                  )}
          </p>
          <Tableau
            legende={t("Feuilles de temps soumises à valider", "Submitted timesheets to approve")}
            lignes={liste.donnees.elements}
            cleLigne={(f) => f.id}
            colonnes={[
              {
                cle: "collaborateur",
                entete: t("Collaborateur", "Employee"),
                rendu: (f) => (
                  <Link href={`/temps/feuilles/${f.id}`} className="mp-lien-ligne">
                    {f.collaborateur_nom}
                  </Link>
                ),
              },
              {
                cle: "semaine",
                entete: t("Semaine", "Week"),
                rendu: (f) => libelleSemaine(f.semaine, ajouterJoursIso(f.semaine, 6), langue),
              },
              {
                cle: "soumise",
                entete: t("Soumise le", "Submitted on"),
                rendu: (f) => formaterDateHeure(f.soumise_le, "Africa/Abidjan", langue),
              },
              {
                cle: "statut",
                entete: t("État", "Status"),
                rendu: (f) => (
                  <BadgeStatut tonalite={statutFeuille(f.statut, langue).tonalite}>
                    {f.cycle > 1
                      ? t(`Resoumise (${f.cycle}e envoi)`, `Resubmitted (submission ${f.cycle})`)
                      : statutFeuille(f.statut, langue).libelle}
                  </BadgeStatut>
                ),
              },
              {
                cle: "action",
                entete: t("Action", "Action"),
                rendu: (f) => (
                  <span className="mp-cellule-action">
                    <Link
                      href={`/temps/feuilles/${f.id}`}
                      className={classesBouton("secondaire")}
                      aria-label={t(
                        `Examiner la feuille de ${f.collaborateur_nom}`,
                        `Review ${f.collaborateur_nom}'s timesheet`,
                      )}
                    >
                      {t("Examiner", "Review")}
                    </Link>
                  </span>
                ),
              },
            ]}
          />
        </>
      )}
      {liste.ok ? (
        <PaginationCurseur
          libelle={t("Pages des feuilles à valider", "Pages of timesheets to approve")}
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
