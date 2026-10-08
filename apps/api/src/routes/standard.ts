import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  briqueCreationSchema,
  briqueModificationSchema,
  casTypeCreationSchema,
  comparaisonVersionsQuerySchema,
  derogationCreationSchema,
  derogationDecisionSchema,
  derogationsQuerySchema,
  elementMethodeCreationSchema,
  etapeCreationSchema,
  etapeModificationSchema,
  facteurCreationSchema,
  methodeCreationSchema,
  methodeListeQuerySchema,
  missionContexteSchema,
  missionMethodeLiaisonSchema,
  missionMigrationQuerySchema,
  missionMigrationSchema,
  noteContexteCreationSchema,
  noteContexteQuerySchema,
  propositionStandardCreationSchema,
  propositionStandardPublicationSchema,
  propositionStandardRevueSchema,
  propositionsStandardQuerySchema,
  regleModulationSchema,
  rubriqueCreationSchema,
  simulationModulationSchema,
  taxonomieCreationSchema,
  taxonomieQuerySchema,
  varianteCreationSchema,
  versionCreationSchema,
  versionModificationSchema,
} from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { paramsId } from "../http/outils.js";
import { lireContenu, sansIdentifiants } from "../standard/contenu.js";
import {
  demanderDerogation,
  deciderDerogation,
  lireDerogationVisible,
  listerDerogationsMission,
  tableauDerogations,
} from "../standard/derogations.js";
import {
  ajouterBrique,
  ajouterCasType,
  ajouterElement,
  ajouterEtape,
  ajouterRegle,
  ajouterRubrique,
  modifierBrique,
  modifierEtape,
  remplacerRegle,
  supprimerBrique,
  supprimerCasType,
  supprimerElement,
  supprimerEtape,
  supprimerRegle,
  supprimerRubrique,
} from "../standard/edition.js";
import { traduireErreurStandard } from "../standard/erreurs.js";
import {
  analyserMiseAJourVariante,
  comparerVersions,
  creerMethode,
  creerNouvelleVersion,
  creerVariante,
  lireDetailMethode,
  lireDetailVersion,
  listerMethodes,
  modifierNotesVersion,
  publierVersion,
  validerVersionStockee,
} from "../standard/methodes.js";
import {
  analyserMigration,
  changerContexte,
  lierMethode,
  lireMethodeMission,
  migrerMethode,
} from "../standard/missions.js";
import {
  executerCas,
  exigerContexteValide,
  lireFacteurs,
  simuler,
} from "../standard/modulation.js";
import {
  creerProposition,
  listerPropositions,
  publierProposition,
  revoirProposition,
} from "../standard/propositions.js";
import {
  creerFacteur,
  creerNote,
  creerTaxonomie,
  listerFacteurs,
  listerNotes,
  listerServices,
  listerTaxonomies,
} from "../standard/referentiel.js";

/*
 * Référentiel de méthodes (STD-01 à STD-12, PRD complémentaire §4, ADR-004), sous /api.
 * Logique : apps/api/src/standard/** ; règles évaluées par le moteur pur de modulation,
 * gardes des dérogations par le moteur `qualite`. Aucune route n'est ouverte au portail
 * client (absentes de LISTE_BLANCHE_PORTAIL ; tables `portail_interdit`).
 *
 * Droits : `standard.lire` (lecture du catalogue, du dictionnaire, simulation, validation,
 * cas types) ; `standard.gerer` (variante, méthode, versions, éditeur, publication,
 * dictionnaire du cabinet, notes, comité méthode) ; mission : `standard.lire` et mission
 * visible pour lire, `standard.lire` + `mission.planifier` et mission modifiable pour lier,
 * changer le contexte ou migrer ; `methode.deroger` pour demander une dérogation ; les
 * décisions de dérogation suivent la garde de la classe de risque (standard/derogations.ts).
 *
 * - GET /standard/taxonomies, POST /standard/taxonomies ; GET /standard/facteurs,
 *   POST /standard/facteurs ; GET /standard/services ; GET et POST /standard/notes ;
 * - GET /methodes, POST /methodes, GET /methodes/:id, POST /methodes/:id/variantes,
 *   POST /methodes/:id/versions ;
 * - GET et PATCH /methodes/versions/:id ; GET /methodes/versions/:id/validation,
 *   /comparaison, /mise-a-jour ; POST /methodes/versions/:id/publication, /simulation,
 *   /cas-types/execution ;
 * - éditeur : POST /methodes/versions/:id/{etapes,briques,elements,rubriques,regles,cas-types},
 *   PATCH …/etapes/:enfantId et …/briques/:enfantId, PUT …/regles/:enfantId,
 *   DELETE …/{etapes,briques,elements,rubriques,regles,cas-types}/:enfantId ;
 * - GET et PUT /missions/:id/methode, POST /missions/:id/methode/contexte,
 *   GET et POST /missions/:id/methode/migration ;
 * - GET et POST /missions/:id/derogations, GET /derogations, GET /derogations/:id,
 *   POST /derogations/:id/decisions ;
 * - GET et POST /standard/propositions, POST /standard/propositions/:id/revue,
 *   POST /standard/propositions/:id/publication.
 */

