import { PLAFONDS_DD, type cadrageSchema, type cadrageVersionSchema } from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import type { MissionAcces } from "../missions/acces.js";
import {
  exigerPlafondDd,
  exigerVersionCourante,
  exigerVersionsRestantes,
  type DossierLu,
} from "./acces.js";
import { assurerDimensionsDd } from "./dimensions-registre.js";
import { libellesDuCadrage, verifierCadrage } from "./taxonomie.js";

/*
 * Dossiers et cadrage (DD-01, migration 0500). Un dossier est l'identité d'une opération
 * d'investissement étudiée (jamais modifiée) ; son cadrage est versionné en ajout seul. Les codes de
 * secteur, de filière et de pays sont validés contre la taxonomie du référentiel.
 */

export type CorpsCadrage = z.infer<typeof cadrageSchema>;
export type CorpsCadrageVersion = z.infer<typeof cadrageVersionSchema>;

export interface CadrageCourant {
  version: number;
  titre: string;
  secteur_code: string;
  filiere_code: string | null;
  pays_code: string;
  cible_nom: string | null;
  type_operation: string;
  devise: string;
  date_operation: string | null;
  question_investissement: string | null;
  perimetre: string | null;
  motif: string | null;
  cree_par: string;
  cree_le: Date;
}

const COLONNES_CADRAGE = `c.version, c.titre, c.secteur_code, c.filiere_code, c.pays_code, c.cible_nom,
  c.type_operation, c.devise, c.date_operation::text AS date_operation, c.question_investissement,
  c.perimetre, c.motif, c.cree_par, c.cree_le`;

export async function cadrageCourant(db: Db, dossierId: string): Promise<CadrageCourant> {
  const r = await db.query(
    `SELECT ${COLONNES_CADRAGE} FROM dd_cadrage_versions c WHERE c.dossier_id = $1
     ORDER BY c.version DESC LIMIT 1`,
    [dossierId],
  );
  if (!r.rows[0]) throw introuvable("Dossier");
  return r.rows[0] as CadrageCourant;
}

/** Versions du cadrage, plus récente d'abord (au plus 200). */
export async function versionsDuCadrage(db: Db, dossierId: string) {
  const r = await db.query(
    `SELECT ${COLONNES_CADRAGE}, u.nom AS cree_par_nom
     FROM dd_cadrage_versions c LEFT JOIN utilisateurs u ON u.id = c.cree_par
     WHERE c.dossier_id = $1 ORDER BY c.version DESC`,
    [dossierId],
  );
  return r.rows as (CadrageCourant & { cree_par_nom: string | null })[];
}

async function insererCadrage(
  db: Db,
  auth: Auth,
  dossierId: string,
  version: number,
  c: CorpsCadrage,
  motif: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO dd_cadrage_versions (cabinet_id, dossier_id, version, titre, secteur_code,
       filiere_code, pays_code, cible_nom, type_operation, devise, date_operation,
       question_investissement, perimetre, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      auth.cabinetId,
      dossierId,
      version,
      c.titre,
      c.secteur_code,
      c.filiere_code,
      c.pays_code,
      c.cible_nom,
      c.type_operation,
      c.devise,
      c.date_operation,
      c.question_investissement,
      c.perimetre,
      motif,
      auth.utilisateurId,
    ],
  );
}

/** R02 : dossier + cadrage version 1 + dimensions `dd.*` du registre (idempotent). */
export async function creerDossier(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  c: CorpsCadrage,
): Promise<{ id: string; version: 1 }> {
  await exigerPlafondDd(db, {
    table: "dd_dossiers",
    colonne: "mission_id",
    valeur: mission.id,
    max: PLAFONDS_DD.dossiers_par_mission,
    quoi: "dossiers de due diligence par mission",
  });
  await verifierCadrage(db, c);
  await assurerDimensionsDd(db, auth, mission.id);
  const r = await db.query(
    `INSERT INTO dd_dossiers (cabinet_id, mission_id, client_id, cree_par)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [auth.cabinetId, mission.id, mission.client_id, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  await insererCadrage(db, auth, id, 1, c, null);
  return { id, version: 1 };
}

/** R05 : nouvelle version du cadrage (motif obligatoire, version lue exigée). */
export async function corrigerCadrage(
  db: Db,
  auth: Auth,
  dossier: DossierLu,
  c: CorpsCadrageVersion,
): Promise<number> {
  const courant = await cadrageCourant(db, dossier.id);
  exigerVersionCourante(c.version_courante, courant.version);
  exigerVersionsRestantes(courant.version + 1, PLAFONDS_DD.versions_par_objet);
  await verifierCadrage(db, c);
  const { motif } = c;
  await insererCadrage(db, auth, dossier.id, courant.version + 1, c, motif);
  return courant.version + 1;
}

/** R01 : dossiers d'une mission, du plus récent au plus ancien (au plus 10). */
export async function listerDossiers(db: Db, missionId: string) {
  const r = await db.query(
    `SELECT d.id, d.numero::text AS numero, d.cree_par, d.cree_le, ${COLONNES_CADRAGE}
     FROM dd_dossiers d
     JOIN LATERAL (SELECT * FROM dd_cadrage_versions cv WHERE cv.dossier_id = d.id
                   ORDER BY cv.version DESC LIMIT 1) c ON true
     WHERE d.mission_id = $1 ORDER BY d.numero DESC LIMIT $2`,
    [missionId, PLAFONDS_DD.dossiers_par_mission + 1],
  );
  return r.rows.slice(0, PLAFONDS_DD.dossiers_par_mission).map((l) => ({
    id: l.id as string,
    numero: l.numero as string,
    titre: l.titre as string,
    secteur_code: l.secteur_code as string,
    pays_code: l.pays_code as string,
    cible_nom: l.cible_nom as string | null,
    type_operation: l.type_operation as string,
    devise: l.devise as string,
    date_operation: l.date_operation as string | null,
    version_cadrage: l.version as number,
    cree_par: l.cree_par as string,
    cree_le: l.cree_le as Date,
  }));
}

/** R03 : dossier, cadrage courant, libellés de taxonomie et mission. */
export async function vueDossier(db: Db, dossier: DossierLu, mission: MissionAcces) {
  const cadrage = await cadrageCourant(db, dossier.id);
  const libelles = await libellesDuCadrage(db, cadrage);
  const m = await db.query("SELECT intitule FROM missions WHERE id = $1", [mission.id]);
  return {
    id: dossier.id,
    numero: dossier.numero,
    cree_par: dossier.cree_par,
    cree_le: dossier.cree_le,
    cadrage,
    version_cadrage: cadrage.version,
    secteur_libelle: libelles.secteur_libelle,
    filiere_libelle: libelles.filiere_libelle,
    pays_libelle: libelles.pays_libelle,
    mission: {
      id: mission.id,
      intitule: (m.rows[0]?.intitule as string | undefined) ?? "",
      statut: mission.statut,
    },
  };
}
