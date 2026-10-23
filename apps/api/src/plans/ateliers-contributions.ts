import { agregerMatrice, agregerPriorisation, agregerVote } from "@missionpilot/engines";
import {
  SCHEMAS_CONTRIBUTION,
  VERSIONS_CONTRIBUTION_MAX,
  type MethodeAtelier,
} from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { AppError, requeteInvalide } from "../errors.js";
import { cleVerrouAtelier, methodesActives, optionsDe, type AtelierDb } from "./ateliers.js";
import { optionsMoteur } from "./ateliers-resultats.js";

/*
 * Contributions aux ateliers (PLA-15), cabinet ET portail : un seul chemin d'écriture. Une contribution
 * est une NOUVELLE VERSION en ajout seul (remplacer la sienne ne détruit rien : l'audit reste complet) ;
 * la courante est la plus haute. Règles contrôlées ici ET par les déclencheurs de la migration 0426
 * (atelier ouvert, participant invité, option de l'atelier, méthode activée, budget de points, plafond
 * par option, classement contigu, doublon) ; le moteur revalide chaque saisie avant son inscription,
 * de sorte qu'une clôture ne peut pas échouer sur une contribution stockée.
 *
 * Verrou : la contribution prend le verrou consultatif PARTAGÉ de l'atelier avant de lire son statut ;
 * la clôture prend le verrou exclusif. Une contribution en cours finit donc avant la clôture, et une
 * contribution tardive voit « clos ».
 *
 * Journal (par l'appelant) : méthode, version, nombre de lignes ; jamais le contenu.
 */

export interface Contributeur {
  cabinetId: string;
  utilisateurId: string;
  /** Client du dirigeant (portail) ; null pour un membre du cabinet. */
  clientId: string | null;
}

/** Verrou partagé de l'atelier : à prendre AVANT de lire son statut. */
export async function verrouillerContributions(db: Db, atelierId: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))", [
    cleVerrouAtelier(atelierId),
  ]);
}

export interface ContributionDeposee {
  methode: MethodeAtelier;
  version: number;
  lignes: number;
}

type Corps = Record<string, unknown>;

interface LigneSaisie {
  option_id: string;
  points: number | null;
  rang: number | null;
  x: number | null;
  y: number | null;
}

function lignesDe(methode: MethodeAtelier, corps: Corps): LigneSaisie[] {
  if (methode === "vote") {
    return (corps.points as { option_id: string; points: number }[]).map((p) => ({
      option_id: p.option_id,
      points: p.points,
      rang: null,
      x: null,
      y: null,
    }));
  }
  if (methode === "priorisation") {
    return (corps.classement as string[]).map((option_id, i) => ({
      option_id,
      points: null,
      rang: i + 1,
      x: null,
      y: null,
    }));
  }
  return (corps.positions as { option_id: string; x: number; y: number }[]).map((p) => ({
    option_id: p.option_id,
    points: null,
    rang: null,
    x: p.x,
    y: p.y,
  }));
}

/** Corps validé par le schéma de la méthode (400 sinon). */
export function lireCorpsContribution(methode: MethodeAtelier, corps: unknown): Corps {
  return SCHEMAS_CONTRIBUTION[methode].parse(corps) as Corps;
}

/**
 * Inscrit une nouvelle version de la contribution de `qui` à `methode`. `atelier` est lu par l'appelant
 * APRÈS `verrouillerContributions`. `nonParticipant` choisit la réponse d'un utilisateur non invité
 * (403 au cabinet, 404 au portail).
 */
