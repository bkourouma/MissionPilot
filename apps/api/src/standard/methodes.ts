import type {
  methodeCreationSchema,
  methodeListeQuerySchema,
  varianteCreationSchema,
  versionCreationSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { traduireErreursPg } from "../db/outils.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { validerVersion } from "./coherence.js";
import {
  copierContenu,
  dernierePubliee,
  exigerBrouillonDuCabinet,
  lireContenu,
  lireMethode,
  lireVersion,
  sansIdentifiants,
} from "./contenu.js";
import { comparerContenus, fusionnerVariante } from "./differences.js";
import { separationVariante, standardLectureSeule } from "./erreurs.js";
import { lireFacteurs } from "./modulation.js";
import { origineMethode, type ContenuMethode, type VersionLigne } from "./types.js";

/*
 * Catalogue, héritage et versions (STD-02, STD-03, STD-11). Le standard est
 * en lecture seule pour les cabinets ; une VARIANTE copie la dernière
 * version publiée du standard dans un brouillon du cabinet, dont les
 * différences restent visibles ; la mise à jour du standard est PROPOSÉE
 * (analyse d'impact), jamais appliquée en silence ; une version se publie
 * seulement si elle est cohérente (`validerVersion`).
 */

const UNIQUES_METHODE = { "*": "Ce code de méthode existe déjà dans le cabinet." };

export async function listerMethodes(db: Db, q: z.infer<typeof methodeListeQuerySchema>) {
  const curseur = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT m.id, m.cabinet_id, m.parent_id, m.code, m.libelle, m.description,
            s.code AS service_code, s.libelle AS service_libelle, m.libelle AS cle_tri,
            p.libelle AS parent_libelle,
            (SELECT jsonb_build_object('id', v.id, 'version', v.version, 'publie_le', v.publie_le)
               FROM methode_versions v WHERE v.methode_id = m.id AND v.statut = 'publiee'
              ORDER BY v.version DESC LIMIT 1) AS derniere_publiee,
            (SELECT v.id FROM methode_versions v WHERE v.methode_id = m.id AND v.statut = 'brouillon') AS brouillon_id,
            (SELECT x.id FROM methodes x WHERE x.parent_id = m.id AND x.cabinet_id = app_cabinet_id()) AS variante_id
     FROM methodes m JOIN services_conseil s ON s.id = m.service_id
     LEFT JOIN methodes p ON p.id = m.parent_id
     WHERE ($1::text IS NULL OR (m.libelle, m.id) > ($1, $2::uuid))
     ORDER BY m.libelle, m.id
     LIMIT $3`,
    [curseur?.[0] ?? null, curseur?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(r.rows, q.limite);
  return {
    ...page,
    elements: page.elements.map(({ cabinet_id, ...m }) => ({
      ...m,
      origine: origineMethode({ cabinet_id, parent_id: m.parent_id }),
    })),
  };
}

/** Mise à jour du standard disponible pour une variante (STD-03), ou null. */
async function miseAJourStandard(
  db: Db,
  versionVariante: VersionLigne | null,
  parentId: string | null,
) {
  if (!parentId || !versionVariante?.base_standard_id) return null;
  const base = await lireVersion(db, versionVariante.base_standard_id);
  const derniere = await dernierePubliee(db, parentId);
  if (!derniere || derniere.version <= base.version) return null;
  return {
    base: { id: base.id, version: base.version },
    disponible: {
      id: derniere.id,
      version: derniere.version,
      notes_version: derniere.notes_version,
    },
  };
}

export async function lireDetailMethode(db: Db, id: string) {
  const m = await lireMethode(db, id);
  const versions = await db.query(
    `SELECT v.id, v.version, v.statut, v.notes_version, v.base_standard_id, v.cree_le, v.publie_le,
            b.version AS base_standard_version, uc.nom AS cree_par_nom, up.nom AS publie_par_nom
     FROM methode_versions v
     LEFT JOIN methode_versions b ON b.id = v.base_standard_id
     LEFT JOIN utilisateurs uc ON uc.id = v.cree_par
     LEFT JOIN utilisateurs up ON up.id = v.publie_par
     WHERE v.methode_id = $1 ORDER BY v.version DESC`,
    [id],
  );
  const parent = m.parent_id ? await lireMethode(db, m.parent_id) : null;
  const variante = await db.query(
    `SELECT id, libelle FROM methodes WHERE parent_id = $1 AND cabinet_id = app_cabinet_id()`,
    [id],
  );
  const publiee = await dernierePubliee(db, id);
  return {
    ...m,
    origine: origineMethode(m),
    parent: parent ? { id: parent.id, libelle: parent.libelle, code: parent.code } : null,
    variante: variante.rows[0] ?? null,
    versions: versions.rows,
    mise_a_jour_standard: await miseAJourStandard(db, publiee, m.parent_id),
  };
}

async function creerVersionBrouillon(
  db: Db,
  auth: Auth,
  methodeId: string,
  baseStandardId: string | null,
  notes: string | null,
): Promise<string> {
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO methode_versions (cabinet_id, methode_id, version, notes_version, base_standard_id, cree_par)
       VALUES ($1, $2, (SELECT coalesce(max(version), 0) + 1 FROM methode_versions WHERE methode_id = $2),
               $3, $4, $5)
       RETURNING id`,
      [auth.cabinetId, methodeId, notes, baseStandardId, auth.utilisateurId],
    ),
    { "*": "Un brouillon est déjà en cours pour cette méthode : le publier ou le poursuivre." },
  );
  return r.rows[0].id as string;
}

