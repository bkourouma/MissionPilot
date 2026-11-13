import Link from "next/link";
import type { Metadata } from "next";
import { aPermission, creerTraduire } from "@missionpilot/shared";
import { SaisiesEnAttente } from "../../../components/hors-ligne/SaisiesEnAttente";
import { NavigationSemaine } from "../../../components/temps/NavigationSemaine";
import { Alerte } from "../../../components/ui/Alerte";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../components/ui/EtatListe";
import { obtenirLangue } from "../../../lib/i18n/serveur";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDateHeure, formaterJours } from "../../../lib/format";
import type { MonPlanning } from "../../../lib/planification";
import { joursDeLaSemaine, libelleDateCourte, lireSemaine } from "../../../lib/semaine";
import { exigerPermission } from "../../../lib/session";
import {
  actionsFeuille,
  nomUnite,
  statutFeuille,
  statutPartie,
  type SemaineTemps,
  type TacheAffectee,
} from "../../../lib/temps";
import { PreparationFeuille, ResteAFaire, type TacheReste } from "./ActionsFeuille";
import { GrilleTemps } from "./GrilleTemps";

export async function generateMetadata(): Promise<Metadata> {
  const t = creerTraduire(await obtenirLangue());
  return { title: t("Feuille de temps", "Timesheet") };
}

interface Declaration {
  tache_id: string;
  collaborateur_id: string;
  semaine: string;
  jours: number;
}

/** Dernière déclaration de reste à faire de l'utilisateur, par tâche, pour ces missions. */
async function dernieresDeclarations(
  missions: string[],
  collaborateurId: string,
): Promise<Map<string, { jours: number; semaine: string }>> {
  const resultats = await Promise.all(
    missions.map((id) =>
      chargerServeur<{ elements: Declaration[] }>(`/api/missions/${id}/reste-a-faire?limite=200`),
    ),
  );
  const parTache = new Map<string, { jours: number; semaine: string }>();
  for (const r of resultats) {
    if (!r.ok) continue;
    // Les déclarations arrivent de la plus récente à la plus ancienne.
    for (const d of r.donnees.elements) {
      if (d.collaborateur_id !== collaborateurId || parTache.has(d.tache_id)) continue;
      parTache.set(d.tache_id, { jours: d.jours, semaine: d.semaine });
    }
  }
  return parTache;
}

