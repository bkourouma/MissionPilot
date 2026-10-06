import type { FastifyPluginAsync } from "fastify";
import {
  fichierTelechargementQuerySchema,
  TYPES_FICHIER_EN_LIGNE,
  type TypeFichier,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, interdit, introuvable } from "../errors.js";
import { deboursVisible, exigerDebours, vueDebours } from "../facturation/debours.js";
import { paramsId } from "../http/outils.js";
import { FichierAbsent, stockageDe } from "../stockage/index.js";
import {
  enregistrerFichier,
  exigerFichierLisible,
  lireTeleversement,
  retirerFichier,
} from "../stockage/fichiers.js";
import { contentDisposition } from "../stockage/nom.js";

/*
 * Fichiers (SOC-05) et justificatifs de débours (FIN-05).
 *
 * Téléchargement GET /fichiers/:id : authentifié, contrôle du cabinet (RLS)
 * ET de la visibilité de l'entité rattachée à CHAQUE appel (404 sinon), flux
 * depuis le stockage (jamais de service statique), journal d'audit sans le
 * contenu. En-têtes : Content-Type forcé au type DÉTECTÉ, nosniff,
 * `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store`,
 * Content-Disposition `attachment` par défaut ; `inline` seulement sur
 * demande et pour PDF, PNG, JPEG, WebP (jamais de HTML ni de SVG servi :
 * ils sont refusés au téléversement).
 */

const STATUTS_JUSTIFIABLES = ["brouillon", "rejete"];

/** Corps multipart : plafond du fichier + marge pour l'enveloppe. */
const limiteCorps = (tailleMax: number) => tailleMax + 64 * 1024;

/** Débours de l'utilisateur, encore modifiable (brouillon ou rejeté), sinon 404/403/409. */
async function exigerDeboursJustifiable(db: Db, auth: Auth, id: string, verrouiller: boolean) {
  const { debours } = await deboursVisible(db, auth, id, verrouiller);
  if (debours.auteur_id !== auth.utilisateurId) throw interdit();
  if (!STATUTS_JUSTIFIABLES.includes(debours.statut as string)) {
    throw conflit("Débours soumis ou validé : son justificatif est figé.");
  }
  return debours;
}

export const routesFichiers: FastifyPluginAsync = async (app) => {
  const tailleMax = app.config.FICHIER_TAILLE_MAX_OCTETS;

  /** Téléverse un fichier, à rattacher ensuite (version de document) dans les 23 h. */
  app.post("/fichiers", { bodyLimit: limiteCorps(tailleMax) }, async (request, reply) => {
    const auth = exiger(request, "document.ecrire");
    const recu = await lireTeleversement(request, tailleMax);
    const fichier = await enregistrerFichier(app, auth, recu);
    reply.status(201);
    return fichier;
  });

  app.get("/fichiers/:id", async (request, reply) => {
    // Tout utilisateur connecté : l'accès est décidé par l'entité rattachée.
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    const q = fichierTelechargementQuerySchema.parse(request.query);
    const f = await app.db.withTenant(auth.cabinetId, async (db) => {
      const lu = await exigerFichierLisible(db, auth, id);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "telechargement",
        entite: "fichier",
        entiteId: id,
        details: { nom: lu.nom, type_mime: lu.type_mime },
      });
      return lu;
    });
    let flux;
    try {
      flux = await stockageDe(app.config).lire(auth.cabinetId, f.cle_stockage);
    } catch (error) {
      if (error instanceof FichierAbsent) throw introuvable("Fichier");
      throw error;
    }
    const enLigne =
      q.affichage === "inline" && TYPES_FICHIER_EN_LIGNE.includes(f.type_mime as TypeFichier);
    const texte = f.type_mime === "text/plain" || f.type_mime === "text/csv";
    return reply
      .header("Content-Type", texte ? `${f.type_mime}; charset=utf-8` : f.type_mime)
      .header("Content-Length", String(f.taille))
      .header("Content-Disposition", contentDisposition(f.nom, enLigne ? "inline" : "attachment"))
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "sandbox; default-src 'none'")
      .header("Cache-Control", "private, no-store")
      .header("Cross-Origin-Resource-Policy", "same-site")
      .header("Referrer-Policy", "no-referrer")
      .send(flux);
  });

  /** Retire un fichier téléversé non rattaché (son auteur seulement). */
  app.delete("/fichiers/:id", async (request, reply) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    await retirerFichier(app, auth, id);
    return reply.status(204).send();
  });

  /**
   * Justificatif d'UN débours de l'utilisateur, en brouillon (ou rejeté :
   * il repasse en brouillon, comme une modification). Remplace le précédent,
   * qui devient orphelin (purgé sous 24 h).
   */
  app.post("/debours/:id/justificatif", { bodyLimit: limiteCorps(tailleMax) }, async (request) => {
    const auth = exiger(request, "debours.saisir");
    const { id } = paramsId.parse(request.params);
    // Droits contrôlés AVANT de lire le corps, puis revérifiés sous verrou.
    await app.db.withTenant(auth.cabinetId, (db) => exigerDeboursJustifiable(db, auth, id, false));
    const recu = await lireTeleversement(request, tailleMax);
    await enregistrerFichier(app, auth, recu, {
      details: { debours_id: id },
      rattacher: async (db, fichier) => {
        const debours = await exigerDeboursJustifiable(db, auth, id, true);
        await db.query(
          `UPDATE debours SET justificatif_fichier_id = $2, justificatif = NULL,
               statut = 'brouillon', modifie_le = now() WHERE id = $1`,
          [id, fichier.id],
        );
        await journaliser(db, {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "justificatif",
          entite: "debours",
          entiteId: id,
          details: {
            mission_id: debours.mission_id,
            fichier_id: fichier.id,
            remplace: debours.justificatif_fichier_id ?? null,
          },
        });
      },
    });
    return app.db.withTenant(auth.cabinetId, async (db) => vueDebours(await exigerDebours(db, id)));
  });

  /** Détache le justificatif d'un débours en brouillon (le fichier devient orphelin). */
  app.delete("/debours/:id/justificatif", async (request) => {
    const auth = exiger(request, "debours.saisir");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const debours = await exigerDeboursJustifiable(db, auth, id, true);
      await db.query(
        `UPDATE debours SET justificatif_fichier_id = NULL, justificatif = NULL,
           statut = 'brouillon', modifie_le = now() WHERE id = $1`,
        [id],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "retrait_justificatif",
        entite: "debours",
        entiteId: id,
        details: { mission_id: debours.mission_id, fichier_id: debours.justificatif_fichier_id },
      });
      return vueDebours(await exigerDebours(db, id));
    });
  });
};
