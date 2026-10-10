import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { syntheseConformite, type StatutConformite } from "@missionpilot/engines";
import {
  appelOffresCreationSchema,
  appelOffresModificationSchema,
  appelOffresStatutSchema,
  appelsOffresImportSchema,
  appelsOffresQuerySchema,
  decisionExtractionSchema,
  decisionGoNoGoSchema,
  dossierAppelOffresSchema,
  etapeRetroplanningModificationSchema,
  etapeTacheSchema,
  evaluationGoNoGoSchema,
  exigenceCreationSchema,
  exigenceModificationSchema,
  extractionExigencesSchema,
  retroplanningGenerationSchema,
} from "@missionpilot/shared";
import {
  ajouterDossier,
  ajouterExigence,
  dossiersDeFiche,
  exigerFicheOuverte,
  exigerFichierTexte,
  extractionsDeFiche,
  extraireExigences,
  historiqueExigence,
  lireTexteBorne,
  matriceDeFiche,
  modifierExigence,
  trancherExtraction,
} from "../appels-offres/exigences.js";
import { traduireErreurAppelsOffres } from "../appels-offres/erreurs.js";
import {
  changerStatut,
  CLE_TRI_AO,
  COLONNES_AO,
  creerFiche,
  DEPUIS_AO,
  evenementsDeFiche,
  importerFiches,
  lireFiche,
  modifierFiche,
  vueFiche,
} from "../appels-offres/fiches.js";
import { deciderFiche, evaluerFiche, lireGoNoGo } from "../appels-offres/go-no-go.js";
import {
  alertesAppelsOffresCabinet,
  aujourdhuiUtc,
  confierEtape,
  genererRetroplanning,
  lireRetroplanning,
  modifierEtape,
  personnesAssignables,
} from "../appels-offres/retroplanning.js";
import { exiger } from "../auth/contexte.js";
import { AppError, introuvable } from "../errors.js";
import { motifContient, paginer, paramsId } from "../http/outils.js";
import { envoyerEmails, type NotificationCreee } from "../notifications/notifier.js";
import { exigerFichierLisible } from "../stockage/fichiers.js";
import { FichierAbsent, stockageDe } from "../stockage/index.js";
import { decoderCurseurCreation, type CleTri } from "./missions.js";

/**
 * Appels d'offres, lot AO-A (AO-01 à AO-03, AO-08, PRD complémentaire §9), monté sous /api.
 *
 * - Droits : `ao.lire` (lecture), `ao.gerer` (fiches, évaluations, dossiers, matrice,
 *   rétro-planning), `ao.decider` (décision go/no-go : associé seul, doublé en base MPA03) ;
 *   en plus `ia.utiliser` pour l'extraction par l'IA, `tache.assigner` pour confier une étape,
 *   `finance.lire` pour saisir ou lire la marge estimée (FIN-02). Les fiches sont une donnée
 *   commerciale du cabinet (RLS) ; aucune route n'est ouverte au portail client
 *   (`LISTE_BLANCHE_PORTAIL`, tables `portail_interdit`).
 * - Aucun appel externe : la veille est une saisie ou un import manuel ; l'IA passe par
 *   l'orchestrateur (repli déterministe) et ne produit que des brouillons à valider.
 * - Scores, synthèse de conformité, rétro-planning et alertes : packages/engines/src/appels-offres.
 * - Chaque écriture est journalisée dans sa transaction, sans contenu de dossier.
 */

const MESSAGE_DEPOT =
  "Dépôt refusé : toutes les exigences obligatoires doivent être conformes ou sans objet.";

