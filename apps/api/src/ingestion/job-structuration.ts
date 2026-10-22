import { z } from "zod";
import type { CodeErreurIngestion } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { authDe } from "../collaboration/entites.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { ContexteJob, HandlerJob } from "../jobs/registre.js";
import { derniereTentative, lireDocument, type DocumentIngestion } from "./documents.js";
import { ErreurIngestion } from "./erreurs.js";
import type { DependancesIngestion } from "./fabrique.js";
import { effacerObjet } from "./fichier-temporaire.js";
import { STRUCTUREURS, type PageIngeree } from "./structuration.js";
import { TYPE_JOB_INGESTION_STRUCTURATION } from "./types.js";

export { TYPE_JOB_INGESTION_STRUCTURATION };

/*
 * Job `ingestion_structuration` (ADR-009, décision 1) : charge `{document_id}`, trois tentatives.
 *
 * 1. efface l'objet de stockage du document (les pages sont durables : l'extraction a été validée), de façon
 *    idempotente ;
 * 2. reconstruit l'AUTEUR du document (`authDe` : utilisateur inactif -> échec UTILISATEUR_INACTIF) ;
 * 3. appelle le structureur de l'usage (`STRUCTUREURS`, voir structuration.ts) sous un SAVEPOINT : une erreur
 *    SQL du structureur n'abîme pas la transaction du job ;
 * 4. passe le document en `termine` avec le résultat (`termine_le` = horloge du job).
 *
 * Un `ErreurIngestion` du structureur est un échec DÉFINITIF (code stable) ; toute autre erreur est une
 * panne passagère (job repris, `ERREUR_INTERNE` à la dernière tentative). Un document qui n'est pas en
 * `structuration` (déjà traité) est ignoré. Une relance (usages DD et standard) repasse `termine` ->
 * `structuration` avec un nouveau job (documents.ts, `relancerStructuration`).
 */

const chargeSchema = z.object({ document_id: z.string().uuid() }).strict();

export function creerHandlerIngestionStructuration(
  dependances: () => DependancesIngestion,
): HandlerJob {
  return async (ctx) => {
    const charge = chargeSchema.safeParse(ctx.charge);
    if (!charge.success) throw new ErreurJobDefinitive("Charge de structuration invalide.");
    // TOUT le traitement est sous ce SAVEPOINT : une erreur inattendue à la dernière tentative (ou définitive)
    // met le document en échec ERREUR_INTERNE au lieu de le laisser « en traitement » pour toujours.
    await ctx.db.query("SAVEPOINT ingestion_job");
    try {
      return await executer(ctx, charge.data.document_id, dependances());
    } catch (error) {
      await ctx.db.query("ROLLBACK TO SAVEPOINT ingestion_job");
      const definitive = error instanceof ErreurJobDefinitive;
      if (!definitive && !(await derniereTentative(ctx.db, ctx.jobId))) throw error;
      const doc = await lireDocument(ctx.db, charge.data.document_id, true);
      if (!doc || doc.statut !== "structuration") {
        if (definitive) throw error;
        return [];
      }
      return echouer(ctx, doc, "ERREUR_INTERNE");
    }
  };
}

async function echouer(ctx: ContexteJob, doc: DocumentIngestion, code: CodeErreurIngestion) {
  await ctx.db.query(
    `UPDATE ingestion_documents SET statut = 'echec', erreur_code = $2, termine_le = $3
     WHERE id = $1`,
    [doc.id, code, ctx.maintenant],
  );
  await journaliser(ctx.db, {
    cabinetId: ctx.cabinetId,
    utilisateurId: doc.cree_par,
    action: "ingestion.echec",
    entite: "ingestion_document",
    entiteId: doc.id,
    details: { usage: doc.usage, code },
  });
  return [];
}

async function executer(ctx: ContexteJob, documentId: string, deps: DependancesIngestion) {
  {
    const doc = await lireDocument(ctx.db, documentId, true);
    if (!doc || doc.statut !== "structuration") return [];
    const derniere = await derniereTentative(ctx.db, ctx.jobId);
    const echec = (code: CodeErreurIngestion) => echouer(ctx, doc, code);

    // Les pages sont durables : l'objet de stockage peut disparaître (idempotent).
    await effacerObjet(ctx.db, deps.config, doc);

    const auth = await authDe(ctx.db, ctx.cabinetId, doc.cree_par);
    if (!auth) return echec("UTILISATEUR_INACTIF");
    if (!ctx.database) throw new ErreurJobDefinitive("Base de l'application absente du contexte.");

    const lues = await ctx.db.query(
      `SELECT numero, texte, methode, confiance_pm::int AS confiance_pm, length(texte)::int AS nb_caracteres
       FROM ingestion_pages WHERE document_id = $1 ORDER BY numero`,
      [doc.id],
    );
    const pages = lues.rows as PageIngeree[];

    await ctx.db.query("SAVEPOINT ingestion_structuration");
    let sortie;
    try {
      sortie = await STRUCTUREURS[doc.usage]({
        document: doc,
        pages,
        db: ctx.db,
        database: ctx.database,
        auth,
        deps,
        maintenant: ctx.maintenant,
      });
      await ctx.db.query("RELEASE SAVEPOINT ingestion_structuration");
    } catch (error) {
      await ctx.db.query("ROLLBACK TO SAVEPOINT ingestion_structuration");
      if (error instanceof ErreurIngestion) return echec(error.code);
      if (derniere) return echec("ERREUR_INTERNE");
      throw error;
    }
    await ctx.db.query(
      `UPDATE ingestion_documents SET statut = 'termine', resultat = $2, termine_le = $3,
         etat_financier_id = COALESCE($4::uuid, etat_financier_id)
       WHERE id = $1`,
      [doc.id, sortie.resultat, ctx.maintenant, sortie.etat_financier_id ?? null],
    );
    await journaliser(ctx.db, {
      cabinetId: ctx.cabinetId,
      utilisateurId: doc.cree_par,
      action: "ingestion.terminer",
      entite: "ingestion_document",
      entiteId: doc.id,
      details: { usage: doc.usage, resultat: sortie.resultat },
    });
    return [];
  }
}
