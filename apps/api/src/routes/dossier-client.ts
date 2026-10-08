import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import {
  dossiersListeQuerySchema,
  etatDecisionSchema,
  etatFinancierCsvSchema,
  etatFinancierExcelQuerySchema,
  etatFinancierSaisieSchema,
  exportDossierQuerySchema,
  facteurValeurCreationSchema,
  faitCreationSchema,
  faitDecisionSchema,
  faitsQuerySchema,
  friseQuerySchema,
  paramsDossierSousId,
  type Devise,
} from "@missionpilot/shared";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import {
  aujourdhui,
  exigerDossierVisible,
  type ClientDossier,
  filtreDossierVisible,
  voitTousLesDossiers,
} from "../dossier/acces.js";
import { avecErreursDossier } from "../dossier/erreurs.js";
import {
  deciderEtat,
  detailEtat,
  ingererEtat,
  listerEtats,
  type EnTeteEtat,
  type FichierAnalyse,
} from "../dossier/etats.js";
import { exporterDossier } from "../dossier/export.js";
import {
  ajouterFacteur,
  contexteFacteurs,
  facteursCourants,
  listerFacteurs,
} from "../dossier/facteurs.js";
import {
  creerFait,
  deciderFait,
  faitsCourantsParCle,
  historiqueFait,
  listerFaits,
} from "../dossier/faits.js";
import { indiceSansHistorique, lireFiabilite } from "../dossier/fiabilite.js";
import { friseDossier } from "../dossier/frise.js";
import { lireEtatDepuisTableau, type ErreurLigneEtat } from "../dossier/import-etats.js";
import { decoderCurseur, motifContient, paginer, paramsId } from "../http/outils.js";
import { assainirNom } from "../stockage/nom.js";
import { lireTeleversement } from "../stockage/fichiers.js";
import { tableauCsv, type TableauImport } from "../temps/import.js";
import {
  IMPORT_EXCEL_TAILLE_MAX,
  lireClasseurTemps,
  tropVolumineux,
} from "../temps/import-excel.js";
import { avecPlaceAnalyse, gardeTailleMultipart } from "./fichiers.js";

/**
 * Dossier client vivant (DOS-01 à DOS-04, DOS-06, DOS-07, PRD complémentaire §5) : faits
 * datés et sourcés, facteurs de contexte, états financiers contrôlés par moteur, indice de
 * fiabilité, frise, export. Lecture : `dossier.lire` ; écriture et export : `dossier.ecrire` ;
 * toujours sur un dossier VISIBLE (`dossier/acces.ts`, 404 sinon). Aucune route n'est ouverte
 * au portail client (absentes de `LISTE_BLANCHE_PORTAIL`, tables `portail_interdit`).
 * L'extraction par l'IA depuis un PDF n'est pas encore branchée (lot ultérieur).
 */

/** Exécute `fn` dans le cabinet, sur un dossier visible, en traduisant les erreurs du dossier. */
function surDossier<T>(
  app: FastifyInstance,
  auth: Auth,
  clientId: string,
  fn: (db: Db, client: ClientDossier) => Promise<T>,
): Promise<T> {
  return avecErreursDossier(() =>
    app.db.withTenant(auth.cabinetId, async (db) =>
      fn(db, await exigerDossierVisible(db, auth, clientId)),
    ),
  );
}

/** Rapport d'import refusé : rien n'est écrit, chaque ligne en erreur est citée. */
function importInvalide(reply: FastifyReply, erreurs: ErreurLigneEtat[]) {
  return reply.status(400).send({
    erreur: {
      code: "IMPORT_INVALIDE",
      message: `${erreurs.length} ligne(s) en erreur : rien n'a été ingéré.`,
      details: { erreurs },
    },
  });
}

async function ingererTableau(
  app: FastifyInstance,
  reply: FastifyReply,
  auth: Auth,
  clientId: string,
  entete: EnTeteEtat & { devise: Devise },
  tableau: TableauImport,
  origine: "csv" | "excel",
  fichier: FichierAnalyse,
) {
  const lecture = lireEtatDepuisTableau(tableau, entete.devise, {
    format: origine,
    fichier: fichier.nom,
  });
  if (lecture.erreurs.length > 0) return importInvalide(reply, lecture.erreurs);
  const etat = await surDossier(app, auth, clientId, (db) =>
    ingererEtat(db, auth, clientId, entete, lecture.lignes, origine, fichier),
  );
  reply.status(201);
  return etat;
}

const empreinte = (contenu: Buffer | string) => createHash("sha256").update(contenu).digest("hex");