function routesFiches(app: FastifyInstance) {
  app.get("/appels-offres", async (request) => {
    const auth = exiger(request, "ao.lire");
    const q = appelsOffresQuerySchema.parse(request.query);
    const apres = decoderCurseurCreation(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_AO}, ${CLE_TRI_AO} AS cle_tri FROM ${DEPUIS_AO}
         WHERE ($1::text IS NULL OR a.statut = $1)
           AND ($2::text IS NULL OR a.titre ILIKE $2 OR a.bailleur ILIKE $2 OR a.reference ILIKE $2)
           AND ($3::timestamptz IS NULL OR (a.cree_le, a.id) < ($3::timestamptz, $4::uuid))
         ORDER BY a.cree_le DESC, a.id DESC LIMIT $5`,
        [
          q.statut ?? null,
          motifContient(q.q),
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const page = paginer(r.rows as (Record<string, unknown> & CleTri)[], q.limite);
      return { elements: page.elements.map(vueFiche), suivant: page.curseur_suivant };
    });
  });

  app.post("/appels-offres", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const corps = appelOffresCreationSchema.parse(request.body);
    const fiche = await app.db.withTenant(auth.cabinetId, (db) => creerFiche(db, auth, corps));
    reply.status(201);
    return fiche;
  });

  app.post("/appels-offres/import", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const lot = appelsOffresImportSchema.parse(request.body);
    const r = await app.db.withTenant(auth.cabinetId, (db) => importerFiches(db, auth, lot));
    reply.status(201);
    return r;
  });

  app.get("/appels-offres/alertes", async (request) => {
    const auth = exiger(request, "ao.lire");
    return app.db.withTenant(auth.cabinetId, (db) =>
      alertesAppelsOffresCabinet(db, aujourdhuiUtc()),
    );
  });

  app.get("/appels-offres/:id", async (request) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => ({
      ...(await lireFiche(db, id)),
      evenements: await evenementsDeFiche(db, id),
    }));
  });

  app.patch("/appels-offres/:id", async (request) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = appelOffresModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierFiche(db, auth, id, corps));
  });

  /** Dépôt (matrice satisfaite), puis gagné ou perdu ; « en réponse » et « no-go » : décision. */
  app.post("/appels-offres/:id/statut", async (request) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = appelOffresStatutSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const fiche = await lireFiche(db, id, true);
      if (corps.statut === "depose") {
        const lignes = await db.query(
          "SELECT statut, obligatoire FROM ao_exigences WHERE ao_id = $1",
          [id],
        );
        const s = syntheseConformite(
          lignes.rows as { statut: StatutConformite; obligatoire: boolean }[],
        );
        if (!s.pretAuDepot) throw new AppError(409, "AO_MATRICE_NON_CONFORME", MESSAGE_DEPOT);
      }
      await changerStatut(db, auth, fiche, corps.statut, corps.motif ?? null);
      return lireFiche(db, id);
    });
  });
}

function routesGoNoGo(app: FastifyInstance) {
  app.get("/appels-offres/:id/go-no-go", async (request) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await lireFiche(db, id);
      return lireGoNoGo(db, auth, id);
    });
  });

  app.post("/appels-offres/:id/evaluations", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = evaluationGoNoGoSchema.parse(request.body);
    const r = await app.db.withTenant(auth.cabinetId, (db) => evaluerFiche(db, auth, id, corps));
    reply.status(201);
    return r;
  });

  app.post("/appels-offres/:id/decision", async (request, reply) => {
    const auth = exiger(request, "ao.decider");
    const { id } = paramsId.parse(request.params);
    const corps = decisionGoNoGoSchema.parse(request.body);
    const r = await app.db.withTenant(auth.cabinetId, (db) => deciderFiche(db, auth, id, corps));
    reply.status(201);
    return r;
  });
}

function routesExigences(app: FastifyInstance) {
  app.get("/appels-offres/:id/dossiers", async (request) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await lireFiche(db, id);
      return { elements: await dossiersDeFiche(db, id) };
    });
  });

  app.post("/appels-offres/:id/dossiers", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = dossierAppelOffresSchema.parse(request.body);
    let texte = corps.texte ?? null;
    let fichier: { nom: string } | null = null;
    if (corps.fichier_id) {
      const f = await app.db.withTenant(auth.cabinetId, async (db) => {
        await exigerFicheOuverte(db, id);
        const lu = await exigerFichierLisible(db, auth, corps.fichier_id as string);
        exigerFichierTexte(lu);
        return lu;
      });
      try {
        texte = await lireTexteBorne(
          await stockageDe(app.config).lire(auth.cabinetId, f.cle_stockage),
        );
      } catch (error) {
        if (error instanceof FichierAbsent) throw introuvable("Fichier");
        throw error;
      }
      fichier = { nom: f.nom };
    }
    const dossier = await app.db.withTenant(auth.cabinetId, (db) =>
      ajouterDossier(db, auth, id, texte as string, fichier),
    );
    reply.status(201);
    return dossier;
  });

  app.get("/appels-offres/:id/extractions", async (request) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await lireFiche(db, id);
      return { elements: await extractionsDeFiche(db, id) };
    });
  });

  /** Extraction (brouillon) : IA par l'orchestrateur, ou découpage déterministe. */
  app.post("/appels-offres/:id/extractions", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = extractionExigencesSchema.parse(request.body);
    if (corps.mode === "ia") exiger(request, "ia.utiliser");
    const { extraction, resultat } = await extraireExigences(
      app.db,
      { config: app.config, journal: (e: unknown) => app.log.info({ ia: e }) },
      auth,
      id,
      corps,
    );
    if (resultat) await apresValidation(app, resultat.notifications);
    reply.status(201);
    return extraction;
  });

  app.post("/appels-offres/extractions/:id/decision", async (request) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = decisionExtractionSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => trancherExtraction(db, auth, id, corps));
  });

  app.get("/appels-offres/:id/exigences", async (request) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await lireFiche(db, id);
      return matriceDeFiche(db, id);
    });
  });

  app.post("/appels-offres/:id/exigences", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = exigenceCreationSchema.parse(request.body);
    const r = await app.db.withTenant(auth.cabinetId, (db) => ajouterExigence(db, auth, id, corps));
    reply.status(201);
    return r;
  });

  app.patch("/appels-offres/exigences/:id", async (request) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = exigenceModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierExigence(db, auth, id, corps));
  });

  app.get("/appels-offres/exigences/:id/historique", async (request) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => historiqueExigence(db, id));
  });
}

function routesRetroplanning(app: FastifyInstance) {
  /**
   * Personnes à qui confier une étape : `tache.assigner` (le droit de confier), sans dépendre de
   * `collaborateurs.lire`. N'expose que les utilisateurs actifs qui ont `ao.lire`.
   */
  app.get("/appels-offres/assignables", async (request) => {
    const auth = exiger(request, "tache.assigner");
    return app.db.withTenant(auth.cabinetId, (db) => personnesAssignables(db));
  });

  app.get("/appels-offres/:id/retroplanning", async (request) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireRetroplanning(db, id, aujourdhuiUtc()));
  });

  app.post("/appels-offres/:id/retroplanning", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    retroplanningGenerationSchema.parse(request.body ?? {});
    const r = await app.db.withTenant(auth.cabinetId, (db) =>
      genererRetroplanning(db, auth, id, aujourdhuiUtc()),
    );
    reply.status(201);
    return r;
  });

  app.patch("/appels-offres/retroplanning/:id", async (request) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = etapeRetroplanningModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, (db) => modifierEtape(db, auth, id, corps));
  });

  /** Confier une étape par une tâche assignée (SOC-08) : `tache.assigner` en plus. */
  app.post("/appels-offres/retroplanning/:id/tache", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    exiger(request, "tache.assigner");
    const { id } = paramsId.parse(request.params);
    const corps = etapeTacheSchema.parse(request.body);
    const { etape, notifications } = await app.db.withTenant(auth.cabinetId, (db) =>
      confierEtape(db, auth, id, corps),
    );
    await apresValidation(app, notifications);
    reply.status(201);
    return etape;
  });
}

/** Envoie les e-mails des notifications après validation de la transaction. */
const apresValidation = (app: FastifyInstance, n: readonly (NotificationCreee | null)[]) =>
  envoyerEmails(app.mailer, n, (m) => app.log.warn(m));

export const routesAppelsOffres: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurAppelsOffres(error);
  });
  routesFiches(app);
  routesGoNoGo(app);
  routesExigences(app);
  routesRetroplanning(app);
};
