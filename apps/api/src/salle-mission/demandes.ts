import type { z } from "zod";
import {
  SALLE_DEMANDES_PAR_MISSION_MAX,
  SALLE_PIECES_PAR_DEMANDE_MAX,
  type SaisiePieceSalle,
  type salleDemandeCreationSchema,
  type salleDemandeModificationSchema,
  type sallePieceModificationSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { clauseSet } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, requeteInvalide } from "../errors.js";
import type { MissionAcces } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { notifier, titreUneLigne, type NotificationCreee } from "../notifications/notifier.js";
import {
  COLONNES_DEMANDE,
  destinatairesClient,
  exigerDemande,
  verrouillerDemande,
  type DemandeDb,
} from "./donnees.js";
import { exigerModele, normaliserPieces, piecesDuModele } from "./modeles.js";
import { planifierRelancesSalle } from "./relances.js";
import { dateFr } from "./regles.js";

/*
 * Demandes documentaires d'une mission (CLI-01) : préparation en brouillon (depuis un modèle,
 * pièce par pièce, ou les deux), envoi au client (notification doublée d'un e-mail aux
 * dirigeants et contributeurs actifs sur le portail, relances automatiques mises en file),
 * prolongation de l'échéance, clôture. Les règles d'état sont doublées par les déclencheurs de
 * 0330 (MPL05) ; chaque action est journalisée dans sa transaction.
 */

type CreationDemande = z.infer<typeof salleDemandeCreationSchema>;
type ModificationDemande = z.infer<typeof salleDemandeModificationSchema>;
type ModificationPiece = z.infer<typeof sallePieceModificationSchema>;

const demandeFigee = (message: string) => new AppError(409, "DEMANDE_FIGEE", message);

async function insererPieces(
  db: Db,
  auth: Auth,
  demande: Pick<DemandeDb, "id" | "mission_id" | "client_id">,
  pieces: readonly SaisiePieceSalle[],
): Promise<void> {
  const existantes = await db.query(
    "SELECT count(*)::int AS n, coalesce(max(ordre), 0)::int AS dernier FROM salle_pieces WHERE demande_id = $1",
    [demande.id],
  );
  const { n, dernier } = existantes.rows[0] as { n: number; dernier: number };
  if (n + pieces.length > SALLE_PIECES_PAR_DEMANDE_MAX) {
    throw conflit(`Une demande compte au plus ${SALLE_PIECES_PAR_DEMANDE_MAX} pièces.`);
  }
  let ordre = dernier;
  for (const p of normaliserPieces(pieces)) {
    ordre += 1;
    await db.query(
      `INSERT INTO salle_pieces (cabinet_id, demande_id, mission_id, client_id, libelle,
         description, obligatoire, ordre, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        auth.cabinetId,
        demande.id,
        demande.mission_id,
        demande.client_id,
        p.libelle,
        p.description,
        p.obligatoire,
        ordre,
        auth.utilisateurId,
      ],
    );
  }
}

export async function creerDemande(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  corps: CreationDemande,
): Promise<DemandeDb> {
  const nombre = await db.query(
    "SELECT count(*)::int AS n FROM salle_demandes WHERE mission_id = $1",
    [mission.id],
  );
  if ((nombre.rows[0].n as number) >= SALLE_DEMANDES_PAR_MISSION_MAX) {
    throw conflit(`Une mission compte au plus ${SALLE_DEMANDES_PAR_MISSION_MAX} demandes.`);
  }
  let pieces: SaisiePieceSalle[] = corps.pieces ?? [];
  if (corps.modele_id) {
    const modele = await exigerModele(db, corps.modele_id);
    if (!modele.actif) throw conflit("Ce modèle est archivé.");
    pieces = [...piecesDuModele(modele), ...pieces];
  }
  const r = await db.query(
    `INSERT INTO salle_demandes (cabinet_id, mission_id, client_id, modele_id, titre, message,
       echeance, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      auth.cabinetId,
      mission.id,
      mission.client_id,
      corps.modele_id ?? null,
      corps.titre,
      corps.message ?? null,
      corps.echeance ?? null,
      auth.utilisateurId,
    ],
  );
  const demande = await exigerDemande(db, mission.id, r.rows[0].id as string);
  await insererPieces(db, auth, demande, pieces);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "salle_demande_creation",
    entite: "salle_demande",
    entiteId: demande.id,
    details: { mission_id: mission.id, modele_id: corps.modele_id ?? null, pieces: pieces.length },
  });
  return demande;
}

/** Échéance exigée à l'envoi et lors d'une prolongation : aujourd'hui (UTC) ou plus tard. */
function exigerEcheanceFuture(echeance: string | null | undefined): string {
  if (!echeance) throw requeteInvalide("Fixez une échéance avant d'envoyer la demande.");
  if (echeance < aujourdhui()) {
    throw requeteInvalide("L'échéance doit être aujourd'hui ou plus tard.");
  }
  return echeance;
}

