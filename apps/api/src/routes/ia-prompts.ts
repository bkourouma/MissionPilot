import type { FastifyPluginAsync } from "fastify";
import {
  promptActivationSchema,
  promptCreationSchema,
  promptsQuerySchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { avecErreursAgents, nonRegressionRequise } from "../agents/erreurs.js";
import { traduireErreursPg } from "../db/outils.js";
import { requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { reglerEvaluationLocale } from "../ia/evaluation.js";
import {
  assurerPromptsExemple,
  chargerPrompt,
  COLONNES_PROMPT,
  variablesDuPrompt,
} from "../ia/prompts.js";

/*
 * Prompts versionnés (PRD, « Architecture » ; migration 0101).
 * - GET (ia.utiliser) : un prompt par nom (sa version ACTIVE), ou toutes les
 *   versions d'un nom (`?nom=`), paginé par curseur.
 * - POST (ia.configurer) : nouvelle version (ajout seul), active par défaut ;
 *   SAUF si le prompt a un jeu d'essai (AGT-04) : une version neuve n'a encore
 *   aucune évaluation, elle est donc créée INACTIVE quand `activer` est omis, et
 *   `activer: true` explicite répond 409 NON_REGRESSION_REQUISE (rien n'est créé).
 * - POST /:id/activer (ia.configurer) : réactive une version existante ; la base
 *   refuse une version sans évaluation réussie (MPG04 → 409 NON_REGRESSION_REQUISE) ;
 *   hors production seulement, une évaluation sur le fournisseur local suffit
 *   (`reglerEvaluationLocale`, migration 0265).
 * Les prompts « exemple » de base sont semés à la première lecture.
 */

const ACTIVE = `(SELECT a.prompt_id FROM ia_prompt_activations a WHERE a.nom = p.nom
  ORDER BY a.id DESC LIMIT 1)`;

/** Le prompt est-il la version active de son nom ? (dernière activation, sinon plus haute version) */
const EST_ACTIF = `coalesce(p.id = ${ACTIVE},
  p.version = (SELECT max(v.version) FROM ia_prompts v WHERE v.nom = p.nom))`;

function vuePrompt(p: Record<string, unknown>): Record<string, unknown> {
  return {
    id: p.id,
    nom: p.nom,
    version: p.version,
    tache: p.tache,
    description: p.description,
    gabarit_systeme: p.gabarit_systeme,
    gabarit_utilisateur: p.gabarit_utilisateur,
    variables: p.variables,
    schema_sortie: p.schema_sortie,
    exemple: p.exemple,
    auteur_id: p.auteur_id,
    cree_le: p.cree_le,
    actif: p.actif,
  };
}

async function lireAvecEtat(db: Db, id: string) {
  const r = await db.query(
    `SELECT ${COLONNES_PROMPT}, ${EST_ACTIF} AS actif FROM ia_prompts p WHERE p.id = $1`,
    [id],
  );
  return vuePrompt(r.rows[0]);
}

export const routesIaPrompts: FastifyPluginAsync = async (app) => {
  app.get("/ia/prompts", async (request) => {
    const auth = exiger(request, "ia.utiliser");
    const q = promptsQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await assurerPromptsExemple(db, auth.cabinetId);
      if (q.nom) {
        // Versions d'un nom, de la plus récente à la plus ancienne.
        const r = await db.query(
          `SELECT ${COLONNES_PROMPT}, ${EST_ACTIF} AS actif, lpad(p.version::text, 10, '0') AS cle_tri
           FROM ia_prompts p WHERE p.nom = $1
             AND ($2::text IS NULL OR (lpad(p.version::text, 10, '0'), p.id) < ($2, $3::uuid))
           ORDER BY cle_tri DESC, p.id DESC LIMIT $4`,
          [q.nom, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
        );
        const page = paginer(
          r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
          q.limite,
        );
        return { ...page, elements: page.elements.map(vuePrompt) };
      }
      const r = await db.query(
        `SELECT * FROM (
           SELECT DISTINCT ON (p.nom) ${COLONNES_PROMPT}, true AS actif, p.nom AS cle_tri
           FROM ia_prompts p
           ORDER BY p.nom, (p.id = ${ACTIVE}) DESC NULLS LAST, p.version DESC) t
         WHERE ($1::text IS NULL OR (t.cle_tri, t.id) > ($1, $2::uuid))
         ORDER BY t.cle_tri, t.id LIMIT $3`,
        [apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
      );
      const page = paginer(
        r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
        q.limite,
      );
      return { ...page, elements: page.elements.map(vuePrompt) };
    });
  });

  app.post("/ia/prompts", async (request, reply) => {
    const auth = exiger(request, "ia.configurer");
    const p = promptCreationSchema.parse(request.body);
    // `activer` vaut vrai par défaut dans le schéma : seule sa présence dans le
    // corps distingue une demande explicite.
    const activerExplicite =
      typeof request.body === "object" &&
      request.body !== null &&
      (request.body as Record<string, unknown>).activer !== undefined;
    const variables = variablesDuPrompt(p.gabarit_systeme, p.gabarit_utilisateur);
    if (variables.length > 30) throw requeteInvalide("30 variables au plus par prompt.");
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      await assurerPromptsExemple(db, auth.cabinetId);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `ia_prompt:${auth.cabinetId}:${p.nom}`,
      ]);
      const max = await db.query(
        "SELECT coalesce(max(version), 0) AS v FROM ia_prompts WHERE nom = $1",
        [p.nom],
      );
      const version = (max.rows[0].v as number) + 1;
      const jeu = await db.query("SELECT 1 FROM agents_jeux_essai WHERE prompt_nom = $1 LIMIT 1", [
        p.nom,
      ]);
      const sousJeuEssai = jeu.rowCount !== 0;
      if (sousJeuEssai && p.activer && activerExplicite) {
        throw nonRegressionRequise(
          "Ce prompt a un jeu d'essai : créez la version sans l'activer, évaluez-la, puis activez-la.",
        );
      }
      const activer = p.activer && !sousJeuEssai;
      const r = await traduireErreursPg(
        db.query(
          `INSERT INTO ia_prompts (cabinet_id, nom, version, tache, gabarit_systeme,
             gabarit_utilisateur, variables, schema_sortie, exemple, description, auteur_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [
            auth.cabinetId,
            p.nom,
            version,
            p.tache,
            p.gabarit_systeme,
            p.gabarit_utilisateur,
            variables,
            JSON.stringify(p.schema_sortie),
            p.exemple,
            p.description,
            auth.utilisateurId,
          ],
        ),
        { "*": "Une version de ce prompt vient d'être créée : réessayez." },
      );
      const id = r.rows[0].id as string;
      if (activer) {
        await reglerEvaluationLocale(db, app.config);
        await db.query(
          "INSERT INTO ia_prompt_activations (cabinet_id, nom, prompt_id, active_par) VALUES ($1, $2, $3, $4)",
          [auth.cabinetId, p.nom, id, auth.utilisateurId],
        );
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation_prompt_ia",
        entite: "ia_prompt",
        entiteId: id,
        details: { nom: p.nom, version, tache: p.tache, active: activer, exemple: p.exemple },
      });
      return lireAvecEtat(db, id);
    });
    return reply.status(201).send(cree);
  });

  app.post("/ia/prompts/:id/activer", async (request) => {
    const auth = exiger(request, "ia.configurer");
    const { id } = paramsId.parse(request.params);
    promptActivationSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const prompt = await chargerPrompt(db, id);
      await reglerEvaluationLocale(db, app.config);
      await avecErreursAgents(() =>
        db.query(
          "INSERT INTO ia_prompt_activations (cabinet_id, nom, prompt_id, active_par) VALUES ($1, $2, $3, $4)",
          [auth.cabinetId, prompt.nom, id, auth.utilisateurId],
        ),
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "activation_prompt_ia",
        entite: "ia_prompt",
        entiteId: id,
        details: { nom: prompt.nom, version: prompt.version },
      });
      return lireAvecEtat(db, id);
    });
  });
};
