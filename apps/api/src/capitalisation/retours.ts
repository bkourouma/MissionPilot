import type {
  OrigineRetour,
  RetourVersion,
  retourValidationSchema,
  retoursQuerySchema,
} from "@missionpilot/shared";
import { aPermission } from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, interdit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  estAssocie,
  exigerMissionVisible,
  filtreVisibilite,
  voitToutesLesMissions,
  type MissionAcces,
} from "../missions/acces.js";
import { actualiserPreuvesCompetences } from "./competences.js";
import { chargerFaitsRetour, type FaitsRetour } from "./donnees.js";
import { donneesVersion, gabaritRetour } from "./gabarit.js";

/*
 * Retour d'expérience (CAP-01). Ouvert à la clôture (mission « à clôturer » ou « clôturée ») avec
 * un brouillon DÉTERMINISTE construit depuis les données de la mission (gabarit.ts) ; amélioré
 * par l'IA à la demande (ia.ts) ou réécrit par le chef de mission (nouvelle version, ajout seul) ;
 * VALIDÉ par le chef ou le directeur de la mission, ou un associé : la version validée est versée
 * à la base de connaissances, et ses temps par brique à la base d'estimation (CAP-02) ; les
 * preuves d'usage des compétences de l'équipe sont relevées (CAP-06).
 *
 * Droits : lire = mission visible (la route exige `connaissance.lire`) ; ouvrir, rédiger, valider
 * = responsable de la mission (chef, directeur) ou associé (la route exige `mission.planifier`).
 */

const ETATS_OUVERTURE = ["a_cloturer", "cloturee"];

export interface RetourIdentite {
  id: string;
  mission_id: string;
  statut: "brouillon" | "valide";
  version_validee: number | null;
  valide_par: string | null;
  valide_le: string | null;
  ouvert_par: string;
  ouvert_le: string;
}

/** Chef ou directeur de la mission, ou associé : rédige et valide le retour d'expérience. */
export function estResponsableMission(auth: Auth, mission: MissionAcces): boolean {
  return (
    estAssocie(auth) ||
    mission.chef_id === auth.utilisateurId ||
    mission.directeur_id === auth.utilisateurId
  );
}

async function inscrireVersion(
  db: Db,
  auth: Auth,
  retourId: string,
  origine: OrigineRetour,
  contenu: RetourVersion,
  donnees: Record<string, unknown>,
  iaDemandeId: string | null = null,
): Promise<number> {
  const r = await db.query(
    `INSERT INTO retour_experience_versions (cabinet_id, retour_id, version, origine, contexte,
       methode, ecarts, lecons, donnees, ia_demande_id, cree_par)
     SELECT $1, $2, coalesce(max(version), 0) + 1, $3, $4, $5, $6, $7, $8, $9, $10
       FROM retour_experience_versions WHERE retour_id = $2
     RETURNING version`,
    [
      auth.cabinetId,
      retourId,
      origine,
      contenu.contexte,
      contenu.methode,
      contenu.ecarts,
      contenu.lecons,
      JSON.stringify(donnees),
      iaDemandeId,
      auth.utilisateurId,
    ],
  );
  return r.rows[0].version as number;
}

