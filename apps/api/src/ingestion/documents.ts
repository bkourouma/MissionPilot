import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  LIBELLES_ERREUR_INGESTION,
  PLAFONDS_INGESTION,
  type CodeErreurIngestion,
  type FormatIngestion,
  type MethodeExtraction,
  type ResultatIngestion,
  type StatutDocumentIngestion,
  type UsageIngestion,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, introuvable } from "../errors.js";
import { avecPlaceAnalyse } from "../routes/fichiers.js";
import { detecterType } from "../stockage/detection.js";
import { enregistrerFichier, type TeleversementRecu } from "../stockage/fichiers.js";
import { assainirNom, extensionDe } from "../stockage/nom.js";
import { TYPE_XLSX } from "../temps/import-excel.js";
import {
  fichierTropVolumineux,
  ingestionPlein,
  textePurge,
  typeDocumentRefuse,
} from "./erreurs.js";
import { listerExtractions, type VueExtraction } from "./extractions.js";
import {
  TENTATIVES_INGESTION,
  TYPE_JOB_INGESTION_EXTRACTION,
  TYPE_JOB_INGESTION_STRUCTURATION,
} from "./types.js";

/*
 * Documents ingérés (lot 6, ADR-009) : réception, plafonds par cabinet, vues, lecture des pages.
 *
 * RÉCEPTION (`creerDocument`) : le type est décidé par le CONTENU AVANT tout stockage
 * (`detecterType` : exécutable, PDF actif, macro… refusés 415) ; seuls PDF et XLSX sont admis
 * (sinon 415 TYPE_DOCUMENT_REFUSE) ; le fichier est enregistré (quota du cabinet) et la ligne
 * `ingestion_documents` ainsi que le job `ingestion_extraction` naissent DANS LA MÊME transaction
 * (`enregistrerFichier` + `rattacher`) : un refus de plafond efface l'objet de stockage.
 *
 * POUR UN AUTRE USAGE (due diligence, standard) : la route de l'usage contrôle d'abord ses droits
 * (permission, visibilité du dossier DD ou du brouillon de méthode), lit le corps avec
 * `lireTeleversement` (taille max : `PLAFONDS_INGESTION.tailleOctetsPdf`, garde `gardeTailleMultipart`),
 * puis appelle `creerDocument(app, auth, recu, { usage, dd_dossier_id | version_methode_id, parametres })`
 * et répond 202 avec la vue renvoyée. Les contraintes SQL de la table imposent la cohérence usage / portée.
 *
 * PLAFONDS par cabinet : 5 documents en traitement, 40 créations par 24 h (409 INGESTION_PLEIN),
 * sérialisés par un verrou de transaction.
 *
 * Aucune vue ne porte de clé de stockage, de coût ni de nom non assaini.
 */

export interface DocumentIngestion {
  id: string;
  cabinet_id: string;
  usage: UsageIngestion;
  client_id: string | null;
  dd_dossier_id: string | null;
  version_methode_id: string | null;
  nom: string;
  format: FormatIngestion;
  sha256: string;
  taille: number;
  fichier_id: string | null;
  parametres: Record<string, unknown>;
  statut: StatutDocumentIngestion;
  resultat: ResultatIngestion | null;
  methode: MethodeExtraction | null;
  nb_pages: number | null;
  nb_caracteres: number | null;
  erreur_code: string | null;
  etat_financier_id: string | null;
  cree_par: string;
  cree_par_nom: string;
  cree_le: Date;
  termine_le: Date | null;
  /** Dernier demandeur d'une lecture (téléversement ou relance) : ne valide pas le brouillon (MQG02). */
  derniere_demande_par: string | null;
  /** Texte des pages purgé à cette date (conservation limitée), sinon null. */
  texte_purge_le: Date | null;
}

const COLONNES_DOCUMENT = `d.id, d.cabinet_id, d.usage, d.client_id, d.dd_dossier_id, d.version_methode_id,
  d.nom, d.format, d.sha256, d.taille, d.fichier_id, d.parametres, d.statut, d.resultat, d.methode,
  d.nb_pages, d.nb_caracteres, d.erreur_code, d.etat_financier_id, d.cree_par, u.nom AS cree_par_nom,
  d.cree_le, d.termine_le, d.derniere_demande_par, d.texte_purge_le`;
