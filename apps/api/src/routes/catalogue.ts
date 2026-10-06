import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  elementCreationSchema,
  elementModificationSchema,
  typeMissionCreationSchema,
  typeMissionDuplicationSchema,
  typeMissionModificationSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { choisir, clauseSet, traduireErreursPg } from "../db/outils.js";
import { introuvable, requeteInvalide } from "../errors.js";
import { paramsId } from "../http/outils.js";

const COLONNES_TYPE = `id, code, libelle, domaine, mode_facturation, duree_type_jours, equipe_type,
  actif, a_valider, cree_le, modifie_le`;
const CHAMPS_TYPE = [
  "code",
  "libelle",
  "domaine",
  "mode_facturation",
  "duree_type_jours",
  "equipe_type",
  "actif",
  "a_valider",
] as const;
const COLONNES_ELEMENT = `id, type_mission_id, parent_id, niveau, libelle, ordre, jours_par_grade,
  est_livrable, est_jalon`;
const CHAMPS_ELEMENT = [
  "parent_id",
  "niveau",
  "libelle",
  "ordre",
  "jours_par_grade",
  "est_livrable",
  "est_jalon",
] as const;
const CODE_PRIS = { "*": "Un type de mission porte déjà ce code." };

const paramsElement = z.object({ id: z.string().uuid(), elementId: z.string().uuid() });
const listeQuery = z.object({ actif: z.enum(["true", "false"]).optional() }).strict();

interface Element {
  id: string;
  parent_id: string | null;
  ordre: number;
  libelle: string;
}

/** Ordre de lecture du modèle : parcours en profondeur, frères triés par ordre puis libellé. */
export function ordonnerArbre<T extends Element>(elements: T[]): T[] {
  const enfants = new Map<string | null, T[]>();
  for (const e of elements) enfants.set(e.parent_id, [...(enfants.get(e.parent_id) ?? []), e]);
  const resultat: T[] = [];
  const visiter = (parent: string | null) => {
    const freres = (enfants.get(parent) ?? []).sort(
      (a, b) => a.ordre - b.ordre || a.libelle.localeCompare(b.libelle, "fr"),
    );
    for (const e of freres) {
      resultat.push(e);
      visiter(e.id);
    }
  };
  visiter(null);
  return resultat;
}

async function exigerType(db: Db, id: string): Promise<Record<string, unknown>> {
  const r = await db.query(`SELECT ${COLONNES_TYPE} FROM types_mission WHERE id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Type de mission");
  return r.rows[0];
}

async function niveauSous(db: Db, typeId: string, parentId: string | null): Promise<number> {
  if (parentId === null) return 1;
  const r = await db.query(
    "SELECT niveau FROM modele_elements WHERE id = $1 AND type_mission_id = $2",
    [parentId, typeId],
  );
  const parent = r.rows[0] as { niveau: number } | undefined;
  if (!parent) throw requeteInvalide("Élément parent inconnu dans ce type de mission.");
  if (parent.niveau >= 3) throw requeteInvalide("Une tâche ne peut pas avoir d'élément enfant.");
  return parent.niveau + 1;
}

/** Copie un type et tout son modèle (MIS-12) ; renvoie l'identifiant du nouveau type. */
async function dupliquerType(
  db: Db,
  cabinetId: string,
  sourceId: string,
  code: string,
  libelle: string,
): Promise<string> {
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO types_mission (cabinet_id, code, libelle, domaine, mode_facturation,
         duree_type_jours, equipe_type, actif)
       SELECT cabinet_id, $2, $3, domaine, mode_facturation, duree_type_jours, equipe_type, true
       FROM types_mission WHERE id = $1 RETURNING id`,
      [sourceId, code, libelle],
    ),
    CODE_PRIS,
  );
  const nouveauId = r.rows[0].id as string;
  await db.query(
    `WITH correspondance AS (
       SELECT id AS ancien, gen_random_uuid() AS nouveau FROM modele_elements WHERE type_mission_id = $1)
     INSERT INTO modele_elements (id, cabinet_id, type_mission_id, parent_id, niveau, libelle, ordre,
       jours_par_grade, est_livrable, est_jalon)
     SELECT m.nouveau, $3, $2, p.nouveau, e.niveau, e.libelle, e.ordre, e.jours_par_grade,
       e.est_livrable, e.est_jalon
     FROM modele_elements e
     JOIN correspondance m ON m.ancien = e.id
     LEFT JOIN correspondance p ON p.ancien = e.parent_id`,
    [sourceId, nouveauId, cabinetId],
  );
  return nouveauId;
}

