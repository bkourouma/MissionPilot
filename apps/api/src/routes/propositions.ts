import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  aPermission,
  propositionElementModificationSchema,
  propositionGenerationSchema,
  propositionModificationSchema,
  propositionStatutSchema,
  propositionTauxSchema,
  type Permission,
  type StatutProposition,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { clauseSet, traduireErreursPg } from "../db/outils.js";
import { conflit, interdit, introuvable, requeteInvalide } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { aujourdhui, gradesParCode } from "../missions/outils.js";
import {
  COLONNES_PROPOSITION,
  copierContenu,
  detailProposition,
  exigerProposition,
  remplirDepuisModele,
} from "../missions/propositions.js";

const paramsElement = z.object({ id: z.string().uuid(), elementId: z.string().uuid() });

/**
 * Transitions de statut (MIS-05) et permission requise pour chacune.
 * brouillon → a_valider → validee (associé) → envoyee → acceptee | refusee ;
 * une proposition à valider peut être renvoyée en brouillon par le valideur.
 */
const TRANSITIONS: Record<StatutProposition, Partial<Record<StatutProposition, Permission>>> = {
  brouillon: { a_valider: "pipeline.gerer" },
  a_valider: { brouillon: "proposition.valider", validee: "proposition.valider" },
  validee: { envoyee: "pipeline.gerer" },
  envoyee: { acceptee: "pipeline.gerer", refusee: "pipeline.gerer" },
  acceptee: {},
  refusee: {},
};

async function exigerBrouillon(db: Db, id: string): Promise<Record<string, unknown>> {
  const p = await exigerProposition(db, id, true);
  if (p.statut !== "brouillon") {
    throw conflit("Seule une proposition en brouillon se modifie : créer une nouvelle version.");
  }
  return p;
}

async function prochainNumero(db: Db, opportuniteId: string): Promise<number> {
  const r = await db.query(
    "SELECT coalesce(max(numero), 0) + 1 AS n FROM propositions WHERE opportunite_id = $1",
    [opportuniteId],
  );
  return r.rows[0].n as number;
}