const DEPUIS_DOCUMENT = "ingestion_documents d JOIN utilisateurs u ON u.id = d.cree_par";
const CLE_TRI = `to_char(d.cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const horodatage = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : ((v as string | null | undefined) ?? null);

export interface VueDocument {
  id: string;
  usage: UsageIngestion;
  nom: string;
  format: FormatIngestion;
  taille: number;
  statut: StatutDocumentIngestion;
  resultat: ResultatIngestion | null;
  methode: MethodeExtraction | null;
  nb_pages: number | null;
  nb_caracteres: number | null;
  erreur_code: string | null;
  erreur: string | null;
  etat_financier_id: string | null;
  parametres: Record<string, unknown>;
  cree_par: { id: string; nom: string };
  cree_le: string | null;
  termine_le: string | null;
  /** Date de purge du texte des pages (ISO), null tant que le texte est conservé. */
  texte_purge_le: string | null;
}

/** Vue d'un document au format de l'API (contrat figé : le web s'y appuie). */
export function vueDocument(d: DocumentIngestion): VueDocument {
  return {
    id: d.id,
    usage: d.usage,
    nom: d.nom,
    format: d.format,
    taille: Number(d.taille),
    statut: d.statut,
    resultat: d.resultat,
    methode: d.methode,
    nb_pages: d.nb_pages,
    nb_caracteres: d.nb_caracteres,
    erreur_code: d.erreur_code,
    erreur: d.erreur_code
      ? (LIBELLES_ERREUR_INGESTION[d.erreur_code as CodeErreurIngestion] ??
        LIBELLES_ERREUR_INGESTION.ERREUR_INTERNE)
      : null,
    etat_financier_id: d.etat_financier_id,
    parametres: d.parametres,
    cree_par: { id: d.cree_par, nom: d.cree_par_nom },
    cree_le: horodatage(d.cree_le),
    termine_le: horodatage(d.termine_le),
    texte_purge_le: horodatage(d.texte_purge_le),
  };
}

/** Périmètre d'un document : au moins une de ces portées, selon l'usage. */
export interface PorteeDocuments {
  client_id?: string;
  dd_dossier_id?: string;
  version_methode_id?: string;
  usages?: readonly UsageIngestion[];
}

const COLONNES_PORTEE = ["client_id", "dd_dossier_id", "version_methode_id"] as const;

function clausePortee(
  portee: PorteeDocuments,
  depart: number,
): { sql: string; valeurs: unknown[] } {
  const sql: string[] = [];
  const valeurs: unknown[] = [];
  for (const colonne of COLONNES_PORTEE) {
    const v = portee[colonne];
    if (v === undefined) continue;
    valeurs.push(v);
    sql.push(`d.${colonne} = $${depart + valeurs.length - 1}`);
  }
  if (portee.usages) {
    valeurs.push([...portee.usages]);
    sql.push(`d.usage = ANY ($${depart + valeurs.length - 1}::text[])`);
  }
  if (sql.length === 0) throw new Error("Périmètre de documents vide.");
  return { sql: sql.join(" AND "), valeurs };
}

/** Document du périmètre, ou 404 (un document d'un autre dossier ou cabinet n'existe pas pour l'appelant). */
export async function exigerDocument(
  db: Db,
  id: string,
  portee: PorteeDocuments,
  verrouiller = false,
): Promise<DocumentIngestion> {
  const p = clausePortee(portee, 2);
  const r = await db.query(
    `SELECT ${COLONNES_DOCUMENT} FROM ${DEPUIS_DOCUMENT} WHERE d.id = $1 AND ${p.sql}
     ${verrouiller ? "FOR UPDATE OF d" : ""}`,
    [id, ...p.valeurs],
  );
  if (!r.rows[0]) throw introuvable("Document");
  return r.rows[0] as DocumentIngestion;
}

/** Document par identifiant seul (jobs : le cabinet est celui de la transaction). */
export async function lireDocument(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<DocumentIngestion | null> {
  const r = await db.query(
    `SELECT ${COLONNES_DOCUMENT} FROM ${DEPUIS_DOCUMENT} WHERE d.id = $1
     ${verrouiller ? "FOR UPDATE OF d" : ""}`,
    [id],
  );
  return (r.rows[0] as DocumentIngestion | undefined) ?? null;
}

/** Liste paginée (plus récent d'abord) ; `cle_tri` est consommée par `paginer`. */
export async function listerDocuments(
  db: Db,
  portee: PorteeDocuments,
  apres: [string, string] | null,
  limite: number,
): Promise<(VueDocument & { cle_tri: string })[]> {
  const p = clausePortee(portee, 1);
  const n = p.valeurs.length;
  const r = await db.query(
    `SELECT ${COLONNES_DOCUMENT}, ${CLE_TRI} AS cle_tri FROM ${DEPUIS_DOCUMENT}
     WHERE ${p.sql}
       AND ($${n + 1}::text IS NULL OR (d.cree_le, d.id) < ($${n + 1}::timestamptz, $${n + 2}::uuid))
     ORDER BY d.cree_le DESC, d.id DESC LIMIT $${n + 3}`,
    [...p.valeurs, apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  return r.rows.map((l) => ({
    ...vueDocument(l as DocumentIngestion),
    cle_tri: l.cle_tri as string,
  }));
}

export interface ResumePage {
  numero: number;
  nb_caracteres: number;
  methode: MethodeExtraction;
  confiance_pm: number | null;
}

export async function listerPages(db: Db, documentId: string): Promise<ResumePage[]> {
  const r = await db.query(
    `SELECT numero, length(texte)::int AS nb_caracteres, methode, confiance_pm::int AS confiance_pm
     FROM ingestion_pages WHERE document_id = $1 ORDER BY numero`,
    [documentId],
  );
  return r.rows as ResumePage[];
}

/** Page d'un document ; 404 « texte purgé » quand la conservation du texte est échue, 404 si la page n'existe pas. */
export async function lirePage(db: Db, documentId: string, numero: number) {
  const purge = await db.query("SELECT texte_purge_le FROM ingestion_documents WHERE id = $1", [
    documentId,
  ]);
  if (purge.rows[0]?.texte_purge_le) throw textePurge();
  const r = await db.query(
    `SELECT numero, texte, methode, confiance_pm::int AS confiance_pm
     FROM ingestion_pages WHERE document_id = $1 AND numero = $2`,
    [documentId, numero],
  );
  if (!r.rows[0]) throw introuvable("Page");
  return r.rows[0] as {
    numero: number;
    texte: string;
    methode: MethodeExtraction;
    confiance_pm: number | null;
  };
}

/** Détail : la vue, les pages (sans texte) et les extractions (brouillons ; vide pour un état financier). */
export async function detailDocument(
  db: Db,
  doc: DocumentIngestion,
): Promise<VueDocument & { pages: ResumePage[]; extractions: VueExtraction[] }> {
  return {
    ...vueDocument(doc),
    pages: await listerPages(db, doc.id),
    extractions: await listerExtractions(db, doc.id),
  };
}

/* ----- Jobs ----- */

/** Met en file le job d'extraction (clé `ingestion:<id>`, idempotente). */
export async function mettreEnFileExtraction(
  db: Db,
  cabinetId: string,
  documentId: string,
  maintenant: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle, tentatives_max)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING`,
    [
      cabinetId,
      TYPE_JOB_INGESTION_EXTRACTION,
      JSON.stringify({ document_id: documentId }),
      maintenant,
      `ingestion:${documentId}`,
      TENTATIVES_INGESTION,
    ],
  );
}

