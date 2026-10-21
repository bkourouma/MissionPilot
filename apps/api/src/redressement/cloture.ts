import { createHash } from "node:crypto";
import {
  construireBilanCloture,
  projeterTresorerie,
  type BilanCloture,
  type EntreesBilanCloture,
  type LigneTresorerie,
  type NiveauAlerte,
  type ResultatTresorerie,
  type TresorerieCloture,
  type VoyantUrgence,
} from "@missionpilot/engines";
import {
  aPermission,
  RED_CLOTURES_MAX,
  redClotureContenuSchema,
  type RedClotureContenu,
  type RedClotureDossierResume,
  type RedClotureResume,
  type RedClotureValidation,
  type RedClotureVue,
  type RedCloturesListeVue,
  type RedStatutCloture,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { estAssocie } from "../missions/acces.js";
import { notationDeMission, resumeNotation } from "../notation/notations.js";
import {
  exigerDossierRedValidation,
  exigerDossierRedVisible,
  type AccesDossierRed,
  type DossierRed,
} from "./acces.js";
import { lireActionsDossier, versPlan } from "./actions.js";
import { causesValidees } from "./causes.js";
import { listerChecklists } from "./checklists.js";
import { DEBIT_CLOTURES } from "./cloture-limites.js";
import { evaluerCovenantsDossier } from "./covenants.js";
import { chargerCreanciers, situationDe } from "./creanciers.js";
import { dateDuJour } from "./dates.js";
import { journalRed } from "./journal.js";
import { verifierDebit } from "./limites.js";
import { contenuDepuisJson, exigerDirecteurDeMission, respecteReserveDirecteur } from "./plan.js";
import { calculerRatiosDossier } from "./ratios.js";
import { entreeMoteur, projectionCourante } from "./tresorerie.js";
import { isoOuVide, personne } from "./vues.js";

/*
 * Bilan de clôture du redressement (RED-08). Le contenu est CONSTRUIT par le moteur
 * `construireBilanCloture` depuis les sorties des autres moteurs du service, lues telles qu'elles
 * sont servies aux écrans (ratios, scores, urgences, trésorerie, plan, créanciers, covenants,
 * check-lists, notation publiée, causes validées) : aucun nombre n'est calculé ici, et rien ne vient
 * d'un client ni d'un modèle de langage.
 *
 * Une version est un instantané en ajout seul. Son empreinte (SHA-256 de la forme canonique, clés
 * triées) est recalculée à la VALIDATION sur l'état courant du dossier, à la date de référence de la
 * version : si l'état a changé depuis la construction, la validation est refusée (409
 * RED_CLOTURE_PERIMEE) et un nouveau bilan se construit. Le bilan s'établit AVANT la clôture du
 * dossier (la base refuse l'écriture d'un dossier clos, MPZ03).
 *
 * Ouverture et fin : ratios = exercice accepté le plus ancien et le plus récent parmi les trois que
 * le module lit (EXERCICES_RATIOS_MAX) ; scores d'alerte et urgences = premier et dernier ; trésorerie
 * = prévision de la première version sans réalisé et projection courante. Avec un seul élément,
 * l'ouverture est absente (comparaison impossible, contrôle « ouverture_comparable » non satisfait).
 *
 * Validation : RÉSERVÉE AU DIRECTEUR DE LA MISSION (même hypothèse métier que le plan,
 * VALIDATION_PLAN_RESERVEE_AU_DIRECTEUR dans plan.ts), associé ou directeur de mission, jamais le
 * créateur du bilan sauf associé (MPZ07), et seulement si les contrôles bloquants sont satisfaits
 * (409 RED_CLOTURE_INCOMPLETE, doublé en base MPZ18). Le journal ne porte que des identifiants et
 * des indicateurs, jamais une valeur du bilan.
 */

interface ClotureLue {
  id: string;
  dossier_id: string;
  version: number;
  date_reference: string;
  empreinte: string;
  complet: boolean;
  statut: RedStatutCloture;
  cree_par: string;
  cree_par_nom: string;
  cree_le: Date;
  valide_par: string | null;
  valide_par_nom: string | null;
  valide_le: Date | null;
  motif_validation: string | null;
  contenu?: unknown;
}

const COLONNES_SANS_CONTENU = `c.id, c.dossier_id, c.version, c.date_reference::text AS date_reference,
  c.empreinte, c.complet, c.statut, c.cree_par, uc.nom AS cree_par_nom, c.cree_le, c.valide_par,
  uv.nom AS valide_par_nom, c.valide_le, c.motif_validation`;
const JOINTURES = `FROM red_clotures c JOIN utilisateurs uc ON uc.id = c.cree_par
  LEFT JOIN utilisateurs uv ON uv.id = c.valide_par`;

/* ----- Empreinte ----- */

/** Forme canonique d'un contenu : JSON dont les clés sont triées à tous les niveaux. */
function canonique(valeur: unknown): string {
  if (Array.isArray(valeur)) return `[${valeur.map(canonique).join(",")}]`;
  if (valeur !== null && typeof valeur === "object") {
    const cles = Object.keys(valeur).sort();
    const corps = cles.map(
      (k) => `${JSON.stringify(k)}:${canonique((valeur as Record<string, unknown>)[k])}`,
    );
    return `{${corps.join(",")}}`;
  }
  return JSON.stringify(valeur) ?? "null";
}

/** SHA-256 de la forme canonique du contenu d'un bilan. */
export function empreinteBilan(contenu: unknown): string {
  return createHash("sha256").update(canonique(contenu), "utf8").digest("hex");
}

/* ----- Entrées du moteur : lectures des autres services ----- */

function syntheseTresorerie(p: ResultatTresorerie): TresorerieCloture {
  return {
    semainesTension: p.semainesTension.length,
    premiereSemaineTension: p.premiereSemaineTension,
    besoinFinancement: p.besoinFinancement,
    soldeMinimum: p.soldeMinimum.montant,
  };
}

interface PrevisionInitiale {
  date_debut: string;
  solde_initial: number;
  seuil_tension: number;
  lignes: LigneTresorerie[];
}

/** Première version de la prévision de trésorerie avec ses lignes, ou null. */
async function premiereVersionTresorerie(
  db: Db,
  dossierId: string,
): Promise<PrevisionInitiale | null> {
  const r = await db.query(
    `SELECT v.id, v.date_debut::text AS date_debut, v.solde_initial::text AS solde_initial,
       v.seuil_tension::text AS seuil_tension
     FROM red_tresorerie_versions v WHERE v.dossier_id = $1 ORDER BY v.version ASC LIMIT 1`,
    [dossierId],
  );
  const v = r.rows[0] as Record<string, unknown> | undefined;
  if (!v) return null;
  const lignes = await db.query(
    `SELECT l.semaine, l.sens, l.categorie, l.montant::text AS montant
     FROM red_tresorerie_lignes l WHERE l.version_id = $1 ORDER BY l.rang`,
    [v.id],
  );
  return {
    date_debut: v.date_debut as string,
    solde_initial: Number(v.solde_initial),
    seuil_tension: Number(v.seuil_tension),
    lignes: (lignes.rows as Record<string, unknown>[]).map((l) => ({
      semaine: l.semaine as number,
      sens: l.sens as "encaissement" | "decaissement",
      categorie: l.categorie as string,
      montant: Number(l.montant),
    })),
  };
}

/** Premier et dernier score d'alerte (un seul score : pas d'ouverture). */
async function bornesScores(db: Db, dossierId: string) {
  const colonnes = "s.score, s.niveau, s.date_reference::text AS date_reference";
  const nombre = await db.query("SELECT count(*)::int AS n FROM red_scores WHERE dossier_id = $1", [
    dossierId,
  ]);
  const lire = async (sens: "ASC" | "DESC") => {
    const r = await db.query(
      `SELECT ${colonnes} FROM red_scores s WHERE s.dossier_id = $1
       ORDER BY s.cree_le ${sens}, s.id ${sens} LIMIT 1`,
      [dossierId],
    );
    const l = r.rows[0] as
      { score: number | null; niveau: NiveauAlerte; date_reference: string } | undefined;
    return l ? { score: l.score, niveau: l.niveau, dateReference: l.date_reference } : null;
  };
  const fin = await lire("DESC");
  return { ouverture: (nombre.rows[0].n as number) >= 2 ? await lire("ASC") : null, fin };
}

/** Première et dernière évaluation d'urgence (une seule : pas d'ouverture). */
async function bornesUrgences(db: Db, dossierId: string) {
  const nombre = await db.query(
    "SELECT count(*)::int AS n FROM red_urgences WHERE dossier_id = $1",
    [dossierId],
  );
  const lire = async (sens: "ASC" | "DESC") => {
    const r = await db.query(
      `SELECT u.voyant, jsonb_array_length(u.resultat -> 'domaines_rouges') AS rouges
       FROM red_urgences u WHERE u.dossier_id = $1 ORDER BY u.cree_le ${sens}, u.id ${sens} LIMIT 1`,
      [dossierId],
    );
    const l = r.rows[0] as { voyant: VoyantUrgence; rouges: number } | undefined;
    return l ? { voyant: l.voyant, domainesRouges: l.rouges } : null;
  };
  const fin = await lire("DESC");
  return { ouverture: (nombre.rows[0].n as number) >= 2 ? await lire("ASC") : null, fin };
}

/** Entrées du moteur d'après l'état courant du dossier, à une date de référence donnée. */
async function entreesCourantes(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  dateReference: string,
): Promise<EntreesBilanCloture> {
  const calcul = await calculerRatiosDossier(db, dossier);
  const exercices = calcul.exercices;
  const fin = exercices[0]?.ratios ?? null;
  const ouverture =
    exercices.length >= 2 ? (exercices[exercices.length - 1]?.ratios ?? null) : null;

  const courante = await projectionCourante(db, dossier.id);
  const premiere = await premiereVersionTresorerie(db, dossier.id);
  const tresorerieOuverture = premiere
    ? syntheseTresorerie(
        projeterTresorerie(
          entreeMoteur(
            premiere.date_debut,
            premiere.solde_initial,
            premiere.seuil_tension,
            premiere.lignes,
            [],
          ),
        ),
      )
    : null;

  const actions = await lireActionsDossier(db, dossier.id);
  const valide = await db.query(
    `SELECT contenu FROM red_plan_versions WHERE dossier_id = $1 AND statut = 'valide'
     ORDER BY version DESC LIMIT 1`,
    [dossier.id],
  );
  const planValide = valide.rows[0]
    ? contenuDepuisJson(valide.rows[0].contenu).actions.length
    : null;

  const creanciers = (await chargerCreanciers(db, dossier.id, null, true)).flatMap((c) => {
    const s = situationDe(c, dateReference);
    return s
      ? [
          {
            encoursInitial: s.encoursInitial,
            encoursRestant: s.encoursRestant,
            echu: s.echu,
            remise: s.accord?.remise ?? 0,
            totalPaye: s.accord?.totalPaye ?? 0,
            statutAccord: s.accord?.statut ?? null,
          },
        ]
      : [];
  });

  const listes = await listerChecklists(db, dossier, "active");

  const notation = await notationDeMission(db, dossier.mission_id);
  const publiees = notation
    ? (await resumeNotation(db, notation)).versions.filter((v) => v.statut === "publiee")
    : [];
  const versNotation = (v: (typeof publiees)[number] | undefined) =>
    v ? { numero: v.numero, score: v.score, classe: v.classe } : null;

  const causes = await causesValidees(db, dossier.id);

  return {
    dateReference,
    devise: dossier.devise as EntreesBilanCloture["devise"],
    ratios: { ouverture, fin },
    alerte: await bornesScores(db, dossier.id),
    urgence: await bornesUrgences(db, dossier.id),
    tresorerie: {
      ouverture: tresorerieOuverture,
      fin: courante ? syntheseTresorerie(courante.projection) : null,
    },
    plan: { actions: actions.map(versPlan), actionsAuPlanValide: planValide },
    creanciers,
    covenantsEnDefaut: await evaluerCovenantsDossier(db, auth, dossier),
    checklists: listes.checklists.map((c) => ({
      completudePb: c.completude_pb,
      conformitePb: c.conformite_pb,
    })),
    notation: {
      // Du plus récent au plus ancien : la première version publiée est la dernière de la liste.
      premiere: versNotation(publiees[publiees.length - 1]),
      derniere: versNotation(publiees[0]),
    },
    causes: { validee: causes !== null, nombre: causes?.causes.length ?? 0 },
  };
}

/** Bilan de l'état courant du dossier (moteur), à la date de référence donnée. */
export async function bilanCourant(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  dateReference: string = dateDuJour(),
): Promise<BilanCloture> {
  return construireBilanCloture(await entreesCourantes(db, auth, dossier, dateReference));
}

/* ----- Droits de validation ----- */

const peutValiderRole = (auth: Auth): boolean =>
  aPermission(auth.roles, "redressement.valider") &&
  (auth.roles.includes("associe") || auth.roles.includes("directeur_mission"));

const separation = (message: string) => new AppError(403, "SEPARATION_DES_TACHES", message);

/* ----- Vues ----- */

function resume(c: ClotureLue, peut: boolean): RedClotureResume {
  return {
    id: c.id,
    dossier_id: c.dossier_id,
    version: c.version,
    statut: c.statut,
    date_reference: c.date_reference,
    complet: c.complet,
    empreinte: c.empreinte,
    cree_par: personne(c.cree_par, c.cree_par_nom),
    cree_le: isoOuVide(c.cree_le),
    valide_par: c.valide_par ? personne(c.valide_par, c.valide_par_nom ?? "") : null,
    valide_le: c.valide_le ? isoOuVide(c.valide_le) : null,
    motif: c.motif_validation,
    peut_valider: peut,
  };
}

/** Contenu relu par le schéma partagé ; illisible : 409 (jamais un 500). */
export function contenuLu(contenu: unknown): RedClotureContenu {
  const lu = redClotureContenuSchema.safeParse(contenu);
  if (!lu.success) {
    throw new AppError(
      409,
      "RED_CLOTURE_ILLISIBLE",
      "Le contenu de ce bilan de clôture est illisible.",
    );
  }
  return lu.data;
}

function peutValider(
  auth: Auth,
  c: ClotureLue,
  derniere: number,
  { dossier, mission }: AccesDossierRed,
): boolean {
  return (
    c.statut === "brouillon" &&
    c.complet &&
    c.version === derniere &&
    dossier.statut !== "clos" &&
    mission.statut !== "cloturee" &&
    peutValiderRole(auth) &&
    respecteReserveDirecteur(auth, mission) &&
    (c.cree_par !== auth.utilisateurId || estAssocie(auth))
  );
}

async function derniereVersion(db: Db, dossierId: string): Promise<number> {
  const r = await db.query(
    "SELECT coalesce(max(version), 0)::int AS derniere FROM red_clotures WHERE dossier_id = $1",
    [dossierId],
  );
  return r.rows[0].derniere as number;
}

/* ----- Lectures ----- */

/** Route : versions du dossier (30 au plus), la plus récente d'abord, sans contenu. */
export async function listerClotures(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
): Promise<RedCloturesListeVue> {
  const r = await db.query(
    `SELECT ${COLONNES_SANS_CONTENU} ${JOINTURES} WHERE c.dossier_id = $1
     ORDER BY c.version DESC LIMIT ${RED_CLOTURES_MAX}`,
    [acces.dossier.id],
  );
  const lignes = r.rows as ClotureLue[];
  const derniere = lignes[0]?.version ?? 0;
  return { elements: lignes.map((c) => resume(c, peutValider(auth, c, derniere, acces))) };
}

/** Bilan dont le dossier est visible, ou 404 (le même pour un bilan inconnu ou d'un autre cabinet). */
export async function clotureVisible(
  db: Db,
  auth: Auth,
  id: string,
): Promise<{ acces: AccesDossierRed; ligne: ClotureLue }> {
  const r = await db.query(
    `SELECT ${COLONNES_SANS_CONTENU}, c.contenu ${JOINTURES} WHERE c.id = $1`,
    [id],
  );
  const ligne = r.rows[0] as ClotureLue | undefined;
  if (!ligne) throw introuvable("Bilan de clôture");
  const acces = await exigerDossierRedVisible(db, auth, ligne.dossier_id).catch(() => {
    throw introuvable("Bilan de clôture");
  });
  return { acces, ligne };
}

async function vueComplete(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
  c: ClotureLue,
): Promise<RedClotureVue> {
  const derniere = await derniereVersion(db, c.dossier_id);
  return { ...resume(c, peutValider(auth, c, derniere, acces)), contenu: contenuLu(c.contenu) };
}

/** Route : un bilan avec son contenu. */
export async function lireCloture(db: Db, auth: Auth, id: string): Promise<RedClotureVue> {
  const { acces, ligne } = await clotureVisible(db, auth, id);
  return vueComplete(db, auth, acces, ligne);
}

/**
 * Résumé du bilan pour le tableau de bord : « valide » dès qu'une version est validée (version et
 * date de la dernière validée), sinon « brouillon » (dernière version), sinon « absent ».
 */
export async function resumeCloture(db: Db, dossierId: string): Promise<RedClotureDossierResume> {
  const valide = await db.query(
    `SELECT version, valide_le FROM red_clotures WHERE dossier_id = $1 AND statut = 'valide'
     ORDER BY version DESC LIMIT 1`,
    [dossierId],
  );
  const v = valide.rows[0] as { version: number; valide_le: Date } | undefined;
  if (v) return { statut: "valide", version: v.version, valide_le: isoOuVide(v.valide_le) };
  const derniere = await derniereVersion(db, dossierId);
  return derniere > 0
    ? { statut: "brouillon", version: derniere, valide_le: null }
    : { statut: "absent", version: null, valide_le: null };
}

/* ----- Écritures ----- */

/** Nouveau bilan (brouillon), contenu construit par le moteur depuis l'état courant du dossier. */
export async function creerCloture(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
): Promise<RedClotureVue> {
  await verifierDebit(db, auth, DEBIT_CLOTURES);
  const dateReference = dateDuJour();
  const contenu = await bilanCourant(db, auth, acces.dossier, dateReference);
  const version = (await derniereVersion(db, acces.dossier.id)) + 1;
  const r = await db.query(
    `INSERT INTO red_clotures (cabinet_id, dossier_id, version, date_reference, contenu, empreinte,
       complet, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      auth.cabinetId,
      acces.dossier.id,
      version,
      dateReference,
      JSON.stringify(contenu),
      empreinteBilan(contenu),
      contenu.complet,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journalRed(db, auth, "red_cloture", "creation", id, {
    dossier_id: acces.dossier.id,
    version,
    complet: contenu.complet,
  });
  return lireCloture(db, auth, id);
}

/**
 * Validation d'un bilan (dossier verrouillé AVANT toute lecture dont une règle dépend). Séparation
 * des tâches, réserve au directeur, dernière version, contrôles bloquants satisfaits, état du
 * dossier inchangé depuis la construction.
 */
export async function validerCloture(
  db: Db,
  auth: Auth,
  id: string,
  corps: RedClotureValidation,
): Promise<RedClotureVue> {
  const apercu = await db.query("SELECT dossier_id FROM red_clotures WHERE id = $1", [id]);
  if (!apercu.rows[0]) throw introuvable("Bilan de clôture");
  const dossierId = apercu.rows[0].dossier_id as string;
  await exigerDossierRedVisible(db, auth, dossierId).catch(() => {
    throw introuvable("Bilan de clôture");
  });
  const acces = await exigerDossierRedValidation(db, auth, dossierId);
  const { dossier, mission } = acces;
  const lu = await db.query(
    `SELECT ${COLONNES_SANS_CONTENU}, c.contenu ${JOINTURES} WHERE c.id = $1`,
    [id],
  );
  const c = lu.rows[0] as ClotureLue | undefined;
  if (!c) throw introuvable("Bilan de clôture");
  if (!peutValiderRole(auth)) {
    throw separation("Le bilan de clôture est validé par un associé ou un directeur de mission.");
  }
  exigerDirecteurDeMission(mission);
  if (!respecteReserveDirecteur(auth, mission)) {
    throw new AppError(
      403,
      "VALIDATION_RESERVEE_DIRECTEUR",
      "Seul le directeur de la mission valide le bilan de clôture.",
    );
  }
  if (c.cree_par === auth.utilisateurId && !estAssocie(auth)) {
    throw separation("Le créateur d'un bilan de clôture ne le valide pas lui-même.");
  }
  if (c.statut !== "brouillon") {
    throw new AppError(409, "RED_TRANSITION_INVALIDE", "Ce bilan de clôture est déjà validé.");
  }
  if (c.version !== (await derniereVersion(db, dossierId))) {
    throw new AppError(
      409,
      "RED_VERSION_NON_CONSECUTIVE",
      "Une version plus récente existe : seule la dernière version du bilan se valide.",
    );
  }
  const contenu = contenuLu(c.contenu);
  const manquants = contenu.controles.filter((x) => x.bloquant && !x.satisfait);
  if (!c.complet || !contenu.complet || manquants.length > 0) {
    throw new AppError(
      409,
      "RED_CLOTURE_INCOMPLETE",
      "Le bilan de clôture est incomplet : des contrôles bloquants ne sont pas satisfaits.",
      { manquants: manquants.map((x) => x.code) },
    );
  }
  const actuel = await bilanCourant(db, auth, dossier, c.date_reference);
  if (empreinteBilan(actuel) !== empreinteBilan(contenu)) {
    throw new AppError(
      409,
      "RED_CLOTURE_PERIMEE",
      "L'état du dossier a changé depuis la construction de ce bilan : construisez-en un nouveau.",
    );
  }
  await db.query(
    `UPDATE red_clotures SET statut = 'valide', valide_par = $2, valide_le = now(), motif_validation = $3
     WHERE id = $1`,
    [id, auth.utilisateurId, corps.motif ?? null],
  );
  await journalRed(db, auth, "red_cloture", "validation", id, {
    dossier_id: dossierId,
    version: c.version,
  });
  return lireCloture(db, auth, id);
}
