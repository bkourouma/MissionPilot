import { contientNonVerifie, lireLecturesIa, lirePropositionIa } from "@missionpilot/engines";
import { contenuPropositionSchema } from "@missionpilot/shared";
import { journaliser } from "../../../audit.js";
import { lireDocument } from "../../../ingestion/documents.js";
import { creerBrouillon } from "../../../ingestion/extractions.js";
import type { DependancesIngestion } from "../../../ingestion/fabrique.js";
import { effacerObjet } from "../../../ingestion/fichier-temporaire.js";
import { creerHandlerIngestionExtraction } from "../../../ingestion/job-extraction.js";
import { creerHandlerIngestionStructuration } from "../../../ingestion/job-structuration.js";
import {
  TYPE_JOB_INGESTION_EXTRACTION,
  TYPE_JOB_INGESTION_STRUCTURATION,
} from "../../../ingestion/types.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { etalerJournal, maintenantBase, type FenetreReelle } from "../missions/antidatage.js";
import { ok } from "./outils.js";
import { corpsMultipart } from "./salle-fichiers.js";

/*
 * Outils du module INGESTION : téléversement par la route réelle (multipart), exécution des jobs
 * d'un document SEUL (jamais le worker : il réserverait les jobs des autres domaines), lecture
 * simulée d'un document de due diligence ou du standard, reprise par clé naturelle et antidatage.
 *
 * LECTURE SIMULÉE : le seed n'a aucune clé d'IA. Pour les usages DD et standard, le brouillon est
 * produit par un GABARIT déterministe (les lignes que proposerait un modèle, dérivées du texte
 * fourni dans donnees-ingestion.ts) puis relu par le MOTEUR comme une sortie de modèle
 * (`lireLecturesIa`, `lirePropositionIa` : extrait et nombres retrouvés dans la page citée). Le
 * brouillon naît par le service réel `creerBrouillon` et le document passe `termine` comme dans le
 * job de structuration (`ia_demande_id` reste nul : aucun appel d'IA n'a eu lieu). Les états
 * financiers, eux, passent par les DEUX jobs réels (tableur : règles du moteur, jamais d'IA).
 */

const TYPES_JOBS = [TYPE_JOB_INGESTION_EXTRACTION, TYPE_JOB_INGESTION_STRUCTURATION];

/** Dépendances des handlers : configuration du seed, aucune IA, aucun OCR. */
const dependances = (ctx: ContexteTenantDemo) => (): DependancesIngestion => ({
  config: ctx.config,
  ia: { config: ctx.config },
  ocr: null,
});

export interface DocumentLu {
  id: string;
  statut: string;
  resultat: string | null;
  etatFinancierId: string | null;
  creePar: string;
}

/** Portée d'un document pour la clé naturelle (usage + nom + client / dossier DD / version). */
export interface PorteeDocument {
  usage: "etat_financier" | "dd_rapport" | "dd_salle" | "standard_historique";
  nom: string;
  clientId?: string;
  ddDossierId?: string;
  versionMethodeId?: string;
}

/** Document déjà ingéré pour cette clé naturelle (reprise sans doublon), ou null. */
export async function documentExistant(
  ctx: ContexteTenantDemo,
  p: PorteeDocument,
): Promise<DocumentLu | null> {
  const r = await ctx.proprietaire.query(
    `SELECT id, statut, resultat, etat_financier_id, cree_par FROM ingestion_documents
      WHERE cabinet_id = $1 AND usage = $2 AND nom = $3
        AND client_id IS NOT DISTINCT FROM $4::uuid
        AND dd_dossier_id IS NOT DISTINCT FROM $5::uuid
        AND version_methode_id IS NOT DISTINCT FROM $6::uuid
      ORDER BY cree_le, id LIMIT 1`,
    [
      ctx.cabinetId,
      p.usage,
      p.nom,
      p.clientId ?? null,
      p.ddDossierId ?? null,
      p.versionMethodeId ?? null,
    ],
  );
  const l = r.rows[0];
  if (!l) return null;
  return {
    id: l.id as string,
    statut: l.statut as string,
    resultat: (l.resultat as string | null) ?? null,
    etatFinancierId: (l.etat_financier_id as string | null) ?? null,
    creePar: l.cree_par as string,
  };
}

