import type { Metadata } from "next";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirLangue } from "../../../../../lib/i18n/serveur";
import {
  geometrieGantt,
  tachesChronologiques,
  tachesDansLOrdre,
  type Decoupage,
  type Planning,
} from "../../../../../lib/decoupage";
import { formaterDate, formaterNombre } from "../../../../../lib/format";
import { droitsMission } from "../../../../../lib/missions";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { Dependances } from "./Dependances";

export async function generateMetadata(): Promise<Metadata> {
  const langue = await obtenirLangue();
  return { title: langue === "en" ? "Engagement schedule" : "Planning de la mission" };
}

export default async function PagePlanning({ params }: { params: Promise<{ id: string }> }) {
  const langue = await obtenirLangue();
  const en = langue === "en";
  const tr = (fr: string, e: string) => (en ? e : fr);
  const { id } = await params;
  const { utilisateur } = await exigerPermission("mission.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsMission(m, utilisateur.roles, utilisateur.id, langue);
  const [planning, decoupage] = await Promise.all([
    chargerServeur<Planning>(`/api/missions/${m.id}/planning`),
    chargerServeur<Decoupage>(`/api/missions/${m.id}/decoupage`),
  ]);
  if (!planning.ok) {
    return (
      <EtatErreur
        titre={tr("Le planning n'a pas pu être calculé.", "The schedule could not be calculated.")}
        message={planning.message}
        hrefReessayer={`/missions/${m.id}/planning`}
      />
    );
  }
  const p = planning.donnees;
  const situees = decoupage.ok ? tachesDansLOrdre(decoupage.donnees) : [];
  const chemin = (tid: string) =>
    situees.find((t) => t.id === tid)?.chemin ??
    p.taches.find((t) => t.id === tid)?.libelle ??
    tr("Tâche", "Task");
  const taches = tachesChronologiques(p.taches);
  const jalons = [...p.jalons].sort((a, b) =>
    (a.date_prevue ?? "9999").localeCompare(b.date_prevue ?? "9999"),
  );
  const gantt = geometrieGantt(taches, jalons);
  const predecesseurs = (tid: string) =>
    p.dependances.filter((d) => d.successeur_id === tid).map((d) => chemin(d.predecesseur_id));

  return (
    <div className="mp-pile mp-pile--large">
      <Carte titre={tr("Planning", "Schedule")}>
        {taches.length === 0 ? (
          <EtatVide
            titre={tr("Aucune tâche à planifier.", "No tasks to schedule.")}
            icone="calendrier"
          >
            <p>
              {tr(
                "Ajoutez des tâches dans l'onglet Découpage.",
                "Add tasks in the Work breakdown tab.",
              )}
            </p>
          </EtatVide>
        ) : (
          <div className="mp-pile">
            <p className="mp-texte-doux">
              {en
                ? `Earliest dates in firm business days, calculated from ${formaterDate(m.date_debut, "UTC", langue) === "—" ? "the same day (engagement with no start date)" : formaterDate(m.date_debut, "UTC", langue)} and the dependencies.`
                : `Dates au plus tôt en jours ouvrés du cabinet, calculées depuis le ${formaterDate(m.date_debut) === "—" ? "jour même (mission sans date de début)" : formaterDate(m.date_debut)} et les dépendances.`}
            </p>
            {gantt ? (
              <figure className="mp-gantt" aria-labelledby="legende-gantt">
                <figcaption id="legende-gantt" className="mp-gantt__legende">
                  {tr(
                    `Diagramme de Gantt du ${formaterDate(gantt.debut)} au ${formaterDate(gantt.fin)} — le détail figure dans le tableau ci-dessous.`,
                    `Gantt chart from ${formaterDate(gantt.debut, "UTC", langue)} to ${formaterDate(gantt.fin, "UTC", langue)} — details are in the table below.`,
                  )}
                </figcaption>
                <ol className="mp-gantt__lignes" aria-hidden="true">
                  {taches.map((t) => {
                    const b = gantt.barres.get(t.id);
                    return (
                      <li key={t.id} className="mp-gantt__ligne">
                        <span className="mp-gantt__libelle">{t.libelle}</span>
                        <span className="mp-gantt__piste">
                          {b ? (
                            <span
                              className="mp-gantt__barre"
                              style={{ left: `${b.gauche}%`, width: `${b.largeur}%` }}
                            />
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                  {jalons
                    .filter((j) => gantt.jalons.has(j.id))
                    .map((j) => (
                      <li key={j.id} className="mp-gantt__ligne mp-gantt__ligne--jalon">
                        <span className="mp-gantt__libelle">{`${tr("Jalon", "Milestone")} : ${j.libelle}`}</span>
                        <span className="mp-gantt__piste">
                          <span
                            className="mp-gantt__jalon"
                            style={{ left: `${gantt.jalons.get(j.id)}%` }}
                          />
                        </span>
                      </li>
                    ))}
                </ol>
                <div className="mp-gantt__ligne" aria-hidden="true">
                  <span />
                  <span className="mp-gantt__axe">
                    <span>{formaterDate(gantt.debut, "UTC", langue)}</span>
                    <span>{formaterDate(gantt.fin, "UTC", langue)}</span>
                  </span>
                </div>
              </figure>
            ) : null}
            <Tableau
              legende={tr("Tâches par ordre chronologique", "Tasks in chronological order")}
              legendeVisible
              lignes={taches}
              cleLigne={(t) => t.id}
              colonnes={[
                {
                  cle: "tache",
                  entete: tr("Tâche", "Task"),
                  rendu: (t) => <span className="mp-coupure">{chemin(t.id)}</span>,
                },
                {
                  cle: "debut",
                  entete: tr("Début", "Start"),
                  rendu: (t) => formaterDate(t.debut, "UTC", langue),
                },
                {
                  cle: "fin",
                  entete: tr("Fin", "End"),
                  rendu: (t) => formaterDate(t.fin, "UTC", langue),
                },
                {
                  cle: "duree",
                  entete: tr("Durée", "Duration"),
                  alignement: "droite",
                  rendu: (t) =>
                    tr(
                      `${formaterNombre(t.duree_jours_ouvres, 0)} j ouvré(s)`,
                      `${formaterNombre(t.duree_jours_ouvres, 0, langue)} business d`,
                    ),
                },
                {
                  cle: "apres",
                  entete: tr("Après", "After"),
                  rendu: (t) => {
                    const pred = predecesseurs(t.id);
                    return pred.length ? (
                      <span className="mp-coupure">{pred.join(" ; ")}</span>
                    ) : (
                      "—"
                    );
                  },
                },
              ]}
            />
          </div>
        )}
      </Carte>

      <Carte titre={tr("Jalons", "Milestones")}>
        {jalons.length === 0 ? (
          <p className="mp-texte-doux">
            {tr(
              "Aucun jalon. Ajoutez-en depuis l'onglet Découpage.",
              "No milestones. Add some from the Work breakdown tab.",
            )}
          </p>
        ) : (
          <ul className="mp-liste-lignes">
            {jalons.map((j) => (
              <li key={j.id} className="mp-liste-lignes__ligne">
                <span className="mp-liste-lignes__texte">
                  <strong>{j.libelle}</strong>
                  <span className="mp-texte-doux">
                    {j.date_prevue
                      ? tr(
                          `Prévu le ${formaterDate(j.date_prevue)}`,
                          `Planned for ${formaterDate(j.date_prevue, "UTC", langue)}`,
                        )
                      : tr("Date à fixer", "Date to be set")}
                  </span>
                </span>
                <span>{j.atteint ? tr("Atteint", "Reached") : tr("À venir", "Upcoming")}</span>
              </li>
            ))}
          </ul>
        )}
      </Carte>

      <Carte titre={tr("Dépendances entre tâches", "Dependencies between tasks")}>
        <Dependances
          missionId={m.id}
          dependances={p.dependances.map((d) => ({
            ...d,
            predecesseur: chemin(d.predecesseur_id),
            successeur: chemin(d.successeur_id),
          }))}
          taches={situees.map((t) => ({ valeur: t.id, libelle: t.chemin }))}
          modifiable={droits.planifier}
        />
      </Carte>
    </div>
  );
}