/** Import Excel : multipart enregistré dans ce seul périmètre (encapsulation Fastify). */
const routesImportEtatExcel: FastifyPluginAsync = async (app) => {
  await app.register(multipart, {
    limits: {
      fileSize: IMPORT_EXCEL_TAILLE_MAX,
      files: 1,
      fields: 0,
      parts: 1,
      fieldNameSize: 50,
      headerPairs: 50,
    },
    throwFileSizeLimit: true,
  });

  app.post(
    "/dossiers/:id/etats-financiers/excel",
    // Taille annoncée refusée avant toute lecture, même sans session (413).
    { onRequest: gardeTailleMultipart(IMPORT_EXCEL_TAILLE_MAX, tropVolumineux) },
    async (request, reply) => {
      const auth = exiger(request, "dossier.ecrire");
      const { id } = paramsId.parse(request.params);
      const q = etatFinancierExcelQuerySchema.parse(request.query);
      // Dossier visible AVANT de lire le corps : un dossier d'autrui ne consomme rien.
      await surDossier(app, auth, id, async () => undefined);
      const recu = await lireTeleversement(request, IMPORT_EXCEL_TAILLE_MAX);
      // Analyse hors transaction, dans le sémaphore des fichiers puis le lecteur borné.
      const tableau = await avecPlaceAnalyse(auth.cabinetId, () => lireClasseurTemps(recu.contenu));
      const fichier = {
        nom: recu.nom ? assainirNom(recu.nom) : null,
        sha256: empreinte(recu.contenu),
        taille: recu.contenu.length,
      };
      return ingererTableau(app, reply, auth, id, q, tableau, "excel", fichier);
    },
  );
};