/** Instant (horloge de la base) du dernier téléversement de chaque document de ce seed. */
const DEPOTS = new Map<string, Date>();

/** Téléverse un fichier par la route réelle (202 attendu) ; renvoie l'identifiant du document. */
export async function televerser(
  ctx: ContexteTenantDemo,
  session: SessionDemo,
  url: string,
  nom: string,
  contenu: Buffer,
  type: string,
): Promise<string> {
  const m = corpsMultipart(nom, contenu, type);
  const debut = (await ctx.proprietaire.query("SELECT clock_timestamp() AS t")).rows[0].t as Date;
  const r = await ctx.app.inject({
    method: "POST",
    url,
    headers: { cookie: session.cookie, ...m.headers },
    payload: m.payload,
  });
  ok(202, r, `téléversement de « ${nom} »`);
  const id = r.json().id as string;
  DEPOTS.set(id, debut);
  return id;
}

/**
 * Démonstration publique : `neutraliserEnvois` passe en « echec » (charge effacée) tout job créé par
 * une transaction du seed. Les jobs d'ingestion du document en cours (créés depuis son téléversement, ce qui est sûr : les documents
 * sont traités l'un après l'autre) sont remis en attente avec leur charge `{document_id}` ;
 * le seed les exécute lui-même, tout de suite, sans worker ni envoi : aucun job ne survit.
 */
async function rendreJobsNeutralises(
  ctx: ContexteTenantDemo,
  types: readonly string[],
  documentId: string,
): Promise<void> {
  const depuis = DEPOTS.get(documentId);
  if (!depuis) return;
  await ctx.proprietaire.query(
    `UPDATE jobs SET statut = 'en_attente', erreur = NULL,
            charge = jsonb_build_object('document_id', $3::text)
      WHERE cabinet_id = $1 AND type = ANY ($2::text[]) AND statut = 'echec'
        AND charge = '{}'::jsonb AND erreur LIKE 'Neutralisé%'
        AND cree_le >= $4::timestamptz`,
    [ctx.cabinetId, types, documentId, depuis],
  );
}

/**
 * Exécute les jobs d'ingestion EN ATTENTE d'un document (extraction puis, si demandé,
 * structuration), dans la transaction du cabinet comme le worker. Les jobs des autres domaines ne
 * sont jamais touchés.
 */
export async function executerJobsDocument(
  ctx: ContexteTenantDemo,
  documentId: string,
  avecStructuration: boolean,
): Promise<void> {
  const dep = dependances(ctx);
  const handlers: Record<string, ReturnType<typeof creerHandlerIngestionExtraction>> = {
    [TYPE_JOB_INGESTION_EXTRACTION]: creerHandlerIngestionExtraction(dep),
    [TYPE_JOB_INGESTION_STRUCTURATION]: creerHandlerIngestionStructuration(dep),
  };
  const types = avecStructuration ? TYPES_JOBS : [TYPE_JOB_INGESTION_EXTRACTION];
  for (let tour = 0; tour < 6; tour++) {
    if (ctx.publique) await rendreJobsNeutralises(ctx, types, documentId);
    const r = await ctx.proprietaire.query(
      `UPDATE jobs SET statut = 'en_cours', tentatives = tentatives + 1, verrouille_le = now()
        WHERE id = (SELECT id FROM jobs WHERE cabinet_id = $1 AND type = ANY ($2::text[])
                       AND statut = 'en_attente' AND charge->>'document_id' = $3
                     ORDER BY cree_le, id LIMIT 1)
        RETURNING id, type, charge`,
      [ctx.cabinetId, types, documentId],
    );
    const job = r.rows[0];
    if (!job) return;
    const handler = handlers[job.type as string];
    if (!handler) throw new Error(`Type de job inconnu : ${String(job.type)}`);
    try {
      await ctx.database.withTenant(ctx.cabinetId, async (db) => {
        await handler({
          db,
          cabinetId: ctx.cabinetId,
          jobId: job.id as string,
          charge: job.charge as Record<string, unknown>,
          maintenant: new Date(),
          database: ctx.database,
        });
        await db.query("UPDATE jobs SET statut = 'termine', progression = 100 WHERE id = $1", [
          job.id,
        ]);
      });
    } catch (error) {
      const message = (error instanceof Error ? error.message : "erreur").slice(0, 300);
      await ctx.proprietaire.query("UPDATE jobs SET statut = 'echec', erreur = $2 WHERE id = $1", [
        job.id,
        message,
      ]);
      throw new Error(`Job d'ingestion ${String(job.type)} en échec : ${message}`);
    }
  }
}