export default async function PageFeuilleDeTemps({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("temps.saisir");
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const semaine = lireSemaine((await searchParams).semaine);
  const q = semaine ? `?semaine=${semaine}` : "";
  const [r, planning] = await Promise.all([
    chargerServeur<SemaineTemps>(`/api/feuilles-temps/semaine${q}`),
    chargerServeur<MonPlanning>(`/api/mon-planning${q}`),
  ]);
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Feuille de temps", "Timesheet")} />
        <EtatErreur
          titre={t(
            "Votre feuille de temps n'a pas pu être chargée.",
            "Your timesheet could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={`/temps${q}`}
        />
      </div>
    );
  }
  const s = r.donnees;
  const f = s.feuille;
  const statut = f ? statutFeuille(f.statut, langue) : null;
  const actions = actionsFeuille(f, utilisateur.id, langue);
  const lignesPlanning = planning.ok ? planning.donnees.lignes : [];
  const taches: TacheAffectee[] = lignesPlanning
    .filter((l) => l.tache.libelle !== null)
    .map((l) => ({
      tache_id: l.tache.id,
      tache_libelle: l.tache.libelle,
      mission_id: l.mission.id,
      mission_intitule: l.mission.intitule,
    }));

  // Reste à faire : tâches des missions accessibles (l'API refuse les autres).
  const accessibles = lignesPlanning.filter(
    (l) => l.mission.accessible && l.mission.statut !== "cloturee" && l.tache.libelle,
  );
  const declarations =
    s.collaborateur && aPermission(utilisateur.roles, "budget.lire_jours")
      ? await dernieresDeclarations(
          [...new Set(accessibles.map((l) => l.mission.id))],
          s.collaborateur.id,
        )
      : new Map<string, { jours: number; semaine: string }>();
  const tachesReste: TacheReste[] = [
    ...new Map(
      accessibles.map((l) => [
        l.tache.id,
        {
          tache_id: l.tache.id,
          mission_id: l.mission.id,
          libelle: l.tache.libelle ?? t("Tâche", "Task"),
          mission: l.mission.intitule ?? t("Mission", "Engagement"),
          dernier: declarations.get(l.tache.id) ?? null,
        },
      ]),
    ).values(),
  ];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Feuille de temps", "Timesheet")}
        soustitre={t(
          `Saisie en ${nomUnite(s.unite_saisie_temps)}${s.unite_saisie_temps === "heure" ? ` (journée de ${s.heures_par_jour} h)` : ""}. Le brouillon s'enregistre tout seul, même hors connexion.`,
          `Entry in ${nomUnite(s.unite_saisie_temps, langue)}${s.unite_saisie_temps === "heure" ? ` (${s.heures_par_jour}-hour day)` : ""}. The draft saves itself, even offline.`,
        )}
        badges={
          statut ? <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut> : null
        }
      />
      <NavigationSemaine
        base="/temps"
        semaine={s.semaine}
        libelle={t("Changer de semaine de la feuille", "Change the timesheet week")}
      />

      {s.collaborateur ? (
        <SaisiesEnAttente utilisateurId={utilisateur.id} feuilleCouranteId={f?.id ?? null} />
      ) : null}

      {!s.collaborateur ? (
        <EtatVide
          titre={t(
            "Aucune fiche collaborateur n'est rattachée à votre compte.",
            "No employee record is linked to your account.",
          )}
          icone="personnes"
        >
          <p>
            {t(
              "La saisie des temps sera possible quand votre compte sera lié à votre fiche dans le référentiel des collaborateurs.",
              "Time entry will be possible once your account is linked to your record in the employee directory.",
            )}
          </p>
        </EtatVide>
      ) : !f ? (
        <Carte titre={t("Votre feuille de la semaine", "Your timesheet for the week")}>
          <div className="mp-pile">
            {s.pre_remplissage.length > 0 ? (
              <>
                <p>
                  {t(
                    `Vos affectations proposent ${s.pre_remplissage.length} ligne(s). Vous pourrez les ajuster avant de soumettre.`,
                    `Your assignments suggest ${s.pre_remplissage.length} row(s). You can adjust them before submitting.`,
                  )}
                </p>
                <ul className="mp-liste-simple">
                  {s.pre_remplissage.map((l) => (
                    <li key={`${l.date}-${l.tache_id}`}>
                      {`${libelleDateCourte(l.date, langue)} — ${l.tache_libelle ?? t("Tâche", "Task")} (${l.mission_intitule ?? t("Mission", "Engagement")}) : ${formaterJours(l.jours, langue)}`}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mp-texte-doux">
                {t(
                  "Aucune affectation à reporter cette semaine : vous partirez d'une feuille vide (activités internes, congés…).",
                  "No assignment to carry over this week: you will start from an empty timesheet (internal activities, leave…).",
                )}
              </p>
            )}
            <PreparationFeuille
              semaine={s.semaine.debut}
              prerempli={s.pre_remplissage.length > 0}
            />
          </div>
        </Carte>
      ) : (
        <>
          {f.statut === "rejetee" ? (
            <Alerte
              tonalite="danger"
              titre={t(
                "Feuille rejetée : à corriger puis resoumettre",
                "Timesheet rejected: correct it, then resubmit",
              )}
              annonce="aucune"
            >
              {f.motif_rejet ? (
                <p className="mp-texte-preserve">
                  {t(`Motif : ${f.motif_rejet}`, `Reason: ${f.motif_rejet}`)}
                </p>
              ) : null}
              {f.parties
                .filter((p) => p.statut === "rejetee" && p.motif && p.motif !== f.motif_rejet)
                .map((p) => (
                  <p key={p.mission_id ?? "interne"} className="mp-texte-preserve">
                    {`${p.intitule} : ${p.motif}`}
                  </p>
                ))}
            </Alerte>
          ) : f.statut === "soumise" ? (
            <Alerte
              tonalite="info"
              titre={t("Feuille soumise", "Timesheet submitted")}
              annonce="aucune"
            >
              <p>
                {t(
                  `Soumise le ${formaterDateHeure(f.soumise_le, "Africa/Abidjan", langue)}. Elle n'est plus modifiable : votre chef de mission la valide ou la rejette avec un motif.`,
                  `Submitted on ${formaterDateHeure(f.soumise_le, "Africa/Abidjan", langue)}. It can no longer be edited: your engagement manager approves it or rejects it with a reason.`,
                )}
              </p>
            </Alerte>
          ) : f.statut === "validee" || f.statut === "verrouillee" ? (
            <Alerte
              tonalite="succes"
              titre={statutFeuille(f.statut, langue).libelle}
              annonce="aucune"
            >
              <p>
                {t(
                  "Pour modifier des temps validés, faites une ",
                  "To change approved time, make a ",
                )}
                <Link href="/temps/corrections">
                  {t("demande de correction", "correction request")}
                </Link>
                .
              </p>
            </Alerte>
          ) : null}

          {s.jours_clotures.length > 0 ? (
            <Alerte tonalite="info" titre={t("Jours clôturés", "Closed days")} annonce="aucune">
              <p>
                {t(
                  `${s.jours_clotures.map((d) => libelleDateCourte(d, langue)).join(", ")} : période clôturée, saisie verrouillée.`,
                  `${s.jours_clotures.map((d) => libelleDateCourte(d, langue)).join(", ")}: closed period, entry locked.`,
                )}
              </p>
            </Alerte>
          ) : null}

          <Carte titre={t("Temps de la semaine", "Time for the week")}>
            <GrilleTemps
              key={`${f.id}-${f.statut}-${f.cycle}`}
              feuille={f}
              unite={s.unite_saisie_temps}
              jours={joursDeLaSemaine(s.semaine.debut)}
              joursClotures={s.jours_clotures}
              activites={s.activites}
              taches={actions.modifier ? taches : []}
              modifiable={actions.modifier}
              libelleSoumettre={actions.libelleSoumettre}
              utilisateurId={utilisateur.id}
            />
          </Carte>

          {f.parties.length > 0 && f.statut !== "brouillon" ? (
            <Carte titre={t("Validation par mission", "Approval by engagement")}>
              <ul className="mp-liste-lignes">
                {f.parties.map((p) => (
                  <li key={p.mission_id ?? "interne"} className="mp-liste-lignes__ligne">
                    <span className="mp-liste-lignes__texte">
                      <strong>{p.intitule}</strong>
                      {p.decide_le ? (
                        <span className="mp-texte-doux">
                          {t(
                            `Décidée le ${formaterDateHeure(p.decide_le, "Africa/Abidjan", langue)}`,
                            `Decided on ${formaterDateHeure(p.decide_le, "Africa/Abidjan", langue)}`,
                          )}
                        </span>
                      ) : null}
                    </span>
                    {p.statut ? (
                      <BadgeStatut tonalite={statutPartie(p.statut, langue).tonalite}>
                        {statutPartie(p.statut, langue).libelle}
                      </BadgeStatut>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Carte>
          ) : null}
        </>
      )}

      {s.collaborateur &&
      tachesReste.length > 0 &&
      aPermission(utilisateur.roles, "budget.lire_jours") ? (
        <Carte titre={t("Reste à faire", "Remaining work")}>
          <div className="mp-pile">
            <p className="mp-texte-doux">
              {t(
                "Combien de jours vous reste-t-il sur chaque tâche ? L'atterrissage de la mission (réalisé + reste à faire) en dépend.",
                "How many days do you have left on each task? The engagement forecast (actuals + remaining work) depends on it.",
              )}
            </p>
            <ResteAFaire
              taches={tachesReste}
              semaine={s.semaine.debut}
              unite={s.unite_saisie_temps}
            />
          </div>
        </Carte>
      ) : null}
    </div>
  );
}
