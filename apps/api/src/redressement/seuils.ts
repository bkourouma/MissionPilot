import { validerSeuilsAlerte, SEUILS_ALERTE_DEFAUT } from "@missionpilot/engines";
import {
  aPermission,
  RED_SECTEURS,
  type RedSecteur,
  type RedSeuils,
  type RedSeuilsCreation,
  type RedSeuilsEtatVue,
  type RedSeuilsVersionVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { estAssocie } from "../missions/acces.js";
import { journalRed } from "./journal.js";
import { DEBIT_SEUILS, verifierDebit } from "./limites.js";
import { iso, isoOuVide, personne, seuilsDepuisJson, seuilsVersJson } from "./vues.js";

/*
 * Seuils d'alerte par secteur (RED-10), fixés par les experts du cabinet et VERSIONNÉS : une version
 * est rédigée (brouillon) par un détenteur de `redressement.parametrer`, puis PUBLIÉE par un expert
 * métier ou un associé qui n'en est pas l'auteur (sauf associé) : séparation des tâches contrôlée
 * ici ET par la base (MPZ07). La version en vigueur d'un secteur est la plus haute version publiée ;
 * sans version publiée, le moteur applique ses valeurs par défaut (PROVISOIRES, DECISIONS.md). Les
 * scores déjà calculés ne changent jamais (ils conservent l'instantané de leurs seuils).
 */

export interface SeuilsEnVigueur {
  source: "cabinet" | "defaut_moteur";
  versionId: string | null;
  version: number | null;
  /** JSON snake_case tel que stocké : l'instantané d'un score le recopie à l'identique. */
  json: RedSeuils;
}

const COLONNES = `s.id, s.secteur, s.version, s.statut, s.seuils, s.motif, s.cree_par, uc.nom AS cree_par_nom,
  s.cree_le, s.publiee_par, up.nom AS publiee_par_nom, s.publiee_le`;
const JOINTURES = `FROM red_seuils_versions s
  JOIN utilisateurs uc ON uc.id = s.cree_par
  LEFT JOIN utilisateurs up ON up.id = s.publiee_par`;

function vue(l: Record<string, unknown>): RedSeuilsVersionVue {
  return {
    id: l.id as string,
    secteur: l.secteur as RedSecteur,
    version: l.version as number,
    statut: l.statut as RedSeuilsVersionVue["statut"],
    seuils: l.seuils as RedSeuils,
    motif: (l.motif as string | null) ?? null,
    cree_par: personne(l.cree_par as string, l.cree_par_nom as string),
    cree_le: isoOuVide(l.cree_le as Date),
    publiee_par: l.publiee_par
      ? personne(l.publiee_par as string, l.publiee_par_nom as string)
      : null,
    publiee_le: iso(l.publiee_le as Date | null),
  };
}

/** Peut publier cette version : brouillon, rôle d'expert métier ou d'associé, jamais l'auteur (sauf associé). */
function peutPublier(auth: Auth, v: { statut: string; cree_par: string }): boolean {
  return (
    v.statut === "brouillon" &&
    aPermission(auth.roles, "redressement.parametrer") &&
    (auth.roles.includes("expert_metier") || estAssocie(auth)) &&
    (v.cree_par !== auth.utilisateurId || estAssocie(auth))
  );
}

/** Route 13 : état des seuils par secteur (en vigueur, brouillon à publier, historique). */
export async function lireSeuils(
  db: Db,
  auth: Auth,
  secteur: RedSecteur | undefined,
): Promise<RedSeuilsEtatVue> {
  const r = await db.query(
    `SELECT ${COLONNES} ${JOINTURES} WHERE ($1::text IS NULL OR s.secteur = $1)
     ORDER BY s.secteur, s.version DESC LIMIT 400`,
    [secteur ?? null],
  );
  const lignes = r.rows as Record<string, unknown>[];
  const secteurs = (secteur ? [secteur] : [...RED_SECTEURS]).map((s) => {
    const versions = lignes.filter((l) => l.secteur === s);
    const derniere = versions[0];
    const brouillon = derniere && derniere.statut === "brouillon" ? derniere : null;
    const enVigueur = versions.find((l) => l.statut === "publiee");
    return {
      secteur: s,
      en_vigueur: enVigueur ? vue(enVigueur) : null,
      brouillon: brouillon ? vue(brouillon) : null,
      historique: versions.map(vue),
      peut_publier: brouillon
        ? peutPublier(auth, { statut: "brouillon", cree_par: brouillon.cree_par as string })
        : false,
    };
  });
  return { secteurs, defaut_moteur: seuilsVersJson(SEUILS_ALERTE_DEFAUT) };
}

async function verrouillerSecteur(db: Db, cabinetId: string, secteur: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `redressement_seuils:${cabinetId}:${secteur}`,
  ]);
}