const paramsEnfant = z.object({ id: z.string().uuid(), enfantId: z.string().uuid() }).strict();

export const routesStandard: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurStandard(error);
  });

  const lire = <T>(auth: Auth, fn: (db: Db) => Promise<T>) => app.db.withTenant(auth.cabinetId, fn);

  /* ----- Dictionnaire, facteurs, services, notes ----- */

  app.get("/standard/taxonomies", async (request) => {
    const auth = exiger(request, "standard.lire");
    const q = taxonomieQuerySchema.parse(request.query);
    return lire(auth, (db) => listerTaxonomies(db, q));
  });

  app.post("/standard/taxonomies", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const corps = taxonomieCreationSchema.parse(request.body);
    return reply.status(201).send(await lire(auth, (db) => creerTaxonomie(db, auth, corps)));
  });

  app.get("/standard/facteurs", async (request) => {
    const auth = exiger(request, "standard.lire");
    return lire(auth, (db) => listerFacteurs(db));
  });

  app.post("/standard/facteurs", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const corps = facteurCreationSchema.parse(request.body);
    return reply.status(201).send(await lire(auth, (db) => creerFacteur(db, auth, corps)));
  });

  app.get("/standard/services", async (request) => {
    const auth = exiger(request, "standard.lire");
    return lire(auth, (db) => listerServices(db));
  });

  app.get("/standard/notes", async (request) => {
    const auth = exiger(request, "standard.lire");
    const q = noteContexteQuerySchema.parse(request.query);
    return lire(auth, (db) => listerNotes(db, q));
  });

  app.post("/standard/notes", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const corps = noteContexteCreationSchema.parse(request.body);
    return reply.status(201).send(await lire(auth, (db) => creerNote(db, auth, corps)));
  });

  /* ----- Catalogue et héritage ----- */

  app.get("/methodes", async (request) => {
    const auth = exiger(request, "standard.lire");
    const q = methodeListeQuerySchema.parse(request.query);
    return lire(auth, (db) => listerMethodes(db, q));
  });

  app.post("/methodes", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const corps = methodeCreationSchema.parse(request.body);
    return reply.status(201).send(await lire(auth, (db) => creerMethode(db, auth, corps)));
  });

  app.get("/methodes/:id", async (request) => {
    const auth = exiger(request, "standard.lire");
    const { id } = paramsId.parse(request.params);
    return lire(auth, (db) => lireDetailMethode(db, id));
  });

  app.post("/methodes/:id/variantes", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = varianteCreationSchema.parse(request.body ?? {});
    return reply.status(201).send(await lire(auth, (db) => creerVariante(db, auth, id, corps)));
  });

  app.post("/methodes/:id/versions", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = versionCreationSchema.parse(request.body ?? {});
    return reply
      .status(201)
      .send(await lire(auth, (db) => creerNouvelleVersion(db, auth, id, corps)));
  });

  /* ----- Versions ----- */

  app.get("/methodes/versions/:id", async (request) => {
    const auth = exiger(request, "standard.lire");
    const { id } = paramsId.parse(request.params);
    return lire(auth, (db) => lireDetailVersion(db, id));
  });

  app.patch("/methodes/versions/:id", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = versionModificationSchema.parse(request.body);
    return lire(auth, (db) => modifierNotesVersion(db, auth, id, corps.notes_version ?? null));
  });

  app.get("/methodes/versions/:id/validation", async (request) => {
    const auth = exiger(request, "standard.lire");
    const { id } = paramsId.parse(request.params);
    return lire(auth, (db) => validerVersionStockee(db, id));
  });

  app.get("/methodes/versions/:id/comparaison", async (request) => {
    const auth = exiger(request, "standard.lire");
    const { id } = paramsId.parse(request.params);
    const { avec } = comparaisonVersionsQuerySchema.parse(request.query);
    return lire(auth, (db) => comparerVersions(db, id, avec));
  });

  app.get("/methodes/versions/:id/mise-a-jour", async (request) => {
    const auth = exiger(request, "standard.lire");
    const { id } = paramsId.parse(request.params);
    return lire(auth, (db) => analyserMiseAJourVariante(db, id));
  });

  app.post("/methodes/versions/:id/publication", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    return lire(auth, (db) => publierVersion(db, auth, id));
  });

  app.post("/methodes/versions/:id/simulation", async (request) => {
    const auth = exiger(request, "standard.lire");
    const { id } = paramsId.parse(request.params);
    const corps = simulationModulationSchema.parse(request.body);
    return lire(auth, async (db) => {
      const facteurs = await lireFacteurs(db);
      const avant = exigerContexteValide(facteurs, corps.contexte_avant);
      const apres = exigerContexteValide(facteurs, corps.contexte_apres);
      return simuler(sansIdentifiants(await lireContenu(db, id)), avant, apres);
    });
  });

  app.post("/methodes/versions/:id/cas-types/execution", async (request) => {
    const auth = exiger(request, "standard.lire");
    const { id } = paramsId.parse(request.params);
    return lire(auth, async (db) => executerCas(sansIdentifiants(await lireContenu(db, id))));
  });

  /* ----- Éditeur sans code (brouillon du cabinet) ----- */

  app.post("/methodes/versions/:id/etapes", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = etapeCreationSchema.parse(request.body);
    return reply.status(201).send(await lire(auth, (db) => ajouterEtape(db, auth, id, corps)));
  });

  app.patch("/methodes/versions/:id/etapes/:enfantId", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const { id, enfantId } = paramsEnfant.parse(request.params);
    const corps = etapeModificationSchema.parse(request.body);
    return lire(auth, (db) => modifierEtape(db, auth, id, enfantId, corps));
  });

  app.delete("/methodes/versions/:id/etapes/:enfantId", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id, enfantId } = paramsEnfant.parse(request.params);
    await lire(auth, (db) => supprimerEtape(db, auth, id, enfantId));
    return reply.status(204).send();
  });

  app.post("/methodes/versions/:id/briques", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = briqueCreationSchema.parse(request.body);
    return reply.status(201).send(await lire(auth, (db) => ajouterBrique(db, auth, id, corps)));
  });

  app.patch("/methodes/versions/:id/briques/:enfantId", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const { id, enfantId } = paramsEnfant.parse(request.params);
    const corps = briqueModificationSchema.parse(request.body);
    return lire(auth, (db) => modifierBrique(db, auth, id, enfantId, corps));
  });

  app.delete("/methodes/versions/:id/briques/:enfantId", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id, enfantId } = paramsEnfant.parse(request.params);
    await lire(auth, (db) => supprimerBrique(db, auth, id, enfantId));
    return reply.status(204).send();
  });

  app.post("/methodes/versions/:id/elements", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = elementMethodeCreationSchema.parse(request.body);
    return reply.status(201).send(await lire(auth, (db) => ajouterElement(db, auth, id, corps)));
  });

  app.delete("/methodes/versions/:id/elements/:enfantId", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id, enfantId } = paramsEnfant.parse(request.params);
    await lire(auth, (db) => supprimerElement(db, auth, id, enfantId));
    return reply.status(204).send();
  });

  app.post("/methodes/versions/:id/rubriques", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = rubriqueCreationSchema.parse(request.body);
    return reply.status(201).send(await lire(auth, (db) => ajouterRubrique(db, auth, id, corps)));
  });

  app.delete("/methodes/versions/:id/rubriques/:enfantId", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id, enfantId } = paramsEnfant.parse(request.params);
    await lire(auth, (db) => supprimerRubrique(db, auth, id, enfantId));
    return reply.status(204).send();
  });

  app.post("/methodes/versions/:id/regles", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const regle = regleModulationSchema.parse(request.body);
    return reply.status(201).send(await lire(auth, (db) => ajouterRegle(db, auth, id, regle)));
  });

  app.put("/methodes/versions/:id/regles/:enfantId", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const { id, enfantId } = paramsEnfant.parse(request.params);
    const regle = regleModulationSchema.parse(request.body);
    return lire(auth, (db) => remplacerRegle(db, auth, id, enfantId, regle));
  });

  app.delete("/methodes/versions/:id/regles/:enfantId", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id, enfantId } = paramsEnfant.parse(request.params);
    await lire(auth, (db) => supprimerRegle(db, auth, id, enfantId));
    return reply.status(204).send();
  });

  app.post("/methodes/versions/:id/cas-types", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = casTypeCreationSchema.parse(request.body);
    return reply.status(201).send(await lire(auth, (db) => ajouterCasType(db, auth, id, corps)));
  });

  app.delete("/methodes/versions/:id/cas-types/:enfantId", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const { id, enfantId } = paramsEnfant.parse(request.params);
    await lire(auth, (db) => supprimerCasType(db, auth, id, enfantId));
    return reply.status(204).send();
  });

  /* ----- Mission figée sur une version (STD-08) ----- */

  app.get("/missions/:id/methode", async (request) => {
    const auth = exiger(request, "standard.lire");
    const { id } = paramsId.parse(request.params);
    return lire(auth, (db) => lireMethodeMission(db, auth, id));
  });

  app.put("/missions/:id/methode", async (request) => {
    const auth = exiger(request, "standard.lire");
    exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const corps = missionMethodeLiaisonSchema.parse(request.body);
    return lire(auth, (db) => lierMethode(db, auth, id, corps.version_id, corps.contexte));
  });

  app.post("/missions/:id/methode/contexte", async (request) => {
    const auth = exiger(request, "standard.lire");
    exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const corps = missionContexteSchema.parse(request.body);
    return lire(auth, (db) => changerContexte(db, auth, id, corps.contexte, corps.motif));
  });

  app.get("/missions/:id/methode/migration", async (request) => {
    const auth = exiger(request, "standard.lire");
    const { id } = paramsId.parse(request.params);
    const q = missionMigrationQuerySchema.parse(request.query);
    return lire(auth, (db) => analyserMigration(db, auth, id, q.version_id));
  });

  app.post("/missions/:id/methode/migration", async (request) => {
    const auth = exiger(request, "standard.lire");
    exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const corps = missionMigrationSchema.parse(request.body);
    return lire(auth, (db) => migrerMethode(db, auth, id, corps.version_id, corps.motif));
  });

  /* ----- Dérogations (STD-07) ----- */

  app.get("/missions/:id/derogations", async (request) => {
    const auth = exiger(request, "standard.lire");
    const { id } = paramsId.parse(request.params);
    return lire(auth, (db) => listerDerogationsMission(db, auth, id));
  });

  app.post("/missions/:id/derogations", async (request, reply) => {
    const auth = exiger(request, "methode.deroger");
    const { id } = paramsId.parse(request.params);
    const corps = derogationCreationSchema.parse(request.body);
    return reply
      .status(201)
      .send(await lire(auth, (db) => demanderDerogation(db, auth, id, corps)));
  });

  app.get("/derogations", async (request) => {
    const auth = exiger(request, "standard.lire");
    const q = derogationsQuerySchema.parse(request.query);
    return lire(auth, (db) => tableauDerogations(db, auth, q));
  });

  app.get("/derogations/:id", async (request) => {
    const auth = exiger(request, "standard.lire");
    const { id } = paramsId.parse(request.params);
    return lire(auth, (db) => lireDerogationVisible(db, auth, id));
  });

  app.post("/derogations/:id/decisions", async (request) => {
    const auth = exiger(request, "standard.lire");
    const { id } = paramsId.parse(request.params);
    const corps = derogationDecisionSchema.parse(request.body);
    return lire(auth, (db) => deciderDerogation(db, auth, id, corps));
  });

  /* ----- Comité méthode (STD-12) ----- */

  app.get("/standard/propositions", async (request) => {
    const auth = exiger(request, "standard.lire");
    const q = propositionsStandardQuerySchema.parse(request.query);
    return lire(auth, (db) => listerPropositions(db, q));
  });

  app.post("/standard/propositions", async (request, reply) => {
    const auth = exiger(request, "standard.gerer");
    const corps = propositionStandardCreationSchema.parse(request.body);
    return reply.status(201).send(await lire(auth, (db) => creerProposition(db, auth, corps)));
  });

  app.post("/standard/propositions/:id/revue", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = propositionStandardRevueSchema.parse(request.body);
    return lire(auth, (db) => revoirProposition(db, auth, id, corps));
  });

  app.post("/standard/propositions/:id/publication", async (request) => {
    const auth = exiger(request, "standard.gerer");
    const { id } = paramsId.parse(request.params);
    const { version_id } = propositionStandardPublicationSchema.parse(request.body);
    return lire(auth, (db) => publierProposition(db, auth, id, version_id));
  });
};
