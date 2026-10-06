import type { FastifyPluginAsync } from "fastify";
import {
  absenceDemandeSchema,
  absenceRefusSchema,
  absencesListeQuerySchema,
  aPermission,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { estAssocie } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { envoyerEmails, notifier } from "../notifications/notifier.js";
import { collaborateurDe } from "../planification/outils.js";

/*
 * Congés et absences (PLN-07).
 * - Un collaborateur demande pour lui-même (permission conges.demander, et un
 *   collaborateur actif rattaché à son compte).
 * - Un détenteur de conges.valider valide ou refuse (motif obligatoire), mais
 *   jamais sa propre demande, sauf s'il est associé.
 * - Le demandeur annule tant que l'absence n'a pas commencé.
 * - Seules les absences validées sont déduites de la capacité (plan de charge).
 * - Le type d'absence (maladie…) est une donnée personnelle : il n'est servi
 *   qu'au demandeur et aux valideurs, jamais dans le plan de charge.
 */

const COLONNES = `ab.id, ab.collaborateur_id, c.nom AS collaborateur_nom, ab.demandeur_id, ab.type,
  ab.date_debut::text AS date_debut, ab.date_fin::text AS date_fin, ab.commentaire, ab.statut,
  ab.motif_refus, ab.decide_par, ab.decide_le, ab.annulee_le, ab.cree_le`;
const DEPUIS = "absences ab JOIN collaborateurs c ON c.id = ab.collaborateur_id";

async function lire(db: Db, id: string, verrouiller = false): Promise<Record<string, unknown>> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM ${DEPUIS} WHERE ab.id = $1 ${verrouiller ? "FOR UPDATE OF ab" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Absence");
  return r.rows[0];
}

const valideur = (auth: Auth) => aPermission(auth.roles, "conges.valider");

const LIBELLES_TYPE: Record<string, string> = {
  conge_paye: "congé payé",
  maladie: "absence",
  formation: "formation",
  autre: "absence",
};

async function journal(db: Db, auth: Auth, action: string, id: string, details: object) {
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action,
    entite: "absence",
    entiteId: id,
    details: details as Record<string, unknown>,
  });
}

/** Demande lisible par l'utilisateur : la sienne, ou toutes s'il valide les congés. */
async function lireVisible(db: Db, auth: Auth, id: string, verrouiller = false) {
  const a = await lire(db, id, verrouiller);
  if (!valideur(auth) && a.demandeur_id !== auth.utilisateurId) throw introuvable("Absence");
  return a;
}

/** Décision sur une demande : valideur, pas le demandeur (sauf associé), statut « demandee ». */
async function exigerDecidable(db: Db, auth: Auth, id: string) {
  const a = await lire(db, id, true);
  if (a.demandeur_id === auth.utilisateurId && !estAssocie(auth)) {
    throw new AppError(
      403,
      "AUTO_VALIDATION",
      "Vous ne pouvez pas décider de votre propre demande d'absence.",
    );
  }
  if (a.statut !== "demandee") throw conflit("Cette demande a déjà été traitée ou annulée.");
  return a;
}

