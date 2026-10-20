import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  signatureAnnulationSchema,
  signatureCreationSchema,
  signatureEnvoiSchema,
  signatureMissionParamSchema,
  signatureParamSchema,
  signatureRefusSchema,
  signatureSignerSchema,
  signaturesQuerySchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { empreinte, trousseauDepuisConfig } from "../auth/chiffrement.js";
import { exiger } from "../auth/contexte.js";
import { serviceIdentite } from "../auth/confirmer-identite.js";
import { COOKIE_SESSION, hacherJeton } from "../auth/session.js";
import { traduireErreurCanaux } from "../canaux/erreurs.js";
import { lireDossierPreuves } from "../canaux/preuves.js";
import {
  annulerDemande,
  creerDemandeSignature,
  envoyerDemande,
  exigerDemandeVisible,
  lireSignataires,
  listerDemandesMission,
  monSignataire,
  noterConsultation,
  refuserDemande,
  signerDemande,
  vueDemande,
  vueSignataire,
  type DependancesSignature,
} from "../canaux/signatures.js";
import { AppError, introuvable } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { exigerMissionModifiable, exigerMissionVisible } from "../missions/acces.js";
import { envoyerEmails } from "../notifications/notifier.js";
import { FichierAbsent, stockageDe } from "../stockage/index.js";
import { contentDisposition } from "../stockage/nom.js";
import type { Db } from "../db/pool.js";

/*
 * Signature électronique d'un PDF de mission (CLI-05, ADR-010, lot 3c), sous /api, côté cabinet.
 * Fournisseur LOCAL : « simple simulée », SANS valeur juridique ; aucun effet sur le budget ni sur le
 * statut de la mission. Mission visible TOUJOURS exigée (404 sinon) ; fermées au portail (le client
 * signe par /api/portail/signatures). Signer : `mission.signer`, signataire de la partie cabinet,
 * reconfirmation d'identité (second facteur ACTIF exigé : 409 `TFA_INACTIVE`).
 */

/**
 * CSP de la lecture en ligne d'un PDF de signature. Pas de `sandbox` : il empêche la visionneuse PDF du
 * navigateur de s'afficher. Le contenu est un PDF dont le type a été DÉTECTÉ par le contenu à l'import
 * (liste blanche, PDF à contenu actif refusé) et vérifié à la création de la demande ; le serveur fixe
 * lui-même `application/pdf`.
 */
export const CSP_LECTURE_PDF = "default-src 'none'; frame-ancestors 'none'";

/**
 * En-têtes de lecture du document d'une demande de signature (cabinet et portail) : lecture dans le
 * navigateur (`inline`) pour un PDF ; tout autre type (ne devrait pas exister) reste en pièce jointe
 * sous la CSP `sandbox`. `nosniff`, `no-store` dans les deux cas.
 */
