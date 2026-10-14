import { createHash } from "node:crypto";
import type { ConsentementCourant } from "@missionpilot/engines";
import {
  MENTION_COURANTE,
  MENTIONS_CONSENTEMENT,
  type CanalMessagerie,
  type SourceConsentement,
  type VersionMentionConsentement,
} from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { mentionPerimee } from "./erreurs.js";

/*
 * Consentement par destinataire ET par canal (SPEC-3c §6.2, §7.2). L'historique est en AJOUT SEUL
 * (MPH01) : l'état courant est la dernière ligne. Un retrait n'est jamais refusé et prend effet
 * immédiatement ; l'envoi relit l'état sous le verrou du destinataire (pas de course avec STOP).
 */

export interface MentionConsentement {
  version: VersionMentionConsentement;
  texte: string;
  /** SHA-256 du texte EXACT affiché : le serveur le calcule, le client n'envoie que la version. */
  empreinte: string;
}

/** Mention en vigueur pour le canal. */
export function mentionEnVigueur(canal: CanalMessagerie): MentionConsentement {
  const version = MENTION_COURANTE[canal];
  const texte: string = MENTIONS_CONSENTEMENT[version].texte;
  return { version, texte, empreinte: createHash("sha256").update(texte, "utf8").digest("hex") };
}

/** 409 `MENTION_PERIMEE` si la version envoyée n'est pas celle en vigueur pour ce canal. */
export function exigerMentionCourante(
  canal: CanalMessagerie,
  version: string,
): MentionConsentement {
  const mention = mentionEnVigueur(canal);
  if (mention.version !== version) throw mentionPerimee();
  return mention;
}

export interface ConsentementEtat {
  statut: ConsentementCourant;
  source: SourceConsentement | null;
  cree_le: Date | null;
}

/** État courant (dernière ligne de l'historique) d'un destinataire, ou « absent ». */
export async function consentementCourant(
  db: Db,
  destinataireId: string,
): Promise<ConsentementEtat> {
  const r = await db.query(
    `SELECT statut, source, cree_le FROM canaux_consentements
     WHERE destinataire_id = $1 ORDER BY id DESC LIMIT 1`,
    [destinataireId],
  );
  const l = r.rows[0];
  return l
    ? {
        statut: l.statut as "accorde" | "retire",
        source: l.source as SourceConsentement,
        cree_le: l.cree_le as Date,
      }
    : { statut: "absent", source: null, cree_le: null };
}

/** États courants de plusieurs destinataires (une requête) : la dernière ligne de chacun. */
export async function consentementsCourants(
  db: Db,
  destinataireIds: readonly string[],
): Promise<Map<string, ConsentementEtat>> {
  const etats = new Map<string, ConsentementEtat>();
  if (destinataireIds.length === 0) return etats;
  const r = await db.query(
    `SELECT DISTINCT ON (destinataire_id) destinataire_id, statut, source, cree_le
     FROM canaux_consentements WHERE destinataire_id = ANY($1::uuid[])
     ORDER BY destinataire_id, id DESC`,
    [destinataireIds],
  );
  for (const l of r.rows) {
    etats.set(l.destinataire_id as string, {
      statut: l.statut as "accorde" | "retire",
      source: l.source as SourceConsentement,
      cree_le: l.cree_le as Date,
    });
  }
  return etats;
}

/**
 * Verrou du destinataire : `FOR UPDATE` pour qui modifie un consentement ou un numéro (un envoi
 * concurrent attend puis relit l'état), `FOR SHARE` pour qui envoie. Renvoie la ligne utile ou null.
 */
export async function verrouillerDestinataire(
  db: Db,
  destinataireId: string,
  mode: "UPDATE" | "SHARE",
): Promise<{
  id: string;
  utilisateur_id: string;
  canal: CanalMessagerie;
  verifie_le: Date | null;
} | null> {
  const verrou = mode === "UPDATE" ? "FOR UPDATE" : "FOR SHARE";
  const r = await db.query(
    `SELECT id, utilisateur_id, canal, verifie_le FROM canaux_destinataires
     WHERE id = $1 ${verrou}`,
    [destinataireId],
  );
  return (
    (r.rows[0] as
      | {
          id: string;
          utilisateur_id: string;
          canal: CanalMessagerie;
          verifie_le: Date | null;
        }
      | undefined) ?? null
  );
}