/** Propositions techniques et financières (MIS-05). */
export const routesPropositions: FastifyPluginAsync = async (app) => {
  app.get("/opportunites/:id/propositions", async (request) => {
    const auth = exiger(request, "pipeline.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const o = await db.query("SELECT 1 FROM opportunites WHERE id = $1", [id]);
      if (!o.rowCount) throw introuvable("Opportunité");
      const r = await db.query(
        `SELECT ${COLONNES_PROPOSITION} FROM propositions p WHERE p.opportunite_id = $1
         ORDER BY p.numero`,
        [id],
      );
      return { elements: r.rows };
    });
  });

  app.post("/opportunites/:id/propositions", async (request, reply) => {
    const auth = exiger(request, "pipeline.gerer");
    const { id } = paramsId.parse(request.params);
    const g = propositionGenerationSchema.parse(request.body);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      const o = await db.query(
        "SELECT id, intitule, devise, type_mission_id, statut FROM opportunites WHERE id = $1 FOR UPDATE",
        [id],
      );
      const opp = o.rows[0];
      if (!opp) throw introuvable("Opportunité");
      if (opp.statut !== "ouverte") throw conflit("L'opportunité est close.");
      const typeId = g.type_mission_id ?? opp.type_mission_id;
      if (!typeId) throw requeteInvalide("Un type de mission du catalogue est requis.");
      const type = await db.query("SELECT id FROM types_mission WHERE id = $1", [typeId]);
      if (!type.rowCount) throw requeteInvalide("Type de mission inconnu dans ce cabinet.");
      const devise = g.devise ?? opp.devise;
      const r = await db.query(
        `INSERT INTO propositions (cabinet_id, opportunite_id, type_mission_id, numero, intitule, devise,
           date_reference, equipe, cree_par)
         SELECT $1, $2, t.id, $3, $4, $5, $6, t.equipe_type, $7 FROM types_mission t WHERE t.id = $8
         RETURNING id`,
        [
          auth.cabinetId,
          id,
          await prochainNumero(db, id),
          g.intitule ?? opp.intitule,
          devise,
          g.date_reference ?? aujourdhui(),
          auth.utilisateurId,
          typeId,
        ],
      );
      const propositionId = r.rows[0].id as string;
      await remplirDepuisModele(db, auth.cabinetId, propositionId, typeId, devise);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "generation",
        entite: "proposition",
        entiteId: propositionId,
        details: { opportunite_id: id, type_mission_id: typeId, devise },
      });
      return detailProposition(db, await exigerProposition(db, propositionId));
    });
    reply.status(201);
    return creee;
  });

  app.get("/propositions/:id", async (request) => {
    const auth = exiger(request, "pipeline.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      detailProposition(db, await exigerProposition(db, id)),
    );
  });

  app.patch("/propositions/:id", async (request) => {
    const auth = exiger(request, "pipeline.gerer");
    const { id } = paramsId.parse(request.params);
    const modif = propositionModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerBrouillon(db, id);
      if (modif.equipe)
        await gradesParCode(
          db,
          modif.equipe.map((m) => m.grade_code),
        );
      const set = clauseSet(modif, 2, ["equipe"]);
      await db.query(`UPDATE propositions SET ${set.sql}, modifie_le = now() WHERE id = $1`, [
        id,
        ...set.valeurs,
      ]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "proposition",
        entiteId: id,
        details: { champs: Object.keys(modif) },
      });
      return detailProposition(db, await exigerProposition(db, id));
    });
  });

  app.patch("/propositions/:id/elements/:elementId", async (request) => {
    const auth = exiger(request, "pipeline.gerer");
    const { id, elementId } = paramsElement.parse(request.params);
    const modif = propositionElementModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerBrouillon(db, id);
      const e = await db.query(
        "SELECT id FROM proposition_elements WHERE id = $1 AND proposition_id = $2",
        [elementId, id],
      );
      if (!e.rowCount) throw introuvable("Élément de la proposition");
      if (modif.libelle !== undefined) {
        await db.query("UPDATE proposition_elements SET libelle = $2 WHERE id = $1", [
          elementId,
          modif.libelle,
        ]);
      }
      if (modif.jours_par_grade !== undefined) {
        const grades = await gradesParCode(db, Object.keys(modif.jours_par_grade));
        await db.query("DELETE FROM proposition_lignes WHERE element_id = $1", [elementId]);
        for (const [code, jours] of Object.entries(modif.jours_par_grade)) {
          await db.query(
            `INSERT INTO proposition_lignes (cabinet_id, proposition_id, element_id, grade_id, jours)
             VALUES ($1, $2, $3, $4, $5)`,
            [auth.cabinetId, id, elementId, grades.get(code), jours],
          );
          // Un grade nouvellement chiffré reçoit une ligne de taux à renseigner.
          await db.query(
            `INSERT INTO proposition_taux (cabinet_id, proposition_id, grade_id)
             VALUES ($1, $2, $3) ON CONFLICT (proposition_id, grade_id) DO NOTHING`,
            [auth.cabinetId, id, grades.get(code)],
          );
        }
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification_element",
        entite: "proposition",
        entiteId: id,
        details: { element_id: elementId, champs: Object.keys(modif) },
      });
      return detailProposition(db, await exigerProposition(db, id));
    });
  });

  app.put("/propositions/:id/taux", async (request) => {
    const auth = exiger(request, "pipeline.gerer");
    const { id } = paramsId.parse(request.params);
    const { taux } = propositionTauxSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerBrouillon(db, id);
      const grades = await gradesParCode(db, Object.keys(taux));
      for (const [code, valeur] of Object.entries(taux)) {
        await db.query(
          `INSERT INTO proposition_taux (cabinet_id, proposition_id, grade_id, taux_journalier)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (proposition_id, grade_id) DO UPDATE SET taux_journalier = EXCLUDED.taux_journalier`,
          [auth.cabinetId, id, grades.get(code), valeur],
        );
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification_taux",
        entite: "proposition",
        entiteId: id,
        details: { grades: Object.keys(taux) },
      });
      return detailProposition(db, await exigerProposition(db, id));
    });
  });

  app.post("/propositions/:id/statut", async (request) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    const { statut } = propositionStatutSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const p = await exigerProposition(db, id, true);
      const actuel = p.statut as StatutProposition;
      const permission = TRANSITIONS[actuel][statut];
      if (!permission) throw conflit(`Transition impossible : ${actuel} → ${statut}.`);
      if (!aPermission(auth.roles, permission)) throw interdit();
      if (statut === "validee") {
        const detail = await detailProposition(db, p);
        const chiffrage = detail.chiffrage as { taux_manquants: string[]; jours_total: number };
        if (chiffrage.taux_manquants.length > 0) {
          throw requeteInvalide(
            `Taux de vente manquant(s) : ${chiffrage.taux_manquants.join(", ")}.`,
          );
        }
        if (chiffrage.jours_total <= 0)
          throw requeteInvalide("La proposition ne chiffre aucun jour.");
      }
      await db.query(
        `UPDATE propositions SET statut = $2, modifie_le = now(),
           validee_par = CASE WHEN $2 = 'validee' THEN $3::uuid ELSE validee_par END,
           validee_le = CASE WHEN $2 = 'validee' THEN now() ELSE validee_le END,
           envoyee_le = CASE WHEN $2 = 'envoyee' THEN now() ELSE envoyee_le END,
           repondue_le = CASE WHEN $2 IN ('acceptee', 'refusee') THEN now() ELSE repondue_le END
         WHERE id = $1`,
        [id, statut, auth.utilisateurId],
      );
      if (statut === "acceptee") {
        // Proposition acceptée : l'opportunité est gagnée (MIS-04).
        await db.query(
          `UPDATE opportunites SET statut = 'gagnee', probabilite = 100, cloturee_le = now(),
             modifie_le = now() WHERE id = $1 AND statut = 'ouverte'`,
          [p.opportunite_id],
        );
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "changement_statut",
        entite: "proposition",
        entiteId: id,
        details: { avant: actuel, apres: statut },
      });
      return detailProposition(db, await exigerProposition(db, id));
    });
  });

  app.post("/propositions/:id/nouvelle-version", async (request, reply) => {
    const auth = exiger(request, "pipeline.gerer");
    const { id } = paramsId.parse(request.params);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      const source = await exigerProposition(db, id);
      const o = await db.query("SELECT statut FROM opportunites WHERE id = $1 FOR UPDATE", [
        source.opportunite_id,
      ]);
      if (o.rows[0]?.statut !== "ouverte") throw conflit("L'opportunité est close.");
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO propositions (cabinet_id, opportunite_id, type_mission_id, numero, intitule,
             devise, date_reference, equipe, cree_par)
           SELECT cabinet_id, opportunite_id, type_mission_id, $2, intitule, devise, date_reference,
             equipe, $3 FROM propositions WHERE id = $1 RETURNING id`,
          [id, await prochainNumero(db, source.opportunite_id as string), auth.utilisateurId],
        ),
        { "*": "Une autre version vient d'être créée : réessayer." },
      );
      const nouvelle = r.rows[0].id as string;
      await copierContenu(db, auth.cabinetId, id, nouvelle);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "nouvelle_version",
        entite: "proposition",
        entiteId: nouvelle,
        details: { source_id: id },
      });
      return detailProposition(db, await exigerProposition(db, nouvelle));
    });
    reply.status(201);
    return creee;
  });
};