/** Catalogue des types de mission et leur modèle (MIS-01, MIS-02, MIS-12). */
export const routesCatalogue: FastifyPluginAsync = async (app) => {
  app.get("/types-mission", async (request) => {
    const auth = exiger(request, "catalogue.lire");
    const { actif } = listeQuery.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_TYPE} FROM types_mission
         WHERE $1::boolean IS NULL OR actif = $1 ORDER BY lower(libelle), id`,
        [actif === undefined ? null : actif === "true"],
      );
      return { elements: r.rows };
    });
  });

  app.get("/types-mission/:id", async (request) => {
    const auth = exiger(request, "catalogue.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const type = await exigerType(db, id);
      const r = await db.query(
        `SELECT ${COLONNES_ELEMENT} FROM modele_elements WHERE type_mission_id = $1`,
        [id],
      );
      return { ...type, elements: ordonnerArbre(r.rows as (Element & Record<string, unknown>)[]) };
    });
  });

  app.post("/types-mission", async (request, reply) => {
    const auth = exiger(request, "catalogue.ecrire");
    const t = typeMissionCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO types_mission (cabinet_id, code, libelle, domaine, mode_facturation,
             duree_type_jours, equipe_type, actif)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLONNES_TYPE}`,
          [
            auth.cabinetId,
            t.code,
            t.libelle,
            t.domaine ?? null,
            t.mode_facturation,
            t.duree_type_jours,
            JSON.stringify(t.equipe_type),
            t.actif,
          ],
        ),
        CODE_PRIS,
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "type_mission",
        entiteId: r.rows[0].id,
        details: { apres: choisir(r.rows[0], CHAMPS_TYPE) },
      });
      return r.rows[0];
    });
    reply.status(201);
    return cree;
  });

  app.patch("/types-mission/:id", async (request) => {
    const auth = exiger(request, "catalogue.ecrire");
    const { id } = paramsId.parse(request.params);
    const modif = typeMissionModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = await exigerType(db, id);
      const set = clauseSet(modif, 2, ["equipe_type"]);
      const r = await traduireErreursPg(
        db.query(
          `UPDATE types_mission SET ${set.sql}, modifie_le = now() WHERE id = $1
           RETURNING ${COLONNES_TYPE}`,
          [id, ...set.valeurs],
        ),
        CODE_PRIS,
      );
      const champs = Object.keys(modif);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "type_mission",
        entiteId: id,
        details: { avant: choisir(avant, champs), apres: choisir(r.rows[0], champs) },
      });
      return r.rows[0];
    });
  });

  app.post("/types-mission/:id/dupliquer", async (request, reply) => {
    const auth = exiger(request, "catalogue.ecrire");
    const { id } = paramsId.parse(request.params);
    const { code, libelle } = typeMissionDuplicationSchema.parse(request.body);
    const copie = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerType(db, id);
      const nouveauId = await dupliquerType(db, auth.cabinetId, id, code, libelle);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "duplication",
        entite: "type_mission",
        entiteId: nouveauId,
        details: { source_id: id, code, libelle },
      });
      return exigerType(db, nouveauId);
    });
    reply.status(201);
    return copie;
  });

  app.post("/types-mission/:id/elements", async (request, reply) => {
    const auth = exiger(request, "catalogue.ecrire");
    const { id } = paramsId.parse(request.params);
    const e = elementCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerType(db, id);
      const niveau = await niveauSous(db, id, e.parent_id);
      const r = await db.query(
        `INSERT INTO modele_elements (cabinet_id, type_mission_id, parent_id, niveau, libelle, ordre,
           jours_par_grade, est_livrable, est_jalon)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLONNES_ELEMENT}`,
        [
          auth.cabinetId,
          id,
          e.parent_id,
          niveau,
          e.libelle,
          e.ordre,
          JSON.stringify(e.jours_par_grade),
          e.est_livrable,
          e.est_jalon,
        ],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "modele_element",
        entiteId: r.rows[0].id,
        details: { type_mission_id: id, apres: choisir(r.rows[0], CHAMPS_ELEMENT) },
      });
      return r.rows[0];
    });
    reply.status(201);
    return cree;
  });

  app.patch("/types-mission/:id/elements/:elementId", async (request) => {
    const auth = exiger(request, "catalogue.ecrire");
    const { id, elementId } = paramsElement.parse(request.params);
    const modif = elementModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = (
        await db.query(
          `SELECT ${COLONNES_ELEMENT} FROM modele_elements WHERE id = $1 AND type_mission_id = $2`,
          [elementId, id],
        )
      ).rows[0];
      if (!avant) throw introuvable("Élément du modèle");
      const set = clauseSet(modif, 3, ["jours_par_grade"]);
      const r = await db.query(
        `UPDATE modele_elements SET ${set.sql}, modifie_le = now()
         WHERE id = $1 AND type_mission_id = $2 RETURNING ${COLONNES_ELEMENT}`,
        [elementId, id, ...set.valeurs],
      );
      const champs = Object.keys(modif);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "modele_element",
        entiteId: elementId,
        details: {
          type_mission_id: id,
          avant: choisir(avant, champs),
          apres: choisir(r.rows[0], champs),
        },
      });
      return r.rows[0];
    });
  });

  app.delete("/types-mission/:id/elements/:elementId", async (request, reply) => {
    const auth = exiger(request, "catalogue.ecrire");
    const { id, elementId } = paramsElement.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `DELETE FROM modele_elements WHERE id = $1 AND type_mission_id = $2
         RETURNING ${COLONNES_ELEMENT}`,
        [elementId, id],
      );
      if (!r.rows[0]) throw introuvable("Élément du modèle");
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "suppression",
        entite: "modele_element",
        entiteId: elementId,
        // Les éléments enfants sont supprimés avec lui (cascade).
        details: { type_mission_id: id, avant: choisir(r.rows[0], CHAMPS_ELEMENT) },
      });
    });
    return reply.status(204).send();
  });
};
