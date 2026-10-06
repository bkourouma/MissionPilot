import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  collaborateurCoutsSchema,
  collaborateurCreationSchema,
  collaborateurModificationSchema,
  TYPES_COLLABORATEUR,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { choisir, clauseSet, montant, traduireErreursPg } from "../db/outils.js";
import { introuvable } from "../errors.js";
import { decoderCurseur, motifContient, paginer, paramsId } from "../http/outils.js";

/**
 * Colonnes du référentiel, sans aucune donnée financière (FIN-02) : coûts et
 * taux vivent dans collaborateur_couts et ne passent que par /couts.
 */
const COLONNES = `c.id, c.utilisateur_id, c.nom, c.grade_id, g.code AS grade_code,
  g.libelle AS grade_libelle, c.competences, c.secteurs, c.langues, c.capacite_pct, c.type,
  c.actif, c.cree_le, c.modifie_le`;
const DEPUIS = "collaborateurs c LEFT JOIN grades g ON g.id = c.grade_id";
const CHAMPS = [
  "utilisateur_id",
  "nom",
  "grade_id",
  "competences",
  "secteurs",
  "langues",
  "capacite_pct",
  "type",
  "actif",
] as const;
const COLONNES_COUTS = `id, cout_journalier, taux_vente_specifique, cout_achat, devise,
  depuis_le::text AS depuis_le, cree_par, cree_le`;

const UNICITES = { "*": "Cet utilisateur est déjà rattaché à un collaborateur." };
const REFERENCE = "Utilisateur ou grade inconnu dans ce cabinet.";

const listeQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    actif: z.enum(["true", "false"]).optional(),
    type: z.enum(TYPES_COLLABORATEUR).optional(),
    grade_id: z.string().uuid().optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
    curseur: z.string().max(500).optional(),
  })
  .strict();

async function lire(db: Db, id: string): Promise<Record<string, unknown>> {
  const r = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE c.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Collaborateur");
  return r.rows[0];
}

const enMontants = (l: Record<string, unknown>) => ({
  ...l,
  cout_journalier: montant(l.cout_journalier),
  taux_vente_specifique: montant(l.taux_vente_specifique),
  cout_achat: montant(l.cout_achat),
});

/** Référentiel des collaborateurs (PLN-05, PLN-08) et leurs coûts (FIN-02). */
export const routesCollaborateurs: FastifyPluginAsync = async (app) => {
  app.get("/collaborateurs", async (request) => {
    const auth = exiger(request, "collaborateurs.lire");
    const q = listeQuery.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES}, lower(c.nom) AS cle_tri FROM ${DEPUIS}
         WHERE ($1::text IS NULL OR c.nom ILIKE $1 OR array_to_string(c.competences, ' ') ILIKE $1
                OR array_to_string(c.secteurs, ' ') ILIKE $1)
           AND ($2::boolean IS NULL OR c.actif = $2)
           AND ($3::text IS NULL OR c.type = $3)
           AND ($4::uuid IS NULL OR c.grade_id = $4)
           AND ($5::text IS NULL OR (lower(c.nom), c.id) > ($5, $6::uuid))
         ORDER BY lower(c.nom), c.id
         LIMIT $7`,
        [
          motifContient(q.q),
          q.actif === undefined ? null : q.actif === "true",
          q.type ?? null,
          q.grade_id ?? null,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      return paginer(r.rows, q.limite);
    });
  });

  app.get("/collaborateurs/:id", async (request) => {
    const auth = exiger(request, "collaborateurs.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lire(db, id));
  });

  app.post("/collaborateurs", async (request, reply) => {
    const auth = exiger(request, "collaborateurs.ecrire");
    const collab = collaborateurCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO collaborateurs (cabinet_id, ${CHAMPS.join(", ")})
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [auth.cabinetId, ...CHAMPS.map((c) => collab[c])],
        ),
        UNICITES,
        REFERENCE,
      );
      const id = r.rows[0].id as string;
      const lu = await lire(db, id);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "collaborateur",
        entiteId: id,
        details: { apres: choisir(lu, CHAMPS) },
      });
      return lu;
    });
    reply.status(201);
    return cree;
  });

  app.patch("/collaborateurs/:id", async (request) => {
    const auth = exiger(request, "collaborateurs.ecrire");
    const { id } = paramsId.parse(request.params);
    const modif = collaborateurModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = await lire(db, id);
      const set = clauseSet(modif, 2);
      await traduireErreursPg(
        db.query(`UPDATE collaborateurs SET ${set.sql}, modifie_le = now() WHERE id = $1`, [
          id,
          ...set.valeurs,
        ]),
        UNICITES,
        REFERENCE,
      );
      const apres = await lire(db, id);
      const champs = Object.keys(modif);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "collaborateur",
        entiteId: id,
        details: { avant: choisir(avant, champs), apres: choisir(apres, champs) },
      });
      return apres;
    });
  });

  app.get("/collaborateurs/:id/couts", async (request) => {
    const auth = exiger(request, "finance.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await lire(db, id);
      const r = await db.query(
        `SELECT ${COLONNES_COUTS}, depuis_le <= current_date AS en_vigueur_possible
         FROM collaborateur_couts WHERE collaborateur_id = $1 ORDER BY depuis_le DESC`,
        [id],
      );
      const historique = r.rows.map(({ en_vigueur_possible: _e, ...l }) => enMontants(l));
      // Ligne en vigueur : la plus récente dont la date d'effet est passée.
      const courantIndex = r.rows.findIndex((l) => l.en_vigueur_possible);
      return {
        collaborateur_id: id,
        courant: courantIndex >= 0 ? historique[courantIndex] : null,
        historique,
      };
    });
  });

  app.post("/collaborateurs/:id/couts", async (request, reply) => {
    const auth = exiger(request, "taux.gerer");
    const { id } = paramsId.parse(request.params);
    const couts = collaborateurCoutsSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      await lire(db, id);
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO collaborateur_couts (cabinet_id, collaborateur_id, cout_journalier,
             taux_vente_specifique, cout_achat, devise, depuis_le, cree_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLONNES_COUTS}`,
          [
            auth.cabinetId,
            id,
            couts.cout_journalier,
            couts.taux_vente_specifique,
            couts.cout_achat,
            couts.devise,
            couts.depuis_le,
            auth.utilisateurId,
          ],
        ),
        { "*": "Une ligne de coûts existe déjà à cette date d'effet." },
      );
      // Pas de montant dans le journal (FIN-02) : seulement la date d'effet.
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "collaborateur_couts",
        entiteId: r.rows[0].id,
        details: { collaborateur_id: id, depuis_le: couts.depuis_le },
      });
      return enMontants(r.rows[0]);
    });
    reply.status(201);
    return cree;
  });
};
