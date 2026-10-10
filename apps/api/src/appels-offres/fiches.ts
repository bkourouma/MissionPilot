import {
  PROFIL_COMPETENCES_MAX,
  PROFIL_REFERENCES_MAX,
  rapprocherAppelOffres,
  transitionAppelOffresAutorisee,
  type ProfilCabinet,
  type Rapprochement,
  type StatutAppelOffres,
} from "@missionpilot/engines";
import type {
  AppelOffresCreation,
  AppelOffresModification,
  AppelsOffresImport,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { authDe } from "../collaboration/entites.js";
import type { Db } from "../db/pool.js";
import { conflit, introuvable, requeteInvalide } from "../errors.js";

/*
 * Fiches d'appels d'offres (AO-01) : saisie et import MANUELS (aucun connecteur, aucun appel
 * réseau), rapprochement déterministe avec le profil du cabinet par le moteur, cycle de vie
 * tracé en ajout seul. Les fiches sont une donnée commerciale du CABINET : tout détenteur de
 * `ao.lire` les voit (comme le pipeline) ; rien n'est ouvert au portail client.
 *
 * Profil du cabinet lu pour le rapprochement : compétences et secteurs des collaborateurs actifs,
 * références = missions signées (secteur de la mission ou du client, pays du client) et appels
 * d'offres gagnés (secteur, pays, bailleur). Seuls des COMPTES sortent du rapprochement : aucun
 * intitulé de mission n'est exposé (visibilité des missions, SOC-02).
 */

export const COLONNES_AO = `a.id, a.reference, a.titre, a.objet, a.bailleur, a.pays, a.secteur,
  a.montant_estime, a.devise, a.date_publication::text AS date_publication,
  a.date_limite::text AS date_limite, a.source, a.source_libelle, a.url, a.mots_cles, a.statut,
  a.score_rapprochement, a.rapprochement, a.responsable_id, r.nom AS responsable_nom, a.cree_par,
  a.cree_le, a.modifie_le`;
export const DEPUIS_AO = "appels_offres a LEFT JOIN utilisateurs r ON r.id = a.responsable_id";
export const CLE_TRI_AO = `to_char(a.cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface FicheAo extends Record<string, unknown> {
  id: string;
  titre: string;
  statut: StatutAppelOffres;
  date_limite: string | null;
  score_rapprochement: number;
}

/** Ligne SQL → réponse (montant en nombre : bigint lu en texte par pg). */
export function vueFiche<T extends Record<string, unknown>>(ligne: T): T {
  const m = ligne.montant_estime;
  return { ...ligne, montant_estime: m === null || m === undefined ? null : Number(m) };
}

export async function lireFiche(db: Db, id: string, verrouiller = false): Promise<FicheAo> {
  const r = await db.query(
    `SELECT ${COLONNES_AO} FROM ${DEPUIS_AO} WHERE a.id = $1 ${verrouiller ? "FOR UPDATE OF a" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Appel d'offres");
  return vueFiche(r.rows[0] as FicheAo);
}

/** Profil du cabinet pour le rapprochement (AO-01), borné. */
export async function lireProfilCabinet(db: Db): Promise<ProfilCabinet> {
  const collab = await db.query(
    `SELECT competences, secteurs FROM collaborateurs WHERE actif
     ORDER BY cree_le DESC, id DESC LIMIT $1`,
    [PROFIL_COMPETENCES_MAX],
  );
  const missions = await db.query(
    `SELECT coalesce(m.secteur, c.secteur) AS secteur, c.pays::text AS pays
     FROM missions m JOIN clients c ON c.id = m.client_id
     WHERE m.statut IN ('signee', 'en_cours', 'a_cloturer', 'cloturee')
     ORDER BY m.cree_le DESC, m.id DESC LIMIT $1`,
    [PROFIL_REFERENCES_MAX],
  );
  const gagnes = await db.query(
    `SELECT secteur, pays, bailleur FROM appels_offres WHERE statut = 'gagne'
     ORDER BY cree_le DESC, id DESC LIMIT $1`,
    [PROFIL_REFERENCES_MAX],
  );
  const competences = new Set<string>();
  const secteurs = new Set<string>();
  for (const c of collab.rows as { competences: string[]; secteurs: string[] }[]) {
    c.competences.forEach((x) => competences.add(x));
    c.secteurs.forEach((x) => secteurs.add(x));
  }
  return {
    competences: [...competences].slice(0, PROFIL_COMPETENCES_MAX),
    secteurs: [...secteurs],
    references: [
      ...(missions.rows as { secteur: string | null; pays: string | null }[]).map((m) => ({
        secteur: m.secteur,
        pays: m.pays,
        bailleur: null,
      })),
      ...(gagnes.rows as {
        secteur: string | null;
        pays: string | null;
        bailleur: string | null;
      }[]),
    ].slice(0, PROFIL_REFERENCES_MAX),
  };
}

type ChampsFiche = AppelOffresCreation;

function rapprocher(f: ChampsFiche, profil: ProfilCabinet): Rapprochement {
  return rapprocherAppelOffres(
    {
      titre: f.titre,
      objet: f.objet ?? null,
      secteur: f.secteur ?? null,
      pays: f.pays ?? null,
      bailleur: f.bailleur ?? null,
      motsCles: f.mots_cles ?? [],
    },
    profil,
  );
}

/** Responsable désigné : utilisateur ACTIF du cabinet (le déclencheur refuse le portail). */
async function exigerResponsable(db: Db, auth: Auth, id: string | null | undefined) {
  if (!id) return;
  if (!(await authDe(db, auth.cabinetId, id))) {
    throw requeteInvalide("Responsable inconnu ou inactif.");
  }
}

async function inserer(
  db: Db,
  auth: Auth,
  f: ChampsFiche,
  source: "saisie" | "import",
  profil: ProfilCabinet,
  sourceLibelle: string | null,
): Promise<string> {
  const rap = rapprocher(f, profil);
  const r = await db.query(
    `INSERT INTO appels_offres (cabinet_id, reference, titre, objet, bailleur, pays, secteur,
       montant_estime, devise, date_publication, date_limite, source, source_libelle, url,
       mots_cles, score_rapprochement, rapprochement, responsable_id, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     RETURNING id`,
    [
      auth.cabinetId,
      f.reference ?? null,
      f.titre,
      f.objet ?? null,
      f.bailleur ?? null,
      f.pays ?? null,
      f.secteur ?? null,
      f.montant_estime ?? null,
      f.devise ?? "XOF",
      f.date_publication ?? null,
      f.date_limite ?? null,
      source,
      f.source_libelle ?? sourceLibelle,
      f.url ?? null,
      f.mots_cles ?? [],
      rap.score,
      JSON.stringify(rap),
      f.responsable_id ?? null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await db.query(
    `INSERT INTO appels_offres_evenements (cabinet_id, ao_id, de_statut, vers_statut, auteur_id)
     VALUES ($1, $2, NULL, 'detecte', $3)`,
    [auth.cabinetId, id, auth.utilisateurId],
  );
  return id;
}

export async function creerFiche(db: Db, auth: Auth, f: AppelOffresCreation): Promise<FicheAo> {
  await exigerResponsable(db, auth, f.responsable_id);
  const id = await inserer(db, auth, f, "saisie", await lireProfilCabinet(db), null);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "appel_offres",
    entiteId: id,
    details: { source: "saisie" },
  });
  return lireFiche(db, id);
}

/**
 * Import manuel d'un lot (AO-01) : une référence déjà connue (ou répétée dans le lot) est
 * IGNORÉE et signalée ; le reste est créé dans la même transaction.
 */
export async function importerFiches(
  db: Db,
  auth: Auth,
  lot: AppelsOffresImport,
): Promise<{ crees: string[]; ignores: { rang: number; reference: string }[] }> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `ao_import:${auth.cabinetId}`,
  ]);
  for (const f of lot.fiches) await exigerResponsable(db, auth, f.responsable_id);
  const references = lot.fiches
    .map((f) => f.reference?.toLowerCase())
    .filter((x): x is string => !!x);
  const existantes = new Set(
    (
      await db.query(
        "SELECT lower(reference) AS r FROM appels_offres WHERE lower(reference) = ANY($1::text[])",
        [references],
      )
    ).rows.map((x) => x.r as string),
  );
  const profil = await lireProfilCabinet(db);
  const crees: string[] = [];
  const ignores: { rang: number; reference: string }[] = [];
  for (const [rang, f] of lot.fiches.entries()) {
    const ref = f.reference?.toLowerCase();
    if (ref && existantes.has(ref)) {
      ignores.push({ rang, reference: f.reference as string });
      continue;
    }
    if (ref) existantes.add(ref);
    crees.push(await inserer(db, auth, f, "import", profil, lot.source_libelle ?? null));
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "import",
    entite: "appel_offres",
    details: { crees: crees.length, ignores: ignores.length },
  });
  return { crees, ignores };
}

