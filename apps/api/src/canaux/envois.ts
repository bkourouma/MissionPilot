import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  decisionRepli,
  ErreurCanaux,
  GABARITS_CANAL,
  peutEnvoyer,
  rendreGabaritCanal,
  rendreVarianteSms,
  type CodeGabarit,
  type CodeRefusEnvoi,
  type ConsentementCourant,
  type GabaritRendu,
  type MotifBlocage,
  type StatutEnvoi,
} from "@missionpilot/engines";
import type { CanalMessagerie, ObjetEnvoiCanal } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { trousseauDepuisConfig, type Trousseau } from "../auth/chiffrement.js";
import { lireCoupeCircuit } from "../agents/autonomie.js";
import type { Db } from "../db/pool.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { HandlerJob } from "../jobs/registre.js";
import { associesActifs, notifier, type NotificationCreee } from "../notifications/notifier.js";
import { consentementCourant } from "./consentements.js";
import type { DependancesCanaux } from "./fabrique.js";
import {
  aadNumero,
  chiffrerVariables,
  dechiffrerNumero,
  dechiffrerVariables,
  empreinteContenu,
} from "./numeros.js";
import type { Canaux, ResultatEnvoi } from "./ports.js";

/*
 * Envois (SPEC-3c §7.1) : journal SANS contenu (`canaux_envois`) et job `canal_envoi`.
 *
 * « Au plus une fois » : l'appel au port se fait HORS de toute transaction de verrou, en trois temps
 * (transactions courtes séparées par `ctx.database`, comme `ia/job.ts`) :
 * 1. réservation : verrou de l'envoi, relecture sous verrou du destinataire (consentement, numéro,
 *    compte, plafonds, coupe-circuit) ; refus : `bloque` + motif, SANS nouvelle tentative ;
 * 2. appel du port, numéro déchiffré EN MÉMOIRE seulement ;
 * 3. résultat : `accepte`, `echec` (+ repli SMS), retour à `reserve` (refus réessayable certifié par
 *    le fournisseur) ou `incertain` (issue inconnue : JAMAIS rejoué, notification aux associés).
 * Un envoi `en_cours` depuis plus de 15 minutes (worker tombé pendant l'appel) passe `incertain` au
 * rejeu, sans renvoi. La clé d'idempotence `cle` (unique par cabinet) rend la mise en file idempotente.
 */

export const TYPE_JOB_CANAL_ENVOI = "canal_envoi";

/** Tentatives d'un envoi (reprise 1, 2, 4, 8 min du worker) : valeur PROVISOIRE. */
export const TENTATIVES_MAX_ENVOI = 5;
/** Au-delà, un envoi `en_cours` est considéré comme interrompu pendant l'appel (issue inconnue). */
export const DELAI_ENVOI_EN_COURS_MS = 15 * 60_000;

const chargeSchema = z
  .object({ envoi_id: z.string().uuid(), v: z.number().int(), d: z.string().min(1).max(4000) })
  .strict();

export interface DemandeEnvoi {
  cabinetId: string;
  canal: CanalMessagerie;
  destinataireId: string;
  gabarit: CodeGabarit;
  variables: readonly string[];
  objetType: ObjetEnvoiCanal;
  objetId: string;
  /** Clé d'idempotence (unique par cabinet). */
  cle: string;
  /** Envoi SMS qui repart d'un WhatsApp : identifiant de la ligne d'origine. */
  repliDe?: string;
  maintenant: Date;
}

export interface EnvoiMisEnFile {
  id: string;
  statut: StatutEnvoi;
  motif: MotifBlocage | null;
  /** Vrai si la clé existait déjà (rejeu) : rien n'a été ajouté. */
  existant: boolean;
}

interface ContexteAutorisation {
  compteId: string;
  compteActif: boolean;
  identifiantCompte: string;
  repliSms: boolean;
  destinataireActif: boolean;
  numeroVerifie: boolean;
  consentement: ConsentementCourant;
  categorie: (typeof GABARITS_CANAL)[CodeGabarit]["categorie"];
  refus: readonly MotifBlocage[];
}