export const routesAbsences: FastifyPluginAsync = async (app) => {
  app.get("/absences", async (request) => {
    const auth = exiger(request);
    const q = absencesListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      // Sans conges.valider : uniquement ses propres demandes.
      const r = await db.query(
        `SELECT ${COLONNES}, to_char(ab.date_debut, 'YYYY-MM-DD') AS cle_tri FROM ${DEPUIS}
         WHERE ($1::boolean OR ab.demandeur_id = $2)
           AND ($3::text IS NULL OR ab.statut = $3)
           AND ($4::uuid IS NULL OR ab.collaborateur_id = $4)
           AND ($5::date IS NULL OR ab.date_fin >= $5)
           AND ($6::date IS NULL OR ab.date_debut <= $6)
           AND ($7::text IS NULL OR (to_char(ab.date_debut, 'YYYY-MM-DD'), ab.id) > ($7, $8::uuid))
         ORDER BY ab.date_debut, ab.id
         LIMIT $9`,
        [
          valideur(auth),
          auth.utilisateurId,
          q.statut ?? null,
          q.collaborateur_id ?? null,
          q.debut ?? null,
          q.fin ?? null,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      return paginer(r.rows, q.limite);
    });
  });

  app.post("/absences", async (request, reply) => {
    const auth = exiger(request, "conges.demander");
    const d = absenceDemandeSchema.parse(request.body);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      const collaborateur = await collaborateurDe(db, auth.utilisateurId);
      if (!collaborateur) {
        throw conflit("Aucun collaborateur actif n'est rattaché à votre compte.");
      }
      // Verrou du collaborateur : deux demandes concurrentes ne se chevauchent pas.
      await db.query("SELECT 1 FROM collaborateurs WHERE id = $1 FOR UPDATE", [collaborateur.id]);
      const chevauche = await db.query(
        `SELECT 1 FROM absences WHERE collaborateur_id = $1 AND statut IN ('demandee', 'validee')
           AND date_debut <= $3 AND date_fin >= $2`,
        [collaborateur.id, d.date_debut, d.date_fin],
      );
      if (chevauche.rowCount) throw conflit("Une absence couvre déjà une partie de cette période.");
      const r = await db.query(
        `INSERT INTO absences (cabinet_id, collaborateur_id, demandeur_id, type, date_debut,
           date_fin, commentaire)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          auth.cabinetId,
          collaborateur.id,
          auth.utilisateurId,
          d.type,
          d.date_debut,
          d.date_fin,
          d.commentaire ?? null,
        ],
      );
      const id = r.rows[0].id as string;
      await journal(db, auth, "demande", id, {
        collaborateur_id: collaborateur.id,
        date_debut: d.date_debut,
        date_fin: d.date_fin,
      });
      return lire(db, id);
    });
    reply.status(201);
    return creee;
  });

  app.get("/absences/:id", async (request) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireVisible(db, auth, id));
  });

  app.post("/absences/:id/valider", async (request) => {
    const auth = exiger(request, "conges.valider");
    const { id } = paramsId.parse(request.params);
    const { absence, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const a = await exigerDecidable(db, auth, id);
      await db.query(
        `UPDATE absences SET statut = 'validee', decide_par = $2, decide_le = now() WHERE id = $1`,
        [id, auth.utilisateurId],
      );
      await journal(db, auth, "validation", id, { collaborateur_id: a.collaborateur_id });
      const n = await notifier(db, {
        cabinetId: auth.cabinetId,
        destinataireId: a.demandeur_id as string,
        type: "absence_validee",
        titre: `Votre demande de ${LIBELLES_TYPE[a.type as string] ?? "absence"} est validée`,
        corps: `Du ${a.date_debut as string} au ${a.date_fin as string}.`,
        lien: `/mon-planning?semaine=${a.date_debut as string}`,
        email: true,
      });
      return { absence: await lire(db, id), notifications: [n] };
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    return absence;
  });

  app.post("/absences/:id/refuser", async (request) => {
    const auth = exiger(request, "conges.valider");
    const { id } = paramsId.parse(request.params);
    const { motif } = absenceRefusSchema.parse(request.body);
    const { absence, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const a = await exigerDecidable(db, auth, id);
      await db.query(
        `UPDATE absences SET statut = 'refusee', motif_refus = $2, decide_par = $3, decide_le = now()
         WHERE id = $1`,
        [id, motif, auth.utilisateurId],
      );
      await journal(db, auth, "refus", id, { collaborateur_id: a.collaborateur_id, motif });
      const n = await notifier(db, {
        cabinetId: auth.cabinetId,
        destinataireId: a.demandeur_id as string,
        type: "absence_refusee",
        titre: `Votre demande de ${LIBELLES_TYPE[a.type as string] ?? "absence"} est refusée`,
        corps: `Du ${a.date_debut as string} au ${a.date_fin as string}. Motif : ${motif}`,
        lien: "/mon-planning",
        email: true,
      });
      return { absence: await lire(db, id), notifications: [n] };
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    return absence;
  });

  /** Annulation par le demandeur, tant que l'absence n'a pas commencé. */
  app.post("/absences/:id/annuler", async (request) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const a = await lire(db, id, true);
      if (a.demandeur_id !== auth.utilisateurId) throw introuvable("Absence");
      if (a.statut !== "demandee" && a.statut !== "validee") {
        throw conflit("Cette absence est déjà refusée ou annulée.");
      }
      if ((a.date_debut as string) <= aujourdhui()) {
        throw conflit("Une absence commencée ne s'annule plus.");
      }
      await db.query(`UPDATE absences SET statut = 'annulee', annulee_le = now() WHERE id = $1`, [
        id,
      ]);
      await journal(db, auth, "annulation", id, { statut_avant: a.statut });
      return lire(db, id);
    });
  });
};
