import type {
  attestationCreationSchema,
  ReferenceContenu,
  referencesQuerySchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { motifContient } from "../http/outils.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { exigerFichierRattachable } from "../stockage/fichiers.js";
import { curseurNumero, journal, pageParNumero, verrouEntite } from "./commun.js";

/*
 * Banque de références et d'attestations de bonne exécution (AO-05) : références versionnées en
 * ajout seul (0381), recherche par secteur, pays, bailleur et montant (dans UNE devise : aucun
 * change implicite), pièces justificatives rattachées depuis le stockage existant.
 *
 * Pièce : le fichier est d'abord téléversé par POST /api/fichiers (non rattaché, son auteur
 * seul), puis rattaché ici sous verrou (`exigerFichierRattachable`) ; il n'est plus orphelin
 * (fichier_orphelin, 0384). Le téléchargement passe par la route de la banque, qui revérifie le
 * droit `ao.lire` à chaque appel (GET /api/fichiers/:id ne connaît pas ce rattachement : 404).
 */

const COLONNES_VERSION = `v.version, v.titre, v.client_nom, v.client_id, v.mission_id, v.pays,
  v.secteurs, v.bailleur, v.montant, v.devise, to_char(v.date_debut, 'YYYY-MM-DD') AS date_debut,
  to_char(v.date_fin, 'YYYY-MM-DD') AS date_fin, v.role_cabinet, v.description, v.motif,
  v.cree_par AS version_cree_par, v.cree_le AS version_cree_le`;

function vueVersion(l: Record<string, unknown>) {
  return {
    version: l.version as number,
    titre: l.titre,
    client_nom: l.client_nom,
    client_id: l.client_id ?? null,
    mission_id: l.mission_id ?? null,
    pays: l.pays,
    secteurs: l.secteurs,
    bailleur: l.bailleur ?? null,
    montant: Number(l.montant),
    devise: l.devise,
    date_debut: l.date_debut,
    date_fin: l.date_fin ?? null,
    role_cabinet: l.role_cabinet,
    description: l.description ?? null,
    motif: l.motif ?? null,
    cree_par: l.version_cree_par,
    cree_le: l.version_cree_le,
  };
}

/** Une mission citée doit être visible de l'utilisateur (404 sinon, comme une inexistante). */
async function verifierMission(db: Db, auth: Auth, c: ReferenceContenu): Promise<void> {
  if (c.mission_id) await exigerMissionVisible(db, auth, c.mission_id);
}

async function insererVersion(
  db: Db,
  auth: Auth,
  referenceId: string,
  version: number,
  c: ReferenceContenu,
  motif: string | null,
): Promise<void> {
  await verifierMission(db, auth, c);
  await db.query(
    `INSERT INTO ao_reference_versions (cabinet_id, reference_id, version, titre, client_nom,
       client_id, mission_id, pays, secteurs, bailleur, montant, devise, date_debut, date_fin,
       role_cabinet, description, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      auth.cabinetId,
      referenceId,
      version,
      c.titre,
      c.client_nom,
      c.client_id ?? null,
      c.mission_id ?? null,
      c.pays,
      c.secteurs,
      c.bailleur ?? null,
      c.montant,
      c.devise,
      c.date_debut,
      c.date_fin,
      c.role_cabinet,
      c.description ?? null,
      motif,
      auth.utilisateurId,
    ],
  );
}

export async function creerReference(db: Db, auth: Auth, c: ReferenceContenu): Promise<string> {
  const r = await db.query(
    "INSERT INTO ao_references (cabinet_id, cree_par) VALUES ($1, $2) RETURNING id",
    [auth.cabinetId, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  await insererVersion(db, auth, id, 1, c, null);
  await journal(db, auth, "creation_reference_ao", "ao_reference", id, {
    client_id: c.client_id ?? null,
    mission_id: c.mission_id ?? null,
  });
  return id;
}

/** Référence visible (RLS) et sa version courante, ou 404. */
export async function exigerReference(db: Db, id: string) {
  const r = await db.query(
    `SELECT r.id, r.numero, r.cree_par, r.cree_le, ${COLONNES_VERSION}
     FROM ao_references r
     JOIN LATERAL (SELECT * FROM ao_reference_versions x WHERE x.reference_id = r.id
                   ORDER BY x.version DESC LIMIT 1) v ON true
     WHERE r.id = $1`,
    [id],
  );
  const l = r.rows[0] as Record<string, unknown> | undefined;
  if (!l) throw introuvable("Référence");
  return {
    id: l.id as string,
    numero: Number(l.numero),
    cree_par: l.cree_par as string,
    cree_le: l.cree_le as Date,
    courante: vueVersion(l),
  };
}

export async function attestationsDe(db: Db, referenceId: string) {
  const r = await db.query(
    `SELECT a.id, a.type, to_char(a.date_attestation, 'YYYY-MM-DD') AS date_attestation,
       a.emetteur, a.cree_par, a.cree_le, a.retiree_le, a.motif_retrait,
       f.id AS fichier_id, f.nom_origine AS fichier_nom, f.type_mime, f.taille
     FROM ao_attestations a JOIN fichiers f ON f.id = a.fichier_id
     WHERE a.reference_id = $1 ORDER BY a.cree_le, a.id`,
    [referenceId],
  );
  return r.rows.map((l) => ({
    id: l.id as string,
    type: l.type as string,
    date_attestation: l.date_attestation as string,
    emetteur: l.emetteur as string,
    cree_par: l.cree_par as string,
    cree_le: l.cree_le as Date,
    retiree: l.retiree_le !== null,
    retiree_le: (l.retiree_le as Date | null) ?? null,
    motif_retrait: (l.motif_retrait as string | null) ?? null,
    fichier: {
      id: l.fichier_id as string,
      nom: l.fichier_nom as string,
      type_mime: l.type_mime as string,
      taille: Number(l.taille),
    },
  }));
}

export async function detailReference(db: Db, id: string) {
  const ref = await exigerReference(db, id);
  const versions = await db.query(
    `SELECT ${COLONNES_VERSION} FROM ao_reference_versions v WHERE v.reference_id = $1
     ORDER BY v.version DESC`,
    [id],
  );
  return {
    ...ref,
    versions: versions.rows.map((l) => vueVersion(l as Record<string, unknown>)),
    attestations: await attestationsDe(db, id),
  };
}

export async function nouvelleVersionReference(
  db: Db,
  auth: Auth,
  id: string,
  c: ReferenceContenu,
  motif: string,
): Promise<void> {
  await verrouEntite(db, "reference", id);
  const ref = await exigerReference(db, id);
  await insererVersion(db, auth, id, ref.courante.version + 1, c, motif);
  await journal(db, auth, "version_reference_ao", "ao_reference", id, {
    version: ref.courante.version + 1,
  });
}

/**
 * Recherche sur la version courante : texte (titre, client, description), secteur, pays,
 * bailleur ; montant borné dans la devise demandée (le schéma l'exige avec un montant).
 */
export async function listerReferences(db: Db, q: z.infer<typeof referencesQuerySchema>) {
  const apres = curseurNumero(q.curseur);
  const r = await db.query(
    `SELECT r.id, r.numero, ${COLONNES_VERSION},
       (SELECT count(*)::int FROM ao_attestations a
        WHERE a.reference_id = r.id AND a.retiree_le IS NULL) AS attestations
     FROM ao_references r
     JOIN LATERAL (SELECT * FROM ao_reference_versions x WHERE x.reference_id = r.id
                   ORDER BY x.version DESC LIMIT 1) v ON true
     WHERE ($1::text IS NULL OR v.titre ILIKE $1 OR v.client_nom ILIKE $1 OR v.description ILIKE $1)
       AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM unnest(v.secteurs) s WHERE s ILIKE $2))
       AND ($3::text IS NULL OR v.pays = $3)
       AND ($4::text IS NULL OR v.bailleur ILIKE $4)
       AND ($5::text IS NULL OR v.devise = $5)
       AND ($6::bigint IS NULL OR v.montant >= $6)
       AND ($7::bigint IS NULL OR v.montant <= $7)
       AND ($8::bigint IS NULL OR r.numero < $8)
     ORDER BY r.numero DESC
     LIMIT $9`,
    [
      motifContient(q.q),
      motifContient(q.secteur),
      q.pays ?? null,
      motifContient(q.bailleur),
      q.devise ?? null,
      q.montant_min ?? null,
      q.montant_max ?? null,
      apres,
      q.limite + 1,
    ],
  );
  const lignes = r.rows.map((l) => ({
    id: l.id as string,
    numero: Number(l.numero),
    attestations: l.attestations as number,
    ...vueVersion(l as Record<string, unknown>),
  }));
  return pageParNumero(lignes, q.limite);
}

/** Rattache un fichier téléversé (orphelin, de l'utilisateur, récent) comme pièce d'une référence. */
export async function ajouterAttestation(
  db: Db,
  auth: Auth,
  referenceId: string,
  corps: z.infer<typeof attestationCreationSchema>,
): Promise<string> {
  await exigerReference(db, referenceId);
  await exigerFichierRattachable(db, auth, corps.fichier_id);
  const r = await db.query(
    `INSERT INTO ao_attestations (cabinet_id, reference_id, fichier_id, type, date_attestation,
       emetteur, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      referenceId,
      corps.fichier_id,
      corps.type,
      corps.date_attestation,
      corps.emetteur,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journal(db, auth, "ajout_attestation_ao", "ao_reference", referenceId, {
    attestation_id: id,
    fichier_id: corps.fichier_id,
    type: corps.type,
  });
  return id;
}

/** Pièce visible (RLS) avec sa référence et son fichier, ou 404. */
export async function exigerAttestation(db: Db, id: string, verrouiller = false) {
  if (verrouiller) await verrouEntite(db, "attestation", id);
  const r = await db.query(
    `SELECT a.id, a.reference_id, a.fichier_id, a.retiree_le, a.cree_par FROM ao_attestations a
     WHERE a.id = $1`,
    [id],
  );
  const l = r.rows[0];
  if (!l) throw introuvable("Pièce");
  return {
    id: l.id as string,
    reference_id: l.reference_id as string,
    fichier_id: l.fichier_id as string,
    retiree: l.retiree_le !== null,
    cree_par: l.cree_par as string,
  };
}

/**
 * Retrait motivé d'une pièce (une fois) : le fichier redevient orphelin et sera purgé (24 h), donc
 * IRRÉVERSIBLE. Réservé à qui a ajouté la pièce, à un associé ou à un directeur de mission : un
 * autre détenteur de `ao.gerer` ne détruit pas la pièce justificative d'un collègue (403).
 */
export async function retirerAttestation(
  db: Db,
  auth: Auth,
  id: string,
  motif: string,
): Promise<string> {
  const a = await exigerAttestation(db, id, true);
  if (a.retiree) throw conflit("Cette pièce est déjà retirée.");
  if (
    a.cree_par !== auth.utilisateurId &&
    !auth.roles.includes("associe") &&
    !auth.roles.includes("directeur_mission")
  ) {
    throw new AppError(
      403,
      "INTERDIT",
      "Seul l'auteur de la pièce, un associé ou un directeur de mission la retire.",
    );
  }
  await db.query(
    `UPDATE ao_attestations SET retiree_le = now(), retiree_par = $2, motif_retrait = $3
     WHERE id = $1`,
    [id, auth.utilisateurId, motif],
  );
  await journal(db, auth, "retrait_attestation_ao", "ao_reference", a.reference_id, {
    attestation_id: id,
    fichier_id: a.fichier_id,
  });
  return a.reference_id;
}
