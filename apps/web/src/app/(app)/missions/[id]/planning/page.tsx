import type { Metadata } from "next";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
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

export const metadata: Metadata = { title: "Planning de la mission" };

export default async function PagePlanning({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("mission.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsMission(m, utilisateur.roles, utilisateur.id);
  const [planning, decoupage] = await Promise.all([
    chargerServeur<Planning>(`/api/missions/${m.id}/planning`),
    chargerServeur<Decoupage>(`/api/missions/${m.id}/decoupage`),
  ]);
  if (!planning.ok) {
    return (
      <EtatErreur
        titre="Le planning n'a pas pu être calculé."
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
    "Tâche";
  const taches = tachesChronologiques(p.taches);
  const jalons = [...p.jalons].sort((a, b) =>
    (a.date_prevue ?? "9999").localeCompare(b.date_prevue ?? "9999"),
  );
  const gantt = geometrieGantt(taches, jalons);
  const predecesseurs = (tid: string) =>
    p.dependances.filter((d) => d.successeur_id === tid).map((d) => chemin(d.predecesseur_id));

  return (
    <div className="mp-pile mp-pile--large">
      <Carte titre="Planning">
        {taches.length === 0 ? (
          <EtatVide titre="Aucune tâche à planifier." icone="calendrier">
            <p>Ajoutez des tâches dans l&apos;onglet Découpage.</p>
          </EtatVide>
        ) : (
          <div className="mp-pile">
            <p className="mp-texte-doux">
              {`Dates au plus tôt en jours ouvrés du cabinet, calculées depuis le ${formaterDate(m.date_debut) === "—" ? "jour même (mission sans date de début)" : formaterDate(m.date_debut)} et les dépendances.`}
            </p>
            {gantt ? (
              <figure className="mp-gantt" aria-labelledby="legende-gantt">
                <figcaption id="legende-gantt" className="mp-gantt__legende">
                  {`Diagramme de Gantt du ${formaterDate(gantt.debut)} au ${formaterDate(gantt.fin)} — le détail figure dans le tableau ci-dessous.`}
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
                        <span className="mp-gantt__libelle">{`Jalon : ${j.libelle}`}</span>
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
                    <span>{formaterDate(gantt.debut)}</span>
                    <span>{formaterDate(gantt.fin)}</span>
                  </span>
                </div>
              </figure>
            ) : null}
            <Tableau
              legende="Tâches par ordre chronologique"
              legendeVisible
              lignes={taches}
              cleLigne={(t) => t.id}
              colonnes={[
                {
                  cle: "tache",
                  entete: "Tâche",
                  rendu: (t) => <span className="mp-coupure">{chemin(t.id)}</span>,
                },
                { cle: "debut", entete: "Début", rendu: (t) => formaterDate(t.debut) },
                { cle: "fin", entete: "Fin", rendu: (t) => formaterDate(t.fin) },
                {
                  cle: "duree",
                  entete: "Durée",
                  alignement: "droite",
                  rendu: (t) => `${formaterNombre(t.duree_jours_ouvres, 0)} j ouvré(s)`,
                },
                {
                  cle: "apres",
                  entete: "Après",
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

      <Carte titre="Jalons">
        {jalons.length === 0 ? (
          <p className="mp-texte-doux">Aucun jalon. Ajoutez-en depuis l&apos;onglet Découpage.</p>
        ) : (
          <ul className="mp-liste-lignes">
            {jalons.map((j) => (
              <li key={j.id} className="mp-liste-lignes__ligne">
                <span className="mp-liste-lignes__texte">
                  <strong>{j.libelle}</strong>
                  <span className="mp-texte-doux">
                    {j.date_prevue ? `Prévu le ${formaterDate(j.date_prevue)}` : "Date à fixer"}
                  </span>
                </span>
                <span>{j.atteint ? "Atteint" : "À venir"}</span>
              </li>
            ))}
          </ul>
        )}
      </Carte>

      <Carte titre="Dépendances entre tâches">
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