export interface NouveauConsentement {
  cabinetId: string;
  destinataireId: string;
  canal: CanalMessagerie;
  statut: "accorde" | "retire";
  source: SourceConsentement;
  /** Nul seulement pour `message_stop`. */
  acteurId: string | null;
  mention?: MentionConsentement;
  referencePreuve?: string;
  evenementRef?: string;
}

/** Ajoute une ligne à l'historique (les règles de forme sont celles de la base, MPH01/MPH02). */
export async function ajouterConsentement(db: Db, c: NouveauConsentement): Promise<number> {
  const r = await db.query(
    `INSERT INTO canaux_consentements
       (cabinet_id, destinataire_id, canal, statut, source, mention_version, mention_empreinte,
        reference_preuve, acteur_id, evenement_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id::text AS id`,
    [
      c.cabinetId,
      c.destinataireId,
      c.canal,
      c.statut,
      c.source,
      c.mention?.version ?? null,
      c.mention?.empreinte ?? null,
      c.referencePreuve ?? null,
      c.acteurId,
      c.evenementRef ?? null,
    ],
  );
  return Number(r.rows[0].id);
}

/**
 * Retrait : jamais refusé, effet immédiat. Une ligne `retire` n'est ajoutée que si l'état courant
 * est « accordé » (l'historique ne s'alourdit pas de retraits sans objet) ; renvoie vrai si une ligne
 * a été ajoutée. Le destinataire est verrouillé par l'appelant (`verrouillerDestinataire`).
 */
export async function retirerConsentement(
  db: Db,
  p: {
    cabinetId: string;
    destinataireId: string;
    canal: CanalMessagerie;
    source: Extract<
      SourceConsentement,
      | "retrait_portail"
      | "retrait_cabinet"
      | "message_stop"
      | "changement_numero"
      | "desactivation_utilisateur"
    >;
    acteurId: string | null;
    evenementRef?: string;
  },
): Promise<boolean> {
  const courant = await consentementCourant(db, p.destinataireId);
  if (courant.statut !== "accorde") return false;
  await ajouterConsentement(db, {
    cabinetId: p.cabinetId,
    destinataireId: p.destinataireId,
    canal: p.canal,
    statut: "retire",
    source: p.source,
    acteurId: p.acteurId,
    ...(p.evenementRef ? { evenementRef: p.evenementRef } : {}),
  });
  return true;
}

/**
 * Désactivation d'un utilisateur du portail : son consentement est retiré sur chacun de ses
 * canaux (source `desactivation_utilisateur`, acteur = la personne qui désactive). Les envois
 * sont déjà bloqués (`destinataire_inactif`) ; le retrait garde l'historique juste et évite
 * qu'une réactivation ne ressuscite un accord ancien. Renvoie les canaux retirés (vide si aucun
 * consentement n'était accordé). Le destinataire est verrouillé avant la lecture de son état.
 */
export async function retirerConsentementsUtilisateur(
  db: Db,
  p: { cabinetId: string; utilisateurId: string; acteurId: string },
): Promise<CanalMessagerie[]> {
  const lignes = await db.query(
    "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 ORDER BY id",
    [p.utilisateurId],
  );
  const retires: CanalMessagerie[] = [];
  for (const l of lignes.rows as { id: string }[]) {
    const verrou = await verrouillerDestinataire(db, l.id, "UPDATE");
    if (!verrou) continue;
    const retire = await retirerConsentement(db, {
      cabinetId: p.cabinetId,
      destinataireId: l.id,
      canal: verrou.canal,
      source: "desactivation_utilisateur",
      acteurId: p.acteurId,
    });
    if (retire) retires.push(verrou.canal);
  }
  return retires;
}
