import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  noteCreationSchema,
  noteSoumissionSchema,
  noteValidationSchema,
  noteVersionSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { dossierAccessible } from "../due-diligence/acces.js";
import { journalDd } from "../due-diligence/journal.js";
import {
  ajouterVersionNote,
  creerNote,
  lireDetailNote,
  lireNote,
  listerNotes,
  soumettreNote,
  validerNote,
} from "../due-diligence/notes.js";
import { paramsId } from "../http/outils.js";

/*
 * Notes au comité (DD-13, SPEC-3b §8.8, R46 à R51) : brouillons versionnés, soumission à base
 * figée par les moteurs, validation par un tiers (`dd.valider`). Le rendu PDF ou Word (R52, R53)
 * vit dans `routes/rapports.ts`. Erreurs traduites par le plugin parent.
 */

const queryNote = z
  .object({ version: z.coerce.number().int().min(1).max(200).optional() })
  .strict();

export const routesDueDiligenceNotes: FastifyPluginAsync = async (app) => {
  app.get("/dd/dossiers/:id/notes", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await dossierAccessible(db, auth, id, false);
      return listerNotes(db, id);
    });
  });

  app.post("/dd/dossiers/:id/notes", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = noteCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { dossier } = await dossierAccessible(db, auth, id, true);
      const n = await creerNote(db, auth, dossier, c);
      await journalDd(db, auth, "dd_note_creee", "dd_note", n.id, {
        dossier_id: id,
        recommandation: c.recommandation,
      });
      return n;
    });
    reply.status(201);
    return cree;
  });

  app.get("/dd/notes/:id", async (request) => {
    const auth = exiger(request, "dd.lire");
    const { id } = paramsId.parse(request.params);
    const q = queryNote.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const note = await lireNote(db, id);
      const { dossier, mission } = await dossierAccessible(
        db,
        auth,
        note.dossier_id,
        false,
        "Note",
      );
      return lireDetailNote(db, mission, dossier, note, q.version ?? null);
    });
  });

  app.post("/dd/notes/:id/versions", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = noteVersionSchema.parse(request.body);
    const version = await app.db.withTenant(auth.cabinetId, async (db) => {
      const note = await lireNote(db, id);
      await dossierAccessible(db, auth, note.dossier_id, true, "Note");
      const v = await ajouterVersionNote(db, auth, note, c);
      await journalDd(db, auth, "dd_note_modifiee", "dd_note", id, {
        version: v,
        recommandation: c.recommandation,
      });
      return v;
    });
    reply.status(201);
    return { version };
  });

  app.post("/dd/notes/:id/soumission", async (request, reply) => {
    const auth = exiger(request, "dd.ecrire");
    const { id } = paramsId.parse(request.params);
    const c = noteSoumissionSchema.parse(request.body);
    const version = await app.db.withTenant(auth.cabinetId, async (db) => {
      const note = await lireNote(db, id);
      const { dossier, mission } = await dossierAccessible(db, auth, note.dossier_id, true, "Note");
      const v = await soumettreNote(db, auth, mission, dossier, note, c);
      await journalDd(db, auth, "dd_note_soumise", "dd_note", id, { version: v });
      return v;
    });
    reply.status(201);
    return { version };
  });

  app.post("/dd/notes/:id/validation", async (request, reply) => {
    const auth = exiger(request, "dd.valider");
    const { id } = paramsId.parse(request.params);
    const c = noteValidationSchema.parse(request.body);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const note = await lireNote(db, id);
      const { dossier, mission } = await dossierAccessible(db, auth, note.dossier_id, true, "Note");
      await validerNote(db, auth, mission, dossier, note, c);
      await journalDd(
        db,
        auth,
        c.decision === "valide" ? "dd_note_validee" : "dd_note_rejetee",
        "dd_note",
        id,
        { version: c.version },
      );
    });
    reply.status(201);
    return { ok: true };
  });
};
