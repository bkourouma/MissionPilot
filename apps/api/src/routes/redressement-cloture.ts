import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  aPermission,
  rapportsListeQuerySchema,
  redClotureCreationSchema,
  redClotureRapportQuerySchema,
  redClotureValidationSchema,
} from "@missionpilot/shared";
import { exiger, type Auth } from "../auth/contexte.js";
import { conflit, interdit } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { enregistrerRapport, verifierDebitRapports } from "../rapports/enregistrement.js";
import { lireParametresRapports } from "../rapports/parametres.js";
import { cheminNavigateur } from "../rapports/pdf.js";
import { rendreRapport, type FormatRapport } from "../rapports/rendu.js";
import { exigerDossierRedEcriture, exigerDossierRedVisible } from "../redressement/acces.js";
import {
  clotureVisible,
  creerCloture,
  listerClotures,
  lireCloture,
  validerCloture,
} from "../redressement/cloture.js";
import { listerRapportsCloture, rapportCloture } from "../redressement/cloture-rapport.js";

/*
 * Bilan de clôture du redressement et rapport de clôture (RED-08, lot 2), plugin de
 * routes/redressement.ts. Le bilan compare l'état du dossier à l'ouverture et à la fin ; son contenu
 * est construit par le serveur depuis les moteurs (jamais reçu d'un client) et se valide avant la
 * clôture du dossier.
 *
 * - GET  /redressement/dossiers/:id/clotures — versions (30 au plus, sans contenu) ; `redressement.lire`.
 * - POST /redressement/dossiers/:id/clotures — nouveau brouillon depuis l'état courant (201) ;
 *   `redressement.ecrire`, dossier ouvert, plafond de débit (429 RED_TROP_DE_BILANS).
 * - GET  /redressement/clotures/:id — un bilan avec son contenu ; `redressement.lire`.
 * - POST /redressement/clotures/:id/validation — `redressement.valider`, RÉSERVÉE AU DIRECTEUR de la
 *   mission (403 VALIDATION_RESERVEE_DIRECTEUR), jamais le créateur sauf associé (403
 *   SEPARATION_DES_TACHES), contrôles bloquants satisfaits (409 RED_CLOTURE_INCOMPLETE), état du
 *   dossier inchangé (409 RED_CLOTURE_PERIMEE), dernière version (409).
 * - POST /redressement/clotures/:id/rapports?format=pdf|docx — rapport de clôture d'un bilan VALIDÉ
 *   (409 RED_CLOTURE_NON_VALIDEE sinon ; doublé en base, MPR05) ; `mission.lire` et
 *   `redressement.lire` ; même débit (429 TROP_DE_RAPPORTS), mêmes formats et même enregistrement que
 *   les autres rapports de service (routes/rapports.ts) ; niveau « red », confidentiel.
 * - GET  /redressement/clotures/:id/rapports — rapports de ce bilan, plus récent d'abord.
 *
 * Le fichier d'un rapport se télécharge par GET /fichiers/:id, qui revérifie mission visible,
 * `mission.lire` et `redressement.lire` à chaque appel. Fermé au portail (aucune entrée dans la liste
 * blanche). Le journal d'audit ne porte que des identifiants et des indicateurs.
 */

/**
 * Génère le rapport (même logique que `generer` de routes/rapports.ts) : contenu construit sous la
 * transaction du cabinet, mission visible et ouverte et débit contrôlés, mention du cabinet, rendu
 * hors transaction, puis enregistrement.
 */
async function genererRapportCloture(
  app: FastifyInstance,
  auth: Auth,
  clotureId: string,
  format: FormatRapport,
) {
  const date = aujourdhui();
  const c = await app.db.withTenant(auth.cabinetId, async (db) => {
    const construit = await rapportCloture(db, auth, clotureId, date);
    const mission = await exigerMissionVisible(db, auth, construit.source.missionId);
    if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
    await verifierDebitRapports(db, auth);
    const { mention_effective: mention } = await lireParametresRapports(db);
    return mention
      ? { ...construit, rapport: { ...construit.rapport, mention_pied: mention } }
      : construit;
  });
  const { rapport, contenu } = await rendreRapport(c.rapport, format, {
    cheminNavigateur: format === "pdf" ? cheminNavigateur(app.config) : null,
    cabinetId: auth.cabinetId,
    plafondOctets: app.config.FICHIER_TAILLE_MAX_OCTETS,
  });
  return enregistrerRapport(app, auth, {
    missionId: c.source.missionId,
    modele: "cloture_redressement",
    format,
    rapport,
    niveau: "red",
    contenu,
    source: { clotureId: c.source.clotureId, version: c.source.version },
  });
}

export const routesRedressementCloture: FastifyPluginAsync = async (app) => {
  app.get("/redressement/dossiers/:id/clotures", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      listerClotures(db, auth, await exigerDossierRedVisible(db, auth, id)),
    );
  });

  app.post("/redressement/dossiers/:id/clotures", async (request, reply) => {
    const auth = exiger(request, "redressement.ecrire");
    const { id } = paramsId.parse(request.params);
    redClotureCreationSchema.parse(request.body ?? {});
    const vue = await app.db.withTenant(auth.cabinetId, async (db) =>
      creerCloture(db, auth, await exigerDossierRedEcriture(db, auth, id)),
    );
    reply.status(201);
    return vue;
  });

  app.get("/redressement/clotures/:id", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => lireCloture(db, auth, id));
  });

  app.post("/redressement/clotures/:id/validation", async (request) => {
    const auth = exiger(request, "redressement.valider");
    const { id } = paramsId.parse(request.params);
    const corps = redClotureValidationSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, (db) => validerCloture(db, auth, id, corps));
  });

  app.post("/redressement/clotures/:id/rapports", async (request, reply) => {
    const auth = exiger(request, "mission.lire");
    if (!aPermission(auth.roles, "redressement.lire")) throw interdit();
    const { id } = paramsId.parse(request.params);
    const { format } = redClotureRapportQuerySchema.parse(request.query);
    const resultat = await genererRapportCloture(app, auth, id, format);
    reply.status(201);
    return resultat;
  });

  app.get("/redressement/clotures/:id/rapports", async (request) => {
    const auth = exiger(request, "redressement.lire");
    const { id } = paramsId.parse(request.params);
    const q = rapportsListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await clotureVisible(db, auth, id);
      return listerRapportsCloture(db, auth, id, q);
    });
  });
};