/**
 * Met en file le job de structuration (clé `ingestion-structuration:<id>`, suffixée `:<rang>` pour une
 * relance : une clé déjà utilisée est ignorée par la file).
 */
export async function mettreEnFileStructuration(
  db: Db,
  cabinetId: string,
  documentId: string,
  maintenant: Date,
  rang = 0,
): Promise<void> {
  await db.query(
    `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle, tentatives_max)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING`,
    [
      cabinetId,
      TYPE_JOB_INGESTION_STRUCTURATION,
      JSON.stringify({ document_id: documentId }),
      maintenant,
      rang === 0
        ? `ingestion-structuration:${documentId}`
        : `ingestion-structuration:${documentId}:${rang}`,
      TENTATIVES_INGESTION,
    ],
  );
}

/**
 * Relance de la structuration d'un document `termine` des usages DD et standard (le déclencheur 0521 refuse
 * l'état financier) : `termine` -> `structuration`, résultat et date de fin remis à NULL, nouveau job.
 * Les droits de la route appelante sont déjà contrôlés. 409 si le document n'est pas terminé ou si le texte de
 * ses pages a été purgé (il n'y a plus rien à relire).
 *
 * SÉPARATION DES TÂCHES : l'utilisateur qui relance devient le DEMANDEUR (`derniere_demande_par`) ; le
 * brouillon qui en résulte porte `demande_par` et ce demandeur ne le valide pas (MQG02), sauf associé.
 *
 * À SAVOIR (revue M5) : la relance ne passe pas par `exigerPlace` (ni quota de documents en traitement, ni
 * plafond journalier), et la structuration s'exécute avec les droits et le quota IA de l'AUTEUR du document
 * (`cree_par`, via `authDe`), non de la personne qui relance.
 */
