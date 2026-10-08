import type { FastifyPluginAsync } from "fastify";
import {
  ajouterJours,
  capacite,
  joursAffectesSurPeriode,
  lundiDeLaSemaine,
  SEUILS_CHARGE_DEFAUT,
  sommerJours,
  surcharges,
  type LigneCharge,
} from "@missionpilot/engines";
import { monPlanningQuerySchema, planDeChargeQuerySchema } from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  exigerMissionVisible,
  filtreVisibilite,
  voitToutesLesMissions,
} from "../missions/acces.js";
import { aujourdhui, chargerCalendrier, nombre } from "../missions/outils.js";
import {
  absencesValidees,
  affectationsDe,
  calculerPlan,
  periodeDuPlan,
  type CollaborateurPlan,
} from "../planification/charge.js";
import { collaborateurDe } from "../planification/outils.js";

type QueryPlan = ReturnType<typeof planDeChargeQuerySchema.parse>;

/**
 * Page de collaborateurs actifs du plan de charge (pagination par curseur sur
 * le nom). `equipe` : collaborateurs affectés nominativement à une mission,
 * qui doit être visible de l'utilisateur (sinon 404). Aucune donnée
 * financière n'est lue.
 *
 * Curseur (F5) : il ne porte que l'identifiant du dernier collaborateur servi
 * (clé de tri vide), la position (nom, id) est relue en base. Un nom de 160
 * caractères multi-octets ne rend donc plus le curseur indécodable (> 500
 * caractères en base64url).
 */
