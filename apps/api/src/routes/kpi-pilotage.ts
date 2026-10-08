import type { FastifyPluginAsync } from "fastify";
import { kpiRevueDossierQuerySchema, kpiTableauQuerySchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { paramsId } from "../http/outils.js";
import {
  arbresDeMission,
  contributionsArbre,
  creerArbre,
  creerNoeud,
  detailArbre,
  exigerArbreVisible,
  modifierArbre,
  modifierNoeud,
} from "../kpi/arbres.js";
import {
  changerStatutAction,
  commenterAction,
  creerAction,
  detailAction,
  efficaciteDetaillee,
  exigerActionVisible,
  listerActions,
  modifierAction,
} from "../kpi/actions.js";
import { rapportRevueARendre } from "../kpi/dossier-revue.js";
import { qualiteMission } from "../kpi/qualite-donnees.js";
import {
  annulerRevue,
  changerStatutDecision,
  cloturerRevue,
  creerDecision,
  creerRevue,
  detailRevue,
  exigerRevueVisible,
  genererOrdreDuJour,
  listerRevues,
  modifierRevue,
  remplacerOrdreDuJour,
  tenirRevue,
} from "../kpi/revues.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { cheminNavigateur } from "../rapports/pdf.js";
import { lireParametresRapports } from "../rapports/parametres.js";
import { rendreRapport, TYPES_RAPPORT } from "../rapports/rendu.js";

/*
 * Pilotage augmenté des KPI (PRD complémentaire §11.4), monté par routes/kpi.ts sous /api :
 * KPI-13 arbres d'indicateurs, KPI-15 qualité des données, KPI-17 revues de performance,
 * KPI-18 actions correctives. Droits : `kpi.lire` (lecture), `kpi.gerer` (arbres et revues),
 * `kpi.saisir` (actions et statut des décisions), plus les règles de la mission (kpi/acces.ts) ;
 * un identifiant invisible, inconnu ou d'un autre cabinet répond 404. Tous les chiffres sortent
 * du moteur (packages/engines/src/kpi). Fermé au portail : aucune de ces routes n'est dans
 * LISTE_BLANCHE_PORTAIL et les tables sont en `portail_interdit`.
 */

/** Dossiers de revue téléchargeables par utilisateur sur la fenêtre glissante (comme les rapports). */
export const DOSSIERS_REVUE_PAR_FENETRE = 10;
export const FENETRE_DOSSIERS_REVUE_MINUTES = 10;
const ACTION_TELECHARGEMENT = "telechargement_dossier_revue_kpi";

/** Compte les dossiers déjà réservés par l'utilisateur sur la fenêtre (429 au-delà du plafond). */
async function verifierDebitDossiers(db: Db, auth: Auth): Promise<void> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM journal_audit
     WHERE utilisateur_id = $1 AND action = $2 AND cree_le > now() - make_interval(mins => $3)`,
    [auth.utilisateurId, ACTION_TELECHARGEMENT, FENETRE_DOSSIERS_REVUE_MINUTES],
  );
  if ((r.rows[0].n as number) >= DOSSIERS_REVUE_PAR_FENETRE) {
    throw new AppError(
      429,
      "TROP_DE_DOSSIERS_REVUE",
      `Au plus ${DOSSIERS_REVUE_PAR_FENETRE} dossiers de revue par ${FENETRE_DOSSIERS_REVUE_MINUTES} minutes : réessayez plus tard.`,
    );
  }
}

/**
 * Réserve un téléchargement AVANT le rendu : sous un verrou consultatif propre à l'utilisateur
 * (jusqu'à la fin de la transaction), compte les réservations de la fenêtre puis journalise la
 * réservation dans la même transaction. N demandes simultanées se sérialisent donc : au plus
 * DOSSIERS_REVUE_PAR_FENETRE rendus (DOCX, PPTX : coûteux) passent, les autres reçoivent 429 avant
 * tout rendu (même principe que rapports/enregistrement.ts). Un rendu qui échoue consomme tout de
 * même sa réservation : le plafond est un plafond de demandes, pas de succès.
 */
export async function reserverTelechargementDossier(
  db: Db,
  auth: Auth,
  revue: { id: string; statut: string },
  format: string,
): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `kpi_dossier_revue_debit:${auth.utilisateurId}`,
  ]);
  await verifierDebitDossiers(db, auth);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: ACTION_TELECHARGEMENT,
    entite: "kpi_revue",
    entiteId: revue.id,
    details: { format, statut: revue.statut },
  });
}

export const routesKpiPilotage: FastifyPluginAsync = async (app) => {
  /* ----- KPI-13 : arbres d'indicateurs ----- */

  app.get("/missions/:id/kpi/arbres", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      return arbresDeMission(db, id);
    });
  });

  app.post("/missions/:id/kpi/arbres", async (request, reply) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    const arbre = await app.db.withTenant(auth.cabinetId, (db) =>
      creerArbre(db, auth, id, request.body),
    );
    reply.status(201);
    return arbre;
  });

  app.get("/kpi/arbres/:id", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      detailArbre(db, (await exigerArbreVisible(db, auth, id)).arbre),
    );
  });

  app.patch("/kpi/arbres/:id", async (request) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => modifierArbre(db, auth, id, request.body));
  });

  app.post("/kpi/arbres/:id/noeuds", async (request, reply) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    const noeud = await app.db.withTenant(auth.cabinetId, (db) =>
      creerNoeud(db, auth, id, request.body),
    );
    reply.status(201);
    return noeud;
  });

  app.patch("/kpi/arbres/noeuds/:id", async (request) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => modifierNoeud(db, auth, id, request.body));
  });

  app.get("/kpi/arbres/:id/contributions", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) =>
      contributionsArbre(db, auth, id, request.query),
    );
  });

  /* ----- KPI-15 : qualité des données ----- */

  app.get("/missions/:id/kpi/qualite-donnees", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    const q = kpiTableauQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      return qualiteMission(db, id, q.date ?? aujourdhui());
    });
  });

  /* ----- KPI-18 : actions correctives ----- */

  app.get("/missions/:id/kpi/actions", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => listerActions(db, auth, id, request.query));
  });

  app.post("/missions/:id/kpi/actions", async (request, reply) => {
    const auth = exiger(request, "kpi.saisir");
    const { id } = paramsId.parse(request.params);
    const action = await app.db.withTenant(auth.cabinetId, (db) =>
      creerAction(db, auth, id, request.body),
    );
    reply.status(201);
    return action;
  });

  app.get("/kpi/actions/:id", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      detailAction(db, (await exigerActionVisible(db, auth, id)).action),
    );
  });

  app.patch("/kpi/actions/:id", async (request) => {
    const auth = exiger(request, "kpi.saisir");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => modifierAction(db, auth, id, request.body));
  });

  app.post("/kpi/actions/:id/statut", async (request) => {
    const auth = exiger(request, "kpi.saisir");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) =>
      changerStatutAction(db, auth, id, request.body),
    );
  });

  app.post("/kpi/actions/:id/commentaires", async (request, reply) => {
    const auth = exiger(request, "kpi.saisir");
    const { id } = paramsId.parse(request.params);
    const action = await app.db.withTenant(auth.cabinetId, (db) =>
      commenterAction(db, auth, id, request.body),
    );
    reply.status(201);
    return action;
  });

  app.get("/kpi/actions/:id/efficacite", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) =>
      efficaciteDetaillee(db, auth, id, request.query),
    );
  });

  /* ----- KPI-17 : revues de performance ----- */

  app.get("/missions/:id/kpi/revues", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => listerRevues(db, auth, id, request.query));
  });

  app.post("/missions/:id/kpi/revues", async (request, reply) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    const revue = await app.db.withTenant(auth.cabinetId, (db) =>
      creerRevue(db, auth, id, request.body),
    );
    reply.status(201);
    return revue;
  });

  app.get("/kpi/revues/:id", async (request) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => detailRevue(db, auth, id));
  });

  app.patch("/kpi/revues/:id", async (request) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => modifierRevue(db, auth, id, request.body));
  });

  app.post("/kpi/revues/:id/ordre-du-jour/generer", async (request) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => genererOrdreDuJour(db, auth, id));
  });

  app.put("/kpi/revues/:id/ordre-du-jour", async (request) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) =>
      remplacerOrdreDuJour(db, auth, id, request.body),
    );
  });

  app.post("/kpi/revues/:id/tenir", async (request) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => tenirRevue(db, auth, id, request.body));
  });

  app.post("/kpi/revues/:id/cloturer", async (request) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => cloturerRevue(db, auth, id));
  });

  app.post("/kpi/revues/:id/annuler", async (request) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => annulerRevue(db, auth, id));
  });

  app.post("/kpi/revues/:id/decisions", async (request, reply) => {
    const auth = exiger(request, "kpi.gerer");
    const { id } = paramsId.parse(request.params);
    const decision = await app.db.withTenant(auth.cabinetId, (db) =>
      creerDecision(db, auth, id, request.body),
    );
    reply.status(201);
    return decision;
  });

  app.post("/kpi/revues/decisions/:id/statut", async (request) => {
    const auth = exiger(request, "kpi.saisir");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) =>
      changerStatutDecision(db, auth, id, request.body),
    );
  });

  /**
   * Dossier de la revue : document (PDF, Word) ou présentation (PowerPoint) générés par le moteur
   * de rapports depuis le MÊME contenu. Non conservé : rendu à chaque demande, servi en pièce
   * jointe. Au plus DOSSIERS_REVUE_PAR_FENETRE téléchargements par utilisateur sur la fenêtre,
   * réservés (et journalisés) sous verrou AVANT le rendu.
   */
  app.get("/kpi/revues/:id/dossier", async (request, reply) => {
    const auth = exiger(request, "kpi.lire");
    const { id } = paramsId.parse(request.params);
    const { format } = kpiRevueDossierQuerySchema.parse(request.query);
    const { revue, rapport } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { revue } = await exigerRevueVisible(db, auth, id);
      await reserverTelechargementDossier(db, auth, revue, format);
      const base = await rapportRevueARendre(db, revue);
      const { mention_effective: mention } = await lireParametresRapports(db);
      return { revue, rapport: mention ? { ...base, mention_pied: mention } : base };
    });
    const { contenu } = await rendreRapport(rapport, format, {
      cheminNavigateur: format === "pdf" ? cheminNavigateur(app.config) : null,
      cabinetId: auth.cabinetId,
      plafondOctets: app.config.FICHIER_TAILLE_MAX_OCTETS,
    });
    const type = TYPES_RAPPORT[format];
    return reply
      .header("content-type", type.mime)
      .header(
        "content-disposition",
        `attachment; filename="Revue KPI ${revue.numero} ${revue.date_prevue}.${type.extension}"`,
      )
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "sandbox")
      .header("cache-control", "private, no-store")
      .send(contenu);
  });
};
