import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  calculerDatesAuPlusTot,
  type Dependance,
  type ParametresCalendrier,
  type TachePlanifiee,
} from "@missionpilot/engines";
import {
  aPermission,
  dependanceCreationSchema,
  jalonCreationSchema,
  jalonModificationSchema,
  lotCreationSchema,
  lotModificationSchema,
  phaseCreationSchema,
  phaseModificationSchema,
  reorganisationSchema,
  tacheBudgetSchema,
  tacheCreationSchema,
  tacheModificationSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { choisir, clauseSet, traduireErreursPg } from "../db/outils.js";
import { introuvable, requeteInvalide } from "../errors.js";
import { paramsId } from "../http/outils.js";
import {
  exigerMissionModifiable,
  exigerMissionVisible,
  type MissionAcces,
} from "../missions/acces.js";
import { agregerDecoupage, chargerDecoupage, type Decoupage } from "../missions/decoupage.js";
import { aujourdhui, chargerCalendrier } from "../missions/outils.js";

const paramsElement = z.object({ id: z.string().uuid(), elementId: z.string().uuid() });

/** Tables du découpage : colonnes renvoyées et entité journalisée. */
const ELEMENTS = {
  phase: {
    table: "mission_phases",
    colonnes: "id, libelle, ordre",
    quoi: "Phase",
  },
  lot: {
    table: "mission_lots",
    colonnes: "id, phase_id, libelle, ordre, est_livrable",
    quoi: "Lot",
  },
  tache: {
    table: "mission_taches",
    colonnes: `id, phase_id, lot_id, libelle, ordre, est_livrable, date_debut::text AS date_debut,
      duree_jours_ouvres`,
    quoi: "Tâche",
  },
  jalon: {
    table: "mission_jalons",
    colonnes: "id, phase_id, libelle, date_prevue::text AS date_prevue, atteint, ordre",
    quoi: "Jalon",
  },
} as const;
type TypeElement = keyof typeof ELEMENTS;

const PARENT_INCONNU = "Parent inconnu dans cette mission.";

async function lireElement(
  db: Db,
  type: TypeElement,
  missionId: string,
  id: string,
): Promise<Record<string, unknown>> {
  const e = ELEMENTS[type];
  const r = await db.query(
    `SELECT ${e.colonnes} FROM ${e.table} WHERE id = $1 AND mission_id = $2`,
    [id, missionId],
  );
  if (!r.rows[0]) throw introuvable(e.quoi);
  return r.rows[0];
}

/** Parent d'une tâche : un lot (sa phase en découle) ou une phase de la mission. */
async function parentDeTache(
  db: Db,
  missionId: string,
  parentId: string,
): Promise<{ phaseId: string; lotId: string | null }> {
  const lot = await db.query(
    "SELECT phase_id FROM mission_lots WHERE id = $1 AND mission_id = $2",
    [parentId, missionId],
  );
  if (lot.rows[0]) return { phaseId: lot.rows[0].phase_id, lotId: parentId };
  const phase = await db.query("SELECT 1 FROM mission_phases WHERE id = $1 AND mission_id = $2", [
    parentId,
    missionId,
  ]);
  if (phase.rowCount) return { phaseId: parentId, lotId: null };
  throw requeteInvalide(PARENT_INCONNU);
}

/** Tâches et dépendances au format du moteur planning (début par défaut : celui de la mission). */
function versMoteur(
  mission: Pick<MissionAcces, "date_debut">,
  d: Pick<Decoupage, "taches" | "dependances">,
): { taches: TachePlanifiee[]; dependances: Dependance[] } {
  const debutDefaut = mission.date_debut ?? aujourdhui();
  return {
    taches: d.taches.map((t) => ({
      id: t.id as string,
      debut: (t.date_debut as string | null) ?? debutDefaut,
      dureeJoursOuvres: t.duree_jours_ouvres as number,
      phaseId: t.phase_id as string,
    })),
    dependances: d.dependances.map((x) => ({
      predecesseur: x.predecesseur_id as string,
      successeur: x.successeur_id as string,
      decalage: x.decalage as number,
    })),
  };
}

/** Dates au plus tôt en jours ouvrés du cabinet ; lève un cycle de dépendances (moteur). */
function planifier(
  mission: Pick<MissionAcces, "date_debut">,
  d: Pick<Decoupage, "taches" | "dependances">,
  calendrier: ParametresCalendrier,
) {
  const { taches, dependances } = versMoteur(mission, d);
  return calculerDatesAuPlusTot(taches, dependances, calendrier);
}

async function journal(
  db: Db,
  auth: Auth,
  action: string,
  entite: string,
  entiteId: string,
  details: Record<string, unknown>,
) {
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action,
    entite,
    entiteId,
    details,
  });
}