export const routesDossierClient: FastifyPluginAsync = async (app) => {
  app.get("/dossiers", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const q = dossiersListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT c.id, c.raison_sociale, c.secteur, c.pays, c.taille, c.actif,
           lower(c.raison_sociale) AS cle_tri,
           (SELECT max(f.cree_le) FROM dossier_faits f WHERE f.client_id = c.id) AS dernier_fait_le,
           (SELECT count(*)::int FROM dossier_faits f
              WHERE f.client_id = c.id AND NOT EXISTS (SELECT 1 FROM dossier_faits_decisions d WHERE d.fait_id = f.id)
                AND NOT EXISTS (SELECT 1 FROM dossier_faits x WHERE x.remplace_id = f.id)) AS propositions,
           (SELECT count(*)::int FROM dossier_etats_financiers e
              WHERE e.client_id = c.id AND NOT EXISTS (SELECT 1 FROM dossier_etats_decisions d WHERE d.etat_id = e.id)
                AND NOT EXISTS (SELECT 1 FROM dossier_etats_financiers x WHERE x.remplace_id = e.id)) AS etats_en_revue
         FROM clients c
         WHERE ${filtreDossierVisible(1, 2)}
           AND ($3::text IS NULL OR c.raison_sociale ILIKE $3 OR c.secteur ILIKE $3)
           AND ($4::text IS NULL OR (lower(c.raison_sociale), c.id) > ($4, $5::uuid))
         ORDER BY lower(c.raison_sociale), c.id
         LIMIT $6`,
        [
          voitTousLesDossiers(auth),
          auth.utilisateurId,
          motifContient(q.q),
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      return paginer(r.rows, q.limite);
    });
  });

  /** Vue d'ensemble : profil (valeurs courantes), propositions, facteurs, finances, fiabilité. */
  app.get("/dossiers/:id", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id } = paramsId.parse(request.params);
    return surDossier(app, auth, id, async (db, client) => {
      const date = aujourdhui();
      const faits = await listerFaits(db, id, "courants");
      const facteurs = await listerFacteurs(db, id);
      const fiabilite = indiceSansHistorique(await lireFiabilite(db, id));
      return {
        client,
        date_reference: date,
        profil: faitsCourantsParCle(faits, date),
        propositions: faits.filter((f) => f.statut === "propose"),
        facteurs: facteursCourants(facteurs, date),
        etats_financiers: (await listerEtats(db, id)).map(({ constats: _c, ...e }) => e),
        fiabilite,
      };
    });
  });

  app.get("/dossiers/:id/faits", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id } = paramsId.parse(request.params);
    const q = faitsQuerySchema.parse(request.query);
    return surDossier(app, auth, id, async (db) => ({
      elements: await listerFaits(db, id, q.vue, q.categorie),
    }));
  });

  app.post("/dossiers/:id/faits", async (request, reply) => {
    const auth = exiger(request, "dossier.ecrire");
    const { id } = paramsId.parse(request.params);
    const fait = faitCreationSchema.parse(request.body);
    const cree = await surDossier(app, auth, id, (db) => creerFait(db, auth, id, fait));
    reply.status(201);
    return cree;
  });

  app.get("/dossiers/:id/faits/:sousId/historique", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id, sousId } = paramsDossierSousId.parse(request.params);
    return surDossier(app, auth, id, async (db) => ({
      elements: await historiqueFait(db, id, sousId),
    }));
  });

  app.post("/dossiers/:id/faits/:sousId/decision", async (request) => {
    const auth = exiger(request, "dossier.ecrire");
    const { id, sousId } = paramsDossierSousId.parse(request.params);
    const decision = faitDecisionSchema.parse(request.body);
    return surDossier(app, auth, id, (db) => deciderFait(db, auth, id, sousId, decision));
  });

  app.get("/dossiers/:id/facteurs", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id } = paramsId.parse(request.params);
    return surDossier(app, auth, id, async (db) => {
      const date = aujourdhui();
      const valeurs = await listerFacteurs(db, id);
      return {
        date_reference: date,
        courants: facteursCourants(valeurs, date),
        contexte: contexteFacteurs(valeurs, date),
        historique: valeurs,
      };
    });
  });

  app.post("/dossiers/:id/facteurs", async (request, reply) => {
    const auth = exiger(request, "dossier.ecrire");
    const { id } = paramsId.parse(request.params);
    const valeur = facteurValeurCreationSchema.parse(request.body);
    const cree = await surDossier(app, auth, id, (db) => ajouterFacteur(db, auth, id, valeur));
    reply.status(201);
    return cree;
  });

  app.get("/dossiers/:id/etats-financiers", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id } = paramsId.parse(request.params);
    return surDossier(app, auth, id, async (db) => ({ elements: await listerEtats(db, id) }));
  });

  app.get("/dossiers/:id/etats-financiers/:sousId", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id, sousId } = paramsDossierSousId.parse(request.params);
    return surDossier(app, auth, id, (db) => detailEtat(db, id, sousId));
  });

  /** Saisie structurée (lignes JSON, chacune avec sa référence éventuelle). */
  app.post("/dossiers/:id/etats-financiers", async (request, reply) => {
    const auth = exiger(request, "dossier.ecrire");
    const { id } = paramsId.parse(request.params);
    const { lignes, ...entete } = etatFinancierSaisieSchema.parse(request.body);
    const etat = await surDossier(app, auth, id, (db) =>
      ingererEtat(db, auth, id, entete, lignes, "saisie", null),
    );
    reply.status(201);
    return etat;
  });

  app.post("/dossiers/:id/etats-financiers/csv", async (request, reply) => {
    const auth = exiger(request, "dossier.ecrire");
    const { id } = paramsId.parse(request.params);
    const { csv, nom_fichier, ...entete } = etatFinancierCsvSchema.parse(request.body);
    await surDossier(app, auth, id, async () => undefined);
    const fichier = {
      nom: nom_fichier ? assainirNom(nom_fichier) : null,
      sha256: empreinte(csv),
      taille: Buffer.byteLength(csv, "utf8"),
    };
    return ingererTableau(app, reply, auth, id, entete, tableauCsv(csv), "csv", fichier);
  });

  app.post("/dossiers/:id/etats-financiers/:sousId/decision", async (request) => {
    const auth = exiger(request, "dossier.ecrire");
    const { id, sousId } = paramsDossierSousId.parse(request.params);
    const decision = etatDecisionSchema.parse(request.body);
    return surDossier(app, auth, id, (db) => deciderEtat(db, auth, id, sousId, decision));
  });

  app.get("/dossiers/:id/fiabilite", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id } = paramsId.parse(request.params);
    return surDossier(app, auth, id, (db) => lireFiabilite(db, id));
  });

  app.get("/dossiers/:id/frise", async (request) => {
    const auth = exiger(request, "dossier.lire");
    const { id } = paramsId.parse(request.params);
    const q = friseQuerySchema.parse(request.query);
    return surDossier(app, auth, id, (db) => friseDossier(db, auth, id, q));
  });

  /** Export à la demande du client (DOS-07) : JSON ou ZIP, tracé et journalisé. */
  app.get("/dossiers/:id/export", async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = exiger(request, "dossier.ecrire");
    const { id } = paramsId.parse(request.params);
    const { format } = exportDossierQuerySchema.parse(request.query);
    const resultat = await surDossier(app, auth, id, (db, client) =>
      exporterDossier(db, auth, client, format),
    );
    return reply
      .header(
        "content-type",
        format === "zip" ? "application/zip" : "application/json; charset=utf-8",
      )
      .header("content-disposition", `attachment; filename="dossier-client-${id}.${format}"`)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-store")
      .header("x-empreinte-sha256", resultat.sha256)
      .send(resultat.corps);
  });

  await app.register(routesImportEtatExcel);
};