export async function creerMethode(
  db: Db,
  auth: Auth,
  corps: z.infer<typeof methodeCreationSchema>,
) {
  const service = await db.query(`SELECT id FROM services_conseil WHERE id = $1`, [
    corps.service_id,
  ]);
  if (!service.rowCount) throw requeteInvalide("Service inconnu.");
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO methodes (cabinet_id, service_id, code, libelle, description, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        auth.cabinetId,
        corps.service_id,
        corps.code,
        corps.libelle,
        corps.description ?? null,
        auth.utilisateurId,
      ],
    ),
    UNIQUES_METHODE,
  );
  const methodeId = r.rows[0].id as string;
  const versionId = await creerVersionBrouillon(db, auth, methodeId, null, null);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "standard.methode.creer",
    entite: "methode",
    entiteId: methodeId,
    details: { code: corps.code },
  });
  return { id: methodeId, version_id: versionId };
}

/** Variante du cabinet d'une méthode du standard : copie de sa dernière version publiée. */
export async function creerVariante(
  db: Db,
  auth: Auth,
  standardId: string,
  corps: z.infer<typeof varianteCreationSchema>,
) {
  const standard = await lireMethode(db, standardId);
  if (standard.cabinet_id !== null) {
    throw requeteInvalide("Une variante se crée depuis une méthode du standard.");
  }
  const source = await dernierePubliee(db, standardId);
  if (!source) throw conflit("Cette méthode du standard n'a aucune version publiée.");
  const existe = await db.query(
    `SELECT id FROM methodes WHERE parent_id = $1 AND cabinet_id = $2`,
    [standardId, auth.cabinetId],
  );
  if (existe.rowCount) {
    throw new AppError(
      409,
      "VARIANTE_EXISTANTE",
      "Le cabinet a déjà une variante de cette méthode.",
    );
  }
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO methodes (cabinet_id, service_id, code, libelle, description, parent_id, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        auth.cabinetId,
        standard.service_id,
        corps.code ?? standard.code,
        corps.libelle ?? `${standard.libelle} (cabinet)`,
        standard.description,
        standardId,
        auth.utilisateurId,
      ],
    ),
    UNIQUES_METHODE,
  );
  const methodeId = r.rows[0].id as string;
  const versionId = await creerVersionBrouillon(
    db,
    auth,
    methodeId,
    source.id,
    `Variante créée depuis la version ${source.version} du standard.`,
  );
  await copierContenu(
    db,
    auth.cabinetId,
    versionId,
    sansIdentifiants(await lireContenu(db, source.id)),
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "standard.variante.creer",
    entite: "methode",
    entiteId: methodeId,
    details: { standard_id: standardId, base_standard_id: source.id },
  });
  return { id: methodeId, version_id: versionId };
}

