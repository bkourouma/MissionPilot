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
import { formaterDate, formaterJours } from "../../../lib/format";
import {
  groupesParMission,
  STATUT_ABSENCE,
  TYPE_ABSENCE_LIBELLES,
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

export const metadata: Metadata = { title: "Mon planning" };

export default async function PageMonPlanning({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("temps.saisir");
  const semaine = lireSemaine((await searchParams).semaine);
  const r = await chargerServeur<MonPlanning>(
    `/api/mon-planning${semaine ? `?semaine=${semaine}` : ""}`,
  );
  const reessayer = semaine ? `/planning?semaine=${semaine}` : "/planning";

  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Mon planning" />
        <EtatErreur
          titre="Votre planning n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={reessayer}
        />
      </div>
    );
  }
  const p = r.donnees;
  const groupes = groupesParMission(p.lignes);
  const depasse = p.capacite !== null && p.jours_affectes > p.capacite;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Mon planning"
        soustitre="Vos tâches et jours alloués de la semaine, vos absences et les jours fériés."
        actions={
          p.collaborateur ? (
            <Link href={`/temps?semaine=${p.semaine.debut}`} className={classesBouton("primaire")}>
              <Icone nom="horloge" />
              <span>Saisir mes temps</span>
            </Link>
          ) : null
        }
      />
      <NavigationSemaine
        base="/planning"
        semaine={p.semaine}
        libelle="Changer de semaine du planning"
      />

      {!p.collaborateur ? (
        <EtatVide
          titre="Aucune fiche collaborateur n'est rattachée à votre compte."
          icone="personnes"
        >
          <p>
            Votre planning apparaîtra quand le responsable des ressources aura lié votre compte à
            votre fiche dans le référentiel des collaborateurs.
          </p>
        </EtatVide>
      ) : (
        <>
          <ul className="mp-totaux" aria-label="Synthèse de la semaine">
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">Jours alloués</span>
              <span className="mp-totaux__valeur">{formaterJours(p.jours_affectes)}</span>
            </li>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">Capacité de la semaine</span>
              <span className="mp-totaux__valeur">{formaterJours(p.capacite)}</span>
            </li>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">Tâches</span>
              <span className="mp-totaux__valeur">{p.lignes.length}</span>
            </li>
          </ul>
          {depasse ? (
            <Alerte tonalite="attention" titre="Semaine chargée" annonce="aucune">
              <p>
                Vos jours alloués dépassent votre capacité de la semaine (jours fériés et absences
                validées déduits). Parlez-en à votre chef de mission.
              </p>
            </Alerte>
          ) : null}

          <section aria-labelledby="titre-taches" className="mp-pile">
            <h2 id="titre-taches" className="mp-section__titre">
              Vos tâches de la semaine
            </h2>
            {groupes.length === 0 ? (
              <EtatVide titre="Aucune tâche affectée cette semaine." icone="calendrier">
                <p>
                  Vos affectations apparaissent ici dès qu&apos;un chef de mission vous attribue des
                  jours sur une tâche.
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
                                {l.tache.libelle ?? "Tâche non accessible"}
                              </strong>
                              <span className="mp-texte-doux">
                                {[
                                  l.tache.phase_libelle,
                                  `affectation de ${formaterJours(l.affectation.jours_alloues)} du ${formaterDate(l.affectation.date_debut)} au ${formaterDate(l.affectation.date_fin)}`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </span>
                            <span className="mp-total-jours">
                              {formaterJours(l.jours_alloues_semaine)}
                              <span className="mp-visuellement-cache"> cette semaine</span>
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
              Jour par jour
            </h2>
            <ol className="mp-jours-semaine">
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
                      {libelleJourLong(date)}
                      {aujourdhui ? (
                        <span className="mp-jours-semaine__marque">Aujourd&apos;hui</span>
                      ) : null}
                    </span>
                    <span className="mp-jours-semaine__infos">
                      {feries.map((f) => (
                        <BadgeStatut key={f.date + f.libelle} tonalite="neutre" sansIcone>
                          <span className="mp-badge__interne">
                            <Icone nom="drapeau" taille={14} />
                            {`Férié : ${f.libelle}`}
                          </span>
                        </BadgeStatut>
                      ))}
                      {absences.map((a) => (
                        <BadgeStatut key={a.id} tonalite={STATUT_ABSENCE[a.statut].tonalite}>
                          {`${TYPE_ABSENCE_LIBELLES[a.type]} (${STATUT_ABSENCE[a.statut].libelle.toLowerCase()})`}
                        </BadgeStatut>
                      ))}
                      {feries.length === 0 && absences.length === 0 ? (
                        <span className="mp-texte-doux">Aucun événement</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            {aPermission(utilisateur.roles, "conges.demander") ? (
              <p className="mp-texte-doux">
                <Link href="/planning/conges">Demander un congé ou une absence</Link>
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