export async function relancerStructuration(
  db: Db,
  auth: Auth,
  documentId: string,
  maintenant: Date,
): Promise<void> {
  const doc = await lireDocument(db, documentId, true);
  if (!doc) throw introuvable("Document");
  if (doc.usage === "etat_financier" || doc.statut !== "termine") {
    throw conflit("Seul un document terminé se relance.");
  }
  if (doc.texte_purge_le) {
    throw conflit(
      "Le texte de ce document a été purgé : il ne se relit plus, téléversez-le de nouveau.",
    );
  }
  await db.query(
    `UPDATE ingestion_documents SET statut = 'structuration', resultat = NULL, termine_le = NULL,
       derniere_demande_par = $2 WHERE id = $1`,
    [documentId, auth.utilisateurId],
  );
  const n = await db.query(
    "SELECT count(*)::int AS n FROM jobs WHERE type = $1 AND charge->>'document_id' = $2",
    [TYPE_JOB_INGESTION_STRUCTURATION, documentId],
  );
  await mettreEnFileStructuration(
    db,
    auth.cabinetId,
    documentId,
    maintenant,
    n.rows[0].n as number,
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "ingestion.relancer",
    entite: "ingestion_document",
    entiteId: documentId,
    details: { usage: doc.usage },
  });
}

/* ----- Réception ----- */

export interface SpecDocument {
  usage: UsageIngestion;
  client_id?: string;
  dd_dossier_id?: string;
  version_methode_id?: string;
  /** Paramètres de l'usage (état financier : exercice, date_cloture, devise, tolerance). */
  parametres?: Record<string, unknown>;
}

/**
 * Un document « en traitement » créé il y a plus longtemps n'a plus de job actif (trois tentatives et leurs
 * reprises tiennent en quelques minutes) : il est tenu pour mort et ne bloque plus le quota du cabinet.
 */
const DELAI_DOCUMENT_MORT_MINUTES = 30;

/** Vrai quand la tentative en cours du job est la dernière (le document doit alors échouer proprement). */
export async function derniereTentative(db: Db, jobId: string): Promise<boolean> {
  const r = await db.query("SELECT tentatives, tentatives_max FROM jobs WHERE id = $1", [jobId]);
  const j = r.rows[0] as { tentatives: number; tentatives_max: number } | undefined;
  return !j || j.tentatives >= j.tentatives_max;
}