function notesFusion(conflits: { collection: string; code: string }[], version: number): string {
  const base = `Mise à jour depuis la version ${version} du standard.`;
  if (conflits.length === 0) return base;
  return `${base} Choix du cabinet conservés : ${conflits.map((c) => `${c.collection}/${c.code}`).join(", ")}.`.slice(
    0,
    4000,
  );
}

/**
 * Nouvelle version en brouillon d'une méthode du cabinet, depuis sa dernière
 * version publiée ; `rebaser` (variante) : fusion avec la dernière version
 * publiée du standard, les choix du cabinet l'emportant.
 */
export async function creerNouvelleVersion(
  db: Db,
  auth: Auth,
  methodeId: string,
  corps: z.infer<typeof versionCreationSchema>,
) {
  const m = await lireMethode(db, methodeId);
  if (m.cabinet_id === null) throw standardLectureSeule();
  await db.query(`SELECT id FROM methodes WHERE id = $1 FOR UPDATE`, [methodeId]);
  const source = await dernierePubliee(db, methodeId);
  if (!source) throw conflit("Publier d'abord le brouillon en cours.");
  let contenu: ContenuMethode = sansIdentifiants(await lireContenu(db, source.id));
  let base = source.base_standard_id;
  let notes = corps.notes_version ?? null;
  let conflits: { collection: string; code: string }[] = [];
  if (corps.rebaser) {
    if (!m.parent_id || !source.base_standard_id) {
      throw requeteInvalide("Seule une variante se met à jour depuis le standard.");
    }
    const standard = await dernierePubliee(db, m.parent_id);
    if (!standard || standard.id === source.base_standard_id) {
      throw conflit("La variante part déjà de la dernière version du standard.");
    }
    const fusion = fusionnerVariante(
      sansIdentifiants(await lireContenu(db, source.base_standard_id)),
      contenu,
      sansIdentifiants(await lireContenu(db, standard.id)),
    );
    contenu = fusion.contenu;
    conflits = fusion.conflits;
    base = standard.id;
    notes = notes ?? notesFusion(fusion.conflits, standard.version);
  }
  const versionId = await creerVersionBrouillon(db, auth, methodeId, base, notes);
  await copierContenu(db, auth.cabinetId, versionId, contenu);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: corps.rebaser ? "standard.variante.mettre_a_jour" : "standard.version.creer",
    entite: "methode_version",
    entiteId: versionId,
    details: { methode_id: methodeId, source_id: source.id, base_standard_id: base, conflits },
  });
  return { id: versionId, conflits };
}

export async function modifierNotesVersion(
  db: Db,
  auth: Auth,
  versionId: string,
  notes: string | null,
) {
  await exigerBrouillonDuCabinet(db, versionId);
  await db.query(`UPDATE methode_versions SET notes_version = $2 WHERE id = $1`, [
    versionId,
    notes,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "standard.version.modifier",
    entite: "methode_version",
    entiteId: versionId,
  });
  return lireVersion(db, versionId);
}