const origineWeb = (config: { WEB_ORIGIN: string }) => new URL(config.WEB_ORIGIN).origin;

function debutDuMoisUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Autorisation d'un envoi par le moteur (`peutEnvoyer`) sur les données lues sous la RLS du cabinet.
 * `excluEnvoiId` : l'envoi lui-même, retiré des compteurs lors de la relecture à l'exécution.
 */
async function evaluerAutorisation(
  db: Db,
  p: {
    canal: CanalMessagerie;
    destinataireId: string;
    gabarit: CodeGabarit;
    maintenant: Date;
    excluEnvoiId: string | null;
    verrou: "SHARE" | null;
  },
): Promise<ContexteAutorisation | null> {
  const categorie = GABARITS_CANAL[p.gabarit].categorie;
  const compte = await db.query(
    "SELECT id, actif, identifiant_compte, repli_sms FROM canaux_comptes WHERE canal = $1",
    [p.canal],
  );
  const c = compte.rows[0] as
    { id: string; actif: boolean; identifiant_compte: string; repli_sms: boolean } | undefined;
  if (!c) return null;
  const dest = await db.query(
    `SELECT d.verifie_le, u.actif AS utilisateur_actif
     FROM canaux_destinataires d JOIN utilisateurs u ON u.id = d.utilisateur_id
     WHERE d.id = $1 AND d.canal = $2 ${p.verrou === "SHARE" ? "FOR SHARE OF d" : ""}`,
    [p.destinataireId, p.canal],
  );
  const d = dest.rows[0] as { verifie_le: Date | null; utilisateur_actif: boolean } | undefined;
  if (!d) return null;
  const consentement = (await consentementCourant(db, p.destinataireId)).statut;
  const exclu = p.excluEnvoiId;
  const initiesDest = await db.query(
    `SELECT count(*)::int AS n FROM canaux_envois
     WHERE destinataire_id = $1 AND categorie NOT IN ('verification', 'reponse_service')
       AND statut <> 'bloque' AND cree_le > $2::timestamptz - interval '24 hours'
       AND ($3::uuid IS NULL OR id <> $3)`,
    [p.destinataireId, p.maintenant, exclu],
  );
  const initiesMois = await db.query(
    `SELECT count(*)::int AS n FROM canaux_envois
     WHERE categorie NOT IN ('verification', 'reponse_service')
       AND statut <> 'bloque' AND cree_le >= $1::timestamptz AND ($2::uuid IS NULL OR id <> $2)`,
    [debutDuMoisUtc(p.maintenant), exclu],
  );
  const reponses = await db.query(
    `SELECT count(*)::int AS n FROM canaux_envois
     WHERE destinataire_id = $1 AND categorie = 'reponse_service'
       AND statut <> 'bloque' AND cree_le > $2::timestamptz - interval '24 hours'
       AND ($3::uuid IS NULL OR id <> $3)`,
    [p.destinataireId, p.maintenant, exclu],
  );
  const entrant = await db.query(
    `SELECT max(recu_le) AS dernier FROM canaux_evenements_recus
     WHERE destinataire_id = $1 AND type = 'message'`,
    [p.destinataireId],
  );
  const dernier = entrant.rows[0]?.dernier as Date | null | undefined;
  // Écart d'horloge entre le processus et la base : jamais une durée négative.
  const heures = dernier
    ? Math.max(0, p.maintenant.getTime() - dernier.getTime()) / 3_600_000
    : null;
  const coupe =
    categorie === "relance" || categorie === "synthese" ? await lireCoupeCircuit(db) : null;
  const decision = peutEnvoyer({
    compteActif: c.actif,
    destinataireActif: d.utilisateur_actif,
    numeroVerifie: d.verifie_le !== null,
    consentement,
    categorie,
    coupeCircuitN4: coupe?.actif === true,
    envoisInitiesDernieres24h: initiesDest.rows[0].n as number,
    envoisInitiesMois: initiesMois.rows[0].n as number,
    reponsesService24h: reponses.rows[0].n as number,
    heuresDepuisDernierEntrant: heures,
  });
  return {
    compteId: c.id,
    compteActif: c.actif,
    identifiantCompte: c.identifiant_compte,
    repliSms: c.repli_sms,
    destinataireActif: d.utilisateur_actif,
    numeroVerifie: d.verifie_le !== null,
    consentement,
    categorie,
    refus: decision.refus,
  };
}

