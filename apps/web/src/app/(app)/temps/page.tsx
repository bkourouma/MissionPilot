import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { NavigationSemaine } from "../../../components/temps/NavigationSemaine";
import { Alerte } from "../../../components/ui/Alerte";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDateHeure, formaterJours } from "../../../lib/format";
import type { MonPlanning } from "../../../lib/planification";
import { joursDeLaSemaine, libelleDateCourte, lireSemaine } from "../../../lib/semaine";
import { exigerPermission } from "../../../lib/session";
import {
  actionsFeuille,
  NOM_UNITE,
  STATUT_FEUILLE,
  STATUT_PARTIE,
  type SemaineTemps,
  type TacheAffectee,
} from "../../../lib/temps";
import { PreparationFeuille, ResteAFaire, type TacheReste } from "./ActionsFeuille";
import { GrilleTemps } from "./GrilleTemps";

export const metadata: Metadata = { title: "Feuille de temps" };

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
  const semaine = lireSemaine((await searchParams).semaine);
  const q = semaine ? `?semaine=${semaine}` : "";
  const [r, planning] = await Promise.all([
    chargerServeur<SemaineTemps>(`/api/feuilles-temps/semaine${q}`),
    chargerServeur<MonPlanning>(`/api/mon-planning${q}`),
  ]);
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Feuille de temps" />
        <EtatErreur
          titre="Votre feuille de temps n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={`/temps${q}`}
        />
      </div>
    );
  }
  const s = r.donnees;
  const f = s.feuille;
  const statut = f ? STATUT_FEUILLE[f.statut] : null;
  const actions = actionsFeuille(f, utilisateur.id);
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
          libelle: l.tache.libelle ?? "Tâche",
          mission: l.mission.intitule ?? "Mission",
          dernier: declarations.get(l.tache.id) ?? null,
        },
      ]),
    ).values(),
  ];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Feuille de temps"
        soustitre={`Saisie en ${NOM_UNITE[s.unite_saisie_temps]}${s.unite_saisie_temps === "heure" ? ` (journée de ${s.heures_par_jour} h)` : ""}. Le brouillon s'enregistre tout seul, même hors connexion.`}
        badges={
          statut ? <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut> : null
        }
      />
      <NavigationSemaine
        base="/temps"
        semaine={s.semaine}
        libelle="Changer de semaine de la feuille"
      />

      {!s.collaborateur ? (
        <EtatVide
          titre="Aucune fiche collaborateur n'est rattachée à votre compte."
          icone="personnes"
        >
          <p>
            La saisie des temps sera possible quand votre compte sera lié à votre fiche dans le
            référentiel des collaborateurs.
          </p>
        </EtatVide>
      ) : !f ? (
        <Carte titre="Votre feuille de la semaine">
          <div className="mp-pile">
            {s.pre_remplissage.length > 0 ? (
              <>
                <p>
                  Vos affectations proposent {s.pre_remplissage.length} ligne(s). Vous pourrez les
                  ajuster avant de soumettre.
                </p>
                <ul className="mp-liste-simple">
                  {s.pre_remplissage.map((l) => (
                    <li key={`${l.date}-${l.tache_id}`}>
                      {`${libelleDateCourte(l.date)} — ${l.tache_libelle ?? "Tâche"} (${l.mission_intitule ?? "Mission"}) : ${formaterJours(l.jours)}`}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mp-texte-doux">
                Aucune affectation à reporter cette semaine : vous partirez d&apos;une feuille vide
                (activités internes, congés…).
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
              titre="Feuille rejetée : à corriger puis resoumettre"
              annonce="aucune"
            >
              {f.motif_rejet ? (
                <p className="mp-texte-preserve">{`Motif : ${f.motif_rejet}`}</p>
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
            <Alerte tonalite="info" titre="Feuille soumise" annonce="aucune">
              <p>
                {`Soumise le ${formaterDateHeure(f.soumise_le)}. Elle n'est plus modifiable : votre chef de mission la valide ou la rejette avec un motif.`}
              </p>
            </Alerte>
          ) : f.statut === "validee" || f.statut === "verrouillee" ? (
            <Alerte tonalite="succes" titre={STATUT_FEUILLE[f.statut].libelle} annonce="aucune">
              <p>
                Pour modifier des temps validés, faites une{" "}
                <Link href="/temps/corrections">demande de correction</Link>.
              </p>
            </Alerte>
          ) : null}

          {s.jours_clotures.length > 0 ? (
            <Alerte tonalite="info" titre="Jours clôturés" annonce="aucune">
              <p>
                {`${s.jours_clotures.map(libelleDateCourte).join(", ")} : période clôturée, saisie verrouillée.`}
              </p>
            </Alerte>
          ) : null}

          <Carte titre="Temps de la semaine">
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
            />
          </Carte>

          {f.parties.length > 0 && f.statut !== "brouillon" ? (
            <Carte titre="Validation par mission">
              <ul className="mp-liste-lignes">
                {f.parties.map((p) => (
                  <li key={p.mission_id ?? "interne"} className="mp-liste-lignes__ligne">
                    <span className="mp-liste-lignes__texte">
                      <strong>{p.intitule}</strong>
                      {p.decide_le ? (
                        <span className="mp-texte-doux">{`Décidée le ${formaterDateHeure(p.decide_le)}`}</span>
                      ) : null}
                    </span>
                    {p.statut ? (
                      <BadgeStatut tonalite={STATUT_PARTIE[p.statut].tonalite}>
                        {STATUT_PARTIE[p.statut].libelle}
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
        <Carte titre="Reste à faire">
          <div className="mp-pile">
            <p className="mp-texte-doux">
              Combien de jours vous reste-t-il sur chaque tâche ? L&apos;atterrissage de la mission
              (réalisé + reste à faire) en dépend.
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
