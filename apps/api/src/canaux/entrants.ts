import { z } from "zod";
import {
  analyserReponse,
  fusionnerStatutEnvoi,
  validerResultatTranscription,
  type StatutEnvoi,
} from "@missionpilot/engines";
import { TYPES_AUDIO } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { trousseauDepuisConfig, type Trousseau } from "../auth/chiffrement.js";
import type { Db } from "../db/pool.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { HandlerJob } from "../jobs/registre.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import { retirerConsentement, verrouillerDestinataire } from "./consentements.js";
import { etatDestinataire, retrouverExpediteur } from "./destinataires.js";
import { mettreEnFileEnvoi } from "./envois.js";
import type { DependancesCanaux } from "./fabrique.js";
import { ErreurCanal, ErreurTranscription, type Canaux, type EvenementCanal } from "./ports.js";
import { traiterConfirmation, traiterTexteSaisie, type ReponseDeService } from "./saisies-kpi.js";
import { nomDuCabinet } from "./synthese.js";

/*
 * Traitement des événements d'un webhook DÉJÀ authentifié (SPEC-3c §8.3). Rejet par défaut : expéditeur
 * inconnu, événement inconnu, compte inactif → aucune écriture utile. AUCUN contenu de message n'est
 * conservé (ni dans `canaux_evenements_recus`, ni dans un journal) ; seule la proposition de saisie
 * (valeur analysée) survit. Un contenu entrant est une donnée NON FIABLE : jamais interprété par un
 * modèle, seules les commandes fermées de `analyserReponse` agissent, par du code déterministe.
 */

export const TYPE_JOB_CANAL_ENTRANT_AUDIO = "canal_entrant_audio";
/** Taille maximale d'un média entrant (15 Mo : plafond d'un fichier). */
export const MEDIA_ENTRANT_OCTETS_MAX = 15 * 1024 * 1024;

export interface CompteResolu {
  cabinetId: string;
  compteId: string;
  identifiantCompte: string;
}

interface ContexteTraitement {
  trousseau: Trousseau;
  compte: CompteResolu;
  maintenant: Date;
}

/** Met en file la réponse de service (réponse libre dans la fenêtre de 24 h) d'un événement. */
async function repondre(
  db: Db,
  c: ContexteTraitement,
  destinataireId: string,
  evenementId: string,
  r: ReponseDeService,
): Promise<void> {
  await mettreEnFileEnvoi(db, c.trousseau, {
    cabinetId: c.compte.cabinetId,
    canal: "whatsapp",
    destinataireId,
    gabarit: r.gabarit,
    variables: r.variables,
    objetType: "kpi_saisie",
    objetId: r.objetId,
    cle: `reponse:${evenementId}`,
    maintenant: c.maintenant,
  });
}

async function traiterStatut(
  db: Db,
  evenement: Extract<EvenementCanal, { type: "statut" }>,
): Promise<"traite" | "ignore"> {
  const r = await db.query(
    `SELECT id, statut FROM canaux_envois WHERE canal = 'whatsapp' AND id_externe = $1 FOR UPDATE`,
    [evenement.idExterneMessage],
  );
  const envoi = r.rows[0] as { id: string; statut: StatutEnvoi } | undefined;
  if (!envoi) return "ignore";
  const nouveau = fusionnerStatutEnvoi(envoi.statut, evenement.statut);
  if (nouveau === envoi.statut) return "traite"; // un statut qui revient en arrière est sans effet
  await db.query(
    `UPDATE canaux_envois SET statut = $2, code_refus = COALESCE($3, code_refus),
       termine_le = CASE WHEN $2 IN ('echec', 'lu') THEN now() ELSE termine_le END WHERE id = $1`,
    [envoi.id, nouveau, evenement.codeRefus],
  );
  return "traite";
}

