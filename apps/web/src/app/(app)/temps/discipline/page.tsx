import type { Metadata } from "next";
import { creerTraduire } from "@missionpilot/shared";
import { BadgeStatut, type TonaliteStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Tableau } from "../../../../components/ui/Tableau";
import { obtenirLangue } from "../../../../lib/i18n/serveur";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate, formaterPourcentage } from "../../../../lib/format";
import { libelleDateCourte } from "../../../../lib/semaine";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = creerTraduire(await obtenirLangue());
  return { title: t("Discipline de saisie", "Time entry discipline") };
}

interface Ratio {
  reussis: number;
  attendus: number;
  taux: number | null;
}

interface Discipline {
  debut: string;
  fin: string;
  date_reference: string;
  total: Ratio;
  elements: (Ratio & {
    collaborateur: { id: string; nom: string };
    semaines: { semaine: string; date_limite: string; statut: string; soumise_le: string | null }[];
  })[];
  curseur_suivant: string | null;
}

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

const ETAT_SEMAINE: Record<string, { libelle: string; tonalite: TonaliteStatut }> = {
  absente: { libelle: "Non soumise", tonalite: "danger" },
  brouillon: { libelle: "Brouillon", tonalite: "attention" },
  soumise: { libelle: "Soumise", tonalite: "succes" },
  validee: { libelle: "Validée", tonalite: "succes" },
  rejetee: { libelle: "Rejetée", tonalite: "attention" },
  verrouillee: { libelle: "Verrouillée", tonalite: "succes" },
};

const ETAT_SEMAINE_EN: Record<string, string> = {
  absente: "Not submitted",
  brouillon: "Draft",
  soumise: "Submitted",
  validee: "Approved",
  rejetee: "Rejected",
  verrouillee: "Locked",
};

/** Indicateur « Discipline de saisie » : feuilles soumises dans les délais / attendues. */
export default async function PageDiscipline({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("temps.saisir");
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const brut = (await searchParams).curseur;
  const curseur = typeof brut === "string" && CURSEUR.test(brut) ? brut : "";
  const r = await chargerServeur<Discipline>(
    `/api/temps/discipline?limite=50${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
  );
  const ratio = (x: Ratio) =>
    x.taux === null
      ? t("Rien d'attendu", "Nothing expected")
      : `${formaterPourcentage(x.taux, 1, langue)} (${x.reussis} ${t("sur", "of")} ${x.attendus})`;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Discipline de saisie", "Time entry discipline")}
        soustitre={t(
          "Feuilles soumises dans les délais (au plus tard le dimanche de la semaine) sur les feuilles attendues, quatre dernières semaines. Votre équipe si vous validez des temps, tout le cabinet pour la direction.",
          "Timesheets submitted on time (by Sunday of the week at the latest) out of the timesheets expected, last four weeks. Your team if you approve time, the whole firm for management.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t("L'indicateur n'a pas pu être calculé.", "The indicator could not be computed.")}
          message={r.message}
          hrefReessayer="/temps/discipline"
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucune feuille attendue sur la période.",
            "No timesheet expected in the period.",
          )}
          icone="horloge"
        />
      ) : (
        <>
          <ul className="mp-totaux">
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">
                {t(
                  `Ensemble, du ${formaterDate(r.donnees.debut, "UTC", langue)} au ${formaterDate(r.donnees.fin, "UTC", langue)}`,
                  `Overall, from ${formaterDate(r.donnees.debut, "UTC", langue)} to ${formaterDate(r.donnees.fin, "UTC", langue)}`,
                )}
              </span>
              <span className="mp-totaux__valeur">{ratio(r.donnees.total)}</span>
            </li>
          </ul>
          <Tableau
            legende={t(
              "Discipline de saisie par collaborateur",
              "Time entry discipline by employee",
            )}
            lignes={r.donnees.elements}
            cleLigne={(e) => e.collaborateur.id}
            colonnes={[
              {
                cle: "nom",
                entete: t("Collaborateur", "Employee"),
                rendu: (e) => e.collaborateur.nom,
              },
              {
                cle: "ratio",
                entete: t("Dans les délais", "On time"),
                alignement: "droite",
                rendu: ratio,
              },
              {
                cle: "semaines",
                entete: t("Semaines", "Weeks"),
                rendu: (e) => (
                  <ul className="mp-badges">
                    {e.semaines.map((s) => {
                      const enCours =
                        (s.statut === "absente" || s.statut === "brouillon") &&
                        s.date_limite >= r.donnees.date_reference;
                      const connu = ETAT_SEMAINE[s.statut];
                      const etat = enCours
                        ? {
                            libelle: t("À soumettre d'ici dimanche", "To submit by Sunday"),
                            tonalite: "neutre" as const,
                          }
                        : connu
                          ? {
                              libelle:
                                langue === "en"
                                  ? (ETAT_SEMAINE_EN[s.statut] ?? s.statut)
                                  : connu.libelle,
                              tonalite: connu.tonalite,
                            }
                          : { libelle: s.statut, tonalite: "neutre" as const };
                      return (
                        <li key={s.semaine}>
                          <BadgeStatut tonalite={etat.tonalite}>
                            {`${libelleDateCourte(s.semaine, langue)} : ${etat.libelle}`}
                          </BadgeStatut>
                        </li>
                      );
                    })}
                  </ul>
                ),
              },
            ]}
          />
          <PaginationCurseur
            libelle={t("Pages de collaborateurs", "Employee pages")}
            hrefSuivante={
              r.donnees.curseur_suivant
                ? `/temps/discipline?curseur=${encodeURIComponent(r.donnees.curseur_suivant)}`
                : null
            }
            hrefDebut={curseur ? "/temps/discipline" : null}
          />
        </>
      )}
    </div>
  );
}