export function entetesDocumentSignature(f: {
  nom: string;
  type_mime: string;
  taille: string | number;
}): Record<string, string> {
  const pdf = f.type_mime === "application/pdf";
  return {
    "Content-Type": pdf ? "application/pdf" : f.type_mime,
    "Content-Length": String(f.taille),
    "Content-Disposition": contentDisposition(f.nom, pdf ? "inline" : "attachment"),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": pdf ? CSP_LECTURE_PDF : "sandbox; default-src 'none'",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}

export function dependancesSignature(app: FastifyInstance): DependancesSignature {
  return {
    trousseau: trousseauDepuisConfig(app.config),
    canaux: app.canaux,
    origineWeb: new URL(app.config.WEB_ORIGIN).origin,
  };
}

/** Empreinte HMAC de la session (jamais le jeton, jamais l'adresse IP) pour la preuve. */
export function empreinteSession(app: FastifyInstance, request: FastifyRequest): string | null {
  const jeton = request.cookies[COOKIE_SESSION];
  if (!jeton) return null;
  const t = trousseauDepuisConfig(app.config);
  return empreinte(t, "canal_empreinte", t.versionActuelle, `session:${hacherJeton(jeton)}`);
}

/** Dossier de preuve d'une demande (JSON seul), chaîne revérifiée à chaque lecture. */
export async function dossierPreuves(db: Db, demande: Parameters<typeof vueDemande>[1]) {
  const signataires = await lireSignataires(db, demande.id);
  const { preuves, verification } = await lireDossierPreuves(
    db,
    demande.id,
    demande.empreinte_document,
  );
  return {
    demande: await vueDemande(db, demande),
    signataires: signataires.map(vueSignataire),
    preuves: preuves.map((p) => ({
      rang: p.rang,
      type_evenement: p.type_evenement,
      signataire_id: p.signataire_id,
      horodatage: p.horodatage,
      horodatage_source: "base_locale" as const,
      authentification: p.authentification,
      empreinte: p.empreinte,
      empreinte_precedente: p.empreinte_precedente,
    })),
    verification,
  };
}

export const routesSignatures: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurCanaux(error);
  });

  app.post("/missions/:id/signatures", async (request, reply) => {
    const auth = exiger(request, "signature.demander");
    const { id } = signatureMissionParamSchema.parse(request.params);
    const corps = signatureCreationSchema.parse(request.body);
    const demande = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionModifiable(db, auth, id);
      const did = await creerDemandeSignature(db, auth, mission, corps, new Date());
      const { demande: d } = await exigerDemandeVisible(db, auth, did);
      return {
        ...(await vueDemande(db, d)),
        signataires: (await lireSignataires(db, did)).map(vueSignataire),
      };
    });
    reply.status(201);
    return demande;
  });

  app.get("/missions/:id/signatures", async (request) => {
    const auth = exiger(request, "signature.lire");
    const { id } = signatureMissionParamSchema.parse(request.params);
    const q = signaturesQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const lignes = await listerDemandesMission(db, id, q.statut, apres, q.limite);
      const page = paginer(lignes, q.limite);
      return {
        elements: await Promise.all(
          page.elements.map(async (d) => vueDemande(db, d as Parameters<typeof vueDemande>[1])),
        ),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });

  app.get("/signatures/:id", async (request) => {
    const auth = exiger(request, "signature.lire");
    const { id } = signatureParamSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { demande } = await exigerDemandeVisible(db, auth, id);
      return {
        ...(await vueDemande(db, demande)),
        signataires: (await lireSignataires(db, id)).map(vueSignataire),
      };
    });
  });

  app.post("/signatures/:id/envoyer", async (request) => {
    const auth = exiger(request, "signature.demander");
    const { id } = signatureParamSchema.parse(request.params);
    signatureEnvoiSchema.parse(request.body ?? {});
    const r = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { demande } = await exigerDemandeVisible(db, auth, id);
      await exigerMissionModifiable(db, auth, demande.mission_id);
      const e = await envoyerDemande(db, dependancesSignature(app), auth, id, new Date());
      return { notifications: e.notifications, vue: await vueDemande(db, e.demande) };
    });
    await envoyerEmails(app.mailer, r.notifications, (m) => request.log.warn(m));
    return r.vue;
  });

  app.post("/signatures/:id/annuler", async (request) => {
    const auth = exiger(request, "signature.demander");
    const { id } = signatureParamSchema.parse(request.params);
    const corps = signatureAnnulationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const d = await annulerDemande(db, dependancesSignature(app), auth, id, corps.motif);
      return vueDemande(db, d);
    });
  });

  app.post("/signatures/:id/signer", async (request) => {
    const auth = exiger(request, "mission.signer");
    const { id } = signatureParamSchema.parse(request.params);
    const corps = signatureSignerSchema.parse(request.body);
    // Mission visible et signataire de la partie cabinet : sinon le même 404.
    await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerDemandeVisible(db, auth, id);
      if (!(await monSignataire(db, id, auth.utilisateurId, "cabinet"))) {
        throw introuvable("Demande de signature");
      }
    });
    const sessionEmpreinte = empreinteSession(app, request);
    const r = await serviceIdentite(app).confirmerIdentite(
      auth,
      corps,
      "signature_document",
      (db, facteur) =>
        signerDemande(db, dependancesSignature(app), {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          demandeId: id,
          partie: "cabinet",
          clientId: null,
          facteur,
          sessionEmpreinte,
          maintenant: new Date(),
        }),
    );
    await envoyerEmails(app.mailer, r.notifications, (m) => request.log.warn(m));
    return app.db.withTenant(auth.cabinetId, async (db) => vueDemande(db, r.demande));
  });

  app.post("/signatures/:id/refuser", async (request) => {
    const auth = exiger(request, "mission.signer");
    const { id } = signatureParamSchema.parse(request.params);
    const corps = signatureRefusSchema.parse(request.body);
    const notifications = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerDemandeVisible(db, auth, id);
      return refuserDemande(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        demandeId: id,
        partie: "cabinet",
        clientId: null,
        motif: corps.motif,
        maintenant: new Date(),
      });
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { demande } = await exigerDemandeVisible(db, auth, id);
      return vueDemande(db, demande);
    });
  });

  app.get("/signatures/:id/preuves", async (request) => {
    const auth = exiger(request, "signature.lire");
    const { id } = signatureParamSchema.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { demande } = await exigerDemandeVisible(db, auth, id);
      // L'accès au dossier de preuve est journalisé ; format JSON seul.
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "signature.exporter_preuves",
        entite: "signature_demande",
        entiteId: id,
        details: {},
      });
      return dossierPreuves(db, demande);
    });
  });

  // Lecture du PDF par un signataire du cabinet (preuve « document consulté », exigée avant de signer).
  app.get("/signatures/:id/document", async (request, reply) => {
    const auth = exiger(request, "signature.lire");
    const { id } = signatureParamSchema.parse(request.params);
    const f = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { demande } = await exigerDemandeVisible(db, auth, id);
      await noterConsultation(db, {
        cabinetId: auth.cabinetId,
        demandeId: id,
        utilisateurId: auth.utilisateurId,
        partie: "cabinet",
      });
      const r = await db.query(
        `SELECT nom_origine AS nom, type_mime, taille, cle_stockage FROM fichiers WHERE id = $1`,
        [demande.fichier_id],
      );
      if (!r.rows[0]) throw introuvable("Document");
      return r.rows[0] as {
        nom: string;
        type_mime: string;
        taille: string | number;
        cle_stockage: string;
      };
    });
    let flux;
    try {
      flux = await stockageDe(app.config).lire(auth.cabinetId, f.cle_stockage);
    } catch (error) {
      if (error instanceof FichierAbsent) throw introuvable("Document");
      throw error;
    }
    return reply.headers(entetesDocumentSignature(f)).send(flux);
  });
};

void AppError;