async function traiterMessage(
  db: Db,
  c: ContexteTraitement,
  evenement: Extract<EvenementCanal, { type: "message" }>,
  notifications: NotificationCreee[],
  ligneId: string,
): Promise<{
  traitement: "traite" | "ignore" | "a_traiter";
  destinataireId: string | null;
  motif?: string;
}> {
  const expediteur = await retrouverExpediteur(
    db,
    c.trousseau,
    c.compte.cabinetId,
    "whatsapp",
    evenement.numero,
  );
  if (!expediteur)
    return { traitement: "ignore", destinataireId: null, motif: "expediteur_inconnu" };
  // Rejet par défaut d'un expéditeur NON habilité (utilisateur désactivé, compte du portail non actif,
  // client archivé, numéro non vérifié) : rien n'est écrit ni répondu. Seul « STOP » fonctionne
  // toujours (le retrait d'un consentement ne se refuse jamais).
  const contenu = evenement.contenu;
  const estStop = contenu.genre === "texte" && analyserReponse(contenu.texte).type === "stop";
  if (expediteur.etat !== "ok" && !estStop)
    return { traitement: "ignore", destinataireId: null, motif: expediteur.etat };
  const dest = expediteur.id;
  // Le message est rattaché AVANT toute réponse : la fenêtre de service de 24 h se lit sur cette ligne.
  await db.query("UPDATE canaux_evenements_recus SET destinataire_id = $2 WHERE id = $1", [
    ligneId,
    dest,
  ]);
  // Verrou du destinataire : un retrait (STOP) est immédiat ; un envoi concurrent relit l'état.
  await verrouillerDestinataire(db, dest, "UPDATE");
  if (contenu.genre === "autre")
    return { traitement: "ignore", destinataireId: dest, motif: "genre_non_pris_en_charge" };
  if (contenu.genre === "audio") {
    await db.query(
      `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle, tentatives_max)
       VALUES ($1, $2, $3, $4, $5, 3) ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING`,
      [
        c.compte.cabinetId,
        TYPE_JOB_CANAL_ENTRANT_AUDIO,
        JSON.stringify({
          evenement_ref: evenement.idEvenement,
          destinataire_id: dest,
          utilisateur_id: expediteur.utilisateur_id,
          ref_media: contenu.refMedia,
          type_mime: contenu.typeMime,
          duree_ms: contenu.dureeMs,
        }),
        c.maintenant,
        `entrant_audio:${evenement.idEvenement}`,
      ],
    );
    return { traitement: "a_traiter", destinataireId: dest };
  }
  const reponse = analyserReponse(contenu.texte);
  if (reponse.type === "stop") {
    const retire = await retirerConsentement(db, {
      cabinetId: c.compte.cabinetId,
      destinataireId: dest,
      canal: "whatsapp",
      source: "message_stop",
      acteurId: null,
      evenementRef: evenement.idEvenement,
    });
    await journaliser(db, {
      cabinetId: c.compte.cabinetId,
      utilisateurId: null,
      action: "canal.webhook.stop",
      entite: "canal_destinataire",
      entiteId: dest,
      details: { consentement_retire: retire },
    });
    const nom = await nomDuCabinet(db, c.compte.cabinetId);
    await repondre(db, c, dest, evenement.idEvenement, {
      gabarit: "reponse_stop",
      variables: [nom],
      objetId: dest,
    });
    return { traitement: "traite", destinataireId: dest };
  }
  let reponseService: ReponseDeService | null;
  if (reponse.type === "oui" || reponse.type === "non") {
    const r = await traiterConfirmation(db, {
      cabinetId: c.compte.cabinetId,
      destinataireId: dest,
      reponse: reponse.type,
      valeur: reponse.valeur,
      maintenant: c.maintenant,
    });
    notifications.push(...r.notifications);
    reponseService = r.reponse;
  } else {
    reponseService = await traiterTexteSaisie(db, {
      cabinetId: c.compte.cabinetId,
      destinataireId: dest,
      utilisateurId: expediteur.utilisateur_id,
      evenementRef: evenement.idEvenement,
      texte: contenu.texte,
      origine: "texte",
      maintenant: c.maintenant,
    });
  }
  if (reponseService) await repondre(db, c, dest, evenement.idEvenement, reponseService);
  return { traitement: "traite", destinataireId: dest };
}

