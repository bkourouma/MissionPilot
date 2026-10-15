import type { RecommandationNote } from "@missionpilot/engines";
import {
  PLAFONDS_DD,
  type noteCreationSchema,
  type noteSoumissionSchema,
  type noteValidationSchema,
  type noteVersionSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import type { MissionAcces } from "../missions/acces.js";
import {
  estAssocieDd,
  exigerPlafondDd,
  exigerVersionCourante,
  exigerVersionsRestantes,
  type DossierLu,
} from "./acces.js";
import { construireBaseNote } from "./base-note.js";
import { chargerEtatDossier, controleNoteDe } from "./synthese.js";
import { vueControleNote } from "./vues.js";

/*
 * Notes au comité (DD-13, migration 0507, SPEC-3b §8.8, R46 à R51), en AJOUT SEUL : brouillons
 * versionnés, soumission à base FIGÉE par les moteurs (`base-note.ts`, refusée s'il reste un
 * bloquant : 409 NOTE_BLOQUEE, doublé par MPZ29), validation par un tiers (séparation des tâches
 * API et base, MPZ26 ; associé dispensé). Seule une version VALIDÉE se rend en rapport (MPR04).
 */

export type CorpsNote = z.infer<typeof noteCreationSchema>;
export type CorpsNoteVersion = z.infer<typeof noteVersionSchema>;
export type CorpsSoumission = z.infer<typeof noteSoumissionSchema>;
export type CorpsValidationNote = z.infer<typeof noteValidationSchema>;

export interface NoteLue {
  id: string;
  dossier_id: string;
  titre: string;
  cree_par: string;
  cree_le: Date;
}

export interface VersionNote {
  id: string;
  version: number;
  etat: "brouillon" | "soumise";
  recommandation: RecommandationNote;
  synthese: string;
  conditions: string[];
  soumise_le: Date | null;
  motif: string | null;
  cree_par: string;
  cree_par_nom: string | null;
  cree_le: Date;
}

export interface ValidationNote {
  version: number;
  decision: "valide" | "rejete";
  motif: string | null;
  valide_par: string;
  valide_par_nom: string | null;
  valide_le: Date;
}

export async function lireNote(db: Db, id: string): Promise<NoteLue> {
  const r = await db.query(
    "SELECT id, dossier_id, titre, cree_par, cree_le FROM dd_notes WHERE id = $1",
    [id],
  );
  if (!r.rows[0]) throw introuvable("Note");
  return r.rows[0] as NoteLue;
}

/**
 * Versions d'une note, plus récente d'abord, SANS `base_figee` (jusqu'à 1 Mo par version soumise) :
 * la base se lit pour UNE version (`baseDeVersion`).
 */
export async function versionsDeNote(db: Db, noteId: string): Promise<VersionNote[]> {
  const r = await db.query(
    `SELECT v.id, v.version, v.etat, v.recommandation, v.synthese, v.conditions, v.soumise_le,
       v.motif, v.cree_par, u.nom AS cree_par_nom, v.cree_le
     FROM dd_note_versions v LEFT JOIN utilisateurs u ON u.id = v.cree_par
     WHERE v.note_id = $1 ORDER BY v.version DESC`,
    [noteId],
  );
  return r.rows as VersionNote[];
}

/** `base_figee` d'une seule version de la note (null pour un brouillon). */
async function baseDeVersion(db: Db, noteId: string, version: number): Promise<unknown> {
  const r = await db.query(
    "SELECT base_figee FROM dd_note_versions WHERE note_id = $1 AND version = $2",
    [noteId, version],
  );
  return r.rows[0]?.base_figee ?? null;
}

export async function validationsDeNote(db: Db, noteId: string): Promise<ValidationNote[]> {
  const r = await db.query(
    `SELECT v.version, x.decision, x.motif, x.valide_par, u.nom AS valide_par_nom, x.valide_le
     FROM dd_note_validations x
       JOIN dd_note_versions v ON v.id = x.note_version_id
       LEFT JOIN utilisateurs u ON u.id = x.valide_par
     WHERE v.note_id = $1 ORDER BY v.version DESC`,
    [noteId],
  );
  return r.rows as ValidationNote[];
}

/** `brouillon`, `soumise` (en attente), `validee` ou `rejetee`, d'après la dernière version. */
export function etatDeNote(
  versions: readonly VersionNote[],
  validations: readonly ValidationNote[],
): "brouillon" | "soumise" | "validee" | "rejetee" {
  const derniere = versions[0];
  if (!derniere || derniere.etat === "brouillon") return "brouillon";
  const v = validations.find((x) => x.version === derniere.version);
  if (!v) return "soumise";
  return v.decision === "valide" ? "validee" : "rejetee";
}

export function versionValidee(validations: readonly ValidationNote[]): number | null {
  const valides = validations.filter((v) => v.decision === "valide").map((v) => v.version);
  return valides.length === 0 ? null : valides.reduce((a, b) => (b > a ? b : a));
}

async function insererVersion(
  db: Db,
  auth: Auth,
  noteId: string,
  version: number,
  c: { recommandation: string; synthese: string; conditions: string[] },
  motif: string | null,
  soumission: { base: unknown; le: Date } | null,
): Promise<string> {
  const r = await db.query(
    `INSERT INTO dd_note_versions (cabinet_id, note_id, version, etat, recommandation, synthese,
       conditions, base_figee, soumise_le, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::jsonb, $9, $10, $11) RETURNING id`,
    [
      auth.cabinetId,
      noteId,
      version,
      soumission === null ? "brouillon" : "soumise",
      c.recommandation,
      c.synthese,
      c.conditions,
      soumission === null ? null : JSON.stringify(soumission.base),
      soumission?.le ?? null,
      motif,
      auth.utilisateurId,
    ],
  );
  return r.rows[0].id as string;
}

/** R46 : notes d'un dossier (au plus 10) avec leur état dérivé. */
export async function listerNotes(db: Db, dossierId: string) {
  const r = await db.query(
    "SELECT id, titre, cree_le FROM dd_notes WHERE dossier_id = $1 ORDER BY numero ASC LIMIT $2",
    [dossierId, PLAFONDS_DD.notes_par_dossier + 1],
  );
  const notes = r.rows.slice(0, PLAFONDS_DD.notes_par_dossier);
  const elements = [];
  for (const n of notes) {
    const versions = await versionsDeNote(db, n.id as string);
    const validations = await validationsDeNote(db, n.id as string);
    elements.push({
      id: n.id as string,
      titre: n.titre as string,
      derniere_version: versions[0]?.version ?? 0,
      etat: etatDeNote(versions, validations),
      validee_version: versionValidee(validations),
      cree_le: n.cree_le as Date,
    });
  }
  return { elements };
}

/** R47 : crée une note (brouillon, version 1). */
export async function creerNote(
  db: Db,
  auth: Auth,
  dossier: DossierLu,
  c: CorpsNote,
): Promise<{ id: string; version: 1 }> {
  await exigerPlafondDd(db, {
    table: "dd_notes",
    colonne: "dossier_id",
    valeur: dossier.id,
    max: PLAFONDS_DD.notes_par_dossier,
    quoi: "notes par dossier",
  });
  const r = await db.query(
    `INSERT INTO dd_notes (cabinet_id, dossier_id, titre, cree_par) VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [auth.cabinetId, dossier.id, c.titre, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  await insererVersion(db, auth, id, 1, c, null, null);
  return { id, version: 1 };
}

/** R48 : note, versions, validations et contrôle (à blanc pour un brouillon, figé pour une soumise). */
export async function lireDetailNote(
  db: Db,
  mission: MissionAcces,
  dossier: DossierLu,
  note: NoteLue,
  versionDemandee: number | null,
) {
  const versions = await versionsDeNote(db, note.id);
  const validations = await validationsDeNote(db, note.id);
  const choisie =
    versionDemandee === null ? versions[0] : versions.find((v) => v.version === versionDemandee);
  if (!choisie) throw introuvable("Version de la note");
  let controle;
  if (choisie.etat === "soumise") {
    const base = (await baseDeVersion(db, note.id, choisie.version)) as {
      bloquants: string[];
      avertissements: string[];
    } | null;
    controle = {
      bloquants: base?.bloquants ?? [],
      avertissements: base?.avertissements ?? [],
      soumissible: (base?.bloquants ?? []).length === 0,
      fige: true,
    };
  } else {
    const etat = await chargerEtatDossier(db, mission, dossier);
    controle = {
      ...vueControleNote(controleNoteDe(etat, choisie.recommandation, choisie.conditions.length)),
      fige: false,
    };
  }
  const contenu = choisie;
  return {
    id: note.id,
    titre: note.titre,
    dossier_id: note.dossier_id,
    cree_par: note.cree_par,
    cree_le: note.cree_le,
    etat: etatDeNote(versions, validations),
    validee_version: versionValidee(validations),
    versions: versions.map((v) => ({
      version: v.version,
      etat: v.etat,
      recommandation: v.recommandation,
      motif: v.motif,
      soumise_le: v.soumise_le,
      cree_par: v.cree_par,
      cree_par_nom: v.cree_par_nom,
      cree_le: v.cree_le,
    })),
    contenu,
    validations,
    controle,
    base_figee:
      versionDemandee !== null && choisie.etat === "soumise"
        ? await baseDeVersion(db, note.id, choisie.version)
        : undefined,
  };
}

/** R49 : nouveau brouillon (la dernière version lue est exigée). */
export async function ajouterVersionNote(
  db: Db,
  auth: Auth,
  note: NoteLue,
  c: CorpsNoteVersion,
): Promise<number> {
  const versions = await versionsDeNote(db, note.id);
  const derniere = versions[0]?.version ?? 0;
  exigerVersionCourante(c.version_courante, derniere);
  exigerVersionsRestantes(derniere + 1, PLAFONDS_DD.versions_par_objet);
  await insererVersion(db, auth, note.id, derniere + 1, c, c.motif, null);
  return derniere + 1;
}

/** R50 : soumet le brouillon (dernière version) ; la base est figée par les moteurs. */
export async function soumettreNote(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  dossier: DossierLu,
  note: NoteLue,
  c: CorpsSoumission,
): Promise<number> {
  const versions = await versionsDeNote(db, note.id);
  const derniere = versions[0];
  if (!derniere || derniere.version !== c.version || derniere.etat !== "brouillon") {
    throw new AppError(
      409,
      "VERSION_PERIMEE",
      "Seule la dernière version, si c'est un brouillon, se soumet : rechargez la page.",
    );
  }
  exigerVersionsRestantes(derniere.version + 1, PLAFONDS_DD.versions_par_objet);
  const { base, bloquants } = await construireBaseNote(
    db,
    mission,
    dossier,
    derniere.recommandation,
    derniere.conditions.length,
  );
  if (bloquants.length > 0) {
    throw new AppError(
      409,
      "NOTE_BLOQUEE",
      "La note ne peut pas être soumise : des contrôles bloquants subsistent.",
      { manquants: [...bloquants] },
    );
  }
  if (Buffer.byteLength(JSON.stringify(base), "utf8") > PLAFONDS_DD.base_figee_octets) {
    throw new AppError(
      409,
      "NOTE_TROP_VOLUMINEUSE",
      "La base figée de la note dépasse 1 Mo : réduisez le contenu du dossier.",
    );
  }
  await insererVersion(
    db,
    auth,
    note.id,
    derniere.version + 1,
    derniere,
    "Soumission pour validation.",
    { base, le: new Date() },
  );
  return derniere.version + 1;
}

/** Même règle que le déclencheur `controler_dd_note_validation` (MPZ26). */
async function separationNoteViolee(
  db: Db,
  noteId: string,
  utilisateurId: string,
): Promise<boolean> {
  const r = await db.query(
    `SELECT EXISTS (SELECT 1 FROM dd_notes n WHERE n.id = $1 AND n.cree_par = $2::uuid)
         OR EXISTS (SELECT 1 FROM dd_note_versions z WHERE z.note_id = $1 AND z.cree_par = $2::uuid)
       AS viole`,
    [noteId, utilisateurId],
  );
  return r.rows[0]?.viole === true;
}

/** R51 : un tiers valide ou rejette la dernière version soumise. */
export async function validerNote(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  dossier: DossierLu,
  note: NoteLue,
  c: CorpsValidationNote,
): Promise<void> {
  const versions = await versionsDeNote(db, note.id);
  const validations = await validationsDeNote(db, note.id);
  const visee = versions.find((v) => v.version === c.version);
  const derniereSoumise = versions.find((v) => v.etat === "soumise");
  if (
    !visee ||
    visee.etat !== "soumise" ||
    !derniereSoumise ||
    derniereSoumise.version !== visee.version
  ) {
    throw new AppError(
      409,
      "NOTE_PERIMEE",
      "Cette version n'est plus la dernière version soumise de la note.",
    );
  }
  if (validations.some((v) => v.version === visee.version)) {
    throw new AppError(
      409,
      "NOTE_DEJA_DECIDEE",
      "Cette version de la note a déjà fait l'objet d'une décision.",
    );
  }
  if (!estAssocieDd(auth) && (await separationNoteViolee(db, note.id, auth.utilisateurId))) {
    throw new AppError(
      403,
      "SEPARATION_DES_TACHES",
      "Une note ne se valide ni par son créateur, ni par l'auteur d'une de ses versions.",
    );
  }
  // Le dossier a pu changer depuis la soumission (verdict rejeté, exclusion rouverte…) : valider
  // exige que les contrôles bloquants du moteur soient TOUJOURS levés sur l'état courant.
  if (c.decision === "valide") {
    const etat = await chargerEtatDossier(db, mission, dossier);
    const controle = controleNoteDe(etat, visee.recommandation, visee.conditions.length);
    if (controle.bloquants.length > 0) {
      throw new AppError(
        409,
        "NOTE_BLOQUEE",
        "Le dossier a changé depuis la soumission : des contrôles bloquants réapparaissent, la note ne se valide pas.",
        { manquants: [...controle.bloquants] },
      );
    }
  }
  await db.query(
    `INSERT INTO dd_note_validations (cabinet_id, note_version_id, decision, motif, valide_par)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.cabinetId, visee.id, c.decision, c.motif ?? null, auth.utilisateurId],
  );
}