async function pageCollaborateurs(db: Db, auth: Auth, q: QueryPlan) {
  if (q.equipe) await exigerMissionVisible(db, auth, q.equipe);
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT c.id, c.nom, c.type, c.capacite_pct, c.grade_id, g.code AS grade_code,
       g.libelle AS grade_libelle, '' AS cle_tri
     FROM collaborateurs c LEFT JOIN grades g ON g.id = c.grade_id
     WHERE c.actif
       AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM affectations a
                                        WHERE a.collaborateur_id = c.id AND a.mission_id = $1))
       AND ($2::uuid IS NULL OR c.grade_id = $2)
       AND ($3::text IS NULL OR c.type = $3)
       AND ($4::uuid IS NULL
            OR (lower(c.nom), c.id) > (SELECT lower(x.nom), x.id FROM collaborateurs x WHERE x.id = $4))
     ORDER BY lower(c.nom), c.id
     LIMIT $5`,
    [q.equipe ?? null, q.grade_id ?? null, q.type ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  return paginer(r.rows as (CollaborateurPlan & { cle_tri: string; id: string })[], q.limite);
}

const cellulesVues = (l: LigneCharge) =>
  l.cellules.map((c) => ({
    semaine: c.semaine.debut,
    capacite: c.capacite,
    jours_affectes: c.joursAffectes,
    taux_occupation: c.tauxOccupation,
    etat: c.etat,
  }));

/** Plan de charge (PLN-06) et « Mon planning » (PLN-10). */
export const routesPlanDeCharge: FastifyPluginAsync = async (app) => {
  app.get("/plan-de-charge", async (request) => {
    const auth = exiger(request, "charge.lire");
    const q = planDeChargeQuerySchema.parse(request.query);
    const periode = periodeDuPlan(q.debut, q.fin);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const page = await pageCollaborateurs(db, auth, q);
      const collaborateurs = page.elements as unknown as (CollaborateurPlan &
        Record<string, unknown>)[];
      const grille = await calculerPlan(db, auth.cabinetId, collaborateurs, periode);
      const parId = new Map(grille.map((l) => [l.collaborateurId, l]));
      return {
        debut: periode.debut,
        fin: periode.fin,
        seuils: {
          surcharge_pct: SEUILS_CHARGE_DEFAUT.surchargePct,
          sous_occupation_pct: SEUILS_CHARGE_DEFAUT.sousOccupationPct,
        },
        semaines: (grille[0]?.cellules ?? []).map((c) => c.semaine.debut),
        elements: collaborateurs.map((c) => ({
          collaborateur: {
            id: c.id,
            nom: c.nom,
            type: c.type,
            capacite_pct: c.capacite_pct,
            grade_id: c.grade_id,
            grade_code: c.grade_code,
            grade_libelle: c.grade_libelle,
          },
          cellules: cellulesVues(parId.get(c.id) as LigneCharge),
        })),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });

  /** Cellules en surcharge (PLN-06), sur la même page de collaborateurs que le plan. */
  app.get("/plan-de-charge/surcharges", async (request) => {
    const auth = exiger(request, "charge.lire");
    const q = planDeChargeQuerySchema.parse(request.query);
    const periode = periodeDuPlan(q.debut, q.fin);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const page = await pageCollaborateurs(db, auth, q);
      const collaborateurs = page.elements as unknown as CollaborateurPlan[];
      const noms = new Map(collaborateurs.map((c) => [c.id, c.nom]));
      const grille = await calculerPlan(db, auth.cabinetId, collaborateurs, periode);
      return {
        debut: periode.debut,
        fin: periode.fin,
        elements: surcharges(grille).map((s) => ({
          collaborateur_id: s.collaborateurId,
          collaborateur_nom: noms.get(s.collaborateurId),
          semaine: s.semaine,
          jours_affectes: s.joursAffectes,
          capacite: s.capacite,
        })),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });

  /**
   * « Mon planning » (PLN-10) : la semaine de l'utilisateur connecté, et
   * uniquement ses propres affectations. Les lignes {mission, tâche,
   * jours_alloues_semaine} servent à pré-remplir la feuille de temps (TPS-01).
   *
   * Visibilité (F4) : la règle de missions/acces.ts est appliquée à chaque
   * mission. Une affectation nominative de l'utilisateur reste listée même si
   * la mission lui est invisible (une affectation créée par le responsable des
   * ressources n'ouvre pas l'équipe) : son propre planning est son droit, et
   * la saisie des temps en a besoin. Elle n'expose alors que l'intitulé de la
   * mission et le libellé de la tâche ; le statut de la mission et la phase
   * sont masqués (null) et `mission.accessible` vaut false. Une mission
   * invisible ET clôturée n'est plus « active » (aucun temps à y saisir) :
   * son intitulé et le libellé de la tâche sont masqués aussi.
   */
  app.get("/mon-planning", async (request) => {
    const auth = exiger(request);
    const q = monPlanningQuerySchema.parse(request.query);
    const debut = lundiDeLaSemaine(q.semaine ?? aujourdhui());
    const semaine = { debut, fin: ajouterJours(debut, 6) };
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const calendrier = await chargerCalendrier(db, auth.cabinetId);
      const feries = await db.query(
        `SELECT date::text AS date, libelle FROM cabinet_feries
         WHERE date BETWEEN $1 AND $2 ORDER BY date`,
        [semaine.debut, semaine.fin],
      );
      const moi = await collaborateurDe(db, auth.utilisateurId);
      if (!moi) {
        return {
          semaine,
          collaborateur: null,
          lignes: [],
          absences: [],
          feries: feries.rows,
          capacite: null,
          jours_affectes: 0,
        };
      }
      const details = await db.query(
        `SELECT a.id, a.mission_id, a.tache_id,
           CASE WHEN ${filtreVisibilite(4, 5)} OR m.statut <> 'cloturee' THEN m.intitule
           END AS mission_intitule,
           CASE WHEN ${filtreVisibilite(4, 5)} OR m.statut <> 'cloturee' THEN t.libelle
           END AS tache_libelle,
           ${filtreVisibilite(4, 5)} AS mission_accessible,
           CASE WHEN ${filtreVisibilite(4, 5)} THEN m.statut END AS mission_statut,
           CASE WHEN ${filtreVisibilite(4, 5)} THEN p.libelle END AS phase_libelle
         FROM affectations a
         JOIN missions m ON m.id = a.mission_id
         JOIN mission_taches t ON t.id = a.tache_id
         JOIN mission_phases p ON p.id = t.phase_id
         WHERE a.collaborateur_id = $1 AND a.date_debut <= $3 AND a.date_fin >= $2`,
        [moi.id, semaine.debut, semaine.fin, voitToutesLesMissions(auth), auth.utilisateurId],
      );
      const affectations = await affectationsDe(db, [moi.id], semaine);
      const parId = new Map(details.rows.map((d) => [d.id as string, d]));
      const lignes = affectations
        .map((a) => {
          const d = parId.get(a.id) as Record<string, unknown>;
          return {
            affectation_id: a.id,
            mission: {
              id: d.mission_id,
              intitule: d.mission_intitule,
              statut: d.mission_statut,
              accessible: d.mission_accessible === true,
            },
            tache: { id: a.tacheId, libelle: d.tache_libelle, phase_libelle: d.phase_libelle },
            jours_alloues_semaine: joursAffectesSurPeriode(a, semaine, calendrier),
            affectation: { jours_alloues: a.joursAlloues, date_debut: a.debut, date_fin: a.fin },
          };
        })
        .sort(
          (x, y) =>
            String(x.mission.intitule).localeCompare(String(y.mission.intitule), "fr") ||
            String(x.tache.libelle).localeCompare(String(y.tache.libelle), "fr") ||
            x.affectation_id.localeCompare(y.affectation_id),
        );
      const absences = await db.query(
        `SELECT id, type, statut, date_debut::text AS date_debut, date_fin::text AS date_fin
         FROM absences WHERE collaborateur_id = $1 AND statut IN ('demandee', 'validee')
           AND date_debut <= $3 AND date_fin >= $2 ORDER BY date_debut, id`,
        [moi.id, semaine.debut, semaine.fin],
      );
      const validees = (await absencesValidees(db, [moi.id], semaine)).get(moi.id) ?? [];
      return {
        semaine,
        collaborateur: { id: moi.id, nom: moi.nom },
        lignes,
        absences: absences.rows,
        feries: feries.rows,
        capacite: capacite(semaine, calendrier, validees, nombre(moi.capacite_pct)),
        jours_affectes: sommerJours(lignes.map((l) => l.jours_alloues_semaine)),
      };
    });
  });
};