/**
 * Applique les événements d'un webhook authentifié dans UNE transaction du cabinet. Un rejeu
 * (`(cabinet, canal, evenement_id)` déjà vu) ne produit AUCUN effet. Renvoie le nombre d'événements
 * reçus et les notifications internes créées.
 */
export async function traiterEvenements(
  db: Db,
  c: ContexteTraitement,
  evenements: readonly EvenementCanal[],
): Promise<{ recus: number; notifications: NotificationCreee[] }> {
  const notifications: NotificationCreee[] = [];
  for (const e of evenements) {
    const media =
      e.type === "message" && e.contenu.genre === "audio"
        ? JSON.stringify({
            ref_media: e.contenu.refMedia,
            type_mime: e.contenu.typeMime,
            duree_ms: e.contenu.dureeMs,
          })
        : null;
    const ins = await db.query(
      `INSERT INTO canaux_evenements_recus
         (cabinet_id, canal, compte_id, evenement_id, type, genre, horodatage_fournisseur, media)
       VALUES ($1, 'whatsapp', $2, $3, $4, $5, $6, $7)
       ON CONFLICT (cabinet_id, canal, evenement_id) DO NOTHING RETURNING id`,
      [
        c.compte.cabinetId,
        c.compte.compteId,
        e.idEvenement,
        e.type,
        e.type === "message" ? e.contenu.genre : null,
        e.recuLe,
        media,
      ],
    );
    const ligneId = ins.rows[0]?.id as string | undefined;
    if (!ligneId) continue; // rejeu : aucun effet
    const issue =
      e.type === "statut"
        ? { traitement: await traiterStatut(db, e), destinataireId: null as string | null }
        : await traiterMessage(db, c, e, notifications, ligneId);
    await db.query(
      `UPDATE canaux_evenements_recus SET traitement = $2, destinataire_id = $3, motif_ignore = $4
       WHERE id = $1`,
      [
        ligneId,
        issue.traitement,
        issue.destinataireId,
        "motif" in issue && issue.motif
          ? issue.motif
          : issue.traitement === "ignore"
            ? "evenement_inconnu"
            : null,
      ],
    );
  }
  return { recus: evenements.length, notifications };
}

/* ----- Job : message vocal d'un destinataire ----- */

const chargeAudioSchema = z
  .object({
    evenement_ref: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    destinataire_id: z.string().uuid(),
    utilisateur_id: z.string().uuid(),
    ref_media: z.string().min(1).max(200),
    type_mime: z.string().max(100),
    duree_ms: z.number().int().nullable(),
  })
  .strict();

const TYPES_AUDIO_SET: ReadonlySet<string> = new Set(TYPES_AUDIO);

/**
 * Télécharge le média (15 Mo au plus, type audio de la liste blanche), le transcrit EN MÉMOIRE
 * (`Transcripteur`), applique l'analyse de saisie avec l'origine « vocal » et jette l'audio ET le
 * texte : RIEN n'est stocké. La confirmation `OUI <valeur>` est toujours exigée (une reconnaissance
 * vocale se trompe sur les chiffres).
 */
