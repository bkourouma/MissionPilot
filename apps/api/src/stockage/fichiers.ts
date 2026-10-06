import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { aPermission, CHAMP_FICHIER } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { deboursVisible } from "../facturation/debours.js";
import { missionVisibleOuNull } from "../facturation/outils.js";
import { detecterType } from "./detection.js";
import { stockageDe } from "./index.js";
import { assainirNom, extensionDe, nomAvecExtension } from "./nom.js";

/*
 * Fichiers téléversés : réception bornée, détection du type par le contenu,
 * quota par cabinet, métadonnées en ajout seul, contrôle d'accès à CHAQUE
 * lecture.
 *
 * Accès à un fichier (404 dans tous les autres cas, y compris un autre
 * cabinet, par RLS) :
 * - rattaché à une version de document : « mission.lire » et mission visible ;
 * - justificatif d'un débours : débours visible (auteur, ou qui voit les
 *   débours de la mission) ;
 * - non rattaché (orphelin) : son seul auteur, pendant sa durée de vie ;
 * - marqué supprimé : plus personne.
 */

/** Un téléversement non rattaché doit l'être dans ce délai (la purge passe à 24 h). */
export const DELAI_RATTACHEMENT_HEURES = 23;
/** Téléversements non rattachés simultanés par utilisateur. */
export const TELEVERSEMENTS_EN_ATTENTE_MAX = 20;

export const COLONNES_FICHIER = `f.id, f.nom_origine AS nom, f.type_mime, f.taille, f.sha256,
  f.envoye_par, f.cree_le`;

export interface FichierDb {
  id: string;
  nom: string;
  type_mime: string;
  taille: number;
  sha256: string;
  envoye_par: string;
  cree_le: Date;
  cle_stockage: string;
  supprime: boolean;
}

/** Fichier au format de l'API (jamais la clé de stockage). */
export function vueFichier(f: Record<string, unknown>): Record<string, unknown> {
  return {
    id: f.id,
    nom: f.nom,
    type_mime: f.type_mime,
    taille: Number(f.taille),
    sha256: f.sha256,
    envoye_par: f.envoye_par,
    cree_le: f.cree_le,
  };
}

export interface TeleversementRecu {
  nom: string;
  contenu: Buffer;
}

const tropVolumineux = (max: number) =>
  new AppError(
    413,
    "FICHIER_TROP_VOLUMINEUX",
    `Fichier trop volumineux : ${Math.floor(max / (1024 * 1024))} Mo au plus.`,
  );

/**
 * Lit l'unique fichier du corps multipart (champ « fichier »), borné à
 * `tailleMax` octets. Le Content-Type et l'extension déclarés ne sont pas
 * crus : seul le contenu décide du type (detecterType).
 */
export async function lireTeleversement(
  request: FastifyRequest,
  tailleMax: number,
): Promise<TeleversementRecu> {
  if (!request.isMultipart()) {
    throw new AppError(415, "MULTIPART_ATTENDU", "Téléversement multipart/form-data attendu.");
  }
  let partie;
  try {
    partie = await request.file({
      limits: { fileSize: tailleMax, files: 1, fields: 0, parts: 1, fieldNameSize: 50 },
      throwFileSizeLimit: true,
    });
  } catch (error) {
    throw traduireErreurMultipart(error, tailleMax);
  }
  if (!partie || partie.fieldname !== CHAMP_FICHIER) {
    throw requeteInvalide(`Fichier attendu dans le champ « ${CHAMP_FICHIER} ».`);
  }
  let contenu: Buffer;
  try {
    contenu = await partie.toBuffer();
  } catch (error) {
    throw traduireErreurMultipart(error, tailleMax);
  }
  if (contenu.length > tailleMax) throw tropVolumineux(tailleMax);
  return { nom: partie.filename ?? "", contenu };
}