/** Ligne d'audit d'un envoi suspendu par le coupe-circuit N4 (classe R0 vers le client). */
async function journaliserCoupeCircuit(
  db: Db,
  cabinetId: string,
  envoiId: string,
  canal: CanalMessagerie,
  gabarit: CodeGabarit,
): Promise<void> {
  await journaliser(db, {
    cabinetId,
    utilisateurId: null,
    action: "canal.envoi.suspendu_coupe_circuit",
    entite: "canal_envoi",
    entiteId: envoiId,
    details: { canal, gabarit, classe_risque: "R0", motif: "coupe_circuit_n4" },
  });
}

/**
 * Met un envoi en file DANS la transaction de l'appelant : applique les plafonds du moteur sous les
 * verrous consultatifs `canal_debit:<destinataire>` et `canal_mensuel:<cabinet>`, puis insère la ligne
 * `reserve` (ou `bloque` avec son motif) et le job `canal_envoi`. Idempotent par `cle`. Renvoie null
 * quand le cabinet n'a aucun compte de ce canal ou que le destinataire n'existe pas (rien n'est inscrit).
 */
export async function mettreEnFileEnvoi(
  db: Db,
  trousseau: Trousseau,
  d: DemandeEnvoi,
): Promise<EnvoiMisEnFile | null> {
  if (d.cle.length < 1 || d.cle.length > 200) throw new Error("Clé d'envoi invalide.");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `canal_debit:${d.destinataireId}`,
  ]);
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `canal_mensuel:${d.cabinetId}`,
  ]);
  const deja = await db.query(
    "SELECT id, statut, motif_blocage FROM canaux_envois WHERE cle = $1",
    [d.cle],
  );
  if (deja.rows[0]) {
    return {
      id: deja.rows[0].id as string,
      statut: deja.rows[0].statut as StatutEnvoi,
      motif: (deja.rows[0].motif_blocage as MotifBlocage | null) ?? null,
      existant: true,
    };
  }
  const ctx = await evaluerAutorisation(db, {
    canal: d.canal,
    destinataireId: d.destinataireId,
    gabarit: d.gabarit,
    maintenant: d.maintenant,
    excluEnvoiId: null,
    verrou: null,
  });
  if (!ctx) return null;
  const id = randomUUID();
  const motif = ctx.refus[0] ?? null;
  const statut: StatutEnvoi = motif ? "bloque" : "reserve";
  await db.query(
    `INSERT INTO canaux_envois
       (id, cabinet_id, canal, compte_id, destinataire_id, gabarit, categorie, objet_type, objet_id,
        cle, statut, motif_blocage, repli_de, termine_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      id,
      d.cabinetId,
      d.canal,
      ctx.compteId,
      d.destinataireId,
      d.gabarit,
      ctx.categorie,
      d.objetType,
      d.objetId,
      d.cle,
      statut,
      motif,
      d.repliDe ?? null,
      motif ? d.maintenant : null,
    ],
  );
  if (motif === "coupe_circuit") {
    await journaliserCoupeCircuit(db, d.cabinetId, id, d.canal, d.gabarit);
  }
  if (!motif) {
    const charge = { envoi_id: id, ...chiffrerVariables(trousseau, d.cabinetId, id, d.variables) };
    await db.query(
      `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle, tentatives_max)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING`,
      [
        d.cabinetId,
        TYPE_JOB_CANAL_ENVOI,
        JSON.stringify(charge),
        d.maintenant,
        `${TYPE_JOB_CANAL_ENVOI}:${id}`,
        TENTATIVES_MAX_ENVOI,
      ],
    );
  }
  return { id, statut, motif, existant: false };
}

/* ----- Rendu du message ----- */

/**
 * Variante SMS du gabarit (GSM-7, 160 caractères). Le moteur n'en définit pas pour le code de
 * vérification : un SMS de vérification (numéro SMS à vérifier) reprend ce texte court, sans accent.
 */
function rendreSms(
  gabarit: CodeGabarit,
  variables: readonly string[],
  origine: string,
): GabaritRendu {
  if (GABARITS_CANAL[gabarit].varianteSms !== undefined) {
    return rendreVarianteSms(gabarit, variables, origine);
  }
  if (gabarit === "verification_numero") {
    const code = variables[0];
    if (variables.length !== 1 || code === undefined || !/^\d{6}$/.test(code)) {
      throw new ErreurCanaux("VARIABLE_INVALIDE");
    }
    const texte = `CabinetPilot : votre code de verification est ${code}. Il expire dans 10 minutes.`;
    return { texte, longueur: texte.length, variables: [code] };
  }
  throw new ErreurCanaux("VARIANTE_SMS_ABSENTE");
}

export function rendreMessage(
  canal: CanalMessagerie,
  gabarit: CodeGabarit,
  variables: readonly string[],
  origine: string,
): GabaritRendu {
  return canal === "sms"
    ? rendreSms(gabarit, variables, origine)
    : rendreGabaritCanal(gabarit, variables, origine);
}

/* ----- Handler du job ----- */

interface Reservation {
  envoi: {
    id: string;
    canal: CanalMessagerie;
    gabarit: CodeGabarit;
    categorie: ContexteAutorisation["categorie"];
    cle: string;
    tentatives: number;
    objet_type: ObjetEnvoiCanal;
    objet_id: string;
  };
  utilisateurId: string;
  numeroChiffre: { version: number; donnees: Buffer };
  identifiantCompte: string;
  repliSms: boolean;
}

/** Notification interne aux associés : un message n'a pas pu être confirmé (jamais renvoyé). */
async function notifierIncertain(db: Db, cabinetId: string): Promise<NotificationCreee[]> {
  const creees: NotificationCreee[] = [];
  for (const associeId of await associesActifs(db)) {
    const n = await notifier(db, {
      cabinetId,
      destinataireId: associeId,
      type: "canal_envoi_incertain",
      titre: "Un message n'a pas pu être confirmé",
      corps:
        "L'issue de l'envoi d'un message est inconnue : il n'a pas été renvoyé automatiquement. Consultez le journal des envois.",
      lien: "/parametres/canaux",
    });
    if (n) creees.push(n);
  }
  return creees;
}

export function creerHandlerCanalEnvoi(dependances: () => DependancesCanaux): HandlerJob {
  return async (ctx) => {
    const charge = chargeSchema.safeParse(ctx.charge);
    if (!charge.success) throw new ErreurJobDefinitive("Charge d'envoi de canal invalide.");
    const database = ctx.database;
    // Hors worker (sans base de l'application) : pas d'appel du port dans la transaction du job.
    if (!database)
      throw new ErreurJobDefinitive("Base de l'application absente : envoi impossible.");
    const { config, canaux } = dependances();
    const trousseau = trousseauDepuisConfig(config);
    const transacteur = <T>(fn: (db: Db) => Promise<T>) => database.withTenant(ctx.cabinetId, fn);
    const envoiId = charge.data.envoi_id;
    const notifications: NotificationCreee[] = [];

    // 1. Réservation (transaction courte).
    const reservation = await transacteur(async (db): Promise<Reservation | null> => {
      const r = await db.query(
        `SELECT id, canal, gabarit, categorie, cle, statut, tentatives, en_cours_le, destinataire_id,
                objet_type, objet_id
         FROM canaux_envois WHERE id = $1 FOR UPDATE`,
        [envoiId],
      );
      const e = r.rows[0] as
        | {
            id: string;
            canal: CanalMessagerie;
            gabarit: CodeGabarit;
            categorie: ContexteAutorisation["categorie"];
            cle: string;
            statut: StatutEnvoi;
            tentatives: number;
            en_cours_le: Date | null;
            destinataire_id: string;
            objet_type: ObjetEnvoiCanal;
            objet_id: string;
          }
        | undefined;
      if (!e) return null;
      if (e.statut === "en_cours") {
        // Interrompu pendant l'appel : issue inconnue, JAMAIS renvoyé.
        if (
          e.en_cours_le &&
          ctx.maintenant.getTime() - e.en_cours_le.getTime() >= DELAI_ENVOI_EN_COURS_MS
        ) {
          await db.query(
            "UPDATE canaux_envois SET statut = 'incertain', termine_le = $2 WHERE id = $1",
            [e.id, ctx.maintenant],
          );
          await journaliser(db, {
            cabinetId: ctx.cabinetId,
            utilisateurId: null,
            action: "canal.envoi.incertain",
            entite: "canal_envoi",
            entiteId: e.id,
            details: { canal: e.canal, gabarit: e.gabarit, cause: "interrompu" },
          });
          notifications.push(...(await notifierIncertain(db, ctx.cabinetId)));
        }
        return null;
      }
      if (e.statut !== "reserve") return null; // rejeu après succès ou envoi terminé
      const autorisation = await evaluerAutorisation(db, {
        canal: e.canal,
        destinataireId: e.destinataire_id,
        gabarit: e.gabarit,
        maintenant: ctx.maintenant,
        excluEnvoiId: e.id,
        verrou: "SHARE",
      });
      const port = e.canal === "whatsapp" ? canaux.whatsapp : canaux.sms;
      const motif: MotifBlocage | null = !autorisation
        ? "canal_inactif"
        : (autorisation.refus[0] ?? (port ? null : "canal_inactif"));
      if (motif || !autorisation) {
        await db.query(
          `UPDATE canaux_envois SET statut = 'bloque', motif_blocage = $2, termine_le = $3 WHERE id = $1`,
          [e.id, motif ?? "canal_inactif", ctx.maintenant],
        );
        if (motif === "coupe_circuit") {
          await journaliserCoupeCircuit(db, ctx.cabinetId, e.id, e.canal, e.gabarit);
        }
        return null;
      }
      const num = await db.query(
        `SELECT utilisateur_id, numero_chiffre, numero_cle_version FROM canaux_destinataires
         WHERE id = $1`,
        [e.destinataire_id],
      );
      await db.query(
        `UPDATE canaux_envois SET statut = 'en_cours', en_cours_le = $2, tentatives = tentatives + 1
         WHERE id = $1`,
        [e.id, ctx.maintenant],
      );
      return {
        envoi: {
          id: e.id,
          canal: e.canal,
          gabarit: e.gabarit,
          categorie: e.categorie,
          cle: e.cle,
          tentatives: e.tentatives + 1,
          objet_type: e.objet_type,
          objet_id: e.objet_id,
        },
        utilisateurId: num.rows[0].utilisateur_id as string,
        numeroChiffre: {
          version: Number(num.rows[0].numero_cle_version),
          donnees: num.rows[0].numero_chiffre as Buffer,
        },
        identifiantCompte: autorisation.identifiantCompte,
        repliSms: autorisation.repliSms,
      };
    });
    if (!reservation) return notifications;

    // 2. Appel du port, HORS de toute transaction de verrou ; numéro en mémoire seulement.
    const e = reservation.envoi;
    let resultat: ResultatEnvoi | null = null;
    let texte = "";
    let longueur = 0;
    let inconnu = false;
    let prepare: { numero: string; rendu: GabaritRendu } | null = null;
    try {
      const numero = dechiffrerNumero(
        trousseau,
        reservation.numeroChiffre,
        aadNumero(ctx.cabinetId, reservation.utilisateurId, e.canal),
      );
      const variables = dechiffrerVariables(trousseau, ctx.cabinetId, e.id, charge.data);
      prepare = { numero, rendu: rendreMessage(e.canal, e.gabarit, variables, origineWeb(config)) };
    } catch {
      // Déchiffrement ou rendu impossibles : rien n'est parti (échec définitif, sans repli).
      resultat = {
        statut: "refuse",
        idExterne: null,
        codeRefus: "GABARIT_REFUSE",
        reessayable: false,
      };
    }
    if (prepare) {
      texte = prepare.rendu.texte;
      longueur = prepare.rendu.longueur;
      try {
        resultat = await envoyerParLePort(
          canaux,
          e,
          reservation.identifiantCompte,
          prepare.numero,
          prepare.rendu,
        );
      } catch {
        // Panne de transport (délai, coupure, exception) : l'issue est INCONNUE, jamais rejoué.
        inconnu = true;
      }
    }

    // 3. Résultat (transaction courte).
    let reessayer = false;
    await transacteur(async (db) => {
      if (inconnu || !resultat) {
        await db.query(
          "UPDATE canaux_envois SET statut = 'incertain', termine_le = $2 WHERE id = $1 AND statut = 'en_cours'",
          [e.id, ctx.maintenant],
        );
        await journaliser(db, {
          cabinetId: ctx.cabinetId,
          utilisateurId: null,
          action: "canal.envoi.incertain",
          entite: "canal_envoi",
          entiteId: e.id,
          details: { canal: e.canal, gabarit: e.gabarit, cause: "issue_inconnue" },
        });
        notifications.push(...(await notifierIncertain(db, ctx.cabinetId)));
        return;
      }
      if (resultat.statut === "accepte") {
        await db.query(
          `UPDATE canaux_envois SET statut = 'accepte', id_externe = $2, accepte_le = $3,
             longueur = $4, empreinte_contenu = $5, fournisseur = 'simule', mode_fournisseur = 'simule'
           WHERE id = $1 AND statut = 'en_cours'`,
          [e.id, resultat.idExterne, ctx.maintenant, longueur, empreinteContenu(trousseau, texte)],
        );
        return;
      }
      const code = resultat.codeRefus as CodeRefusEnvoi;
      const epuisees = e.tentatives >= TENTATIVES_MAX_ENVOI;
      if (resultat.reessayable && !epuisees) {
        // Le fournisseur certifie que rien n'a été accepté : retour à « reserve » et reprise du worker.
        await db.query(
          "UPDATE canaux_envois SET statut = 'reserve', code_refus = $2 WHERE id = $1 AND statut = 'en_cours'",
          [e.id, code],
        );
        reessayer = true;
        return;
      }
      await db.query(
        `UPDATE canaux_envois SET statut = 'echec', code_refus = $2, termine_le = $3
         WHERE id = $1 AND statut = 'en_cours'`,
        [e.id, code, ctx.maintenant],
      );
      if (e.canal === "whatsapp") {
        await tenterRepli(
          db,
          trousseau,
          ctx.cabinetId,
          e,
          reservation,
          code,
          epuisees,
          charge.data,
          ctx.maintenant,
        );
      }
    });
    if (reessayer) throw new Error("Fournisseur indisponible : nouvelle tentative.");
    return notifications;
  };
}

async function envoyerParLePort(
  canaux: Canaux,
  e: Reservation["envoi"],
  compte: string,
  numero: string,
  rendu: GabaritRendu,
): Promise<ResultatEnvoi> {
  if (e.canal === "sms") {
    if (!canaux.sms) throw new Error("Passerelle SMS absente.");
    return canaux.sms.envoyer({
      idempotence: e.id,
      compte,
      numero,
      gabarit: e.gabarit,
      texte: rendu.texte,
    });
  }
  if (!canaux.whatsapp) throw new Error("Canal WhatsApp absent.");
  if (e.categorie === "reponse_service") {
    return canaux.whatsapp.envoyerSession({
      idempotence: e.id,
      compte,
      numero,
      texte: rendu.texte,
    });
  }
  return canaux.whatsapp.envoyerGabarit({
    idempotence: e.id,
    compte,
    numero,
    gabarit: e.gabarit,
    langue: "fr",
    variables: rendu.variables,
    texte: rendu.texte,
  });
}

/** Repli SMS (SPEC-3c §9.3) : une seconde ligne, son propre consentement et son propre numéro vérifié. */
async function tenterRepli(
  db: Db,
  trousseau: Trousseau,
  cabinetId: string,
  e: Reservation["envoi"],
  reservation: Reservation,
  codeRefus: CodeRefusEnvoi,
  epuisees: boolean,
  charge: { v: number; d: string },
  maintenant: Date,
): Promise<void> {
  const sms = await db.query(
    `SELECT id, verifie_le FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = 'sms'`,
    [reservation.utilisateurId],
  );
  const dest = sms.rows[0] as { id: string; verifie_le: Date | null } | undefined;
  const consentementSms = dest ? (await consentementCourant(db, dest.id)).statut : "absent";
  const repli = decisionRepli({
    codeRefus,
    tentativesEpuisees: epuisees,
    categorie: e.categorie,
    repliActif: reservation.repliSms,
    consentementSms,
    numeroSmsVerifie: dest?.verifie_le != null,
  });
  if (!repli || !dest) return;
  const variables = dechiffrerVariables(trousseau, cabinetId, e.id, charge);
  await mettreEnFileEnvoi(db, trousseau, {
    cabinetId,
    canal: "sms",
    destinataireId: dest.id,
    gabarit: e.gabarit,
    variables,
    objetType: e.objet_type,
    objetId: e.objet_id,
    cle: `${e.cle}:sms`,
    repliDe: e.id,
    maintenant,
  });
}

/* ----- Lecture du journal (GET /canaux/envois) ----- */

export interface FiltreEnvois {
  statut?: StatutEnvoi | undefined;
  objet_type?: ObjetEnvoiCanal | undefined;
  objet_id?: string | undefined;
  destinataire_id?: string | undefined;
}

export interface LigneEnvoi {
  id: string;
  canal: CanalMessagerie;
  mode_fournisseur: string;
  gabarit: CodeGabarit;
  categorie: string;
  destinataire_id: string;
  destinataire_nom: string;
  statut: StatutEnvoi;
  motif_blocage: MotifBlocage | null;
  code_refus: CodeRefusEnvoi | null;
  objet_type: ObjetEnvoiCanal;
  objet_id: string | null;
  cree_le: Date;
  cout_estime_micro_usd: string | null;
  cle_tri: string;
}

/**
 * Journal des envois, du plus récent au plus ancien (curseur sur horodatage et identifiant). Aucune
 * colonne de contenu n'existe dans la table : ni texte, ni numéro.
 */
export async function listerEnvois(
  db: Db,
  filtre: FiltreEnvois,
  apres: [string, string] | null,
  limite: number,
): Promise<LigneEnvoi[]> {
  const r = await db.query(
    `SELECT e.id, e.canal, e.mode_fournisseur, e.gabarit, e.categorie, e.destinataire_id,
            u.nom AS destinataire_nom, e.statut, e.motif_blocage, e.code_refus, e.objet_type,
            e.objet_id, e.cree_le, e.cout_estime_micro_usd::text AS cout_estime_micro_usd,
            to_char(e.cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cle_tri
     FROM canaux_envois e
     JOIN canaux_destinataires d ON d.id = e.destinataire_id AND d.cabinet_id = e.cabinet_id
     JOIN utilisateurs u ON u.id = d.utilisateur_id
     WHERE ($1::text IS NULL OR e.statut = $1) AND ($2::text IS NULL OR e.objet_type = $2)
       AND ($3::uuid IS NULL OR e.objet_id = $3) AND ($4::uuid IS NULL OR e.destinataire_id = $4)
       AND ($5::text IS NULL OR (e.cree_le, e.id) < ($5::timestamptz, $6::uuid))
     ORDER BY e.cree_le DESC, e.id DESC LIMIT $7`,
    [
      filtre.statut ?? null,
      filtre.objet_type ?? null,
      filtre.objet_id ?? null,
      filtre.destinataire_id ?? null,
      apres?.[0] ?? null,
      apres?.[1] ?? null,
      limite + 1,
    ],
  );
  return r.rows as LigneEnvoi[];
}