export function creerHandlerCanalEntrantAudio(dependances: () => DependancesCanaux): HandlerJob {
  return async (ctx) => {
    const charge = chargeAudioSchema.safeParse(ctx.charge);
    if (!charge.success) throw new ErreurJobDefinitive("Charge de message vocal invalide.");
    const { config, canaux } = dependances();
    const c = charge.data;
    // L'utilisateur est figé à la mise en file : l'habilitation est REVUE au moment d'agir (personne
    // désactivée, client archivé ou numéro modifié depuis). Rien n'est transcrit ni répondu.
    if ((await etatDestinataire(ctx.db, c.destinataire_id)) !== "ok") {
      await ctx.db.query(
        `UPDATE canaux_evenements_recus SET traitement = 'ignore', motif_ignore = 'expediteur_inactif'
         WHERE cabinet_id = $1 AND canal = 'whatsapp' AND evenement_id = $2`,
        [ctx.cabinetId, c.evenement_ref],
      );
      return [];
    }
    const compte = await ctx.db.query(
      "SELECT id, identifiant_compte FROM canaux_comptes WHERE canal = 'whatsapp' AND actif",
    );
    if (!compte.rows[0]) return [];
    const job = await ctx.db.query("SELECT tentatives, tentatives_max FROM jobs WHERE id = $1", [
      ctx.jobId,
    ]);
    const derniere =
      !job.rows[0] || (job.rows[0].tentatives as number) >= (job.rows[0].tentatives_max as number);
    let texte: string | null = null;
    try {
      texte = await transcrireMedia(canaux, compte.rows[0].identifiant_compte as string, c);
    } catch (error) {
      if (error instanceof ErreurTranscription && error.reessayable && !derniere) throw error;
      texte = null; // définitif ou dernière tentative : réponse « non comprise »
    }
    const trousseau = trousseauDepuisConfig(config);
    const reponse: ReponseDeService = texte
      ? await traiterTexteSaisie(ctx.db, {
          cabinetId: ctx.cabinetId,
          destinataireId: c.destinataire_id,
          utilisateurId: c.utilisateur_id,
          evenementRef: c.evenement_ref,
          texte,
          origine: "vocal",
          maintenant: ctx.maintenant,
        })
      : { gabarit: "reponse_non_comprise", variables: [], objetId: c.destinataire_id };
    texte = null; // jeté
    await ctx.db.query(
      "UPDATE canaux_evenements_recus SET traitement = 'traite' WHERE cabinet_id = $1 AND canal = 'whatsapp' AND evenement_id = $2",
      [ctx.cabinetId, c.evenement_ref],
    );
    await mettreEnFileEnvoi(ctx.db, trousseau, {
      cabinetId: ctx.cabinetId,
      canal: "whatsapp",
      destinataireId: c.destinataire_id,
      gabarit: reponse.gabarit,
      variables: reponse.variables,
      objetType: "kpi_saisie",
      objetId: reponse.objetId,
      cle: `reponse:${c.evenement_ref}`,
      maintenant: ctx.maintenant,
    });
    return [];
  };
}

async function transcrireMedia(
  canaux: Canaux,
  identifiantCompte: string,
  c: z.infer<typeof chargeAudioSchema>,
): Promise<string | null> {
  if (!canaux.whatsapp || !canaux.transcripteur) return null;
  if (!TYPES_AUDIO_SET.has(c.type_mime.split(";")[0]?.trim() ?? "")) return null;
  let media;
  try {
    media = await canaux.whatsapp.telechargerMedia(identifiantCompte, c.ref_media);
  } catch (error) {
    if (error instanceof ErreurCanal) return null;
    throw error;
  }
  if (media.contenu.length > MEDIA_ENTRANT_OCTETS_MAX) return null;
  const typeMime = media.typeMime.split(";")[0]?.trim() ?? "";
  if (!TYPES_AUDIO_SET.has(typeMime)) return null;
  const resultat = await canaux.transcripteur.transcrire({
    idempotence: c.evenement_ref,
    audio: media.contenu,
    typeMime: typeMime as "audio/ogg" | "audio/mpeg" | "audio/mp4" | "audio/wav",
    langue: "auto",
  });
  try {
    validerResultatTranscription(resultat);
  } catch {
    return null;
  }
  return resultat.texte;
}