const CHAMPS_MODIFIABLES = [
  "reference",
  "titre",
  "objet",
  "bailleur",
  "pays",
  "secteur",
  "montant_estime",
  "devise",
  "date_publication",
  "date_limite",
  "source_libelle",
  "url",
  "mots_cles",
  "responsable_id",
] as const;

/** Modification d'une fiche encore ouverte ; le rapprochement est recalculé. */
export async function modifierFiche(
  db: Db,
  auth: Auth,
  id: string,
  m: AppelOffresModification,
): Promise<FicheAo> {
  const fiche = await lireFiche(db, id, true);
  if (!["detecte", "go_no_go", "en_reponse"].includes(fiche.statut)) {
    throw conflit("Un appel d'offres clos ne se modifie plus.");
  }
  if (m.responsable_id !== undefined) await exigerResponsable(db, auth, m.responsable_id);
  const fusion = { ...fiche } as Record<string, unknown>;
  for (const c of CHAMPS_MODIFIABLES) if (m[c] !== undefined) fusion[c] = m[c];
  const rap = rapprocher(fusion as unknown as ChampsFiche, await lireProfilCabinet(db));
  await db.query(
    `UPDATE appels_offres SET reference = $2, titre = $3, objet = $4, bailleur = $5, pays = $6,
       secteur = $7, montant_estime = $8, devise = $9, date_publication = $10, date_limite = $11,
       source_libelle = $12, url = $13, mots_cles = $14, responsable_id = $15,
       score_rapprochement = $16, rapprochement = $17, modifie_le = now()
     WHERE id = $1`,
    [
      id,
      fusion.reference ?? null,
      fusion.titre,
      fusion.objet ?? null,
      fusion.bailleur ?? null,
      fusion.pays ?? null,
      fusion.secteur ?? null,
      fusion.montant_estime ?? null,
      fusion.devise,
      fusion.date_publication ?? null,
      fusion.date_limite ?? null,
      fusion.source_libelle ?? null,
      fusion.url ?? null,
      fusion.mots_cles ?? [],
      fusion.responsable_id ?? null,
      rap.score,
      JSON.stringify(rap),
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "modification",
    entite: "appel_offres",
    entiteId: id,
    details: { champs: CHAMPS_MODIFIABLES.filter((c) => m[c] !== undefined) },
  });
  return lireFiche(db, id);
}

