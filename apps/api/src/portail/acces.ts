import type { FastifyInstance, FastifyRequest } from "fastify";
import { estUtilisateurPortail, type Permission } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { interdit, introuvable } from "../errors.js";

/*
 * Couche d'accès du portail client (SOC-09).
 *
 * RÈGLES (testées dans test/portail-*.test.ts) :
 * 1. Toute route du portail côté client exige sa permission portail.*
 *    (aucun rôle interne ne la détient), une session portant un rôle client
 *    et un rattachement ACTIF à un client ACTIF (`request.portail`, chargé
 *    par portail/garde.ts) ; sinon 401/403.
 * 2. Toute lecture se fait dans `avecPortail` : transaction du cabinet (RLS
 *    `isolation`) ET paramètre `app.portail_client_id` (politiques
 *    RESTRICTIVES des migrations 0113 et 0114 : seules les lignes de CE
 *    client effectivement partagées sont visibles, les tables internes sont
 *    vides). Ce paramètre est de toute façon posé par db/pool.ts à CHAQUE
 *    transaction d'une requête du portail (portail/contexte.ts) : un
 *    `withTenant` brut y est soumis aux mêmes politiques ; `avecPortail`
 *    reste la forme à employer (intention explicite). Chaque requête filtre
 *    EN PLUS explicitement sur le client et les partages (double barrière).
 * 3. Une ressource inexistante, d'un autre client, d'un autre cabinet ou non
 *    partagée répond le MÊME 404 (même code, même message).
 * 4. Les réponses sont des projections explicites : jamais de coût, taux,
 *    marge, budget interne, équipe, tâche interne, auteur ni nom d'un membre
 *    du cabinet (sauf le contact principal choisi par le cabinet).
 * 5. Chaque accès est journalisé (qui, quoi, entité) dans la même transaction.
 */

export interface AccesPortail {
  auth: Auth;
  clientId: string;
}

/** Utilisateur du portail actif disposant de `permission`, sinon 401/403. */
export function exigerPortail(request: FastifyRequest, permission: Permission): AccesPortail {
  const auth = exiger(request, permission);
  if (!estUtilisateurPortail(auth.roles) || !request.portail) throw interdit();
  return { auth, clientId: request.portail.clientId };
}

/**
 * Transaction du portail : cabinet (RLS) et client (politiques restrictives
 * 0113-0114). Redondant avec le contexte posé par db/pool.ts pour toute
 * requête du portail, mais garde l'intention visible et vaut hors requête.
 */
export function avecPortail<T>(
  app: FastifyInstance,
  acces: AccesPortail,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  return app.db.withTenant(acces.auth.cabinetId, async (db) => {
    await db.query("SELECT set_config('app.portail_client_id', $1, true)", [acces.clientId]);
    return fn(db);
  });
}

/** Journal d'un accès du portail (lecture, téléchargement, validation). */
export function journaliserPortail(
  db: Db,
  acces: AccesPortail,
  action: string,
  entite: string,
  entiteId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  return journaliser(db, {
    cabinetId: acces.auth.cabinetId,
    utilisateurId: acces.auth.utilisateurId,
    action,
    entite,
    entiteId,
    details: { portail: true, client_id: acces.clientId, ...details },
  });
}

/** 404 unique du portail : inexistant, d'autrui ou non partagé. */
export const introuvablePortail = () => introuvable("Ressource");

export interface MissionPartagee {
  id: string;
  intitule: string;
  statut: string;
  date_debut: string | null;
  date_fin: string | null;
  jalons: boolean;
  factures: boolean;
  directeur_id: string | null;
  chef_id: string | null;
}

/** Colonnes servies au client pour une mission (projection explicite). */
const COLONNES_MISSION = `m.id, m.intitule, m.statut, m.date_debut::text AS date_debut,
  m.date_fin::text AS date_fin, p.jalons, p.factures, m.directeur_id, m.chef_id`;

const DEPUIS_MISSION = `missions m JOIN portail_partages p
  ON p.mission_id = m.id AND p.document_id IS NULL AND p.client_id = m.client_id`;

/** Mission partagée avec le client de l'utilisateur, sinon 404. */
export async function exigerMissionPartagee(
  db: Db,
  acces: AccesPortail,
  missionId: string,
): Promise<MissionPartagee> {
  const r = await db.query(
    `SELECT ${COLONNES_MISSION} FROM ${DEPUIS_MISSION} WHERE m.id = $1 AND m.client_id = $2`,
    [missionId, acces.clientId],
  );
  if (!r.rows[0]) throw introuvablePortail();
  return r.rows[0] as MissionPartagee;
}