function traduireErreurMultipart(error: unknown, tailleMax: number): unknown {
  const code = (error as { code?: string }).code ?? "";
  if (code === "FST_REQ_FILE_TOO_LARGE") return tropVolumineux(tailleMax);
  if (code.startsWith("FST_")) return requeteInvalide("Téléversement invalide.");
  return error;
}

/** Quota et file d'attente sérialisés par cabinet (verrou de transaction). */
async function verrouStockage(db: Db, cabinetId: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `stockage:${cabinetId}`,
  ]);
}

export interface OptionsEnregistrement {
  /** Rattachement dans la même transaction (justificatif de débours). */
  rattacher?: (db: Db, fichier: Record<string, unknown>) => Promise<void>;
  /** Détails d'audit supplémentaires (jamais le contenu). */
  details?: Record<string, unknown>;
}

/**
 * Contrôle, écrit et enregistre un fichier reçu. L'objet est écrit dans le
 * stockage DANS la transaction ; si elle échoue, il est effacé.
 */
export async function enregistrerFichier(
  app: FastifyInstance,
  auth: Auth,
  recu: TeleversementRecu,
  options: OptionsEnregistrement = {},
): Promise<Record<string, unknown>> {
  const nomAssaini = assainirNom(recu.nom);
  const { type, extension } = detecterType(recu.contenu, extensionDe(nomAssaini));
  const nom = nomAvecExtension(nomAssaini, extension);
  const sha256 = createHash("sha256").update(recu.contenu).digest("hex");
  const taille = recu.contenu.length;
  const stockage = stockageDe(app.config);
  let cle: string | null = null;
  try {
    return await app.db.withTenant(auth.cabinetId, async (db) => {
      await verrouStockage(db, auth.cabinetId);
      const utilise = await db.query("SELECT octets_stockage_utilises()::text AS n");
      if (Number(utilise.rows[0].n) + taille > app.config.QUOTA_STOCKAGE_CABINET_OCTETS) {
        throw new AppError(
          409,
          "QUOTA_STOCKAGE_ATTEINT",
          "Le quota de stockage du cabinet est atteint : contactez un associé.",
        );
      }
      if (!options.rattacher) {
        const attente = await db.query(
          `SELECT count(*)::int AS n FROM fichiers f
           WHERE f.envoye_par = $1 AND f.cree_le > now() - make_interval(hours => $2)
             AND fichier_orphelin(f.id)`,
          [auth.utilisateurId, DELAI_RATTACHEMENT_HEURES],
        );
        if ((attente.rows[0].n as number) >= TELEVERSEMENTS_EN_ATTENTE_MAX) {
          throw new AppError(
            409,
            "TELEVERSEMENTS_EN_ATTENTE",
            "Trop de fichiers téléversés en attente de rattachement : rattachez-les ou retirez-les.",
          );
        }
      }
      cle = await stockage.ecrire(auth.cabinetId, recu.contenu);
      const r = await db.query(
        `INSERT INTO fichiers (cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256,
           envoye_par)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, nom_origine AS nom, type_mime, taille, sha256, envoye_par, cree_le`,
        [auth.cabinetId, cle, nom, type, taille, sha256, auth.utilisateurId],
      );
      const fichier = r.rows[0] as Record<string, unknown>;
      // Doublon : même empreinte parmi SES fichiers encore présents (aucune
      // information sur les fichiers d'autrui).
      const doublon = await db.query(
        `SELECT f.id FROM fichiers f
         WHERE f.sha256 = $1 AND f.envoye_par = $2 AND f.id <> $3
           AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)
         ORDER BY f.cree_le, f.id LIMIT 1`,
        [sha256, auth.utilisateurId, fichier.id],
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "televersement",
        entite: "fichier",
        entiteId: fichier.id as string,
        details: { nom, type_mime: type, taille, sha256, ...options.details },
      });
      if (options.rattacher) await options.rattacher(db, fichier);
      return { ...vueFichier(fichier), doublon_de: (doublon.rows[0]?.id as string) ?? null };
    });
  } catch (error) {
    if (cle) await stockage.supprimer(auth.cabinetId, cle).catch(() => undefined);
    throw error;
  }
}

