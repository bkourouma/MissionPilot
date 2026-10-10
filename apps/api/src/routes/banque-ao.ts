import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  attestationCreationSchema,
  attestationRetraitSchema,
  cvAnonymisationSchema,
  cvCreationSchema,
  cvExigencesSchema,
  cvExportQuerySchema,
  cvListeQuerySchema,
  cvVersionSchema,
  gabaritCvCreationSchema,
  offreFinanciereCreationSchema,
  offreFinanciereEntreeSchema,
  offreFinanciereVersionSchema,
  offresQuerySchema,
  offreTechniqueCreationSchema,
  offreTechniqueValidationSchema,
  offreTechniqueVersionSchema,
  referenceContenuSchema,
  referencesQuerySchema,
  referenceVersionSchema,
} from "@missionpilot/shared";
import { exiger, type Auth } from "../auth/contexte.js";
import { serviceIdentite, type ContexteConfirmation } from "../auth/confirmer-identite.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { envoyerEmails } from "../notifications/notifier.js";
import { cheminNavigateur } from "../rapports/pdf.js";
import { rendreRapport, TYPES_RAPPORT } from "../rapports/rendu.js";
import { FichierAbsent, stockageDe } from "../stockage/index.js";
import { contentDisposition } from "../stockage/nom.js";
import { journal, moisCourant } from "../banque-ao/commun.js";
import {
  anonymiserCv,
  contenuCourant,
  controlerContenuCv,
  creerCv,
  creerGabarit,
  detailCv,
  exigerCvUtilisable,
  exigerGabarit,
  listerCv,
  listerGabarits,
  nouvelleVersionCv,
} from "../banque-ao/cv.js";
import { traduireErreurBanqueAo } from "../banque-ao/erreurs.js";
import { cvEnRapport } from "../banque-ao/format-cv.js";
import {
  calculerOffre,
  creerOffreFinanciere,
  detailOffreFinanciere,
  listerOffresFinancieres,
  nouvelleVersionOffreFinanciere,
} from "../banque-ao/offres-financieres.js";
import {
  creerOffreTechnique,
  detailOffreTechnique,
  listerOffresTechniques,
  nouvelleVersionOffreTechnique,
  validerOffreTechnique,
} from "../banque-ao/offres-techniques.js";
import {
  ajouterAttestation,
  creerReference,
  detailReference,
  exigerAttestation,
  listerReferences,
  nouvelleVersionReference,
  retirerAttestation,
} from "../banque-ao/references.js";

/**
 * AO-04 à AO-07 : CV, références, offres technique et financière (PRD complémentaire §9,
 * lot AO-B), montés sous /api/banque-ao.
 *
 * - Droits : `ao.lire` (lecture, contrôle d'un CV, export), `ao.gerer` (banques, offres
 *   techniques, validation). Offre financière (taux journaliers, FIN-02) : `ao.lire` ET
 *   `finance.lire` pour lire, plus `taux.gerer` pour écrire. Offre rédigée par l'IA :
 *   `ia.utiliser` en plus ; méthode liée : `standard.lire` en plus.
 * - Aucune route n'est ouverte au portail client (absentes de `LISTE_BLANCHE_PORTAIL`, tables
 *   `portail_interdit`).
 * - Ajout seul (0380 à 0383) : une correction est une nouvelle version avec motif ; seule la
 *   pièce d'une référence se retire, motivée. Aucune route PUT ni DELETE.
 * - Calculs par les moteurs purs `banque-cv` et `offre-financiere` ; contenu IA par
 *   l'orchestrateur, brouillon validé par un humain.
 * - Chaque écriture est journalisée dans sa transaction, sans contenu personnel ni montant.
 */

/** Exports de CV admis par utilisateur sur la fenêtre glissante (rendu Word ou PDF). */
export const EXPORTS_CV_PAR_FENETRE = 20;
export const FENETRE_EXPORTS_CV_MINUTES = 10;
const ACTION_EXPORT_CV = "export_cv";
const CONTEXTE_ANONYMISATION_CV: ContexteConfirmation = "anonymisation_cv";

