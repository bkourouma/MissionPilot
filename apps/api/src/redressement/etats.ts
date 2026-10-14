import type { EtatPourRatios } from "@missionpilot/engines";
import type { Devise } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";

/*
 * États financiers ACCEPTÉS du dossier client (lecture seule, aucune écriture dans `dossier_*`).
 * Un état entre dans un calcul s'il est COURANT (ni remplacé, ni rejeté) ET accepté ; un état en
 * revue, rejeté ou remplacé n'y entre jamais. Les montants sont ceux du client (pas du cabinet).
 */

/** Nombre d'exercices servis aux ratios, au plus (le plus récent d'abord). */
export const EXERCICES_RATIOS_MAX = 3;
const NON_UTILISES_MAX = 50;

export interface EtatLu {
  id: string;
  exercice: number;
  date_cloture: string;
  devise: Devise;
  /** Décision sans acceptation automatique, contrôles en échec ou tolérance non nulle. */
  accepte_sous_reserve: boolean;
  etat: EtatPourRatios;
}

function nombreOuNul(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Les états acceptés courants d'un client : les trois exercices les plus récents. */
export async function etatsAcceptes(db: Db, clientId: string): Promise<EtatLu[]> {
  const r = await db.query(
    `SELECT e.id, e.exercice, e.date_cloture::text AS date_cloture, e.devise, e.tolerance::int AS tolerance,
       e.totaux, e.controles_ok, d.automatique
     FROM dossier_etats_financiers e
     JOIN dossier_etats_decisions d ON d.etat_id = e.id AND d.decision = 'accepte'
     WHERE e.client_id = $1
       AND NOT EXISTS (SELECT 1 FROM dossier_etats_financiers r WHERE r.remplace_id = e.id)
     ORDER BY e.exercice DESC, e.cree_le DESC, e.id LIMIT $2`,
    [clientId, EXERCICES_RATIOS_MAX],
  );
  if (r.rows.length === 0) return [];
  const lignes = await db.query(
    `SELECT etat_id, code, montant::text AS montant FROM dossier_etats_lignes
     WHERE etat_id = ANY ($1::uuid[]) ORDER BY etat_id, rang`,
    [r.rows.map((e) => e.id as string)],
  );
  const parEtat = new Map<string, { code: string; montant: number }[]>();
  for (const l of lignes.rows) {
    const liste = parEtat.get(l.etat_id as string) ?? [];
    liste.push({ code: l.code as string, montant: Number(l.montant) });
    parEtat.set(l.etat_id as string, liste);
  }
  return r.rows.map((e) => {
    const totaux = (e.totaux ?? {}) as Record<string, unknown>;
    return {
      id: e.id as string,
      exercice: e.exercice as number,
      date_cloture: e.date_cloture as string,
      devise: e.devise as Devise,
      accepte_sous_reserve:
        !(e.automatique as boolean) || !(e.controles_ok as boolean) || (e.tolerance as number) > 0,
      etat: {
        exercice: e.exercice as number,
        devise: e.devise as Devise,
        lignes: parEtat.get(e.id as string) ?? [],
        totalActif: nombreOuNul(totaux.actif),
        totalPassif: nombreOuNul(totaux.passif),
        resultatNet: nombreOuNul(totaux.resultat),
      },
    };
  });
}

export interface EtatNonUtilise {
  etat_id: string;
  exercice: number;
  statut: "en_revue" | "rejete" | "remplace";
}

/** États du client qui n'entrent pas dans les calculs : en revue, rejetés ou remplacés (les plus récents). */
export async function etatsNonUtilises(db: Db, clientId: string): Promise<EtatNonUtilise[]> {
  const r = await db.query(
    `SELECT e.id AS etat_id, e.exercice,
       CASE WHEN r.id IS NOT NULL THEN 'remplace' WHEN d.decision = 'rejete' THEN 'rejete'
            WHEN d.decision = 'accepte' THEN 'accepte' ELSE 'en_revue' END AS statut
     FROM dossier_etats_financiers e
     LEFT JOIN dossier_etats_decisions d ON d.etat_id = e.id
     LEFT JOIN dossier_etats_financiers r ON r.remplace_id = e.id
     WHERE e.client_id = $1
     ORDER BY e.exercice DESC, e.cree_le DESC, e.id LIMIT $2`,
    [clientId, NON_UTILISES_MAX],
  );
  return (r.rows as EtatNonUtilise[]).filter((e) => (e.statut as string) !== "accepte");
}
