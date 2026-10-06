import type { FastifyPluginAsync } from "fastify";
import {
  commentaireCreationSchema,
  commentaireModificationSchema,
  commentairesQuerySchema,
  DELAI_MODIFICATION_COMMENTAIRE_MINUTES,
  mentionnablesQuerySchema,
  type TypeEntiteCollaboration,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { estAssocie } from "../missions/acces.js";
import { exiger, type Auth } from "../auth/contexte.js";
import { authDe, exigerEntiteVisible, voitEntite } from "../collaboration/entites.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, motifContient, paginer, paramsId } from "../http/outils.js";
import { envoyerEmails, notifier, type NotificationCreee } from "../notifications/notifier.js";

/*
 * Commentaires contextuels (SOC-08). Permission « commentaire.ecrire » (tous
 * les rôles) ET entité visible (collaboration/entites.ts), revérifiée à
 * chaque lecture et écriture.
 * - Texte brut renvoyé TEL QUEL (JSON) : il n'est jamais interprété comme
 *   HTML par l'API ; l'interface l'affiche comme du texte.
 * - Mentions : utilisateurs actifs du même cabinet qui voient l'entité ;
 *   chacun reçoit une notification (sans le texte du commentaire).
 * - Modification : par l'auteur, dans les 15 minutes, historisée (révisions).
 * - Suppression : logique (marquage), par l'auteur ou un associé.
 */

const CLE_TRI = "lpad(((extract(epoch FROM c.cree_le) * 1000000)::bigint)::text, 17, '0')";

const COLONNES = `c.id, c.entite_type, c.entite_id, c.auteur_id, u.nom AS auteur_nom,
  CASE WHEN s.commentaire_id IS NULL THEN coalesce(r.texte, c.texte) END AS texte,
  c.mentions, c.cree_le, r.cree_le AS modifie_le,
  c.cree_le + make_interval(mins => ${DELAI_MODIFICATION_COMMENTAIRE_MINUTES}) AS modifiable_jusqu_au,
  (s.commentaire_id IS NOT NULL) AS supprime, s.supprime_le, s.supprime_par`;

const DEPUIS = `commentaires c JOIN utilisateurs u ON u.id = c.auteur_id
  LEFT JOIN LATERAL (SELECT x.texte, x.cree_le FROM commentaire_revisions x
    WHERE x.commentaire_id = c.id ORDER BY x.cree_le DESC, x.id DESC LIMIT 1) r ON true
  LEFT JOIN commentaire_suppressions s ON s.commentaire_id = c.id`;

interface CommentaireDb extends Record<string, unknown> {
  id: string;
  entite_type: TypeEntiteCollaboration;
  entite_id: string;
  auteur_id: string;
  mentions: string[];
  supprime: boolean;
  modifiable_jusqu_au: Date;
}

/** Remplace les identifiants mentionnés par { id, nom } (un supprimé n'expose pas ses mentions). */
async function avecMentions(db: Db, lignes: CommentaireDb[]): Promise<Record<string, unknown>[]> {
  const ids = [...new Set(lignes.flatMap((l) => (l.supprime ? [] : l.mentions)))];
  const noms = new Map<string, string>();
  if (ids.length > 0) {
    const r = await db.query("SELECT id, nom FROM utilisateurs WHERE id = ANY ($1::uuid[])", [ids]);
    for (const u of r.rows) noms.set(u.id as string, u.nom as string);
  }
  return lignes.map((l) => ({
    ...l,
    mentions: l.supprime ? [] : l.mentions.map((id) => ({ id, nom: noms.get(id) ?? null })),
  }));
}

async function lireCommentaire(db: Db, id: string, verrouiller = false): Promise<CommentaireDb> {
  if (verrouiller) {
    // Sérialise modifications et suppression d'un même commentaire.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`commentaire:${id}`]);
  }
  const r = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE c.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Commentaire");
  return r.rows[0] as CommentaireDb;
}

/** Commentaire dont l'entité est visible, sinon 404 (même réponse qu'un inconnu). */
async function commentaireVisible(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<CommentaireDb> {
  const c = await lireCommentaire(db, id, verrouiller);
  if (!(await voitEntite(db, auth, c.entite_type, c.entite_id))) throw introuvable("Commentaire");
  return c;
}

/** Erreur du déclencheur des révisions (fenêtre dépassée, commentaire supprimé) → 409. */
async function sousControle<T>(action: Promise<T>): Promise<T> {
  try {
    return await action;
  } catch (error) {
    if ((error as { code?: string }).code === "MPC01") {
      throw new AppError(409, "COMMENTAIRE_FIGE", "Ce commentaire ne peut plus être modifié.");
    }
    throw error;
  }
}

export const routesCommentaires: FastifyPluginAsync = async (app) => {
  app.get("/commentaires", async (request) => {
    const auth = exiger(request, "commentaire.ecrire");
    const q = commentairesQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerEntiteVisible(db, auth, q.entite_type, q.entite_id);
      const r = await db.query(
        `SELECT ${COLONNES}, ${CLE_TRI} AS cle_tri FROM ${DEPUIS}
         WHERE c.entite_type = $1 AND c.entite_id = $2
           AND ($3::text IS NULL OR (${CLE_TRI}, c.id) > ($3, $4::uuid))
         ORDER BY cle_tri, c.id LIMIT $5`,
        [q.entite_type, q.entite_id, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
      );
      const page = paginer(r.rows as (CommentaireDb & { cle_tri: string })[], q.limite);
      return { ...page, elements: await avecMentions(db, page.elements as CommentaireDb[]) };
    });
  });

  /** Utilisateurs actifs du cabinet qui voient l'entité (pour composer une mention). */
  app.get("/commentaires/mentionnables", async (request) => {
    const auth = exiger(request, "commentaire.ecrire");
    const q = mentionnablesQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerEntiteVisible(db, auth, q.entite_type, q.entite_id);
      const r = await db.query(
        `SELECT id FROM utilisateurs WHERE actif AND id <> $1
           AND ($2::text IS NULL OR nom ILIKE $2)
         ORDER BY lower(nom), id LIMIT $3`,
        [auth.utilisateurId, motifContient(q.q), 50],
      );
      const elements: { id: string; nom: string }[] = [];
      for (const ligne of r.rows) {
        const autre = await authDe(db, auth.cabinetId, ligne.id as string);
        if (autre && (await voitEntite(db, autre, q.entite_type, q.entite_id))) {
          elements.push({ id: autre.utilisateurId, nom: autre.nom });
        }
      }
      return { elements };
    });
  });

  app.post("/commentaires", async (request, reply) => {
    const auth = exiger(request, "commentaire.ecrire");
    const c = commentaireCreationSchema.parse(request.body);
    const { cree, notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const entite = await exigerEntiteVisible(db, auth, c.entite_type, c.entite_id);
      const mentions = c.mentions.filter((id) => id !== auth.utilisateurId);
      // Mentions : utilisateurs actifs du cabinet (un autre cabinet est inconnu) qui voient l'entité.
      for (const id of mentions) {
        const autre = await authDe(db, auth.cabinetId, id);
        if (!autre) throw requeteInvalide("Utilisateur mentionné inconnu ou inactif.");
        if (!(await voitEntite(db, autre, c.entite_type, c.entite_id))) {
          throw requeteInvalide(`${autre.nom} n'a pas accès à cet élément : mention impossible.`);
        }
      }
      const k = entite.colonnes;
      const r = await db.query(
        `INSERT INTO commentaires (cabinet_id, entite_type, entite_id, mission_id, tache_id,
           facture_id, debours_id, opportunite_id, proposition_id, auteur_id, texte, mentions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          auth.cabinetId,
          c.entite_type,
          c.entite_id,
          k.mission_id,
          k.tache_id,
          k.facture_id,
          k.debours_id,
          k.opportunite_id,
          k.proposition_id,
          auth.utilisateurId,
          c.texte,
          mentions,
        ],
      );
      const id = r.rows[0].id as string;
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "commentaire",
        entiteId: id,
        // Jamais le texte dans le journal : il peut citer des données de la mission.
        details: { entite_type: c.entite_type, entite_id: c.entite_id, mentions: mentions.length },
      });
      const notifications: (NotificationCreee | null)[] = [];
      for (const destinataire of mentions) {
        notifications.push(
          await notifier(db, {
            cabinetId: auth.cabinetId,
            destinataireId: destinataire,
            type: "mention_commentaire",
            titre: `${auth.nom} vous a mentionné dans un commentaire`,
            lien: entite.lien,
            email: true,
          }),
        );
      }
      const [lu] = await avecMentions(db, [await lireCommentaire(db, id)]);
      return { cree: lu, notifications };
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    reply.status(201);
    return cree;
  });

  /** Modifie son commentaire dans les 15 minutes ; l'ancien texte reste dans l'historique. */
  app.patch("/commentaires/:id", async (request) => {
    const auth = exiger(request, "commentaire.ecrire");
    const { id } = paramsId.parse(request.params);
    const { texte } = commentaireModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const c = await commentaireVisible(db, auth, id, true);
      if (c.auteur_id !== auth.utilisateurId) throw interdit();
      if (c.supprime) throw conflit("Ce commentaire a été supprimé.");
      const ouvert = await db.query("SELECT $1::timestamptz >= now() AS ouvert", [
        c.modifiable_jusqu_au,
      ]);
      if (!ouvert.rows[0].ouvert) {
        throw new AppError(
          409,
          "DELAI_MODIFICATION_DEPASSE",
          `Un commentaire se modifie dans les ${DELAI_MODIFICATION_COMMENTAIRE_MINUTES} minutes suivant sa publication.`,
        );
      }
      await sousControle(
        db.query(
          `INSERT INTO commentaire_revisions (cabinet_id, commentaire_id, texte) VALUES ($1, $2, $3)`,
          [auth.cabinetId, id, texte],
        ),
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "commentaire",
        entiteId: id,
        details: { entite_type: c.entite_type, entite_id: c.entite_id },
      });
      const [lu] = await avecMentions(db, [await lireCommentaire(db, id)]);
      return lu;
    });
  });

  /** Textes successifs (initial puis révisions) ; rien pour un commentaire supprimé. */
  app.get("/commentaires/:id/historique", async (request) => {
    const auth = exiger(request, "commentaire.ecrire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const c = await commentaireVisible(db, auth, id);
      if (c.supprime) throw conflit("Ce commentaire a été supprimé.");
      const r = await db.query(
        `SELECT texte, cree_le FROM commentaires WHERE id = $1
         UNION ALL
         SELECT texte, cree_le FROM commentaire_revisions WHERE commentaire_id = $1
         ORDER BY cree_le`,
        [id],
      );
      return { elements: r.rows };
    });
  });

  /** Suppression logique : par l'auteur ou un associé ; le fil garde une trace. */
  app.delete("/commentaires/:id", async (request, reply) => {
    const auth = exiger(request, "commentaire.ecrire");
    const { id } = paramsId.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const c = await commentaireVisible(db, auth, id, true);
      if (c.auteur_id !== auth.utilisateurId && !estAssocie(auth)) throw interdit();
      if (c.supprime) throw conflit("Ce commentaire a déjà été supprimé.");
      await db.query(
        `INSERT INTO commentaire_suppressions (cabinet_id, commentaire_id, supprime_par)
         VALUES ($1, $2, $3)`,
        [auth.cabinetId, id, auth.utilisateurId],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "suppression",
        entite: "commentaire",
        entiteId: id,
        details: { entite_type: c.entite_type, entite_id: c.entite_id },
      });
    });
    return reply.status(204).send();
  });
};