export type LectureSimulee =
  | { nature: "lecture_document"; lignes: string[] }
  | { nature: "standard_proposition"; lignes: string[] };

/**
 * Structuration SIMULÉE d'un document DD ou standard en `structuration` : brouillon par le service
 * réel, document `termine` (`brouillon_cree`, ou `rien_trouve` si le moteur ne retient rien),
 * objet de stockage effacé, journal sans contenu ; le job de structuration en attente est soldé.
 */
export async function terminerLectureSimulee(
  ctx: ContexteTenantDemo,
  documentId: string,
  lecture: LectureSimulee,
): Promise<string> {
  const resultat = await ctx.database.withTenant(ctx.cabinetId, async (db) => {
    const doc = await lireDocument(db, documentId, true);
    if (!doc) throw new Error(`Document ${documentId} introuvable.`);
    if (doc.statut === "termine") return doc.resultat ?? "rien_trouve";
    if (doc.statut !== "structuration") {
      throw new Error(`Document ${documentId} : statut « ${doc.statut} » inattendu.`);
    }
    await effacerObjet(db, ctx.config, doc);
    const lues = await db.query(
      "SELECT numero, texte FROM ingestion_pages WHERE document_id = $1 ORDER BY numero",
      [documentId],
    );
    const pages = lues.rows as { numero: number; texte: string }[];
    let res: "brouillon_cree" | "rien_trouve" = "rien_trouve";
    if (lecture.nature === "lecture_document") {
      const { contenu } = lireLecturesIa(lecture.lignes, pages);
      if (contenu.resume.length > 0 || contenu.elements.length > 0) {
        const complet = { ...contenu, tronque: false };
        await creerBrouillon(db, doc, {
          nature: "lecture_document",
          contenu: complet,
          iaDemandeId: null,
          chiffresNonVerifies: contientNonVerifie(complet),
        });
        res = "brouillon_cree";
      }
    } else {
      const { contenu } = lirePropositionIa(lecture.lignes, pages);
      const valide = contenuPropositionSchema.safeParse({ ...contenu, tronque: false });
      if (valide.success) {
        await creerBrouillon(db, doc, {
          nature: "standard_proposition",
          contenu: valide.data,
          iaDemandeId: null,
          chiffresNonVerifies: false,
        });
        res = "brouillon_cree";
      }
    }
    await db.query(
      "UPDATE ingestion_documents SET statut = 'termine', resultat = $2, termine_le = now() WHERE id = $1",
      [documentId, res],
    );
    await journaliser(db, {
      cabinetId: ctx.cabinetId,
      utilisateurId: doc.cree_par,
      action: "ingestion.terminer",
      entite: "ingestion_document",
      entiteId: documentId,
      details: { usage: doc.usage, resultat: res },
    });
    return res;
  });
  await ctx.proprietaire.query(
    `UPDATE jobs SET statut = 'termine', progression = 100
      WHERE cabinet_id = $1 AND type = $2 AND statut = 'en_attente' AND charge->>'document_id' = $3`,
    [ctx.cabinetId, TYPE_JOB_INGESTION_STRUCTURATION, documentId],
  );
  return resultat;
}