/** Version complète, avec ses différences par rapport à la base du standard ou à la version précédente. */
export async function lireDetailVersion(db: Db, versionId: string) {
  const contenu = await lireContenu(db, versionId);
  const v = contenu.version;
  let differences: {
    reference: { id: string; version: number; nature: string };
    diff: unknown;
  } | null = null;
  if (v.base_standard_id) {
    const base = await lireContenu(db, v.base_standard_id);
    differences = {
      reference: { id: base.version.id, version: base.version.version, nature: "standard" },
      diff: comparerContenus(sansIdentifiants(base), sansIdentifiants(contenu)),
    };
  } else if (v.version > 1) {
    const precedente = await db.query(
      `SELECT id FROM methode_versions WHERE methode_id = $1 AND version = $2`,
      [v.methode_id, v.version - 1],
    );
    if (precedente.rows[0]) {
      const p = await lireContenu(db, precedente.rows[0].id);
      differences = {
        reference: { id: p.version.id, version: p.version.version, nature: "precedente" },
        diff: comparerContenus(sansIdentifiants(p), sansIdentifiants(contenu)),
      };
    }
  }
  return {
    ...contenu,
    methode: { ...contenu.methode, origine: origineMethode(contenu.methode) },
    modifiable: v.cabinet_id !== null && v.statut === "brouillon",
    differences,
  };
}

export async function comparerVersions(db: Db, versionId: string, avecId: string) {
  const a = await lireContenu(db, avecId);
  const b = await lireContenu(db, versionId);
  return {
    avant: { id: a.version.id, version: a.version.version, methode: a.methode.libelle },
    apres: { id: b.version.id, version: b.version.version, methode: b.methode.libelle },
    differences: comparerContenus(sansIdentifiants(a), sansIdentifiants(b)),
  };
}

/** Analyse d'impact de la mise à jour du standard pour une variante (STD-03). */
export async function analyserMiseAJourVariante(db: Db, versionId: string) {
  const v = await lireVersion(db, versionId);
  const m = await lireMethode(db, v.methode_id);
  const maj = await miseAJourStandard(db, v, m.parent_id);
  if (!maj) return { disponible: false as const };
  const base = sansIdentifiants(await lireContenu(db, maj.base.id));
  const variante = sansIdentifiants(await lireContenu(db, versionId));
  const nouveau = sansIdentifiants(await lireContenu(db, maj.disponible.id));
  const fusion = fusionnerVariante(base, variante, nouveau);
  return {
    disponible: true as const,
    base: maj.base,
    standard: maj.disponible,
    evolutions_standard: comparerContenus(base, nouveau),
    ecarts_cabinet: comparerContenus(base, variante),
    conflits: fusion.conflits,
    repris: fusion.repris,
  };
}

export async function validerVersionStockee(db: Db, versionId: string) {
  const contenu = await lireContenu(db, versionId);
  const base = contenu.version.base_standard_id
    ? sansIdentifiants(await lireContenu(db, contenu.version.base_standard_id))
    : null;
  return validerVersion(sansIdentifiants(contenu), await lireFacteurs(db), base);
}

/** Publication : brouillon du cabinet, cohérent, notes de version dès la version 2. */
export async function publierVersion(db: Db, auth: Auth, versionId: string) {
  const v = await exigerBrouillonDuCabinet(db, versionId);
  // Variante : quatre yeux (le créateur de la version ne la publie pas, sauf associé) ; doublé en base (MPM08).
  if (v.base_standard_id && v.cree_par === auth.utilisateurId && !auth.roles.includes("associe")) {
    throw separationVariante();
  }
  if (v.version > 1 && !v.notes_version) {
    throw new AppError(
      409,
      "NOTES_VERSION_REQUISES",
      "Rédiger les notes de version avant de publier.",
    );
  }
  const validation = await validerVersionStockee(db, versionId);
  if (!validation.valide) {
    const premiere = validation.anomalies.find((a) => a.gravite === "erreur");
    throw new AppError(
      409,
      "VERSION_INCOHERENTE",
      `Publication refusée : ${premiere?.message ?? "version incohérente"} (${premiere?.chemin ?? ""}).`,
    );
  }
  await db.query(
    `UPDATE methode_versions SET statut = 'publiee', publie_par = $2, publie_le = now() WHERE id = $1`,
    [versionId, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "standard.version.publier",
    entite: "methode_version",
    entiteId: versionId,
    details: { methode_id: v.methode_id, version: v.version },
  });
  const publiee = await lireVersion(db, versionId);
  if (!publiee) throw introuvable("Version de méthode");
  return { ...publiee, validation };
}