export async function modifierDemande(
  db: Db,
  auth: Auth,
  demande: DemandeDb,
  corps: ModificationDemande,
): Promise<void> {
  if (demande.statut === "close") throw demandeFigee("Demande close : définitive.");
  if (demande.statut === "envoyee") {
    if (corps.titre !== undefined || corps.message !== undefined) {
      throw demandeFigee("Demande envoyée : seules l'échéance et les relances changent.");
    }
    if (corps.echeance !== undefined) exigerEcheanceFuture(corps.echeance);
  }
  const set = clauseSet(
    {
      titre: corps.titre,
      message: corps.message,
      echeance: corps.echeance,
      relances_auto: corps.relances_auto,
    },
    2,
  );
  await db.query(`UPDATE salle_demandes SET ${set.sql}, modifie_le = now() WHERE id = $1`, [
    demande.id,
    ...set.valeurs,
  ]);
  const prolongee =
    demande.statut === "envoyee" &&
    corps.echeance !== undefined &&
    corps.echeance !== demande.echeance;
  if (prolongee) {
    await planifierRelancesSalle(db, auth.cabinetId, demande.id, corps.echeance as string);
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: prolongee ? "salle_echeance_modifiee" : "salle_demande_modification",
    entite: "salle_demande",
    entiteId: demande.id,
    details: {
      mission_id: demande.mission_id,
      champs: Object.keys(corps).filter((k) => (corps as Record<string, unknown>)[k] !== undefined),
      ...(prolongee ? { ancienne_echeance: demande.echeance, echeance: corps.echeance } : {}),
    },
  });
}

/** Supprime une demande en brouillon et ses pièces. */
export async function supprimerDemande(db: Db, auth: Auth, demande: DemandeDb): Promise<void> {
  if (demande.statut !== "brouillon") {
    throw demandeFigee("Une demande envoyée ne se supprime pas : la clore.");
  }
  await db.query("DELETE FROM salle_pieces WHERE demande_id = $1", [demande.id]);
  await db.query("DELETE FROM salle_demandes WHERE id = $1", [demande.id]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "salle_demande_suppression",
    entite: "salle_demande",
    entiteId: demande.id,
    details: { mission_id: demande.mission_id, titre: demande.titre },
  });
}

export async function ajouterPiece(
  db: Db,
  auth: Auth,
  demande: DemandeDb,
  piece: SaisiePieceSalle,
): Promise<void> {
  if (demande.statut === "close") throw demandeFigee("Demande close : aucune pièce ne s'y ajoute.");
  await insererPieces(db, auth, demande, [piece]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "salle_piece_ajout",
    entite: "salle_demande",
    entiteId: demande.id,
    details: { mission_id: demande.mission_id, libelle: piece.libelle },
  });
}

export async function modifierPiece(
  db: Db,
  auth: Auth,
  demande: DemandeDb,
  pieceId: string,
  corps: ModificationPiece,
): Promise<void> {
  if (demande.statut !== "brouillon") {
    throw demandeFigee("Demande envoyée : ses pièces sont figées.");
  }
  const set = clauseSet(
    { libelle: corps.libelle, description: corps.description, obligatoire: corps.obligatoire },
    3,
  );
  await db.query(`UPDATE salle_pieces SET ${set.sql} WHERE id = $1 AND demande_id = $2`, [
    pieceId,
    demande.id,
    ...set.valeurs,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "salle_piece_modification",
    entite: "salle_piece",
    entiteId: pieceId,
    details: { demande_id: demande.id },
  });
}

export async function supprimerPiece(
  db: Db,
  auth: Auth,
  demande: DemandeDb,
  pieceId: string,
): Promise<void> {
  if (demande.statut !== "brouillon") {
    throw demandeFigee("Demande envoyée : ses pièces sont figées.");
  }
  await db.query("DELETE FROM salle_pieces WHERE id = $1 AND demande_id = $2", [
    pieceId,
    demande.id,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "salle_piece_suppression",
    entite: "salle_piece",
    entiteId: pieceId,
    details: { demande_id: demande.id },
  });
}

/** Nom du cabinet pour les messages adressés au client (une ligne, borné). */
export async function nomCabinet(db: Db, cabinetId: string): Promise<string> {
  const r = await db.query("SELECT nom FROM cabinets WHERE id = $1", [cabinetId]);
  return titreUneLigne(String(r.rows[0]?.nom ?? "Votre cabinet de conseil")).slice(0, 120);
}

/**
 * Envoi d'une demande en brouillon : échéance future, au moins une pièce, au moins un
 * destinataire sur le portail (sinon le client ne pourrait rien déposer) ; notification
 * doublée d'un e-mail à chaque destinataire, relances automatiques mises en file.
 */