/** Modification ou suppression générique d'un élément du découpage. */
function routesElement(
  app: Parameters<FastifyPluginAsync>[0],
  type: TypeElement,
  chemin: string,
  schema: z.ZodType<Record<string, unknown>>,
) {
  const e = ELEMENTS[type];
  app.patch(`/missions/:id/${chemin}/:elementId`, async (request) => {
    const auth = exiger(request, "mission.planifier");
    const { id, elementId } = paramsElement.parse(request.params);
    const modif = schema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      const avant = await lireElement(db, type, id, elementId);
      const set = clauseSet(modif, 3);
      await traduireErreursPg(
        db.query(
          `UPDATE ${e.table} SET ${set.sql}, modifie_le = now() WHERE id = $1 AND mission_id = $2`,
          [elementId, id, ...set.valeurs],
        ),
        {},
        PARENT_INCONNU,
      );
      const apres = await lireElement(db, type, id, elementId);
      const champs = Object.keys(modif);
      await journal(db, auth, "modification", `mission_${type}`, elementId, {
        mission_id: id,
        avant: choisir(avant, champs),
        apres: choisir(apres, champs),
      });
      return apres;
    });
  });

  app.delete(`/missions/:id/${chemin}/:elementId`, async (request, reply) => {
    const auth = exiger(request, "mission.planifier");
    const { id, elementId } = paramsElement.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      const avant = await lireElement(db, type, id, elementId);
      // Les éléments enfants, budgets et dépendances suivent (cascade).
      await db.query(`DELETE FROM ${e.table} WHERE id = $1 AND mission_id = $2`, [elementId, id]);
      await journal(db, auth, "suppression", `mission_${type}`, elementId, {
        mission_id: id,
        avant: choisir(avant, ["libelle", "phase_id", "lot_id", "ordre"]),
      });
    });
    return reply.status(204).send();
  });
}

