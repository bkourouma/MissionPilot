import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { NavigationSemaine } from "../../../components/temps/NavigationSemaine";
import { Alerte } from "../../../components/ui/Alerte";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { chargerServeur } from "../../../lib/api-serveur";
import { obtenirLangue } from "../../../lib/i18n/serveur";
import { formaterDate, formaterJours } from "../../../lib/format";
import {
  groupesParMission,
  presentationStatutAbsence,
  TYPE_ABSENCE_LIBELLES,
  TYPE_ABSENCE_LIBELLES_EN,
  type MonPlanning,
} from "../../../lib/planification";
import {
  aujourdhuiIso,
  dansPeriode,
  joursDeLaSemaine,
  libelleJourLong,
  lireSemaine,
} from "../../../lib/semaine";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const langue = await obtenirLangue();
  return { title: langue === "en" ? "My schedule" : "Mon planning" };
}

export default async function PageMonPlanning({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const { utilisateur } = await exigerPermission("temps.saisir");
  const semaine = lireSemaine((await searchParams).semaine);
  const r = await chargerServeur<MonPlanning>(
    `/api/mon-planning${semaine ? `?semaine=${semaine}` : ""}`,
  );
  const reessayer = semaine ? `/planning?semaine=${semaine}` : "/planning";

  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Mon planning", "My schedule")} />
        <EtatErreur
          titre={t("Votre planning n'a pas pu être chargé.", "Your schedule could not be loaded.")}
          message={r.message}
          hrefReessayer={reessayer}
        />
      </div>
    );
  }
  const p = r.donnees;
  const groupes = groupesParMission(p.lignes, langue);
  const depasse = p.capacite !== null && p.jours_affectes > p.capacite;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Mon planning", "My schedule")}
        soustitre={t(
          "Vos tâches et jours alloués de la semaine, vos absences et les jours fériés.",
          "Your tasks and allocated days for the week, your absences and public holidays.",
        )}
        actions={
          p.collaborateur ? (
            <Link href={`/temps?semaine=${p.semaine.debut}`} className={classesBouton("primaire")}>
              <Icone nom="horloge" />
              <span>{t("Saisir mes temps", "Enter my time")}</span>
            </Link>
          ) : null
        }
      />
      <NavigationSemaine
        base="/planning"
        semaine={p.semaine}
        libelle={t("Changer de semaine du planning", "Change schedule week")}
      />

      {!p.collaborateur ? (
        <EtatVide
          titre={t(
            "Aucune fiche collaborateur n'est rattachée à votre compte.",
            "No team member profile is linked to your account.",
          )}
          icone="personnes"
        >
          <p>
            {t(
              "Votre planning apparaîtra quand le responsable des ressources aura lié votre compte à votre fiche dans le référentiel des collaborateurs.",
              "Your schedule will appear once the resources manager has linked your account to your profile in the team directory.",
            )}
          </p>
        </EtatVide>
      ) : (
        <>
          <ul className="mp-totaux" aria-label={t("Synthèse de la semaine", "Week summary")}>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">{t("Jours alloués", "Allocated days")}</span>
              <span className="mp-totaux__valeur">{formaterJours(p.jours_affectes, langue)}</span>
            </li>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">
                {t("Capacité de la semaine", "Capacity for the week")}
              </span>
              <span className="mp-totaux__valeur">{formaterJours(p.capacite, langue)}</span>
            </li>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">{t("Tâches", "Tasks")}</span>
              <span className="mp-totaux__valeur">{p.lignes.length}</span>
            </li>
          </ul>
          {depasse ? (
            <Alerte
              tonalite="attention"
              titre={t("Semaine chargée", "Heavy week")}
              annonce="aucune"
            >
              <p>
                {t(
                  "Vos jours alloués dépassent votre capacité de la semaine (jours fériés et absences validées déduits). Parlez-en à votre chef de mission.",
                  "Your allocated days exceed your capacity for the week (public holidays and approved absences deducted). Talk to your engagement manager.",
                )}
              </p>
            </Alerte>
          ) : null}

          <section aria-labelledby="titre-taches" className="mp-pile">
            <h2 id="titre-taches" className="mp-section__titre">
              {t("Vos tâches de la semaine", "Your tasks this week")}
            </h2>
            {groupes.length === 0 ? (
              <EtatVide
                titre={t("Aucune tâche affectée cette semaine.", "No tasks assigned this week.")}
                icone="calendrier"
              >
                <p>
                  {t(
                    "Vos affectations apparaissent ici dès qu'un chef de mission vous attribue des jours sur une tâche.",
                    "Your assignments appear here as soon as an engagement manager allocates days to you on a task.",
                  )}
                </p>
              </EtatVide>
            ) : (
              <ul className="mp-liste-cartes">
                {groupes.map((g) => (
                  <li key={g.cle}>
                    <Carte
                      niveauTitre={3}
                      titre={
                        g.accessible ? (
                          <Link href={`/missions/${g.cle}`}>{g.intitule}</Link>
                        ) : (
                          g.intitule
                        )
                      }
                    >
                      <ul className="mp-liste-lignes">
                        {g.lignes.map((l) => (
                          <li key={l.affectation_id} className="mp-liste-lignes__ligne">
                            <span className="mp-liste-lignes__texte">
                              <strong className="mp-coupure">
                                {l.tache.libelle ??
                                  t("Tâche non accessible", "Task not accessible")}
                              </strong>
                              <span className="mp-texte-doux">
                                {[
                                  l.tache.phase_libelle,
                                  t(
                                    `affectation de ${formaterJours(l.affectation.jours_alloues)} du ${formaterDate(l.affectation.date_debut)} au ${formaterDate(l.affectation.date_fin)}`,
                                    `assignment of ${formaterJours(l.affectation.jours_alloues, langue)} from ${formaterDate(l.affectation.date_debut, "UTC", langue)} to ${formaterDate(l.affectation.date_fin, "UTC", langue)}`,
                                  ),
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </span>
                            <span className="mp-total-jours">
                              {formaterJours(l.jours_alloues_semaine, langue)}
                              <span className="mp-visuellement-cache">
                                {" "}
                                {t("cette semaine", "this week")}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Carte>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="titre-jours" className="mp-pile">
            <h2 id="titre-jours" className="mp-section__titre">
              {t("Jour par jour", "Day by day")}
            </h2>
            <ol
              className="mp-jours-semaine"
              aria-label={t("Les sept jours de la semaine", "The seven days of the week")}
            >
              {joursDeLaSemaine(p.semaine.debut).map((date) => {
                const feries = p.feries.filter((f) => f.date === date);
                const absences = p.absences.filter((a) =>
                  dansPeriode(date, a.date_debut, a.date_fin),
                );
                const aujourdhui = date === aujourdhuiIso();
                return (
                  <li
                    key={date}
                    className={
                      aujourdhui
                        ? "mp-jours-semaine__jour mp-jours-semaine__jour--courant"
                        : "mp-jours-semaine__jour"
                    }
                    aria-current={aujourdhui ? "date" : undefined}
                  >
                    <span className="mp-jours-semaine__date">
                      {libelleJourLong(date, langue)}
                      {aujourdhui ? (
                        <span className="mp-jours-semaine__marque">
                          <Icone nom="horloge" taille={12} />
                          {t("Aujourd'hui", "Today")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mp-jours-semaine__infos">
                      {feries.map((f) => (
                        <BadgeStatut key={f.date + f.libelle} tonalite="neutre" sansIcone>
                          <span className="mp-badge__interne">
                            <Icone nom="drapeau" taille={14} />
                            {`${t("Férié", "Holiday")} : ${f.libelle}`}
                          </span>
                        </BadgeStatut>
                      ))}
                      {absences.map((a) => (
                        <BadgeStatut
                          key={a.id}
                          tonalite={presentationStatutAbsence(a.statut, langue).tonalite}
                        >
                          {`${(langue === "en" ? TYPE_ABSENCE_LIBELLES_EN : TYPE_ABSENCE_LIBELLES)[a.type]} (${presentationStatutAbsence(a.statut, langue).libelle.toLowerCase()})`}
                        </BadgeStatut>
                      ))}
                      {feries.length === 0 && absences.length === 0 ? (
                        <span className="mp-texte-doux">{t("Aucun événement", "No events")}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            {aPermission(utilisateur.roles, "conges.demander") ? (
              <p>
                <Link href="/planning/conges" className={classesBouton("secondaire")}>
                  <Icone nom="calendrier" />
                  <span>
                    {t("Demander un congé ou une absence", "Request leave or an absence")}
                  </span>
                </Link>
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
