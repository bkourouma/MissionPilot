import {
  agregerPriorisation,
  synthetiserAtelier,
  type ClassementParticipant,
  type ContributionVote as VoteMoteur,
  type OptionAtelier,
  type Participation,
  type PositionMatrice,
  type SyntheseAtelier,
} from "@missionpilot/engines";
import type { Db } from "../db/pool.js";

/*
 * Agrégats d'un atelier (PLA-15) : AUCUN calcul ici. Les contributions COURANTES (dernière version de
 * chaque participant et méthode) sont lues, converties en entrées du moteur
 * (`packages/engines/src/plan-strategique/atelier.ts`) et agrégées par lui ; le résultat est figé dans
 * `plan_ateliers.resultats` à la clôture. Le moteur ne connaît que des identifiants opaques (ceux des
 * participants ne quittent jamais ce module) et ne rend jamais une contribution individuelle.
 * Le taux de participation d'un atelier en cours passe lui aussi par le moteur.
 */

export interface AtelierParametres {
  id: string;
  methode_vote: boolean;
  methode_priorisation: boolean;
  methode_matrice: boolean;
  budget_points: number;
  plafond_par_option: number | null;
  axe_x_libelle: string;
  axe_x_inverse: boolean;
  axe_y_libelle: string;
  axe_y_inverse: boolean;
}

export interface OptionDb {
  id: string;
  rang: number;
  libelle: string;
  description: string | null;
}

/** 100 participants × 3 méthodes × 50 options : borne de la lecture. */
const LIGNES_MAX = 15_000;

interface LigneCourante {
  participant_id: string;
  methode: "vote" | "priorisation" | "matrice";
  option_id: string;
  points: number | null;
  rang: number | null;
  x: number | null;
  y: number | null;
}

export interface ContributionsCourantes {
  votes: VoteMoteur[];
  classements: ClassementParticipant[];
  positions: PositionMatrice[];
  /** Participants (identifiants opaques) ayant déposé au moins une contribution. */
  contributeurs: string[];
}

/** Contributions courantes d'un atelier, converties pour le moteur. */
export async function contributionsCourantes(
  db: Db,
  atelierId: string,
): Promise<ContributionsCourantes> {
  const r = await db.query(
    `WITH courantes AS (
       SELECT DISTINCT ON (c.participant_id, c.methode) c.id, c.participant_id, c.methode
       FROM plan_atelier_contributions c WHERE c.atelier_id = $1
       ORDER BY c.participant_id, c.methode, c.version DESC)
     SELECT c.participant_id, c.methode, l.option_id, l.points, l.rang, l.x, l.y
     FROM courantes c JOIN plan_atelier_contribution_lignes l ON l.contribution_id = c.id
     ORDER BY c.participant_id, c.methode, l.rang NULLS LAST, l.option_id
     LIMIT ${LIGNES_MAX}`,
    [atelierId],
  );
  const votes = new Map<string, { optionId: string; points: number }[]>();
  const classements = new Map<string, string[]>();
  const positions: PositionMatrice[] = [];
  const contributeurs = new Set<string>();
  for (const l of r.rows as LigneCourante[]) {
    contributeurs.add(l.participant_id);
    if (l.methode === "vote") {
      const liste = votes.get(l.participant_id) ?? [];
      liste.push({ optionId: l.option_id, points: Number(l.points) });
      votes.set(l.participant_id, liste);
    } else if (l.methode === "priorisation") {
      const liste = classements.get(l.participant_id) ?? [];
      liste.push(l.option_id);
      classements.set(l.participant_id, liste);
    } else {
      positions.push({
        participant: l.participant_id,
        optionId: l.option_id,
        x: Number(l.x),
        y: Number(l.y),
      });
    }
  }
  return {
    votes: [...votes].map(([participant, points]) => ({ participant, points })),
    classements: [...classements].map(([participant, classement]) => ({
      participant,
      classement,
    })),
    positions,
    contributeurs: [...contributeurs],
  };
}

export const optionsMoteur = (options: readonly OptionDb[]): OptionAtelier[] =>
  options.map((o) => ({ id: o.id, libelle: o.libelle }));

/** Agrégats de l'atelier par le moteur, pour les seules méthodes activées. */
export function agregerAtelier(
  atelier: AtelierParametres,
  options: readonly OptionDb[],
  invites: number,
  c: ContributionsCourantes,
): SyntheseAtelier {
  return synthetiserAtelier({
    options: optionsMoteur(options),
    ...(atelier.methode_vote
      ? {
          vote: {
            contributions: c.votes,
            budgetPoints: atelier.budget_points,
            ...(atelier.plafond_par_option === null
              ? {}
              : { plafondParOption: atelier.plafond_par_option }),
            invites,
          },
        }
      : {}),
    ...(atelier.methode_priorisation
      ? { priorisation: { classements: c.classements, invites } }
      : {}),
    ...(atelier.methode_matrice
      ? {
          matrice: {
            positions: c.positions,
            axes: {
              x: { libelle: atelier.axe_x_libelle, inverse: atelier.axe_x_inverse },
              y: { libelle: atelier.axe_y_libelle, inverse: atelier.axe_y_inverse },
            },
            invites,
          },
        }
      : {}),
  });
}

/**
 * Taux de participation d'un atelier en cours : participants ayant déposé au moins une contribution
 * sur les invités, calculé par le moteur (classement fictif d'une option par contributeur : seule la
 * participation du résultat est lue, jamais un rang).
 */
export function participationEnCours(
  options: readonly OptionDb[],
  contributeurs: readonly string[],
  invites: number,
): Participation | null {
  const premiere = options[0];
  if (!premiere || invites === 0) return null;
  return agregerPriorisation(
    optionsMoteur(options),
    contributeurs.map((participant) => ({ participant, classement: [premiere.id] })),
    { invites },
  ).participation;
}