/** Route 14 : nouvelle version (brouillon). Le moteur revalide toutes les règles des seuils. */
export async function creerSeuils(
  db: Db,
  auth: Auth,
  corps: RedSeuilsCreation,
): Promise<RedSeuilsVersionVue> {
  validerSeuilsAlerte(seuilsDepuisJson(corps.seuils));
  await verrouillerSecteur(db, auth.cabinetId, corps.secteur);
  await verifierDebit(db, auth, DEBIT_SEUILS);
  // Un seul brouillon à la fois par secteur (doublé en base, MPZ06) : les 50 versions d'un secteur
  // ne s'épuisent pas en brouillons, et la publication vise toujours la dernière version.
  const enCours = await db.query(
    `SELECT 1 FROM red_seuils_versions s WHERE s.secteur = $1 AND s.statut = 'brouillon' LIMIT 1`,
    [corps.secteur],
  );
  if ((enCours.rowCount ?? 0) > 0) {
    throw new AppError(
      409,
      "RED_SEUILS_BROUILLON_EN_COURS",
      "Un brouillon de seuils est déjà en cours pour ce secteur : publiez-le avant d'en rédiger un autre.",
    );
  }
  const v = await db.query(
    `SELECT coalesce(max(version), 0) + 1 AS suivante FROM red_seuils_versions WHERE secteur = $1`,
    [corps.secteur],
  );
  const version = v.rows[0].suivante as number;
  // Forme normalisée : les clés sont celles du moteur, jamais celles d'un client.
  const seuils = seuilsVersJson(seuilsDepuisJson(corps.seuils));
  const r = await db.query(
    `INSERT INTO red_seuils_versions (cabinet_id, secteur, version, seuils, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      auth.cabinetId,
      corps.secteur,
      version,
      JSON.stringify(seuils),
      corps.motif ?? null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journalRed(db, auth, "red_seuils", "creation", id, { secteur: corps.secteur, version });
  return lireVersion(db, id);
}

async function lireVersion(db: Db, id: string): Promise<RedSeuilsVersionVue> {
  const r = await db.query(`SELECT ${COLONNES} ${JOINTURES} WHERE s.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Version de seuils");
  return vue(r.rows[0] as Record<string, unknown>);
}

const separation = (message: string) => new AppError(403, "SEPARATION_DES_TACHES", message);

/** Route 15 : publication d'un brouillon, la dernière version du secteur, par un autre expert (ou un associé). */
export async function publierSeuils(db: Db, auth: Auth, id: string): Promise<RedSeuilsVersionVue> {
  const apercu = await db.query("SELECT secteur FROM red_seuils_versions WHERE id = $1", [id]);
  if (!apercu.rows[0]) throw introuvable("Version de seuils");
  const secteur = apercu.rows[0].secteur as string;
  await verrouillerSecteur(db, auth.cabinetId, secteur);
  const r = await db.query(
    `SELECT s.id, s.statut, s.version, s.cree_par,
       (SELECT max(x.version) FROM red_seuils_versions x WHERE x.secteur = s.secteur) AS derniere
     FROM red_seuils_versions s WHERE s.id = $1`,
    [id],
  );
  const l = r.rows[0] as
    { statut: string; version: number; cree_par: string; derniere: number } | undefined;
  if (!l) throw introuvable("Version de seuils");
  if (!(auth.roles.includes("expert_metier") || estAssocie(auth))) {
    throw separation("Les seuils sont publiés par un expert métier ou un associé.");
  }
  if (l.cree_par === auth.utilisateurId && !estAssocie(auth)) {
    throw separation("L'auteur de seuils ne les publie pas lui-même.");
  }
  if (l.statut !== "brouillon") {
    throw new AppError(
      409,
      "RED_SEUILS_NON_BROUILLON",
      "Cette version de seuils est déjà publiée.",
    );
  }
  if (l.version !== l.derniere) {
    throw new AppError(
      409,
      "RED_VERSION_NON_CONSECUTIVE",
      "Une version plus récente existe : seule la dernière version d'un secteur se publie.",
    );
  }
  await db.query(
    `UPDATE red_seuils_versions SET statut = 'publiee', publiee_par = $2, publiee_le = now() WHERE id = $1`,
    [id, auth.utilisateurId],
  );
  await journalRed(db, auth, "red_seuils", "publication", id, { secteur, version: l.version });
  return lireVersion(db, id);
}

/** Seuils en vigueur d'un secteur : version publiée la plus haute, sinon valeurs du moteur. */
export async function seuilsEnVigueur(db: Db, secteur: string): Promise<SeuilsEnVigueur> {
  const r = await db.query(
    `SELECT id, version, seuils FROM red_seuils_versions
     WHERE secteur = $1 AND statut = 'publiee' ORDER BY version DESC LIMIT 1`,
    [secteur],
  );
  const l = r.rows[0] as { id: string; version: number; seuils: RedSeuils } | undefined;
  if (!l) {
    return {
      source: "defaut_moteur",
      versionId: null,
      version: null,
      json: seuilsVersJson(SEUILS_ALERTE_DEFAUT),
    };
  }
  return { source: "cabinet", versionId: l.id, version: l.version, json: l.seuils };
}
