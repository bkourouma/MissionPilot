import { z } from "zod";
import type { CodeErreurIngestion } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { ContexteJob, HandlerJob } from "../jobs/registre.js";
import { FichierAbsent, stockageDe } from "../stockage/index.js";
import {
  derniereTentative,
  lireDocument,
  mettreEnFileStructuration,
  type DocumentIngestion,
} from "./documents.js";
import { ErreurIngestion } from "./erreurs.js";
import type { DependancesIngestion } from "./fabrique.js";
import type { Ocr } from "./ocr.js";
import { lireBorne, marquerFichierSupprime, supprimerObjet } from "./fichier-temporaire.js";
import { extrairePagesPdf } from "./pdf.js";
import { extrairePagesTableur } from "./tableur.js";
import { TYPE_JOB_INGESTION_EXTRACTION, type ResultatExtractionTexte } from "./types.js";

export { TYPE_JOB_INGESTION_EXTRACTION };

/*
 * Job `ingestion_extraction` (ADR-009, décision 1) : charge `{document_id}`, trois tentatives.
 *
 * Lit le fichier du stockage, en extrait le texte des pages (PDF : couche texte puis OCR éventuel ; tableur :
 * la feuille), inscrit `ingestion_pages` (ajout seul), renseigne méthode / pages / caractères, passe le
 * document en `structuration`, MARQUE le fichier supprimé (`fichiers_suppressions`) et met en file
 * `ingestion_structuration`, le tout dans la transaction du job. L'effacement PHYSIQUE de l'objet attend la
 * durabilité des pages : début du job de structuration, ou ici en cas d'échec définitif.
 *
 * Échec DÉFINITIF (statut `echec`, code de `CODES_ERREUR_INGESTION`, jamais un message de bibliothèque) :
 * fichier absent, PDF illisible ou sans texte, plafonds, délai dépassé, classeur illisible. Panne passagère
 * (erreur inattendue, saturation) : le job est repris ; à la dernière tentative le document échoue
 * `ERREUR_INTERNE`.
 */

const chargeSchema = z.object({ document_id: z.string().uuid() }).strict();
/** Marge de lecture au-delà de la taille enregistrée (le fichier doit correspondre à l'enregistrement). */
const MARGE_LECTURE = 1024;

type ConfigStockage = DependancesIngestion["config"];

/** Échec définitif du document : fichier marqué supprimé, ligne d'échec, journal, effacement de l'objet. */
async function echouer(
  ctx: ContexteJob,
  config: ConfigStockage,
  doc: DocumentIngestion,
  code: CodeErreurIngestion,
) {
  await marquerFichierSupprime(ctx.db, doc);
  await ctx.db.query(
    `UPDATE ingestion_documents SET statut = 'echec', erreur_code = $2, termine_le = $3,
       fichier_id = NULL WHERE id = $1`,
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
  // `fichier_id` est déjà libéré par la ligne d'échec (un document en échec n'est plus modifiable).
  await supprimerObjet(ctx.db, config, doc);
  return [];
}

export function creerHandlerIngestionExtraction(
  dependances: () => DependancesIngestion,
): HandlerJob {
  return async (ctx) => {
    const charge = chargeSchema.safeParse(ctx.charge);
    if (!charge.success) throw new ErreurJobDefinitive("Charge d'extraction invalide.");
    // TOUT le traitement est sous ce SAVEPOINT : une erreur inattendue à la dernière tentative (ou définitive)
    // met le document en échec ERREUR_INTERNE au lieu de le laisser « en traitement » pour toujours.
    await ctx.db.query("SAVEPOINT ingestion_job");
    try {
      const { config, ocr } = dependances();
      return await executer(ctx, charge.data.document_id, config, ocr);
    } catch (error) {
      await ctx.db.query("ROLLBACK TO SAVEPOINT ingestion_job");
      const definitive = error instanceof ErreurJobDefinitive;
      if (!definitive && !(await derniereTentative(ctx.db, ctx.jobId))) throw error;
      const doc = await lireDocument(ctx.db, charge.data.document_id, true);
      if (!doc || (doc.statut !== "en_file" && doc.statut !== "extraction")) {
        if (definitive) throw error;
        return [];
      }
      return echouer(ctx, dependances().config, doc, "ERREUR_INTERNE");
    }
  };
}

async function executer(
  ctx: ContexteJob,
  documentId: string,
  config: ConfigStockage,
  ocr: Ocr | null,
) {
  {
    const doc = await lireDocument(ctx.db, documentId, true);
    if (!doc || (doc.statut !== "en_file" && doc.statut !== "extraction")) return [];
    const derniere = await derniereTentative(ctx.db, ctx.jobId);
    const echec = (code: CodeErreurIngestion) => echouer(ctx, config, doc, code);

    if (doc.statut === "en_file") {
      await ctx.db.query("UPDATE ingestion_documents SET statut = 'extraction' WHERE id = $1", [
        doc.id,
      ]);
    }
    let contenu: Buffer | null = null;
    if (doc.fichier_id) {
      const f = await ctx.db.query("SELECT cle_stockage FROM fichiers WHERE id = $1", [
        doc.fichier_id,
      ]);
      const cle = f.rows[0]?.cle_stockage as string | undefined;
      if (cle) {
        try {
          contenu = await lireBorne(
            await stockageDe(config).lire(ctx.cabinetId, cle),
            doc.taille + MARGE_LECTURE,
          );
        } catch (error) {
          if (!(error instanceof FichierAbsent)) throw error;
        }
      }
    }
    if (contenu === null) return echec("FICHIER_ABSENT");

    let extrait: ResultatExtractionTexte;
    try {
      extrait =
        doc.format === "pdf"
          ? await extrairePagesPdf(contenu, { ocr })
          : await extrairePagesTableur(contenu);
    } catch (error) {
      if (error instanceof ErreurIngestion) return echec(error.code);
      if (derniere) return echec("ERREUR_INTERNE");
      throw error;
    }

    const { pages } = extrait;
    await ctx.db.query(
      `INSERT INTO ingestion_pages (cabinet_id, document_id, numero, texte, methode, confiance_pm)
       SELECT $1, $2, x.numero, x.texte, x.methode, x.confiance_pm
       FROM unnest($3::int[], $4::text[], $5::text[], $6::int[])
         AS x(numero, texte, methode, confiance_pm)`,
      [
        ctx.cabinetId,
        doc.id,
        pages.map((p) => p.numero),
        pages.map((p) => p.texte),
        pages.map((p) => p.methode),
        pages.map((p) => p.confiance_pm),
      ],
    );
    await ctx.db.query(
      `UPDATE ingestion_documents SET methode = $2, nb_pages = $3, nb_caracteres = $4,
         statut = 'structuration' WHERE id = $1`,
      [doc.id, extrait.methode, pages.length, pages.reduce((s, p) => s + p.texte.length, 0)],
    );
    await marquerFichierSupprime(ctx.db, doc);
    await mettreEnFileStructuration(ctx.db, ctx.cabinetId, doc.id, ctx.maintenant);
    return [];
  }
}
