import type { FastifyPluginAsync } from "fastify";
import {
  gradeCreationSchema,
  gradeModificationSchema,
  gradeTauxSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { choisir, clauseSet, montant, traduireErreursPg } from "../db/outils.js";
import { introuvable } from "../errors.js";
import { paramsId } from "../http/outils.js";

/** Colonnes non financières : jamais de taux ici (FIN-02). */
const COLONNES_GRADE = "id, code, libelle, ordre, actif, a_valider";
const CHAMPS_GRADE = ["code", "libelle", "ordre", "actif", "a_valider"] as const;

const avecTaux = (l: Record<string, unknown>) => ({
  ...l,
  taux_vente_standard: montant(l.taux_vente_standard),
});

/**
 * Grades (PLN-05). La structure est lisible avec catalogue.lire et gérée avec
 * cabinet.gerer ; le taux de vente standard ne passe que par /grades/taux
 * (lecture finance.lire, écriture taux.gerer).
 */
export const routesGrades: FastifyPluginAsync = async (app) => {
  app.get("/grades", async (request) => {
    const auth = exiger(request, "catalogue.lire");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(`SELECT ${COLONNES_GRADE} FROM grades ORDER BY ordre, code`);
      return { elements: r.rows };
    });
  });

  app.post("/grades", async (request, reply) => {
    const auth = exiger(request, "cabinet.gerer");
    const grade = gradeCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO grades (cabinet_id, code, libelle, ordre) VALUES ($1, $2, $3, $4)
           RETURNING ${COLONNES_GRADE}`,
          [auth.cabinetId, grade.code, grade.libelle, grade.ordre],
        ),
        { "*": "Un grade porte déjà ce code." },
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "grade",
        entiteId: r.rows[0].id,
        details: { apres: choisir(r.rows[0], CHAMPS_GRADE) },
      });
      return r.rows[0];
    });
    reply.status(201);
    return cree;
  });

  app.patch("/grades/:id", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { id } = paramsId.parse(request.params);
    const modif = gradeModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = (await db.query(`SELECT ${COLONNES_GRADE} FROM grades WHERE id = $1`, [id]))
        .rows[0];
      if (!avant) throw introuvable("Grade");
      const set = clauseSet(modif, 2);
      const r = await db.query(
        `UPDATE grades SET ${set.sql}, modifie_le = now() WHERE id = $1 RETURNING ${COLONNES_GRADE}`,
        [id, ...set.valeurs],
      );
      const champs = Object.keys(modif);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "grade",
        entiteId: id,
        details: { avant: choisir(avant, champs), apres: choisir(r.rows[0], champs) },
      });
      return r.rows[0];
    });
  });

  app.get("/grades/taux", async (request) => {
    const auth = exiger(request, "finance.lire");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT id, code, libelle, taux_vente_standard, devise, a_valider FROM grades
         ORDER BY ordre, code`,
      );
      return { elements: r.rows.map(avecTaux) };
    });
  });

  app.put("/grades/:id/taux", async (request) => {
    const auth = exiger(request, "taux.gerer");
    const { id } = paramsId.parse(request.params);
    const taux = gradeTauxSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `UPDATE grades SET taux_vente_standard = $2, devise = $3, modifie_le = now() WHERE id = $1
         RETURNING id, code, libelle, taux_vente_standard, devise, a_valider`,
        [id, taux.taux_vente_standard, taux.devise],
      );
      if (!r.rows[0]) throw introuvable("Grade");
      // Pas de montant dans le journal : il est lisible au-delà des seuls rôles finance.
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification_taux",
        entite: "grade",
        entiteId: id,
        details: { champs: ["taux_vente_standard", "devise"] },
      });
      return avecTaux(r.rows[0]);
    });
  });
};
