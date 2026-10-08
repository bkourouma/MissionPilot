/*
 * Justificatif (FIN-05) — dette « chemin libre » (constat F5) soldée :
 * - le justificatif est un fichier TÉLÉVERSÉ par POST /debours/:id/justificatif
 *   (routes/fichiers.ts) : clé de stockage générée par le serveur, type et
 *   taille contrôlés par le contenu, servi par GET /fichiers/:id qui revérifie
 *   la visibilité du débours (deboursVisible) ;
 * - le champ texte `justificatif` (chemin) reste LU pour les anciens débours,
 *   mais n'accepte plus de nouvelle valeur : seul `null` (ou l'absence) passe.
 */
import type { FastifyPluginAsync } from "fastify";
import {
  deboursCreationSchema,
  deboursListeQuerySchema,
  deboursModificationSchema,
  deboursRejetSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import { clauseSet } from "../db/outils.js";
import { AppError, conflit, interdit, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { estAssocie, exigerMissionVisible, type MissionAcces } from "../missions/acces.js";
import { collaborateurDe } from "../planification/outils.js";
import {
  COLONNES_DEBOURS,
  DEPUIS_DEBOURS,
  deboursVisible,
  exigerDebours,
  vueDebours,
} from "../facturation/debours.js";
import { peutValiderDebours, voitDeboursMission } from "../facturation/outils.js";

/** Clé de tri décroissante (plus récent d'abord) compatible avec `paginer`. */
const CLE_RECENT = (col: string) =>
  `lpad((99999999999999999 - (extract(epoch FROM ${col}) * 1000000)::bigint)::text, 17, '0')`;

/** Le chemin libre n'est plus accepté : le justificatif se téléverse. */
function refuserCheminLibre(justificatif: string | null | undefined): void {
  if (justificatif !== null && justificatif !== undefined) {
    throw new AppError(
      400,
      "JUSTIFICATIF_PAR_TELEVERSEMENT",
      "Le justificatif se téléverse (POST /api/debours/:id/justificatif) : un chemin n'est plus accepté.",
    );
  }
}

function exigerAuteur(auth: Auth, debours: Record<string, unknown>): void {
  if (debours.auteur_id !== auth.utilisateurId) throw interdit();
}

/**
 * Décision sur un débours soumis (FIN-05) : un associé, ou le chef ou le
 * directeur de la mission (« debours.valider »), jamais l'auteur sauf associé.
 */
function exigerValideur(auth: Auth, mission: MissionAcces, debours: Record<string, unknown>): void {
  if (!peutValiderDebours(auth, mission)) {
    throw new AppError(
      403,
      "APPROBATION_REQUISE",
      "Ce débours est validé par le chef ou le directeur de la mission, ou un associé.",
    );
  }
  if (debours.auteur_id === auth.utilisateurId && !estAssocie(auth)) {
    throw new AppError(
      403,
      "APPROBATION_REQUISE",
      "L'auteur d'un débours ne le valide pas lui-même.",
    );
  }
  if (debours.statut !== "soumis") throw conflit("Seul un débours soumis se valide ou se rejette.");
}

/** Débours et notes de frais (FIN-05). */
export const routesDebours: FastifyPluginAsync = async (app) => {
  /** Déclare un débours (brouillon) pour soi, sur une mission visible et non clôturée. */
  app.post("/missions/:id/debours", async (request, reply) => {
    const auth = exiger(request, "debours.saisir");
    const { id } = paramsId.parse(request.params);
    const d = deboursCreationSchema.parse(request.body);
    refuserCheminLibre(d.justificatif);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionVisible(db, auth, id);
      if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
      const devise = d.devise ?? mission.devise;
      if (devise !== mission.devise) {
        throw requeteInvalide(
          `Un débours se saisit dans la devise de la mission (${mission.devise}).`,
        );
      }
      const moi = await collaborateurDe(db, auth.utilisateurId);
      if (!moi) throw conflit("Aucun collaborateur actif n'est rattaché à votre compte.");
      const r = await db.query(
        `INSERT INTO debours (cabinet_id, mission_id, collaborateur_id, auteur_id, date, categorie,
           libelle, montant, devise, refacturable, justificatif)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          auth.cabinetId,
          id,
          moi.id,
          auth.utilisateurId,
          d.date,
          d.categorie,
          d.libelle,
          d.montant,
          devise,
          d.refacturable,
          null,
        ],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "debours",
        entiteId: r.rows[0].id,
        details: { mission_id: id, categorie: d.categorie, refacturable: d.refacturable },
      });
      return vueDebours(await exigerDebours(db, r.rows[0].id));
    });
    reply.status(201);
    return cree;
  });

  /** Débours d'une mission : tous pour qui les valide ou les facture, sinon les siens. */
  app.get("/missions/:id/debours", async (request) => {
    const auth = exiger(request, "debours.saisir");
    const { id } = paramsId.parse(request.params);
    const q = deboursListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionVisible(db, auth, id);
      const tous = voitDeboursMission(auth, mission);
      const r = await db.query(
        `SELECT ${COLONNES_DEBOURS}, ${CLE_RECENT("d.cree_le")} AS cle_tri FROM ${DEPUIS_DEBOURS}
         WHERE d.mission_id = $1 AND ($2::boolean OR d.auteur_id = $3)
           AND ($4::text IS NULL OR d.statut = $4)
           AND ($5::text IS NULL OR (${CLE_RECENT("d.cree_le")}, d.id) > ($5, $6::uuid))
         ORDER BY cle_tri, d.id LIMIT $7`,
        [
          id,
          tous,
          auth.utilisateurId,
          q.statut ?? null,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const page = paginer(r.rows, q.limite);
      return { ...page, elements: page.elements.map(vueDebours) };
    });
  });

  /** Mes débours, toutes missions. */
  app.get("/debours", async (request) => {
    const auth = exiger(request, "debours.saisir");
    const q = deboursListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_DEBOURS}, ${CLE_RECENT("d.cree_le")} AS cle_tri FROM ${DEPUIS_DEBOURS}
         WHERE d.auteur_id = $1 AND ($2::text IS NULL OR d.statut = $2)
           AND ($3::text IS NULL OR (${CLE_RECENT("d.cree_le")}, d.id) > ($3, $4::uuid))
         ORDER BY cle_tri, d.id LIMIT $5`,
        [
          auth.utilisateurId,
          q.statut ?? null,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const page = paginer(r.rows, q.limite);
      return { ...page, elements: page.elements.map(vueDebours) };
    });
  });

  app.get("/debours/:id", async (request) => {
    const auth = exiger(request, "debours.saisir");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      vueDebours((await deboursVisible(db, auth, id)).debours),
    );
  });

  /** Modifie son débours en brouillon ou rejeté (un rejeté repasse en brouillon). */
  app.patch("/debours/:id", async (request) => {
    const auth = exiger(request, "debours.saisir");
    const { id } = paramsId.parse(request.params);
    const modif = deboursModificationSchema.parse(request.body);
    refuserCheminLibre(modif.justificatif);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { debours, mission } = await deboursVisible(db, auth, id, true);
      exigerAuteur(auth, debours);
      if (!["brouillon", "rejete"].includes(debours.statut as string)) {
        throw conflit("Seul un débours en brouillon ou rejeté se modifie.");
      }
      if (modif.devise !== undefined && modif.devise !== mission.devise) {
        throw requeteInvalide(
          `Un débours se saisit dans la devise de la mission (${mission.devise}).`,
        );
      }
      const set = clauseSet(modif, 2);
      await db.query(
        `UPDATE debours SET ${set.sql}${set.sql ? ", " : ""}statut = 'brouillon', modifie_le = now()
         WHERE id = $1`,
        [id, ...set.valeurs],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "debours",
        entiteId: id,
        details: { mission_id: debours.mission_id, champs: Object.keys(modif) },
      });
      return vueDebours(await exigerDebours(db, id));
    });
  });

  app.delete("/debours/:id", async (request, reply) => {
    const auth = exiger(request, "debours.saisir");
    const { id } = paramsId.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const { debours } = await deboursVisible(db, auth, id, true);
      exigerAuteur(auth, debours);
      if (!["brouillon", "rejete"].includes(debours.statut as string)) {
        throw conflit("Seul un débours en brouillon ou rejeté se supprime.");
      }
      await db.query("DELETE FROM debours WHERE id = $1", [id]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "suppression",
        entite: "debours",
        entiteId: id,
        details: { mission_id: debours.mission_id },
      });
    });
    return reply.status(204).send();
  });

  app.post("/debours/:id/soumettre", async (request) => {
    const auth = exiger(request, "debours.saisir");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { debours, mission } = await deboursVisible(db, auth, id, true);
      exigerAuteur(auth, debours);
      if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
      if (!["brouillon", "rejete"].includes(debours.statut as string)) {
        throw conflit("Seul un débours en brouillon ou rejeté se soumet.");
      }
      await db.query(
        "UPDATE debours SET statut = 'soumis', soumis_le = now(), modifie_le = now() WHERE id = $1",
        [id],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "soumission",
        entite: "debours",
        entiteId: id,
        details: { mission_id: debours.mission_id },
      });
      return vueDebours(await exigerDebours(db, id));
    });
  });

  app.post("/debours/:id/valider", async (request) => {
    const auth = exiger(request, "debours.saisir");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { debours, mission } = await deboursVisible(db, auth, id, true);
      exigerValideur(auth, mission, debours);
      await db.query(
        `UPDATE debours SET statut = 'valide', decide_par = $2, decide_le = now(), modifie_le = now()
         WHERE id = $1`,
        [id, auth.utilisateurId],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "validation",
        entite: "debours",
        entiteId: id,
        details: { mission_id: debours.mission_id, refacturable: debours.refacturable },
      });
      return vueDebours(await exigerDebours(db, id));
    });
  });

  app.post("/debours/:id/rejeter", async (request) => {
    const auth = exiger(request, "debours.saisir");
    const { id } = paramsId.parse(request.params);
    const { motif } = deboursRejetSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { debours, mission } = await deboursVisible(db, auth, id, true);
      exigerValideur(auth, mission, debours);
      await db.query(
        `UPDATE debours SET statut = 'rejete', motif_rejet = $2, decide_par = $3, decide_le = now(),
           modifie_le = now() WHERE id = $1`,
        [id, motif, auth.utilisateurId],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "rejet",
        entite: "debours",
        entiteId: id,
        details: { mission_id: debours.mission_id, motif },
      });
      return vueDebours(await exigerDebours(db, id));
    });
  });
};