/** Découpage, budget en jours, dépendances et planning d'une mission (PLN-01 à PLN-03). */
export const routesDecoupage: FastifyPluginAsync = async (app) => {
  app.get("/missions/:id/decoupage", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const d = await chargerDecoupage(db, id);
      const avecBudget = aPermission(auth.roles, "budget.lire_jours");
      const lignesDe = (tacheId: unknown) =>
        d.lignes.filter((l) => l.tache_id === tacheId).map(({ tache_id: _t, ...l }) => l);
      const tache = (t: Record<string, unknown>) =>
        avecBudget ? { ...t, budget: lignesDe(t.id) } : t;
      return {
        phases: d.phases.map((p) => ({
          ...p,
          lots: d.lots
            .filter((l) => l.phase_id === p.id)
            .map((l) => ({ ...l, taches: d.taches.filter((t) => t.lot_id === l.id).map(tache) })),
          taches: d.taches.filter((t) => t.phase_id === p.id && t.lot_id === null).map(tache),
        })),
        jalons: d.jalons,
        dependances: d.dependances,
      };
    });
  });

  app.post("/missions/:id/phases", async (request, reply) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const p = phaseCreationSchema.parse(request.body);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      const r = await db.query(
        `INSERT INTO mission_phases (cabinet_id, mission_id, libelle, ordre) VALUES ($1, $2, $3, $4)
         RETURNING ${ELEMENTS.phase.colonnes}`,
        [auth.cabinetId, id, p.libelle, p.ordre],
      );
      await journal(db, auth, "creation", "mission_phase", r.rows[0].id, { mission_id: id, ...p });
      return r.rows[0];
    });
    reply.status(201);
    return creee;
  });

  app.post("/missions/:id/lots", async (request, reply) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const l = lotCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO mission_lots (cabinet_id, mission_id, phase_id, libelle, ordre, est_livrable)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ELEMENTS.lot.colonnes}`,
          [auth.cabinetId, id, l.phase_id, l.libelle, l.ordre, l.est_livrable],
        ),
        {},
        PARENT_INCONNU,
      );
      await journal(db, auth, "creation", "mission_lot", r.rows[0].id, { mission_id: id, ...l });
      return r.rows[0];
    });
    reply.status(201);
    return cree;
  });

  app.post("/missions/:id/taches", async (request, reply) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const t = tacheCreationSchema.parse(request.body);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      const parent = await parentDeTache(db, id, t.parent_id);
      const r = await db.query(
        `INSERT INTO mission_taches (cabinet_id, mission_id, phase_id, lot_id, libelle, ordre,
           est_livrable, date_debut, duree_jours_ouvres)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${ELEMENTS.tache.colonnes}`,
        [
          auth.cabinetId,
          id,
          parent.phaseId,
          parent.lotId,
          t.libelle,
          t.ordre,
          t.est_livrable,
          t.date_debut,
          t.duree_jours_ouvres,
        ],
      );
      await journal(db, auth, "creation", "mission_tache", r.rows[0].id, { mission_id: id, ...t });
      return r.rows[0];
    });
    reply.status(201);
    return creee;
  });

  app.post("/missions/:id/jalons", async (request, reply) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const j = jalonCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO mission_jalons (cabinet_id, mission_id, phase_id, libelle, date_prevue, atteint, ordre)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${ELEMENTS.jalon.colonnes}`,
          [auth.cabinetId, id, j.phase_id, j.libelle, j.date_prevue, j.atteint, j.ordre],
        ),
        {},
        PARENT_INCONNU,
      );
      await journal(db, auth, "creation", "mission_jalon", r.rows[0].id, { mission_id: id, ...j });
      return r.rows[0];
    });
    reply.status(201);
    return cree;
  });

  routesElement(app, "phase", "phases", phaseModificationSchema);
  routesElement(app, "lot", "lots", lotModificationSchema);
  routesElement(app, "tache", "taches", tacheModificationSchema);
  routesElement(app, "jalon", "jalons", jalonModificationSchema);

  /** Budget en jours d'une tâche (PLN-02) : remplace toutes ses lignes. */
  app.put("/missions/:id/taches/:elementId/budget", async (request) => {
    const auth = exiger(request, "budget.ecrire");
    const { id, elementId } = paramsElement.parse(request.params);
    const { lignes } = tacheBudgetSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      await lireElement(db, "tache", id, elementId);
      await db.query("DELETE FROM tache_budget_lignes WHERE tache_id = $1 AND mission_id = $2", [
        elementId,
        id,
      ]);
      for (const l of lignes) {
        await traduireErreursPg(
          db.query(
            `INSERT INTO tache_budget_lignes (cabinet_id, mission_id, tache_id, grade_id,
               collaborateur_id, jours)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              auth.cabinetId,
              id,
              elementId,
              l.grade_id ?? null,
              l.collaborateur_id ?? null,
              l.jours,
            ],
          ),
          {},
          "Grade ou collaborateur inconnu dans ce cabinet.",
        );
      }
      await journal(db, auth, "budget_jours", "mission_tache", elementId, {
        mission_id: id,
        lignes: lignes.length,
      });
      const d = await chargerDecoupage(db, id);
      return {
        tache_id: elementId,
        lignes: d.lignes.filter((l) => l.tache_id === elementId),
      };
    });
  });

  /** Réorganisation (glisser-déposer) : tout ou rien, dans une seule transaction. */
  app.post("/missions/:id/reorganiser", async (request) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const { deplacements } = reorganisationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      for (const dpl of deplacements) {
        await deplacer(db, id, dpl);
      }
      await journal(db, auth, "reorganisation", "mission", id, {
        deplacements: deplacements.map((d) => ({ type: d.type, id: d.id })),
      });
      const d = await chargerDecoupage(db, id);
      return { phases: d.phases, lots: d.lots, taches: d.taches, jalons: d.jalons };
    });
  });

  app.post("/missions/:id/dependances", async (request, reply) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const dep = dependanceCreationSchema.parse(request.body);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      // La mission est verrouillée : deux ajouts concurrents ne peuvent pas former un cycle.
      const mission = await exigerMissionModifiable(db, auth, id);
      const d = await chargerDecoupage(db, id);
      for (const tacheId of [dep.predecesseur_id, dep.successeur_id]) {
        if (!d.taches.some((t) => t.id === tacheId))
          throw requeteInvalide("Tâche inconnue dans cette mission.");
      }
      const calendrier = await chargerCalendrier(db, auth.cabinetId);
      // Détection de cycle par le moteur (CycleDependancesError → 409).
      planifier(
        mission,
        { taches: d.taches, dependances: [...d.dependances, { ...dep }] },
        calendrier,
      );
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO mission_dependances (cabinet_id, mission_id, predecesseur_id, successeur_id, decalage)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, predecesseur_id, successeur_id, decalage`,
          [auth.cabinetId, id, dep.predecesseur_id, dep.successeur_id, dep.decalage],
        ),
        { "*": "Cette dépendance existe déjà." },
        "Tâche inconnue dans cette mission.",
      );
      await journal(db, auth, "creation", "mission_dependance", r.rows[0].id, {
        mission_id: id,
        ...dep,
      });
      return r.rows[0];
    });
    reply.status(201);
    return creee;
  });

  app.delete("/missions/:id/dependances/:elementId", async (request, reply) => {
    const auth = exiger(request, "mission.planifier");
    const { id, elementId } = paramsElement.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      const r = await db.query(
        "DELETE FROM mission_dependances WHERE id = $1 AND mission_id = $2 RETURNING id",
        [elementId, id],
      );
      if (!r.rowCount) throw introuvable("Dépendance");
      await journal(db, auth, "suppression", "mission_dependance", elementId, { mission_id: id });
    });
    return reply.status(204).send();
  });

  /** Planning (PLN-03) : dates au plus tôt en jours ouvrés du cabinet, par le moteur. */
  app.get("/missions/:id/planning", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionVisible(db, auth, id);
      const d = await chargerDecoupage(db, id);
      const dates = planifier(mission, d, await chargerCalendrier(db, auth.cabinetId));
      return {
        taches: d.taches.map((t) => ({
          id: t.id,
          libelle: t.libelle,
          phase_id: t.phase_id,
          lot_id: t.lot_id,
          duree_jours_ouvres: t.duree_jours_ouvres,
          ...dates.get(t.id as string),
        })),
        jalons: d.jalons,
        dependances: d.dependances,
      };
    });
  });

  /** Synthèse en jours (PLN-02) : budget agrégé mission > phase > lot > tâche par le moteur. */
  app.get("/missions/:id/synthese", async (request) => {
    const auth = exiger(request, "budget.lire_jours");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const d = await chargerDecoupage(db, id);
      return { arborescence: agregerDecoupage(id, d), jalons: d.jalons };
    });
  });
};

