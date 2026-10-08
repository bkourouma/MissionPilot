import {
  ajouterJours,
  capacite,
  estDateSaisieModifiable,
  proposerSaisieSemaine,
  type ActiviteJour,
  type Periode,
  type ResultatPreRemplissage,
  type SaisieExistante,
} from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { chargerCalendrier, nombre } from "../missions/outils.js";
import { absencesValidees } from "../planification/charge.js";
import { collaborateurDe } from "../planification/outils.js";
import { jours as joursDe, moisClotures, semaineDe, lireParametresTemps } from "./outils.js";
import { lignesPreRemplies } from "./feuilles.js";

/*
 * PRÉ-REMPLISSAGE DES TEMPS (AUT-09) : SUGGESTION seulement.
 *
 * Cette fonction ne fait que lire : rien n'est enregistré, la feuille n'est ni créée ni
 * modifiée. Le consultant relit la proposition dans l'écran de saisie, l'ajuste puis
 * enregistre par le circuit habituel (PUT /feuilles-temps/:id/lignes, qui rejoue tous les
 * contrôles : tâche affectée, période clôturée, capacité).
 *
 * Sources :
 * - affectations nominatives de la semaine, comme `lignesPreRemplies` (TPS-01) ;
 * - activité du consultant sur la plateforme : SES commentaires, SES tâches de
 *   collaboration terminées et SES documents de mission déposés dans la semaine ;
 * - agenda : aucune source dans le dépôt (pas de connecteur de calendrier) ; la réponse le
 *   déclare (`sources.agenda = false`).
 * Seules les données du consultant connecté sont lues (jamais celles d'un collègue).
 */

export interface SuggestionSemaine extends ResultatPreRemplissage {
  readonly semaine: Periode;
  readonly collaborateurId: string;
  readonly feuilleModifiable: boolean;
  readonly granularite: "demi_journee" | "heure";
  readonly heuresParJour: number;
  readonly activiteIgnoree: number;
  readonly libelles: ReadonlyMap<string, { mission: string; tache: string }>;
}