async function verifierDebitExports(db: Db, auth: Auth): Promise<void> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM journal_audit
     WHERE utilisateur_id = $1 AND action = $2 AND cree_le > now() - make_interval(mins => $3)`,
    [auth.utilisateurId, ACTION_EXPORT_CV, FENETRE_EXPORTS_CV_MINUTES],
  );
  if ((r.rows[0].n as number) >= EXPORTS_CV_PAR_FENETRE) {
    throw new AppError(
      429,
      "TROP_D_EXPORTS_CV",
      `Au plus ${EXPORTS_CV_PAR_FENETRE} exports de CV par ${FENETRE_EXPORTS_CV_MINUTES} minutes : réessayez plus tard.`,
    );
  }
}

const nomFichierCv = (nom: string, code: string, extension: string) =>
  `CV ${nom} ${code}`.replace(/[^A-Za-z0-9 ._-]/g, "-").slice(0, 80) + `.${extension}`;

function routesCv(app: FastifyInstance) {
  app.get("/banque-ao/cv", async (request) => {
    const auth = exiger(request, "ao.lire");
    const q = cvListeQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerCv(db, q));
  });

  app.post("/banque-ao/cv", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const corps = cvCreationSchema.parse(request.body);
    const detail = await app.db.withTenant(auth.cabinetId, async (db) =>
      detailCv(db, await creerCv(db, auth, corps)),
    );
    reply.status(201);
    return detail;
  });

  app.get("/banque-ao/cv/:id", async (request) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => detailCv(db, id));
  });

  app.post("/banque-ao/cv/:id/versions", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = cvVersionSchema.parse(request.body);
    const detail = await app.db.withTenant(auth.cabinetId, async (db) => {
      await nouvelleVersionCv(db, auth, id, corps);
      return detailCv(db, id);
    });
    reply.status(201);
    return detail;
  });

  /**
   * Anonymisation d'un CV (départ d'une personne, droit à l'effacement) : irréversible.
   * `cabinet.gerer`, reconfirmation d'identité (mot de passe, et code si la 2FA est active),
   * fonction SECURITY DEFINER bornée au cabinet (0386), journal dans la même transaction.
   */
  app.post("/banque-ao/cv/:id/anonymisation", async (request) => {
    const auth = exiger(request, "cabinet.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = cvAnonymisationSchema.parse(request.body ?? {});
    // CV inconnu, d'un autre cabinet ou déjà anonymisé : avant toute reconfirmation.
    await app.db.withTenant(auth.cabinetId, (db) => exigerCvUtilisable(db, id));
    const versions = await serviceIdentite(app).confirmerIdentite(
      auth,
      corps.confirmation,
      CONTEXTE_ANONYMISATION_CV,
      (db, facteur) => anonymiserCv(db, auth, id, corps.motif, facteur),
      { motDePasseSeulSiInactive: true },
    );
    return { id, anonymise: true, versions };
  });

  /** Contrôle déterministe (moteur) de la version courante contre des exigences. */
  app.post("/banque-ao/cv/:id/controle", async (request) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    const exigences = cvExigencesSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const courante = await contenuCourant(db, id);
      const reference = exigences.reference ?? moisCourant();
      const resultat = controlerContenuCv(courante.contenu, exigences, reference);
      return {
        cv_id: id,
        version: courante.version,
        reference,
        conforme: resultat.conforme,
        annees_experience: resultat.anneesExperience,
        criteres: resultat.criteres,
      };
    });
  });

  /** CV au format d'un bailleur, en Word ou en PDF (infrastructure de rapports). */
  app.get("/banque-ao/cv/:id/export", async (request, reply) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    const q = cvExportQuerySchema.parse(request.query);
    const reference = q.reference ?? moisCourant();
    const prepare = await app.db.withTenant(auth.cabinetId, async (db) => {
      const profil = await exigerCvUtilisable(db, id);
      const courante = await contenuCourant(db, id);
      const gabarit = await exigerGabarit(db, q.gabarit);
      await verifierDebitExports(db, auth);
      const cabinet = await db.query("SELECT nom FROM cabinets WHERE id = $1", [auth.cabinetId]);
      return {
        profil,
        gabarit,
        rapport: cvEnRapport(
          { nom: profil.nom, version: courante.version },
          courante.contenu,
          gabarit,
          {
            emetteur: (cabinet.rows[0]?.nom as string | undefined) ?? "Cabinet",
            genereLe: new Date().toISOString().slice(0, 10),
            reference,
          },
        ),
      };
    });
    const { contenu } = await rendreRapport(prepare.rapport, q.format, {
      cheminNavigateur: q.format === "pdf" ? cheminNavigateur(app.config) : null,
      cabinetId: auth.cabinetId,
    });
    await app.db.withTenant(auth.cabinetId, (db) =>
      journal(db, auth, ACTION_EXPORT_CV, "ao_cv", id, {
        gabarit: q.gabarit,
        format: q.format,
        taille: contenu.length,
      }),
    );
    const type = TYPES_RAPPORT[q.format];
    return reply
      .header("content-type", type.mime)
      .header(
        "content-disposition",
        contentDisposition(
          nomFichierCv(prepare.profil.nom, prepare.gabarit.code, type.extension),
          "attachment",
        ),
      )
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "sandbox")
      .header("cache-control", "private, no-store")
      .send(contenu);
  });

  app.get("/banque-ao/gabarits-cv", async (request) => {
    const auth = exiger(request, "ao.lire");
    return app.db.withTenant(auth.cabinetId, async (db) => ({
      elements: await listerGabarits(db),
    }));
  });

  app.post("/banque-ao/gabarits-cv", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const corps = gabaritCvCreationSchema.parse(request.body);
    const gabarit = await app.db.withTenant(auth.cabinetId, (db) => creerGabarit(db, auth, corps));
    reply.status(201);
    return gabarit;
  });
}

function routesReferences(app: FastifyInstance) {
  app.get("/banque-ao/references", async (request) => {
    const auth = exiger(request, "ao.lire");
    const q = referencesQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerReferences(db, q));
  });

  app.post("/banque-ao/references", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const contenu = referenceContenuSchema.parse(request.body);
    const detail = await app.db.withTenant(auth.cabinetId, async (db) =>
      detailReference(db, await creerReference(db, auth, contenu)),
    );
    reply.status(201);
    return detail;
  });

  app.get("/banque-ao/references/:id", async (request) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => detailReference(db, id));
  });

  app.post("/banque-ao/references/:id/versions", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = referenceVersionSchema.parse(request.body);
    const detail = await app.db.withTenant(auth.cabinetId, async (db) => {
      await nouvelleVersionReference(db, auth, id, corps.contenu, corps.motif);
      return detailReference(db, id);
    });
    reply.status(201);
    return detail;
  });

  /** Rattache un fichier téléversé par POST /api/fichiers (non rattaché, du même utilisateur). */
  app.post("/banque-ao/references/:id/attestations", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = attestationCreationSchema.parse(request.body);
    const detail = await app.db.withTenant(auth.cabinetId, async (db) => {
      await ajouterAttestation(db, auth, id, corps);
      return detailReference(db, id);
    });
    reply.status(201);
    return detail;
  });

  app.post("/banque-ao/attestations/:id/retrait", async (request) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const { motif } = attestationRetraitSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) =>
      detailReference(db, await retirerAttestation(db, auth, id, motif)),
    );
  });

  /** Fichier d'une pièce non retirée : `ao.lire`, revérifié à chaque appel, journalisé. */
  app.get("/banque-ao/attestations/:id/fichier", async (request, reply) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    const f = await app.db.withTenant(auth.cabinetId, async (db) => {
      const a = await exigerAttestation(db, id);
      if (a.retiree) throw introuvable("Pièce");
      const r = await db.query(
        `SELECT f.nom_origine AS nom, f.type_mime, f.taille, f.cle_stockage FROM fichiers f
         WHERE f.id = $1
           AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)`,
        [a.fichier_id],
      );
      if (!r.rows[0]) throw introuvable("Pièce");
      await journal(db, auth, "telechargement", "fichier", a.fichier_id, {
        attestation_id: id,
      });
      return r.rows[0] as { nom: string; type_mime: string; taille: string; cle_stockage: string };
    });
    let flux;
    try {
      flux = await stockageDe(app.config).lire(auth.cabinetId, f.cle_stockage);
    } catch (error) {
      if (error instanceof FichierAbsent) throw introuvable("Pièce");
      throw error;
    }
    const texte = f.type_mime === "text/plain" || f.type_mime === "text/csv";
    return reply
      .header("Content-Type", texte ? `${f.type_mime}; charset=utf-8` : f.type_mime)
      .header("Content-Length", String(f.taille))
      .header("Content-Disposition", contentDisposition(f.nom, "attachment"))
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "sandbox; default-src 'none'")
      .header("Cache-Control", "private, no-store")
      .header("Cross-Origin-Resource-Policy", "same-site")
      .header("Referrer-Policy", "no-referrer")
      .send(flux);
  });
}

function routesOffresTechniques(app: FastifyInstance) {
  app.get("/banque-ao/offres-techniques", async (request) => {
    const auth = exiger(request, "ao.lire");
    const q = offresQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerOffresTechniques(db, q));
  });

  /** Brouillon IA (orchestrateur, repli déterministe) ou gabarit ; à valider par un humain. */
  app.post("/banque-ao/offres-techniques", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const corps = offreTechniqueCreationSchema.parse(request.body);
    if (corps.generation === "ia") exiger(request, "ia.utiliser");
    if (corps.methode_version_id) exiger(request, "standard.lire");
    const { id, notifications } = await creerOffreTechnique(
      app.db,
      { config: app.config, journal: (e: unknown) => app.log.info({ ia: e }) },
      auth,
      corps,
    );
    await envoyerEmails(app.mailer, notifications, (m) => app.log.warn(m));
    reply.status(201);
    return app.db.withTenant(auth.cabinetId, (db) => detailOffreTechnique(db, id, auth));
  });

  app.get("/banque-ao/offres-techniques/:id", async (request) => {
    const auth = exiger(request, "ao.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => detailOffreTechnique(db, id, auth));
  });

  app.post("/banque-ao/offres-techniques/:id/versions", async (request, reply) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = offreTechniqueVersionSchema.parse(request.body);
    const detail = await app.db.withTenant(auth.cabinetId, async (db) => {
      await nouvelleVersionOffreTechnique(db, auth, id, corps.sections, corps.motif);
      return detailOffreTechnique(db, id, auth);
    });
    reply.status(201);
    return detail;
  });

  app.post("/banque-ao/offres-techniques/:id/validation", async (request) => {
    const auth = exiger(request, "ao.gerer");
    const { id } = paramsId.parse(request.params);
    const corps = offreTechniqueValidationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await validerOffreTechnique(db, auth, id, corps);
      return detailOffreTechnique(db, id, auth);
    });
  });
}

/** FIN-02 : lecture d'une offre financière (taux journaliers). */
function exigerLectureFinanciere(request: Parameters<typeof exiger>[0]): Auth {
  const auth = exiger(request, "ao.lire");
  exiger(request, "finance.lire");
  return auth;
}

/** FIN-02 : écriture d'une offre financière (fixer des taux). */
function exigerEcritureFinanciere(request: Parameters<typeof exiger>[0]): Auth {
  const auth = exigerLectureFinanciere(request);
  exiger(request, "taux.gerer");
  return auth;
}

function routesOffresFinancieres(app: FastifyInstance) {
  /** Calcul sans enregistrement (aperçu de la saisie). */
  app.post("/banque-ao/offres-financieres/simulation", async (request) => {
    exigerLectureFinanciere(request);
    return calculerOffre(offreFinanciereEntreeSchema.parse(request.body));
  });

  app.get("/banque-ao/offres-financieres", async (request) => {
    const auth = exigerLectureFinanciere(request);
    const q = offresQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, (db) => listerOffresFinancieres(db, q));
  });

  app.post("/banque-ao/offres-financieres", async (request, reply) => {
    const auth = exigerEcritureFinanciere(request);
    const corps = offreFinanciereCreationSchema.parse(request.body);
    const detail = await app.db.withTenant(auth.cabinetId, async (db) =>
      detailOffreFinanciere(db, await creerOffreFinanciere(db, auth, corps)),
    );
    reply.status(201);
    return detail;
  });

  app.get("/banque-ao/offres-financieres/:id", async (request) => {
    const auth = exigerLectureFinanciere(request);
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, (db) => detailOffreFinanciere(db, id));
  });

  app.post("/banque-ao/offres-financieres/:id/versions", async (request, reply) => {
    const auth = exigerEcritureFinanciere(request);
    const { id } = paramsId.parse(request.params);
    const corps = offreFinanciereVersionSchema.parse(request.body);
    const detail = await app.db.withTenant(auth.cabinetId, async (db) => {
      await nouvelleVersionOffreFinanciere(db, auth, id, corps.entree, corps.motif);
      return detailOffreFinanciere(db, id);
    });
    reply.status(201);
    return detail;
  });
}

export const routesBanqueAo: FastifyPluginAsync = async (app) => {
  // Règles métier traduites (SQLSTATE MPW…, moteurs) puis relancées : l'enveloppe d'erreur est
  // produite par le gestionnaire unique d'app.ts.
  app.setErrorHandler(async (error) => {
    throw traduireErreurBanqueAo(error);
  });
  routesCv(app);
  routesReferences(app);
  routesOffresTechniques(app);
  routesOffresFinancieres(app);
};