type Deplacement = z.infer<typeof reorganisationSchema>["deplacements"][number];

async function deplacer(db: Db, missionId: string, d: Deplacement): Promise<void> {
  const exiger1 = (r: { rowCount: number | null }, quoi: string) => {
    if (!r.rowCount) throw introuvable(quoi);
  };
  if (d.type === "phase") {
    if (d.parent_id) throw requeteInvalide("Une phase n'a pas de parent.");
    exiger1(
      await db.query(
        "UPDATE mission_phases SET ordre = $3, modifie_le = now() WHERE id = $1 AND mission_id = $2",
        [d.id, missionId, d.ordre],
      ),
      "Phase",
    );
  } else if (d.type === "lot") {
    if (!d.parent_id) throw requeteInvalide("Un lot se place sous une phase.");
    const r = await traduireErreursPg(
      db.query(
        `UPDATE mission_lots SET phase_id = $3, ordre = $4, modifie_le = now()
         WHERE id = $1 AND mission_id = $2`,
        [d.id, missionId, d.parent_id, d.ordre],
      ),
      {},
      PARENT_INCONNU,
    );
    exiger1(r, "Lot");
  } else if (d.type === "tache") {
    if (!d.parent_id) throw requeteInvalide("Une tâche se place sous une phase ou un lot.");
    const parent = await parentDeTache(db, missionId, d.parent_id);
    exiger1(
      await db.query(
        `UPDATE mission_taches SET phase_id = $3, lot_id = $4, ordre = $5, modifie_le = now()
         WHERE id = $1 AND mission_id = $2`,
        [d.id, missionId, parent.phaseId, parent.lotId, d.ordre],
      ),
      "Tâche",
    );
  } else {
    const r = await traduireErreursPg(
      db.query(
        `UPDATE mission_jalons SET phase_id = $3, ordre = $4, modifie_le = now()
         WHERE id = $1 AND mission_id = $2`,
        [d.id, missionId, d.parent_id ?? null, d.ordre],
      ),
      {},
      PARENT_INCONNU,
    );
    exiger1(r, "Jalon");
  }
}