/* ----- Antidatage ----- */

const heure = (jour: string, h: string): string => `${jour}T${h}Z`;

/**
 * Remonte les dates d'un document et de ses brouillons : dépôt (`depot`), fin du traitement le même
 * jour, correction la veille de la décision, décision (`decision`). Requêtes littérales ; les
 * déclencheurs d'identité (MQG01, MQG02) sont désactivés le temps d'UNE transaction et réactivés
 * avant le COMMIT : seules les DATES changent, jamais le contenu ni les statuts.
 */
export async function antedaterDocument(
  ctx: ContexteTenantDemo,
  documentId: string,
  depot: string,
  decision: string | null,
  veille: string | null,
): Promise<void> {
  const c = ctx.proprietaire;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(
      `UPDATE ingestion_documents SET cree_le = $2::timestamptz,
         termine_le = CASE WHEN termine_le IS NULL THEN NULL ELSE $3::timestamptz END
        WHERE id = $1`,
      [documentId, heure(depot, "09:12:00"), heure(depot, "09:40:00")],
    );
    await c.query(
      `UPDATE ingestion_extractions SET cree_le = $2::timestamptz,
         modifie_le = CASE WHEN modifie_le IS NULL THEN NULL ELSE $3::timestamptz END,
         valide_le = CASE WHEN valide_le IS NULL THEN NULL ELSE $4::timestamptz END
        WHERE document_id = $1`,
      [
        documentId,
        heure(depot, "09:40:00"),
        heure(veille ?? decision ?? depot, "16:20:00"),
        heure(decision ?? depot, "10:05:00"),
      ],
    );
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  }
}

/** Antidate l'état financier d'un document (création, décision) : déclencheurs ignorés le temps de la transaction (replica), dates seulement. */
export async function antedaterEtat(
  ctx: ContexteTenantDemo,
  etatId: string,
  depot: string,
  decision: string | null,
): Promise<void> {
  const c = ctx.proprietaire;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query("UPDATE dossier_etats_financiers SET cree_le = $2::timestamptz WHERE id = $1", [
      etatId,
      heure(depot, "09:40:00"),
    ]);
    await c.query(
      `UPDATE dossier_etats_decisions SET cree_le = CASE WHEN automatique THEN $2::timestamptz
                                                         ELSE $3::timestamptz END
        WHERE etat_id = $1`,
      [etatId, heure(depot, "09:40:00"), heure(decision ?? depot, "11:30:00")],
    );
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  }
}

/** Date de la purge du texte (une seule fois, au-delà de la conservation) : remontée après coup. */
export async function antedaterPurge(
  ctx: ContexteTenantDemo,
  documentId: string,
  depuis: string,
): Promise<void> {
  const c = ctx.proprietaire;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(
      `UPDATE ingestion_documents SET texte_purge_le = ($2::date + 91)::timestamptz + interval '3 hours 45 minutes'
        WHERE id = $1 AND texte_purge_le IS NOT NULL`,
      [documentId, depuis],
    );
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  }
}

/** Étale les lignes du journal écrites pendant `fn` sur [jour ; jour + largeur] (ordre conservé). */
export async function etaler<T>(
  ctx: ContexteTenantDemo,
  jour: string,
  fin: string,
  fn: () => Promise<T>,
): Promise<T> {
  const debut = await maintenantBase(ctx);
  const resultat = await fn();
  const fenetre: FenetreReelle = { debut, fin: await maintenantBase(ctx) };
  await etalerJournal(ctx, fenetre, jour, fin);
  return resultat;
}
