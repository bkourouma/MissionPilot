import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  coutTranscriptionMicroUsd,
  ErreurCanaux,
  confianceMoyennePm,
  niveauConfiance,
  validerResultatTranscription,
  verifierPlafondTranscription,
} from "@missionpilot/engines";
import {
  PLAFONDS_TRANSCRIPTION,
  TYPES_AUDIO,
  aPermission,
  type TranscriptionCreation,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { HandlerJob } from "../jobs/registre.js";
import { exigerMissionModifiable, exigerMissionVisible } from "../missions/acces.js";
import { assainirNom, extensionDe, nomAvecExtension } from "../stockage/nom.js";
import { detecterAudio } from "../stockage/detection.js";
import { stockageDe, FichierAbsent } from "../stockage/index.js";
import type { TeleversementRecu } from "../stockage/fichiers.js";
import { verifierDebit } from "./debit.js";
import { plafondTranscription } from "./erreurs.js";
import type { DependancesCanaux } from "./fabrique.js";
import { ErreurTranscription, type DemandeTranscription } from "./ports.js";

/*
 * Transcription d'un audio téléversé (AGT-11, ADR-013, SPEC-3c §7.6). Fournisseur SIMULÉ : il n'accepte
 * qu'un conteneur de test. La transcription automatique est un BROUILLON à relire (version 1), une
 * correction humaine ajoute une version, la validation exige un autre que le dernier modificateur
 * (sauf associé, MPH07). Une transcription non validée ne nourrit RIEN d'autre que ses propres
 * routes (aucun autre code ne la lit). Le téléversement de l'audio suit un chemin DÉDIÉ (décision du
 * Pilote) : `POST /api/fichiers` n'admet pas l'audio.
 */

export const TYPE_JOB_CANAL_TRANSCRIPTION = "canal_transcription";
const DUREE_PAR_DEFAUT_MS = PLAFONDS_TRANSCRIPTION.dureeMaxMinutes * 60_000;

const chargeSchema = z.object({ transcription_id: z.string().uuid() }).strict();
const TYPES_AUDIO_SET: ReadonlySet<string> = new Set(TYPES_AUDIO);

/* ----- Téléversement de l'audio (chemin dédié) ----- */

/**
 * Contrôle (type par le CONTENU, extension cohérente), écrit et enregistre un audio reçu. Mêmes garde-fous
 * que `enregistrerFichier` (quota du cabinet, téléversements en attente) ; l'objet est effacé si la
 * transaction échoue.
 */
export async function enregistrerAudio(
  app: FastifyInstance,
  auth: Auth,
  recu: TeleversementRecu,
): Promise<{ id: string; nom: string; type_mime: string; taille: number; sha256: string }> {
  const nomAssaini = assainirNom(recu.nom);
  const { type, extension } = detecterAudio(recu.contenu, extensionDe(nomAssaini));
  const nom = nomAvecExtension(nomAssaini, extension);
  const sha256 = createHash("sha256").update(recu.contenu).digest("hex");
  const taille = recu.contenu.length;
  const stockage = stockageDe(app.config);
  let cle: string | null = null;
  try {
    return await app.db.withTenant(auth.cabinetId, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `stockage:${auth.cabinetId}`,
      ]);
      const utilise = await db.query("SELECT octets_stockage_utilises()::text AS n");
      if (Number(utilise.rows[0].n) + taille > app.config.QUOTA_STOCKAGE_CABINET_OCTETS) {
        throw new AppError(
          409,
          "QUOTA_STOCKAGE_ATTEINT",
          "Le quota de stockage du cabinet est atteint : contactez un associé.",
        );
      }
      const attente = await db.query(
        `SELECT count(*)::int AS n FROM fichiers f
         WHERE f.envoye_par = $1 AND f.cree_le > now() - interval '23 hours' AND fichier_orphelin(f.id)`,
        [auth.utilisateurId],
      );
      if ((attente.rows[0].n as number) >= 20) {
        throw new AppError(
          409,
          "TELEVERSEMENTS_EN_ATTENTE",
          "Trop de fichiers téléversés en attente de rattachement : rattachez-les ou retirez-les.",
        );
      }
      cle = await stockage.ecrire(auth.cabinetId, recu.contenu);
      const r = await db.query(
        `INSERT INTO fichiers (cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256, envoye_par)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [auth.cabinetId, cle, nom, type, taille, sha256, auth.utilisateurId],
      );
      const id = r.rows[0].id as string;
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "televersement",
        entite: "fichier",
        entiteId: id,
        details: { nom, type_mime: type, taille, sha256, audio: true },
      });
      return { id, nom, type_mime: type, taille, sha256 };
    });
  } catch (error) {
    if (cle) await stockage.supprimer(auth.cabinetId, cle).catch(() => undefined);
    throw error;
  }
}

/* ----- Création ----- */

function debutDuMoisUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Crée la transcription `en_file` et met le job en file (mission déjà contrôlée modifiable). */
export async function creerTranscription(
  db: Db,
  auth: Auth,
  missionId: string,
  corps: TranscriptionCreation,
  maintenant: Date,
): Promise<string> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `canal_transcription:${auth.cabinetId}`,
  ]);
  // Le fichier doit avoir été téléversé PAR cet utilisateur et ne porter aucune transcription : tout
  // autre cas (fichier d'autrui, déjà transcrit, effacé, inexistant) répond le MÊME 404, sans oracle
  // sur l'existence ou l'usage d'un fichier du cabinet (constat M1).
  const f = await db.query(
    `SELECT f.id, f.type_mime FROM fichiers f
     WHERE f.id = $1 AND f.envoye_par = $2
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)
       AND NOT EXISTS (SELECT 1 FROM transcriptions t WHERE t.fichier_id = f.id)`,
    [corps.fichier_id, auth.utilisateurId],
  );
  const fichier = f.rows[0] as { id: string; type_mime: string } | undefined;
  if (!fichier || !TYPES_AUDIO_SET.has(fichier.type_mime)) throw introuvable("Fichier audio");
  await verifierDebit(db, auth, "transcription");
  const enFile = await db.query(
    "SELECT count(*)::int AS n FROM transcriptions WHERE statut IN ('en_file', 'en_cours')",
  );
  if ((enFile.rows[0].n as number) >= PLAFONDS_TRANSCRIPTION.enFileMax)
    throw plafondTranscription();
  const mois = await db.query(
    `SELECT duree_audio_ms, duree_declaree_ms FROM transcriptions
     WHERE cree_le >= $1::timestamptz AND statut <> 'echec'`,
    [debutDuMoisUtc(maintenant)],
  );
  let utiliseesMs = 0;
  for (const l of mois.rows as {
    duree_audio_ms: number | null;
    duree_declaree_ms: number | null;
  }[]) {
    utiliseesMs += l.duree_audio_ms ?? l.duree_declaree_ms ?? DUREE_PAR_DEFAUT_MS;
  }
  const decision = verifierPlafondTranscription({
    utiliseesMs,
    ajoutMs: corps.duree_secondes === undefined ? null : corps.duree_secondes * 1000,
    plafondMinutes: PLAFONDS_TRANSCRIPTION.minutesParMoisEtCabinet,
  });
  if (!decision.autorise) throw plafondTranscription();
  const r = await db.query(
    `INSERT INTO transcriptions
       (cabinet_id, mission_id, fichier_id, langue_demandee, enregistrement_consenti,
        reference_consentement, duree_declaree_ms, cree_par)
     VALUES ($1, $2, $3, $4, true, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      missionId,
      corps.fichier_id,
      corps.langue,
      corps.reference_consentement,
      corps.duree_secondes === undefined ? null : corps.duree_secondes * 1000,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await db.query(
    `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle, tentatives_max)
     VALUES ($1, $2, $3, $4, $5, 3) ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING`,
    [
      auth.cabinetId,
      TYPE_JOB_CANAL_TRANSCRIPTION,
      JSON.stringify({ transcription_id: id }),
      maintenant,
      `transcription:${id}`,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "transcription.creer",
    entite: "transcription",
    entiteId: id,
    details: { mission_id: missionId, langue: corps.langue },
  });
  return id;
}

/* ----- Job ----- */

async function lireTout(flux: Readable): Promise<Buffer> {
  const morceaux: Buffer[] = [];
  for await (const m of flux) morceaux.push(Buffer.isBuffer(m) ? m : Buffer.from(m as Uint8Array));
  return Buffer.concat(morceaux);
}

export function creerHandlerCanalTranscription(dependances: () => DependancesCanaux): HandlerJob {
  return async (ctx) => {
    const charge = chargeSchema.safeParse(ctx.charge);
    if (!charge.success) throw new ErreurJobDefinitive("Charge de transcription invalide.");
    const { config, canaux } = dependances();
    const t = await ctx.db.query(
      `SELECT t.id, t.statut, t.langue_demandee, f.type_mime, f.cle_stockage
       FROM transcriptions t JOIN fichiers f ON f.id = t.fichier_id
       WHERE t.id = $1 FOR UPDATE OF t`,
      [charge.data.transcription_id],
    );
    const ligne = t.rows[0] as
      | {
          id: string;
          statut: string;
          langue_demandee: DemandeTranscription["langue"];
          type_mime: string;
          cle_stockage: string;
        }
      | undefined;
    if (!ligne || !["en_file", "en_cours"].includes(ligne.statut)) return [];
    const job = await ctx.db.query("SELECT tentatives, tentatives_max FROM jobs WHERE id = $1", [
      ctx.jobId,
    ]);
    const derniere =
      !job.rows[0] || (job.rows[0].tentatives as number) >= (job.rows[0].tentatives_max as number);
    const echec = async (code: string) => {
      await ctx.db.query(
        `UPDATE transcriptions SET statut = 'echec', erreur_code = $2, termine_le = $3 WHERE id = $1`,
        [ligne.id, code, ctx.maintenant],
      );
    };
    if (ligne.statut === "en_file") {
      await ctx.db.query("UPDATE transcriptions SET statut = 'en_cours' WHERE id = $1", [ligne.id]);
    }
    if (!canaux.transcripteur) {
      await echec("INDISPONIBLE");
      return [];
    }
    let audio: Buffer;
    try {
      audio = await lireTout(await stockageDe(config).lire(ctx.cabinetId, ligne.cle_stockage));
    } catch (error) {
      if (error instanceof FichierAbsent) {
        await echec("AUDIO_ILLISIBLE");
        return [];
      }
      throw error;
    }
    try {
      const resultat = await canaux.transcripteur.transcrire({
        idempotence: ligne.id,
        audio,
        typeMime: ligne.type_mime as DemandeTranscription["typeMime"],
        langue: ligne.langue_demandee,
      });
      validerResultatTranscription(resultat);
      const confiance = confianceMoyennePm(resultat.segments);
      await ctx.db.query(
        `INSERT INTO transcriptions_versions (cabinet_id, transcription_id, numero, origine, texte, segments)
         VALUES ($1, $2, 1, 'automatique', $3, $4)`,
        [
          ctx.cabinetId,
          ligne.id,
          resultat.texte,
          JSON.stringify(
            resultat.segments.map((s) => ({
              debut_ms: s.debutMs,
              fin_ms: s.finMs,
              texte: s.texte,
              confiance: s.confiance,
            })),
          ),
        ],
      );
      await ctx.db.query(
        `UPDATE transcriptions SET statut = 'a_relire', langue_detectee = $2, duree_audio_ms = $3,
           confiance_pm = $4, cout_estime_micro_usd = $5, termine_le = $6 WHERE id = $1`,
        [
          ligne.id,
          resultat.langueDetectee,
          resultat.dureeAudioMs,
          confiance,
          coutTranscriptionMicroUsd(resultat.dureeAudioMs, 0),
          ctx.maintenant,
        ],
      );
    } catch (error) {
      if (error instanceof ErreurTranscription) {
        if (error.reessayable && !derniere) throw error;
        await echec(error.code);
        return [];
      }
      if (error instanceof ErreurCanaux) {
        await echec("AUDIO_ILLISIBLE");
        return [];
      }
      throw error;
    }
    return [];
  };
}

/* ----- Lectures ----- */

const COLONNES = `t.id, t.mission_id, t.fichier_id, t.langue_demandee, t.langue_detectee, t.statut,
  t.confiance_pm::int AS confiance_pm, t.duree_audio_ms, t.erreur_code, t.mode_fournisseur, t.cree_par,
  t.cree_le, t.valide_par, t.valide_le, t.motif_rejet, (t.audio_supprime_le IS NULL) AS audio_disponible,
  t.cout_estime_micro_usd::text AS cout_estime_micro_usd`;

type LigneT = Record<string, unknown>;

/** Vue d'une transcription : le coût (FIN-02) est ABSENT sans `finance.lire`, jamais masqué par un zéro. */
export function vueTranscription(l: LigneT, auth: Auth): Record<string, unknown> {
  const { cout_estime_micro_usd: cout, ...reste } = l;
  const confiance = reste.confiance_pm as number | null;
  return {
    ...reste,
    niveau_confiance: confiance === null ? null : niveauConfiance(confiance),
    ...(aPermission(auth.roles, "finance.lire")
      ? { cout_estime_micro_usd: cout === null || cout === undefined ? null : Number(cout) }
      : {}),
  };
}

/** Transcription dont la mission est visible, sinon 404 (comme une ressource d'un autre cabinet). */
export async function exigerTranscription(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<LigneT & { id: string; mission_id: string; statut: string }> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM transcriptions t WHERE t.id = $1 ${verrouiller ? "FOR UPDATE OF t" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Transcription");
  const t = r.rows[0] as LigneT & { id: string; mission_id: string; statut: string };
  await exigerMissionVisible(db, auth, t.mission_id).catch((e: unknown) => {
    throw e instanceof AppError && e.statut === 404 ? introuvable("Transcription") : e;
  });
  return t;
}

export async function listerTranscriptions(
  db: Db,
  auth: Auth,
  missionId: string,
  statut: string | undefined,
  apres: [string, string] | null,
  limite: number,
) {
  const r = await db.query(
    `SELECT ${COLONNES},
       to_char(t.cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cle_tri
     FROM transcriptions t
     WHERE t.mission_id = $1 AND ($2::text IS NULL OR t.statut = $2)
       AND ($3::text IS NULL OR (t.cree_le, t.id) < ($3::timestamptz, $4::uuid))
     ORDER BY t.cree_le DESC, t.id DESC LIMIT $5`,
    [missionId, statut ?? null, apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  return r.rows.map((l) => ({ ...vueTranscription(l, auth), cle_tri: l.cle_tri as string }));
}

export async function detailTranscription(db: Db, auth: Auth, id: string) {
  const t = await exigerTranscription(db, auth, id);
  const v = await db.query(
    `SELECT numero, origine, texte, auteur_id, cree_le, segments FROM transcriptions_versions
     WHERE transcription_id = $1 ORDER BY numero`,
    [id],
  );
  const versions = v.rows.map((x) => {
    const segments = x.segments as
      { debut_ms: number; fin_ms: number; texte: string; confiance: number }[] | null;
    return {
      numero: x.numero as number,
      origine: x.origine as string,
      texte: x.texte as string,
      auteur_id: (x.auteur_id as string | null) ?? null,
      cree_le: x.cree_le as Date,
      ...(segments ? { segments } : {}),
    };
  });
  return { ...vueTranscription(t, auth), versions };
}

/* ----- Correction, validation, rejet ----- */

/** Versions d'une transcription au plus (borne le stockage d'un texte corrigé à répétition). */
export const VERSIONS_TRANSCRIPTION_MAX = 50;

/**
 * Mission visible ET non clôturée : valider ou rejeter n'exige pas d'être chef ou directeur (l'expert
 * métier valide, SPEC-3c §14), mais une mission clôturée ne bouge plus (409).
 */
async function exigerMissionOuverte(db: Db, auth: Auth, missionId: string): Promise<void> {
  const m = await exigerMissionVisible(db, auth, missionId, true);
  if (m.statut === "cloturee") throw conflit("La mission est clôturée.");
}

/** Nouvelle version HUMAINE (`If-Match` = numéro de la dernière version lue ; 409 sinon). */
export async function ajouterVersionHumaine(
  db: Db,
  auth: Auth,
  id: string,
  texte: string,
  ifMatch: number,
): Promise<number> {
  const t = await exigerTranscription(db, auth, id, true);
  // Corriger = modifier la mission (comme la création) : directeur, chef ou droit global, mission ouverte.
  await exigerMissionModifiable(db, auth, t.mission_id);
  if (t.statut !== "a_relire") throw conflit("Seule une transcription à relire se corrige.");
  await verifierDebit(db, auth, "correction_transcription");
  const d = await db.query(
    "SELECT max(numero)::int AS dernier FROM transcriptions_versions WHERE transcription_id = $1",
    [id],
  );
  const dernier = d.rows[0].dernier as number;
  if (dernier !== ifMatch) {
    throw conflit("Une autre version a été enregistrée : rechargez puis réessayez.");
  }
  if (dernier >= VERSIONS_TRANSCRIPTION_MAX) {
    throw new AppError(
      409,
      "PLAFOND_VERSIONS",
      `Une transcription compte ${VERSIONS_TRANSCRIPTION_MAX} versions au plus : validez ou rejetez-la.`,
    );
  }
  await db.query(
    `INSERT INTO transcriptions_versions (cabinet_id, transcription_id, numero, origine, texte, auteur_id)
     VALUES ($1, $2, $3, 'humaine', $4, $5)`,
    [auth.cabinetId, id, dernier + 1, texte, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "transcription.modifier",
    entite: "transcription",
    entiteId: id,
    details: { version: dernier + 1 },
  });
  return dernier + 1;
}

/** Validation (`MPH07` : valideur différent du dernier modificateur, sauf associé). */
export async function validerTranscription(db: Db, auth: Auth, id: string): Promise<void> {
  const t = await exigerTranscription(db, auth, id, true);
  await exigerMissionOuverte(db, auth, t.mission_id);
  if (t.statut !== "a_relire") throw conflit("Seule une transcription à relire se valide.");
  await db.query(
    "UPDATE transcriptions SET statut = 'validee', valide_par = $2, valide_le = now() WHERE id = $1",
    [id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "transcription.valider",
    entite: "transcription",
    entiteId: id,
    details: {},
  });
}

export async function rejeterTranscription(
  db: Db,
  auth: Auth,
  id: string,
  motif: string,
): Promise<void> {
  const t = await exigerTranscription(db, auth, id, true);
  await exigerMissionOuverte(db, auth, t.mission_id);
  if (t.statut !== "a_relire") throw conflit("Seule une transcription à relire se rejette.");
  await db.query(
    "UPDATE transcriptions SET statut = 'rejetee', valide_par = $2, valide_le = now(), motif_rejet = $3 WHERE id = $1",
    [id, auth.utilisateurId, motif],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "transcription.rejeter",
    entite: "transcription",
    entiteId: id,
    details: {},
  });
}

/** Fichier audio d'une transcription (mission visible) ; 404 si l'audio a été effacé. */
export async function fichierAudioDe(db: Db, auth: Auth, id: string) {
  const t = await exigerTranscription(db, auth, id);
  if (t.audio_disponible !== true) throw introuvable("Audio");
  const f = await db.query(
    `SELECT f.nom_origine AS nom, f.type_mime, f.taille, f.cle_stockage FROM fichiers f
     WHERE f.id = $1 AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)`,
    [t.fichier_id as string],
  );
  if (!f.rows[0]) throw introuvable("Audio");
  return f.rows[0] as {
    nom: string;
    type_mime: string;
    taille: string | number;
    cle_stockage: string;
  };
}
