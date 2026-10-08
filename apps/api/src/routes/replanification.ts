import type { FastifyPluginAsync } from "fastify";
import {
  ajouterJoursOuvres,
  decalerPhase,
  joursOuvresEntre,
  type DateISO,
  type ParametresCalendrier,
} from "@missionpilot/engines";
import { replanificationQuerySchema, replanificationSchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { AppError, introuvable } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { exigerMissionModifiable } from "../missions/acces.js";
import { chargerDecoupage } from "../missions/decoupage.js";
import { chargerCalendrier, nombre } from "../missions/outils.js";
import { envoyerEmails, notifier, type NotificationCreee } from "../notifications/notifier.js";
import { dateFinMission, versMoteurPlanning } from "../planification/outils.js";

/**
 * Écart signé en jours ouvrés entre deux dates ouvrées (moteur : jours ouvrés
 * entre les bornes incluses, moins un).
 */
function ecartOuvre(avant: DateISO, apres: DateISO, cal: ParametresCalendrier): number {
  if (avant === apres) return 0;
  return apres > avant
    ? joursOuvresEntre(avant, apres, cal) - 1
    : -(joursOuvresEntre(apres, avant, cal) - 1);
}

/** Décale une date d'un nombre de jours ouvrés ; 0 la laisse telle quelle. */
const decaler = (date: DateISO, n: number, cal: ParametresCalendrier): DateISO =>
  n === 0 ? date : ajouterJoursOuvres(date, n, cal);

const horsMission = (debut: string, fin: string, mission: { debut: string; fin: string | null }) =>
  debut < mission.debut || (mission.fin !== null && fin > mission.fin);

/**
 * Re-planification (PLN-09) : décale une phase de N jours ouvrés par le
 * moteur (decalerPhase), recale les tâches dépendantes et les affectations
 * des tâches décalées, puis prévient chaque personne concernée. `?apercu=true`
 * calcule le résultat sans rien écrire ni notifier.
 */
export const routesReplanification: FastifyPluginAsync = async (app) => {
  app.post("/missions/:id/replanifier", async (request) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const apercu = replanificationQuerySchema.parse(request.query).apercu === "true";
    const corps = replanificationSchema.parse(request.body);
    const { resultat, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionModifiable(db, auth, id);
      if (!mission.date_debut) {
        throw new AppError(
          409,
          "MISSION_SANS_DATES",
          "Renseigner la date de début de la mission avant de la re-planifier.",
        );
      }
      const bornes = { debut: mission.date_debut, fin: await dateFinMission(db, id) };
      const d = await chargerDecoupage(db, id);
      if (!d.phases.some((p) => p.id === corps.phase_id)) throw introuvable("Phase");
      const cal = await chargerCalendrier(db, auth.cabinetId);
      const aff = await db.query(
        `SELECT a.id, a.tache_id, a.collaborateur_id, a.jours_alloues::text AS jours,
           a.date_debut::text AS debut, a.date_fin::text AS fin, c.nom, c.utilisateur_id
         FROM affectations a LEFT JOIN collaborateurs c ON c.id = a.collaborateur_id
         WHERE a.mission_id = $1 ORDER BY a.date_debut, a.id`,
        [id],
      );
      const { taches, dependances } = versMoteurPlanning(mission.date_debut, d);
      // Cycle de dépendances : CycleDependancesError → 409 (traduireErreurMoteur).
      const r = decalerPhase({
        taches,
        dependances,
        phaseId: corps.phase_id,
        decalageJoursOuvres: corps.decalage_jours_ouvres,
        affectations: aff.rows.map((a) => ({
          id: a.id as string,
          tacheId: a.tache_id as string,
          debut: a.debut as string,
          fin: a.fin as string,
          collaborateurId: a.collaborateur_id as string | null,
          nom: a.nom as string | null,
          utilisateurId: a.utilisateur_id as string | null,
          jours: nombre(a.jours),
        })),
        calendrier: cal,
      });
      const libelles = new Map(d.taches.map((t) => [t.id as string, t.libelle as string]));
      const changements = new Map(r.tachesDecalees.map((t) => [t.id, t]));
      const affectations = r.affectationsImpactees.map((a) => {
        const t = changements.get(a.tacheId);
        const n = t ? ecartOuvre(t.avant.debut, t.apres.debut, cal) : 0;
        return {
          ...a,
          nouveauDebut: decaler(a.debut, n, cal),
          nouvelleFin: decaler(a.fin, n, cal),
        };
      });
      // Le budget signé et les affectations restent dans les dates de la mission.
      for (const t of r.tachesDecalees) {
        if (horsMission(t.apres.debut, t.apres.fin, bornes)) {
          throw new AppError(
            409,
            "DATES_HORS_MISSION",
            `La tâche « ${libelles.get(t.id) ?? t.id} » sortirait des dates de la mission.`,
          );
        }
      }
      for (const a of affectations) {
        if (horsMission(a.nouveauDebut, a.nouvelleFin, bornes)) {
          throw new AppError(
            409,
            "DATES_HORS_MISSION",
            "Une affectation sortirait des dates de la mission.",
          );
        }
      }
      const personnes = new Map<
        string,
        { collaborateur_id: string; nom: string | null; utilisateur_id: string | null }
      >();
      for (const a of affectations) {
        if (a.collaborateurId) {
          personnes.set(a.collaborateurId, {
            collaborateur_id: a.collaborateurId,
            nom: a.nom,
            utilisateur_id: a.utilisateurId,
          });
        }
      }
      const resultat = {
        apercu,
        phase_id: corps.phase_id,
        decalage_jours_ouvres: corps.decalage_jours_ouvres,
        taches: r.tachesDecalees.map((t) => ({
          id: t.id,
          libelle: libelles.get(t.id),
          avant: t.avant,
          apres: t.apres,
        })),
        affectations: affectations.map((a) => ({
          id: a.id,
          tache_id: a.tacheId,
          collaborateur_id: a.collaborateurId,
          avant: { debut: a.debut, fin: a.fin },
          apres: { debut: a.nouveauDebut, fin: a.nouvelleFin },
        })),
        personnes: [...personnes.values()].sort((x, y) =>
          String(x.nom).localeCompare(String(y.nom), "fr"),
        ),
      };
      if (apercu) return { resultat, notifications: [] as (NotificationCreee | null)[] };

      // Écriture : chaque tâche est ancrée sur ses nouvelles dates au plus tôt
      // (pour qu'un recalcul du planning redonne exactement ce résultat).
      for (const t of d.taches) {
        const apres = r.dates.get(t.id as string);
        if (apres && apres.debut !== t.date_debut) {
          await db.query(
            `UPDATE mission_taches SET date_debut = $3, modifie_le = now()
             WHERE id = $1 AND mission_id = $2`,
            [t.id, id, apres.debut],
          );
        }
      }
      for (const a of affectations) {
        await db.query(
          `UPDATE affectations SET date_debut = $3, date_fin = $4, modifie_le = now()
           WHERE id = $1 AND mission_id = $2`,
          [a.id, id, a.nouveauDebut, a.nouvelleFin],
        );
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "replanification",
        entite: "mission",
        entiteId: id,
        details: {
          phase_id: corps.phase_id,
          decalage_jours_ouvres: corps.decalage_jours_ouvres,
          taches: r.tachesDecalees.length,
          affectations: affectations.length,
        },
      });
      const intitule = (await db.query("SELECT intitule FROM missions WHERE id = $1", [id])).rows[0]
        ?.intitule as string;
      const notifications: (NotificationCreee | null)[] = [];
      const destinataires = new Set(
        [...personnes.values()].map((p) => p.utilisateur_id).filter((u): u is string => !!u),
      );
      for (const utilisateurId of destinataires) {
        const siennes = affectations.filter((a) => a.utilisateurId === utilisateurId);
        notifications.push(
          await notifier(db, {
            cabinetId: auth.cabinetId,
            destinataireId: utilisateurId,
            type: "replanification",
            titre: `Planning modifié : ${intitule}`,
            corps: siennes
              .map(
                (a) =>
                  `${libelles.get(a.tacheId) ?? "Tâche"} : du ${a.nouveauDebut} au ${a.nouvelleFin} (auparavant du ${a.debut} au ${a.fin}).`,
              )
              .join("\n"),
            lien: `/mon-planning?semaine=${siennes[0]?.nouveauDebut ?? ""}`,
            email: true,
          }),
        );
      }
      return { resultat, notifications };
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    if (!apercu && resultat.taches.length === 0) {
      // Rien n'a bougé (ex. décalage absorbé par une dépendance) : réponse explicite.
      return { ...resultat, message: "Aucune date ne change." };
    }
    return resultat;
  });
};