/** Fichier du cabinet courant (RLS) avec sa clé, ou 404. */
async function lireFichier(db: Db, id: string): Promise<FichierDb> {
  const r = await db.query(
    `SELECT ${COLONNES_FICHIER}, f.cle_stockage,
       EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id) AS supprime
     FROM fichiers f WHERE f.id = $1`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Fichier");
  return r.rows[0] as FichierDb;
}

/**
 * Fichier lisible par l'utilisateur (règles en tête de fichier), ou 404 :
 * on ne révèle jamais l'existence d'un fichier inaccessible.
 */
export async function exigerFichierLisible(db: Db, auth: Auth, id: string): Promise<FichierDb> {
  const f = await lireFichier(db, id);
  if (f.supprime) throw introuvable("Fichier");
  const documents = await db.query(
    "SELECT mission_id FROM mission_documents WHERE fichier_id = $1",
    [id],
  );
  const debours = await db.query("SELECT id FROM debours WHERE justificatif_fichier_id = $1", [id]);
  if (documents.rows.length === 0 && debours.rows.length === 0) {
    if (f.envoye_par === auth.utilisateurId) return f;
    throw introuvable("Fichier");
  }
  if (aPermission(auth.roles, "mission.lire")) {
    for (const d of documents.rows) {
      if (await missionVisibleOuNull(db, auth, d.mission_id as string)) return f;
    }
  }
  for (const d of debours.rows) {
    try {
      await deboursVisible(db, auth, d.id as string);
      return f;
    } catch (error) {
      if (!(error instanceof AppError && error.statut === 404)) throw error;
    }
  }
  throw introuvable("Fichier");
}

/**
 * Fichier téléversé par l'utilisateur, encore non rattaché, non supprimé et
 * récent : seul candidat à un rattachement (version de document). Verrouillé
 * pour la transaction (deux rattachements simultanés : un seul passe).
 */
export async function exigerFichierRattachable(db: Db, auth: Auth, id: string): Promise<FichierDb> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`fichier:${id}`]);
  const f = await lireFichier(db, id);
  if (f.supprime || f.envoye_par !== auth.utilisateurId) throw introuvable("Fichier");
  const r = await db.query(
    `SELECT fichier_orphelin($1) AS orphelin,
       $2::timestamptz > now() - make_interval(hours => $3) AS recent`,
    [id, f.cree_le, DELAI_RATTACHEMENT_HEURES],
  );
  if (!r.rows[0].orphelin) throw conflit("Ce fichier est déjà rattaché.");
  if (!r.rows[0].recent) {
    throw conflit("Téléversement expiré : téléversez à nouveau le fichier.");
  }
  return f;
}

/** Retire (marque supprimé) un fichier non rattaché de l'utilisateur et efface son objet. */
export async function retirerFichier(app: FastifyInstance, auth: Auth, id: string): Promise<void> {
  const f = await app.db.withTenant(auth.cabinetId, async (db) => {
    // Un fichier rattaché (409) ne se retire pas par cette route ; expiré, il sera purgé.
    const lu = await exigerFichierRattachable(db, auth, id);
    await db.query(
      `INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif, supprime_par)
       VALUES ($1, $2, 'retire', $3)`,
      [auth.cabinetId, id, auth.utilisateurId],
    );
    await journaliser(db, {
      cabinetId: auth.cabinetId,
      utilisateurId: auth.utilisateurId,
      action: "retrait",
      entite: "fichier",
      entiteId: id,
      details: { nom: lu.nom },
    });
    return lu;
  });
  await stockageDe(app.config)
    .supprimer(auth.cabinetId, f.cle_stockage)
    .catch(() => undefined);
}