/** Suggestion pour la semaine ISO contenant `date`, ou `null` si l'utilisateur n'a pas de fiche collaborateur. */
export async function suggererSemaine(
  db: Db,
  auth: Auth,
  date: string,
): Promise<SuggestionSemaine | null> {
  const semaine = semaineDe(date);
  const moi = await collaborateurDe(db, auth.utilisateurId);
  if (!moi) return null;
  const p = await lireParametresTemps(db, auth.cabinetId);
  const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(semaine.debut, i));
  const vide = { propositions: [], ecartees: [], totalJours: 0 };
  const base = {
    semaine,
    collaborateurId: moi.id,
    granularite: p.granularite,
    heuresParJour: p.heuresParJour,
    activiteIgnoree: 0,
    libelles: new Map<string, { mission: string; tache: string }>(),
  };

  // Une feuille soumise, validée ou verrouillée n'est plus modifiable : rien à proposer.
  const feuille = await db.query(
    "SELECT id, statut FROM feuilles_temps WHERE collaborateur_id = $1 AND semaine = $2",
    [moi.id, semaine.debut],
  );
  const statut = feuille.rows[0]?.statut as string | undefined;
  if (statut !== undefined && statut !== "brouillon" && statut !== "rejetee") {
    return { ...vide, ...base, feuilleModifiable: false };
  }

  const planifie = await lignesPreRemplies(db, auth.cabinetId, moi.id, semaine, p);

  // Tâches affectées au consultant (même règle que la saisie : une affectation nominative).
  const affectees = await db.query(
    `SELECT DISTINCT a.tache_id, a.mission_id, t.libelle AS tache, m.intitule AS mission
     FROM affectations a JOIN mission_taches t ON t.id = a.tache_id
     JOIN missions m ON m.id = a.mission_id
     WHERE a.collaborateur_id = $1 AND m.statut <> 'cloturee'`,
    [moi.id],
  );
  const libelles = new Map<string, { mission: string; tache: string }>(
    affectees.rows.map((l) => [
      l.tache_id as string,
      { mission: l.mission as string, tache: l.tache as string },
    ]),
  );

  // Lignes déjà saisies (hors activités d'absence : elles ne consomment pas la capacité).
  const saisies: SaisieExistante[] = feuille.rows[0]
    ? (
        await db.query(
          `SELECT l.date::text AS date, l.tache_id, l.centiemes
           FROM lignes_temps l LEFT JOIN activites_internes a ON a.id = l.activite_id
           WHERE l.feuille_id = $1 AND coalesce(a.est_absence, false) = false`,
          [feuille.rows[0].id],
        )
      ).rows.map((l) => ({
        date: l.date as string,
        tacheId: (l.tache_id as string | null) ?? null,
        jours: joursDe(l.centiemes),
      }))
    : [];

  // Capacité de chaque jour : calendrier du cabinet et absences validées.
  const calendrier = await chargerCalendrier(db, auth.cabinetId);
  const absences = (await absencesValidees(db, [moi.id], semaine)).get(moi.id) ?? [];
  const capaciteParJour = Object.fromEntries(
    jours.map((d) => [
      d,
      capacite({ debut: d, fin: d }, calendrier, absences, nombre(moi.capacite_pct)),
    ]),
  );
  const clotures = await moisClotures(db);
  const joursVerrouilles = jours.filter(
    (d) => !estDateSaisieModifiable(d, { moisClotures: clotures }),
  );

  const activite = await activiteDe(db, auth.utilisateurId, semaine);
  const resultat = proposerSaisieSemaine({
    semaine,
    granularite: p.granularite,
    heuresParJour: p.heuresParJour,
    planifie: planifie.map((l) => ({
      date: l.date,
      missionId: l.mission_id,
      tacheId: l.tache_id,
      jours: l.jours,
    })),
    activite,
    tachesAffectees: affectees.rows.map((l) => ({
      missionId: l.mission_id as string,
      tacheId: l.tache_id as string,
    })),
    saisies,
    capaciteParJour,
    joursVerrouilles,
  });
  return {
    ...resultat,
    ...base,
    libelles,
    feuilleModifiable: true,
    activiteIgnoree: resultat.ecartees.filter((e) => e.motif === "tache_non_affectee").length,
  };
}

/**
 * Activité propre de l'utilisateur dans la semaine (jours en UTC, comme les indicateurs) :
 * un enregistrement par jour, mission et tâche.
 */
async function activiteDe(
  db: Db,
  utilisateurId: string,
  semaine: Periode,
): Promise<ActiviteJour[]> {
  const debut = semaine.debut;
  const fin = ajouterJours(semaine.fin, 1);
  const r = await db.query(
    `SELECT jour, mission_id, tache_id, count(*)::int AS n FROM (
       SELECT (cree_le AT TIME ZONE 'UTC')::date::text AS jour, mission_id, tache_id
       FROM commentaires
       WHERE auteur_id = $1 AND mission_id IS NOT NULL
         AND (cree_le AT TIME ZONE 'UTC')::date >= $2 AND (cree_le AT TIME ZONE 'UTC')::date < $3
       UNION ALL
       SELECT (fait_le AT TIME ZONE 'UTC')::date::text, mission_id, tache_id
       FROM taches_collaboration
       WHERE assignee_id = $1 AND mission_id IS NOT NULL AND fait_le IS NOT NULL
         AND (fait_le AT TIME ZONE 'UTC')::date >= $2 AND (fait_le AT TIME ZONE 'UTC')::date < $3
       UNION ALL
       SELECT (cree_le AT TIME ZONE 'UTC')::date::text, mission_id, NULL::uuid
       FROM mission_documents
       WHERE auteur_id = $1
         AND (cree_le AT TIME ZONE 'UTC')::date >= $2 AND (cree_le AT TIME ZONE 'UTC')::date < $3
     ) x GROUP BY jour, mission_id, tache_id ORDER BY jour, mission_id, tache_id`,
    [utilisateurId, debut, fin],
  );
  return r.rows.map((l) => ({
    date: l.jour as string,
    missionId: l.mission_id as string,
    tacheId: (l.tache_id as string | null) ?? null,
    evenements: l.n as number,
  }));
}