/** Plafonds du cabinet, sous le verrou `ingestion:<cabinet>` (409 INGESTION_PLEIN). */
async function exigerPlace(db: Db, cabinetId: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `ingestion:${cabinetId}`,
  ]);
  const r = await db.query(
    `SELECT count(*) FILTER (WHERE statut IN ('en_file', 'extraction', 'structuration')
                              AND cree_le > now() - interval '${DELAI_DOCUMENT_MORT_MINUTES} minutes')::int AS en_traitement,
            count(*) FILTER (WHERE cree_le > now() - interval '24 hours')::int AS du_jour
     FROM ingestion_documents`,
  );
  const { en_traitement: traitement, du_jour: jour } = r.rows[0] as {
    en_traitement: number;
    du_jour: number;
  };
  if (traitement >= PLAFONDS_INGESTION.documentsEnTraitementParCabinet) {
    throw ingestionPlein(
      `${PLAFONDS_INGESTION.documentsEnTraitementParCabinet} documents sont déjà en cours de lecture : patientez avant d'en téléverser un autre.`,
    );
  }
  if (jour >= PLAFONDS_INGESTION.documentsParJourEtCabinet) {
    throw ingestionPlein(
      `Le cabinet a atteint ${PLAFONDS_INGESTION.documentsParJourEtCabinet} documents lus en 24 heures : réessayez plus tard.`,
    );
  }
}

/**
 * Reçoit un document (PDF ou XLSX), le stocke temporairement et met sa lecture en file. Renvoie la vue du
 * document (`en_file`). Droits et visibilité du contexte (dossier, brouillon de méthode…) : déjà contrôlés
 * par la route. Erreurs : 415 (type), 413 (taille), 409 (quota de stockage ou INGESTION_PLEIN), 503 (analyses
 * simultanées).
 */
export async function creerDocument(
  app: FastifyInstance,
  auth: Auth,
  recu: TeleversementRecu,
  spec: SpecDocument,
  maintenant: Date = new Date(),
): Promise<VueDocument> {
  const nom = assainirNom(recu.nom);
  const documentId = await avecPlaceAnalyse(auth.cabinetId, async () => {
    // Type décidé par le contenu AVANT tout stockage ; seuls PDF et XLSX.
    const { type } = detecterType(recu.contenu, extensionDe(nom));
    const format: FormatIngestion | null =
      type === "application/pdf" ? "pdf" : type === TYPE_XLSX ? "xlsx" : null;
    if (format === null) throw typeDocumentRefuse();
    const plafond =
      format === "pdf" ? PLAFONDS_INGESTION.tailleOctetsPdf : PLAFONDS_INGESTION.tailleOctetsXlsx;
    if (recu.contenu.length > plafond) throw fichierTropVolumineux(plafond);
    const sha256 = createHash("sha256").update(recu.contenu).digest("hex");
    let id: string | null = null;
    await enregistrerFichier(app, auth, recu, {
      details: { ingestion: true, usage: spec.usage },
      rattacher: async (db, fichier) => {
        await exigerPlace(db, auth.cabinetId);
        const r = await db.query(
          `INSERT INTO ingestion_documents (cabinet_id, usage, client_id, dd_dossier_id, version_methode_id,
             nom, format, sha256, taille, fichier_id, parametres, cree_par, derniere_demande_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
          [
            auth.cabinetId,
            spec.usage,
            spec.client_id ?? null,
            spec.dd_dossier_id ?? null,
            spec.version_methode_id ?? null,
            nom,
            format,
            sha256,
            recu.contenu.length,
            fichier.id,
            JSON.stringify(spec.parametres ?? {}),
            auth.utilisateurId,
          ],
        );
        id = r.rows[0].id as string;
        await mettreEnFileExtraction(db, auth.cabinetId, id, maintenant);
        // Ni texte ni montant dans le journal. Le nom assaini, lui, y figure : `enregistrerFichier`
        // (code partagé) journalise `televersement` avec le nom du fichier.
        await journaliser(db, {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "ingestion.creer",
          entite: "ingestion_document",
          entiteId: id,
          details: { usage: spec.usage, format, taille: recu.contenu.length, sha256 },
        });
      },
    });
    if (id === null) throw new Error("Document non créé.");
    return id as string;
  });
  return app.db.withTenant(auth.cabinetId, async (db) => {
    const doc = await lireDocument(db, documentId);
    if (!doc) throw introuvable("Document");
    return vueDocument(doc);
  });
}