async function identite(db: Db, id: string, verrouiller = false): Promise<RetourIdentite> {
  const r = await db.query(
    `SELECT id, mission_id, statut, version_validee, valide_par, valide_le, ouvert_par, ouvert_le
     FROM retours_experience WHERE id = $1 ${verrouiller ? "FOR UPDATE" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Retour d'expérience");
  return r.rows[0] as RetourIdentite;
}

/** Retour visible (mission visible), sinon 404 ; `verrouiller` sérialise les écritures. */
export async function exigerRetourVisible(db: Db, auth: Auth, id: string, verrouiller = false) {
  const retour = await identite(db, id, verrouiller);
  let mission: MissionAcces;
  try {
    mission = await exigerMissionVisible(db, auth, retour.mission_id);
  } catch (e) {
    throw e instanceof AppError && e.statut === 404 ? introuvable("Retour d'expérience") : e;
  }
  return { retour, mission };
}

/** Retour en brouillon dont l'utilisateur est responsable (403 sinon, 409 si validé). */
export async function exigerRetourRedigeable(db: Db, auth: Auth, id: string) {
  const { retour, mission } = await exigerRetourVisible(db, auth, id, true);
  if (!estResponsableMission(auth, mission)) throw interdit();
  if (retour.statut !== "brouillon") {
    throw new AppError(
      409,
      "RETOUR_VALIDE",
      "Le retour d'expérience est validé : il ne change plus.",
    );
  }
  return { retour, mission };
}

async function versions(db: Db, retourId: string) {
  const r = await db.query(
    `SELECT v.version, v.origine, v.contexte, v.methode, v.ecarts, v.lecons, v.donnees,
            v.ia_demande_id, v.cree_par, u.nom AS cree_par_nom, v.cree_le
     FROM retour_experience_versions v LEFT JOIN utilisateurs u ON u.id = v.cree_par
     WHERE v.retour_id = $1 ORDER BY v.version DESC`,
    [retourId],
  );
  return r.rows as (RetourVersion & {
    version: number;
    origine: OrigineRetour;
    donnees: Record<string, unknown>;
    cree_par_nom: string | null;
    cree_le: string;
  })[];
}

const statutContenu = (origine: OrigineRetour, valide: boolean) =>
  valide ? "valide" : origine === "humain" ? "modifie" : "brouillon_ia";

/**
 * Sans `budget.lire_jours` (expert métier : `connaissance.lire` seul), la section « Écarts »
 * (« Temps réel validé : X pour un budget de Y », jours par brique) et les faits chiffrés de la
 * trace (`donnees.temps`, `donnees.ecarts`) sont ABSENTS de la réponse, jamais masqués.
 */
function sansJours<T extends { ecarts?: string; donnees: Record<string, unknown> }>(v: T) {
  const reste: Partial<T> = { ...v };
  delete reste.ecarts;
  const donnees = { ...v.donnees };
  delete donnees.temps;
  delete donnees.ecarts;
  return { ...(reste as Omit<T, "ecarts" | "donnees">), donnees };
}

/** Détail : identité, mission, version courante, version validée et historique (sans texte). */
export async function detailRetour(db: Db, auth: Auth, retour: RetourIdentite) {
  const avecJours = aPermission(auth.roles, "budget.lire_jours");
  const m = await db.query(
    `SELECT m.intitule, m.statut, c.raison_sociale AS client FROM missions m
     JOIN clients c ON c.id = m.client_id WHERE m.id = $1`,
    [retour.mission_id],
  );
  const liste = await versions(db, retour.id);
  const courante = liste[0] ?? null;
  const validee = liste.find((v) => v.version === retour.version_validee) ?? null;
  const vue = (v: (typeof liste)[number] | null) =>
    v && {
      ...(avecJours ? v : sansJours(v)),
      statut_contenu: statutContenu(v.origine, v.version === retour.version_validee),
      chiffres_non_verifies: v.donnees.chiffres_non_verifies === true,
    };
  return {
    ...retour,
    mission: { id: retour.mission_id, ...m.rows[0] },
    version_courante: vue(courante),
    version_validee_contenu: vue(validee),
    historique: liste.map((v) => ({
      version: v.version,
      origine: v.origine,
      statut_contenu: statutContenu(v.origine, v.version === retour.version_validee),
      cree_par_nom: v.cree_par_nom,
      cree_le: v.cree_le,
    })),
  };
}

/**
 * SERVICE INTERNE (clôture, automatisation) : ouvre le retour d'expérience d'une mission « à
 * clôturer » ou « clôturée » avec le brouillon du gabarit ; idempotent (rend le retour existant).
 * Vérifie la visibilité de la mission ; l'appelant a vérifié la permission de son action.
 * S'exécute dans la transaction `withTenant` de l'appelant.
 */
export async function ouvrirRetourExperience(db: Db, auth: Auth, missionId: string) {
  const mission = await exigerMissionVisible(db, auth, missionId, true);
  if (!ETATS_OUVERTURE.includes(mission.statut)) {
    throw new AppError(
      409,
      "MISSION_NON_CLOTUREE",
      "Le retour d'expérience s'ouvre à la clôture de la mission.",
    );
  }
  const existant = await db.query(`SELECT id FROM retours_experience WHERE mission_id = $1`, [
    missionId,
  ]);
  if (existant.rows[0])
    return detailRetour(db, auth, await identite(db, existant.rows[0].id as string));
  const r = await db.query(
    `INSERT INTO retours_experience (cabinet_id, mission_id, ouvert_par) VALUES ($1, $2, $3)
     RETURNING id`,
    [auth.cabinetId, missionId, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  const faits = await chargerFaitsRetour(db, missionId);
  await inscrireVersion(db, auth, id, "gabarit", gabaritRetour(faits), donneesVersion(faits));
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.retour.ouvrir",
    entite: "retour_experience",
    entiteId: id,
    details: { mission_id: missionId },
  });
  return detailRetour(db, auth, await identite(db, id));
}

export async function lireRetourMission(db: Db, auth: Auth, missionId: string) {
  await exigerMissionVisible(db, auth, missionId);
  const r = await db.query(`SELECT id FROM retours_experience WHERE mission_id = $1`, [missionId]);
  if (!r.rows[0]) return { retour: null };
  return { retour: await detailRetour(db, auth, await identite(db, r.rows[0].id as string)) };
}

export async function lireRetour(db: Db, auth: Auth, id: string) {
  const { retour } = await exigerRetourVisible(db, auth, id);
  return detailRetour(db, auth, retour);
}

/** Nouvelle version rédigée par le responsable de la mission. */
export async function ajouterVersion(db: Db, auth: Auth, id: string, contenu: RetourVersion) {
  const { retour } = await exigerRetourRedigeable(db, auth, id);
  const [precedente] = await versions(db, id);
  const donnees = { ...(precedente?.donnees ?? {}) };
  delete donnees.chiffres_non_verifies;
  delete donnees.nombres_non_verifies;
  const version = await inscrireVersion(db, auth, id, "humain", contenu, donnees);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.retour.rediger",
    entite: "retour_experience",
    entiteId: id,
    details: { version },
  });
  return detailRetour(db, auth, retour);
}

/** Inscrit une version issue d'une génération IA (ou de son repli), dans la transaction `db`. */
export async function inscrireVersionGeneree(
  db: Db,
  auth: Auth,
  id: string,
  v: {
    origine: OrigineRetour;
    contenu: RetourVersion;
    donnees: Record<string, unknown>;
    demandeId: string;
  },
) {
  const { retour } = await exigerRetourRedigeable(db, auth, id);
  const version = await inscrireVersion(db, auth, id, v.origine, v.contenu, v.donnees, v.demandeId);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.retour.generer_ia",
    entite: "retour_experience",
    entiteId: id,
    details: { version, demande_id: v.demandeId, origine: v.origine },
  });
  return detailRetour(db, auth, retour);
}

/** Observations de la base d'estimation (CAP-02), une par brique ayant des tâches rattachées. */
async function verserBaseEstimation(db: Db, auth: Auth, retour: RetourIdentite, f: FaitsRetour) {
  const typeDe = new Map((f.methode?.briques ?? []).map((b) => [b.code, b.temps_type_centiemes]));
  for (const b of f.temps.briques) {
    await db.query(
      `INSERT INTO cap_temps_briques (cabinet_id, mission_id, retour_id, brique_code, methode_code,
         realise_centiemes, budget_centiemes, temps_type_centiemes, contexte)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (mission_id, brique_code) DO NOTHING`,
      [
        auth.cabinetId,
        retour.mission_id,
        retour.id,
        b.brique_code,
        f.methode?.code ?? null,
        b.realise_centiemes,
        b.budget_centiemes,
        typeDe.get(b.brique_code) ?? null,
        JSON.stringify(f.contexte),
      ],
    );
  }
  return f.temps.briques.length;
}

export async function validerRetour(
  db: Db,
  auth: Auth,
  id: string,
  corps: z.infer<typeof retourValidationSchema>,
) {
  const { retour } = await exigerRetourRedigeable(db, auth, id);
  const v = (await versions(db, id)).find((x) => x.version === corps.version);
  if (!v) throw introuvable("Version");
  if (v.donnees.chiffres_non_verifies === true && !corps.acquitte_chiffres) {
    throw new AppError(
      409,
      "CHIFFRES_A_ACQUITTER",
      "Des nombres de cette version ne viennent pas des moteurs : relisez-les puis acquittez.",
    );
  }
  // Le déclencheur MPJ08 (0465) vérifie que le valideur est l'utilisateur de la session et un
  // responsable de la mission (chef, directeur, associé). Exception voulue, conforme au PRD :
  // le chef peut valider la version IA qu'il a lui-même demandée (l'IA propose, l'expert dispose).
  await db.query("SELECT set_config('app.utilisateur_id', $1, true)", [auth.utilisateurId]);
  await db.query(
    `UPDATE retours_experience SET statut = 'valide', version_validee = $2, valide_par = $3,
       valide_le = now() WHERE id = $1`,
    [id, corps.version, auth.utilisateurId],
  );
  const faits = await chargerFaitsRetour(db, retour.mission_id);
  const observations = await verserBaseEstimation(db, auth, retour, faits);
  const preuves = await actualiserPreuvesCompetences(db, retour.mission_id);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.retour.valider",
    entite: "retour_experience",
    entiteId: id,
    details: {
      version: corps.version,
      acquitte_chiffres: corps.acquitte_chiffres,
      observations_estimation: observations,
      preuves_competences: preuves,
    },
  });
  return detailRetour(db, auth, await identite(db, id));
}

const HORODATAGE_PG =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Curseur dont la première clé est un horodatage PostgreSQL (`ouvert_le::text`) : la date est
 * validée ICI (400), sinon le `::timestamptz` de la requête lèverait une erreur de base (500).
 */
export function decoderCurseurHorodate(curseur: string | undefined): [string, string] | null {
  const c = decoderCurseur(curseur);
  if (c === null) return null;
  const m = HORODATAGE_PG.exec(c[0]);
  const [annee, mois, jour, h, mn, s] = (m ?? []).slice(1).map(Number);
  const d = new Date(0);
  if (annee !== undefined && mois !== undefined && jour !== undefined) {
    d.setUTCFullYear(annee, mois - 1, jour);
  }
  const valide =
    m !== null &&
    annee! >= 1900 &&
    annee! <= 2200 &&
    d.getUTCFullYear() === annee &&
    d.getUTCMonth() === mois! - 1 &&
    d.getUTCDate() === jour &&
    h! <= 23 &&
    mn! <= 59 &&
    s! <= 59;
  if (!valide) throw requeteInvalide("Curseur de pagination invalide.");
  return c;
}

/** Retours d'expérience des missions visibles (base de connaissances), plus récents d'abord. */
export async function listerRetours(db: Db, auth: Auth, q: z.infer<typeof retoursQuerySchema>) {
  const curseur = decoderCurseurHorodate(q.curseur);
  const r = await db.query(
    `SELECT r.id, r.mission_id, m.intitule AS mission_intitule, c.raison_sociale AS client,
            r.statut, r.version_validee, r.valide_le, r.ouvert_le, r.ouvert_le::text AS cle_tri
     FROM retours_experience r JOIN missions m ON m.id = r.mission_id
     JOIN clients c ON c.id = m.client_id
     WHERE ${filtreVisibilite(1, 2)} AND ($3::text IS NULL OR r.statut = $3)
       AND ($4::timestamptz IS NULL OR (r.ouvert_le, r.id) < ($4::timestamptz, $5::uuid))
     ORDER BY r.ouvert_le DESC, r.id DESC
     LIMIT $6`,
    [
      voitToutesLesMissions(auth),
      auth.utilisateurId,
      q.statut ?? null,
      curseur?.[0] ?? null,
      curseur?.[1] ?? null,
      q.limite + 1,
    ],
  );
  return paginer(r.rows, q.limite);
}