/** Missions partagées (page par curseur sur intitulé, id). */
export async function missionsPartagees(
  db: Db,
  acces: AccesPortail,
  apres: [string, string] | null,
  limite: number,
): Promise<(MissionPartagee & { cle_tri: string })[]> {
  const r = await db.query(
    `SELECT ${COLONNES_MISSION}, lower(m.intitule) AS cle_tri FROM ${DEPUIS_MISSION}
     WHERE m.client_id = $1 AND ($2::text IS NULL OR (lower(m.intitule), m.id) > ($2, $3::uuid))
     ORDER BY lower(m.intitule), m.id LIMIT $4`,
    [acces.clientId, apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  return r.rows as (MissionPartagee & { cle_tri: string })[];
}

/** Vue client d'une mission : ni budget, ni équipe, ni responsable, ni tâche. */
export function vueMission(m: MissionPartagee): Record<string, unknown> {
  return {
    id: m.id,
    intitule: m.intitule,
    statut: m.statut,
    date_debut: m.date_debut,
    date_fin: m.date_fin,
    partage: { jalons: m.jalons, factures: m.factures },
  };
}

/** Plafond des jalons et livrables servis par mission (bornés, sans curseur). */
export const MAX_PAR_MISSION = 500;

/** Jalons d'une mission partagée AVEC ses jalons (sinon 404), et leur validation client. */
export async function jalonsPartages(db: Db, acces: AccesPortail, mission: MissionPartagee) {
  if (!mission.jalons) throw introuvablePortail();
  const r = await db.query(
    `SELECT j.id, j.libelle, j.date_prevue::text AS date_prevue, j.atteint, j.ordre,
       v.valide_le, v.commentaire, (v.valide_par = $3) AS valide_par_moi
     FROM mission_jalons j
     LEFT JOIN portail_validations_jalons v ON v.jalon_id = j.id AND v.client_id = $2
     WHERE j.mission_id = $1
     ORDER BY j.date_prevue NULLS LAST, j.ordre, j.id LIMIT $4`,
    [mission.id, acces.clientId, acces.auth.utilisateurId, MAX_PAR_MISSION],
  );
  return r.rows.map((j) => ({
    id: j.id as string,
    libelle: j.libelle as string,
    date_prevue: j.date_prevue as string | null,
    atteint: j.atteint as boolean,
    validation: j.valide_le
      ? {
          valide_le: j.valide_le as Date,
          commentaire: (j.commentaire as string | null) ?? null,
          valide_par_moi: j.valide_par_moi === true,
        }
      : null,
  }));
}

/** Documents partagés (livrables) d'une mission partagée. */
export async function livrablesPartages(db: Db, acces: AccesPortail, mission: MissionPartagee) {
  const r = await db.query(
    `SELECT d.id, d.type, d.nom, d.version, d.cree_le, f.type_mime, f.taille,
       (d.fichier_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = d.fichier_id)) AS telechargeable
     FROM portail_partages p
     JOIN mission_documents d ON d.id = p.document_id AND d.mission_id = p.mission_id
     LEFT JOIN fichiers f ON f.id = d.fichier_id
     WHERE p.mission_id = $1 AND p.client_id = $2
       AND (d.statut_contenu IS NULL OR d.statut_contenu = 'valide')
     ORDER BY d.type, lower(d.nom), d.version DESC, d.id LIMIT $3`,
    [mission.id, acces.clientId, MAX_PAR_MISSION],
  );
  return r.rows.map((d) => ({
    id: d.id as string,
    type: d.type as string,
    nom: d.nom as string,
    version: d.version as number,
    depose_le: d.cree_le as Date,
    type_mime: (d.type_mime as string | null) ?? null,
    taille: d.taille === null || d.taille === undefined ? null : Number(d.taille),
    telechargeable: d.telechargeable === true,
  }));
}

/** Fichier d'un livrable partagé et téléchargeable, sinon 404. */
export async function fichierLivrablePartage(db: Db, acces: AccesPortail, documentId: string) {
  const r = await db.query(
    `SELECT d.id AS document_id, d.mission_id, f.id AS fichier_id, f.nom_origine AS nom,
       f.type_mime, f.taille, f.cle_stockage
     FROM portail_partages p
     JOIN missions m ON m.id = p.mission_id AND m.client_id = p.client_id
     JOIN portail_partages pm ON pm.mission_id = m.id AND pm.document_id IS NULL
       AND pm.client_id = p.client_id
     JOIN mission_documents d ON d.id = p.document_id AND d.mission_id = p.mission_id
     JOIN fichiers f ON f.id = d.fichier_id
     WHERE p.document_id = $1 AND p.client_id = $2
       AND (d.statut_contenu IS NULL OR d.statut_contenu = 'valide')
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)`,
    [documentId, acces.clientId],
  );
  if (!r.rows[0]) throw introuvablePortail();
  return r.rows[0] as {
    document_id: string;
    mission_id: string;
    fichier_id: string;
    nom: string;
    type_mime: string;
    taille: string | number;
    cle_stockage: string;
  };
}

/**
 * Factures ÉMISES (ou annulées par avoir) de missions partagées AVEC leurs
 * factures, du client de l'utilisateur. `factureId` : une seule.
 */
export const COLONNES_FACTURE_PORTAIL = `f.id, f.nature, f.facture_origine_id, f.numero,
  f.date_emission::text AS date_emission, f.date_echeance::text AS date_echeance, f.devise,
  f.statut, f.objet, f.total_ht, f.total_tva, f.total_ttc, f.total_retenues, f.net_a_payer,
  f.mission_id, m.intitule AS mission_intitule, f.client_id`;

export const DEPUIS_FACTURE_PORTAIL = `factures f
  JOIN missions m ON m.id = f.mission_id AND m.client_id = f.client_id
  JOIN portail_partages p ON p.mission_id = m.id AND p.document_id IS NULL
    AND p.client_id = f.client_id AND p.factures`;

export const FILTRE_FACTURE_PORTAIL = `f.client_id = $1 AND f.statut IN ('emise', 'annulee')`;
