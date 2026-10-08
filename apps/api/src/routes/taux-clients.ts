import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { tauxClientCreationSchema, tauxClientModificationSchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import { clauseSet, traduireErreursPg } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { conflit, introuvable, requeteInvalide } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { nombre } from "../missions/outils.js";

const COLONNES = `t.id, t.client_id, t.grade_id, g.code AS grade_code, g.libelle AS grade_libelle,
  t.taux, t.devise, t.valide_du::text AS valide_du, t.valide_au::text AS valide_au, t.cree_par,
  t.cree_le, t.modifie_le`;
const DEPUIS = "taux_clients t JOIN grades g ON g.id = t.grade_id";
const DOUBLON =
  "Un taux existe déjà pour ce client, ce grade, cette devise et ce début de validité.";

const vue = (t: Record<string, unknown>) => ({ ...t, taux: nombre(t.taux) });

/** Taux négociés : grille de taux (FIN-02), « taux.gerer » ET « finance.lire ». */
function exigerGrille(request: FastifyRequest): Auth {
  exiger(request, "finance.lire");
  return exiger(request, "taux.gerer");
}

async function lire(db: Db, id: string, verrouiller = false): Promise<Record<string, unknown>> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM ${DEPUIS} WHERE t.id = $1 ${verrouiller ? "FOR UPDATE OF t" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Taux négocié");
  return r.rows[0];
}

/**
 * Taux de vente négociés par client et par grade (FIN-02). Ils priment sur le
 * taux standard du grade (après les taux fixés à la signature ou dans la
 * proposition) dans la génération des propositions et le calcul du budget
 * (missions/budget.ts, moteur `resoudreTauxGrade`).
 */
export const routesTauxClients: FastifyPluginAsync = async (app) => {
  app.get("/clients/:id/taux", async (request) => {
    const auth = exigerGrille(request);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const c = await db.query("SELECT 1 FROM clients WHERE id = $1", [id]);
      if (!c.rowCount) throw introuvable("Client");
      const r = await db.query(
        `SELECT ${COLONNES} FROM ${DEPUIS} WHERE t.client_id = $1
         ORDER BY g.ordre, g.code, t.devise, t.valide_du NULLS FIRST, t.id`,
        [id],
      );
      return { elements: r.rows.map(vue) };
    });
  });

  app.post("/clients/:id/taux", async (request, reply) => {
    const auth = exigerGrille(request);
    const { id } = paramsId.parse(request.params);
    const t = tauxClientCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const c = await db.query("SELECT actif FROM clients WHERE id = $1", [id]);
      if (!c.rows[0]) throw introuvable("Client");
      if (!c.rows[0].actif) throw conflit("Le client est archivé.");
      const g = await db.query("SELECT actif FROM grades WHERE id = $1", [t.grade_id]);
      if (!g.rows[0]?.actif) throw requeteInvalide("Grade inconnu ou inactif dans ce cabinet.");
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO taux_clients (cabinet_id, client_id, grade_id, taux, devise, valide_du,
             valide_au, cree_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            auth.cabinetId,
            id,
            t.grade_id,
            t.taux,
            t.devise,
            t.valide_du,
            t.valide_au,
            auth.utilisateurId,
          ],
        ),
        { "*": DOUBLON },
      );
      // Grille de taux : le journal ne porte pas le montant (FIN-02).
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "taux_client",
        entiteId: r.rows[0].id,
        details: { client_id: id, grade_id: t.grade_id, devise: t.devise },
      });
      return vue(await lire(db, r.rows[0].id));
    });
    reply.status(201);
    return cree;
  });

  app.patch("/taux-clients/:id", async (request) => {
    const auth = exigerGrille(request);
    const { id } = paramsId.parse(request.params);
    const modif = tauxClientModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = await lire(db, id, true);
      const du = modif.valide_du === undefined ? avant.valide_du : modif.valide_du;
      const au = modif.valide_au === undefined ? avant.valide_au : modif.valide_au;
      if (du && au && String(au) < String(du)) {
        throw requeteInvalide("La fin de validité précède son début.");
      }
      const set = clauseSet(modif, 2);
      await traduireErreursPg(
        db.query(`UPDATE taux_clients SET ${set.sql}, modifie_le = now() WHERE id = $1`, [
          id,
          ...set.valeurs,
        ]),
        { "*": DOUBLON },
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "taux_client",
        entiteId: id,
        details: { client_id: avant.client_id, champs: Object.keys(modif) },
      });
      return vue(await lire(db, id));
    });
  });
};