export async function envoyerDemande(
  db: Db,
  auth: Auth,
  demande: DemandeDb,
): Promise<NotificationCreee[]> {
  if (demande.statut !== "brouillon") throw demandeFigee("Cette demande est déjà envoyée.");
  const echeance = exigerEcheanceFuture(demande.echeance);
  const pieces = await db.query(
    "SELECT count(*)::int AS n FROM salle_pieces WHERE demande_id = $1",
    [demande.id],
  );
  const nombre = pieces.rows[0].n as number;
  if (nombre === 0) throw requeteInvalide("Ajoutez au moins une pièce avant d'envoyer.");
  const destinataires = await destinatairesClient(db, demande.client_id);
  if (destinataires.length === 0) {
    throw new AppError(
      409,
      "SALLE_SANS_DESTINATAIRE",
      "Aucun dirigeant ni contributeur du client n'est actif sur le portail : invitez-en un avant d'envoyer.",
    );
  }
  await db.query(
    `UPDATE salle_demandes SET statut = 'envoyee', envoyee_par = $2, envoyee_le = now(),
       modifie_le = now() WHERE id = $1`,
    [demande.id, auth.utilisateurId],
  );
  const cabinet = await nomCabinet(db, auth.cabinetId);
  const notifications: NotificationCreee[] = [];
  for (const d of destinataires) {
    const n = await notifier(db, {
      cabinetId: auth.cabinetId,
      destinataireId: d.id,
      type: "salle_demande",
      titre: `Documents demandés : « ${demande.titre} »`,
      corps: `${cabinet} vous demande ${nombre} pièce${nombre > 1 ? "s" : ""} avant le ${dateFr(echeance)}. Déposez-les depuis votre portail client, rubrique « Documents à fournir ».`,
      lien: `/portail/salle/${demande.id}`,
      email: true,
    });
    if (n) notifications.push(n);
  }
  await planifierRelancesSalle(db, auth.cabinetId, demande.id, echeance);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "salle_demande_envoi",
    entite: "salle_demande",
    entiteId: demande.id,
    details: {
      mission_id: demande.mission_id,
      pieces: nombre,
      echeance,
      destinataires: notifications.map((n) => n.destinataire_id),
    },
  });
  return notifications;
}

export async function cloreDemande(db: Db, auth: Auth, demande: DemandeDb): Promise<void> {
  if (demande.statut !== "envoyee") throw demandeFigee("Seule une demande envoyée se clôt.");
  await verrouillerDemande(db, demande.id, "exclusif");
  await db.query(
    `UPDATE salle_demandes SET statut = 'close', close_par = $2, close_le = now(),
       modifie_le = now() WHERE id = $1`,
    [demande.id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "salle_demande_cloture",
    entite: "salle_demande",
    entiteId: demande.id,
    details: { mission_id: demande.mission_id },
  });
}

/**
 * Clôture de la mission : ses demandes « envoyées » sont closes dans la MÊME transaction, avant
 * le passage de la mission à « cloturee » (le déclencheur `controler_cloture_mission_salle`, 0332,
 * refuse sinon). Chaque demande est verrouillée en exclusif (aucun dépôt en cours), puis close par
 * l'auteur de la clôture ; une ligne de journal par demande, avec la cause. Les brouillons restent
 * des brouillons (ils ne s'enverront plus : mission close). Renvoie le nombre de demandes closes.
 */
export async function cloreDemandesDeMission(
  db: Db,
  auth: Auth,
  missionId: string,
): Promise<number> {
  const r = await db.query(
    "SELECT id FROM salle_demandes WHERE mission_id = $1 AND statut = 'envoyee' ORDER BY id",
    [missionId],
  );
  let n = 0;
  for (const { id } of r.rows as { id: string }[]) {
    await verrouillerDemande(db, id, "exclusif");
    const lue = await db.query(
      `SELECT ${COLONNES_DEMANDE} FROM salle_demandes d WHERE d.id = $1 FOR UPDATE`,
      [id],
    );
    const demande = lue.rows[0] as DemandeDb | undefined;
    if (!demande || demande.statut !== "envoyee") continue;
    await db.query(
      `UPDATE salle_demandes SET statut = 'close', close_par = $2, close_le = now(),
         modifie_le = now() WHERE id = $1`,
      [id, auth.utilisateurId],
    );
    await journaliser(db, {
      cabinetId: auth.cabinetId,
      utilisateurId: auth.utilisateurId,
      action: "salle_demande_cloture",
      entite: "salle_demande",
      entiteId: id,
      details: { mission_id: missionId, cause: "cloture_mission" },
    });
    n += 1;
  }
  return n;
}