/**
 * Change le statut d'une fiche (verrouillée par l'appelant), trace l'événement et journalise.
 * La transition est vérifiée par le moteur puis par le déclencheur (MPA02 à MPA04).
 */
export async function changerStatut(
  db: Db,
  auth: Auth,
  fiche: FicheAo,
  vers: StatutAppelOffres,
  motif: string | null,
): Promise<void> {
  if (!transitionAppelOffresAutorisee(fiche.statut, vers)) {
    throw conflit(`Passage de « ${fiche.statut} » à « ${vers} » non admis.`);
  }
  await db.query("UPDATE appels_offres SET statut = $2, modifie_le = now() WHERE id = $1", [
    fiche.id,
    vers,
  ]);
  await db.query(
    `INSERT INTO appels_offres_evenements (cabinet_id, ao_id, de_statut, vers_statut, motif,
       auteur_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.cabinetId, fiche.id, fiche.statut, vers, motif, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "changement_statut",
    entite: "appel_offres",
    entiteId: fiche.id,
    details: { de: fiche.statut, vers },
  });
  fiche.statut = vers;
}

export async function evenementsDeFiche(db: Db, id: string) {
  const r = await db.query(
    `SELECT e.id, e.de_statut, e.vers_statut, e.motif, e.auteur_id, u.nom AS auteur_nom, e.cree_le
     FROM appels_offres_evenements e JOIN utilisateurs u ON u.id = e.auteur_id
     WHERE e.ao_id = $1 ORDER BY e.cree_le, e.id`,
    [id],
  );
  return r.rows;
}