export async function deposerContribution(
  db: Db,
  atelier: AtelierDb,
  qui: Contributeur,
  methode: MethodeAtelier,
  corps: Corps,
  nonParticipant: () => Error,
): Promise<ContributionDeposee> {
  if (atelier.statut !== "ouvert") {
    throw new AppError(409, "ATELIER_ETAT", "Cet atelier n'accepte pas de contributions.");
  }
  if (!methodesActives(atelier).includes(methode)) {
    throw requeteInvalide("Cette méthode n'est pas activée pour cet atelier.");
  }
  const p = await db.query(
    "SELECT id FROM plan_atelier_participants WHERE atelier_id = $1 AND utilisateur_id = $2",
    [atelier.id, qui.utilisateurId],
  );
  const participantId = (p.rows[0] as { id: string } | undefined)?.id;
  if (!participantId) throw nonParticipant();

  const options = await optionsDe(db, atelier.id);
  const connues = new Set(options.map((o) => o.id));
  const lignes = lignesDe(methode, corps);
  if (lignes.some((l) => !connues.has(l.option_id))) {
    throw new AppError(400, "ATELIER_OPTION_INCONNUE", "Option inconnue de cet atelier.");
  }
  // Le moteur revalide la saisie (budget, plafond, bornes, doublons) avec les paramètres de l'atelier.
  const moteur = optionsMoteur(options);
  if (methode === "vote") {
    const points = lignes.map((l) => ({ optionId: l.option_id, points: l.points as number }));
    if (points.every((x) => x.points === 0)) {
      throw requeteInvalide("Répartissez au moins un point.");
    }
    agregerVote(moteur, [{ participant: "x", points }], {
      budgetPoints: atelier.budget_points,
      ...(atelier.plafond_par_option === null
        ? {}
        : { plafondParOption: atelier.plafond_par_option }),
    });
  } else if (methode === "priorisation") {
    agregerPriorisation(moteur, [{ participant: "x", classement: lignes.map((l) => l.option_id) }]);
  } else {
    agregerMatrice(
      moteur,
      lignes.map((l) => ({
        participant: "x",
        optionId: l.option_id,
        x: l.x as number,
        y: l.y as number,
      })),
    );
  }

  // Une personne ne dépose qu'une contribution à la fois (version suivante calculée sous verrou).
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `plan_atelier_contribution:${participantId}:${methode}`,
  ]);
  const v = await db.query(
    `SELECT coalesce(max(version), 0)::int AS version FROM plan_atelier_contributions
     WHERE participant_id = $1 AND methode = $2`,
    [participantId, methode],
  );
  const version = (v.rows[0].version as number) + 1;
  if (version > VERSIONS_CONTRIBUTION_MAX) {
    throw new AppError(
      409,
      "ATELIER_PLAFOND",
      `Au plus ${VERSIONS_CONTRIBUTION_MAX} versions d'une même contribution.`,
    );
  }
  const h = await db.query(
    `INSERT INTO plan_atelier_contributions (cabinet_id, atelier_id, participant_id, utilisateur_id,
       client_id, methode, version, nombre_lignes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      qui.cabinetId,
      atelier.id,
      participantId,
      qui.utilisateurId,
      qui.clientId,
      methode,
      version,
      lignes.length,
    ],
  );
  const contributionId = h.rows[0].id as string;
  // Lignes insérées une à une, dans l'ordre du classement (le déclencheur exige des rangs contigus).
  for (const l of lignes) {
    await db.query(
      `INSERT INTO plan_atelier_contribution_lignes (cabinet_id, contribution_id, atelier_id, methode,
         option_id, points, rang, x, y) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [qui.cabinetId, contributionId, atelier.id, methode, l.option_id, l.points, l.rang, l.x, l.y],
    );
  }
  return { methode, version, lignes: lignes.length };
}

export interface MaContribution {
  version: number;
  depose_le: Date;
  points?: { option_id: string; points: number }[];
  classement?: string[];
  positions?: { option_id: string; x: number; y: number }[];
}

/** SA contribution courante par méthode (jamais celle d'un autre). */
export async function lireMaContribution(
  db: Db,
  atelierId: string,
  utilisateurId: string,
): Promise<Partial<Record<MethodeAtelier, MaContribution>>> {
  const r = await db.query(
    `WITH courantes AS (
       SELECT DISTINCT ON (c.methode) c.id, c.methode, c.version, c.depose_le
       FROM plan_atelier_contributions c
       WHERE c.atelier_id = $1 AND c.utilisateur_id = $2
       ORDER BY c.methode, c.version DESC)
     SELECT c.methode, c.version, c.depose_le, l.option_id, l.points, l.rang, l.x, l.y
     FROM courantes c JOIN plan_atelier_contribution_lignes l ON l.contribution_id = c.id
     ORDER BY c.methode, l.rang NULLS LAST, l.option_id LIMIT 150`,
    [atelierId, utilisateurId],
  );
  const sortie: Partial<Record<MethodeAtelier, MaContribution>> = {};
  for (const l of r.rows as {
    methode: MethodeAtelier;
    version: number;
    depose_le: Date;
    option_id: string;
    points: number | null;
    rang: number | null;
    x: number | null;
    y: number | null;
  }[]) {
    const c = (sortie[l.methode] ??= { version: l.version, depose_le: l.depose_le });
    if (l.methode === "vote") {
      (c.points ??= []).push({ option_id: l.option_id, points: Number(l.points) });
    } else if (l.methode === "priorisation") {
      (c.classement ??= []).push(l.option_id);
    } else {
      (c.positions ??= []).push({ option_id: l.option_id, x: Number(l.x), y: Number(l.y) });
    }
  }
  return sortie;
}
