import { createHash } from "node:crypto";
import {
  contributionIa,
  SEUIL_MODIFICATION_MAJEURE_PCT_DEFAUT,
  syntheseContributionsIa,
  type ContributionIa,
  type SyntheseContributionIa,
} from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { avecErreursAgents, contributionExiste } from "./erreurs.js";

/*
 * Contribution de l'IA par livrable (AGT-05, migration 0263). Toutes les
 * mesures sortent du moteur pur `contributionIa` (distance d'édition en mots,
 * part conservée, modification majeure au seuil, temps de revue) ; l'API ne
 * calcule rien. Les textes ne sont pas recopiés : seules leurs empreintes
 * SHA-256 sont gardées.
 *
 * Service interne `enregistrerContributionLivrable`, utilisable par les autres
 * modules (rapports, qualité) au moment où un livrable issu d'un brouillon IA
 * est validé ; la décision sur une exécution d'agent l'appelle elle-même.
 */

const empreinteTexte = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

export interface EntreeContribution {
  /** Auteur de la mesure ; null pour un traitement interne. */
  auth: Pick<Auth, "cabinetId" | "utilisateurId"> | null;
  cabinetId: string;
  livrableType: string;
  livrableId: string;
  missionId?: string | null;
  executionId?: string | null;
  briqueId?: string | null;
  agentCode?: string | null;
  brouillon: string;
  valide: string;
  /** Durées des sessions de revue, en secondes (QUA-03). */
  sessionsRevueSecondes?: readonly number[];
  seuilModificationMajeurePct?: number;
}

/** Mesure (moteur pur) et enregistre la contribution de l'IA à un livrable ; 409 si déjà mesurée. */
export async function enregistrerContributionLivrable(
  db: Db,
  e: EntreeContribution,
): Promise<ContributionIa> {
  const c = contributionIa(
    {
      brouillon: e.brouillon,
      valide: e.valide,
      sessionsRevueSecondes: e.sessionsRevueSecondes ?? [],
    },
    {
      seuilModificationMajeurePct:
        e.seuilModificationMajeurePct ?? SEUIL_MODIFICATION_MAJEURE_PCT_DEFAUT,
    },
  );
  const r = await avecErreursAgents(() =>
    db.query(
      `INSERT INTO agents_contributions (cabinet_id, livrable_type, livrable_id, mission_id, execution_id,
         brique_id, agent_code, mots_brouillon, mots_valides, distance, mots_conserves, part_conservee_pct,
         taux_modification_pct, modification_majeure, seuil_pct, sessions_revue, temps_revue_secondes,
         mediane_revue_secondes, exacte, brouillon_empreinte, valide_empreinte, auteur_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
         $20, $21, $22)
       ON CONFLICT (cabinet_id, livrable_type, livrable_id) DO NOTHING RETURNING id`,
      [
        e.cabinetId,
        e.livrableType,
        e.livrableId,
        e.missionId ?? null,
        e.executionId ?? null,
        e.briqueId ?? null,
        e.agentCode ?? null,
        c.motsBrouillon,
        c.motsValides,
        c.distance,
        c.motsConserves,
        c.partConserveePct,
        c.modification.tauxModificationPct,
        c.modification.majeure,
        c.modification.seuilPct,
        c.tempsRevue.sessions,
        c.tempsRevue.totalSecondes,
        c.tempsRevue.medianeSecondes,
        c.exacte,
        empreinteTexte(e.brouillon),
        empreinteTexte(e.valide),
        e.auth?.utilisateurId ?? null,
      ],
    ),
  );
  if (!r.rows[0]) throw contributionExiste();
  return c;
}

/* ----- Lecture agrégée ----- */

export interface FiltresContributions {
  agent?: string | undefined;
  brique?: string | undefined;
  mission_id?: string | undefined;
  limite: number;
  curseur?: string | undefined;
}

const CLE_TRI = "lpad(((extract(epoch FROM c.cree_le) * 1000000)::bigint)::text, 17, '0')";

/** Visibilité : contribution sans mission, ou d'une mission visible de l'utilisateur. */
const VISIBLE = (pToutes: number, pUtilisateur: number) =>
  `(c.mission_id IS NULL OR EXISTS (SELECT 1 FROM missions m WHERE m.id = c.mission_id
     AND ${filtreVisibilite(pToutes, pUtilisateur)}))`;

const FILTRES = `($3::text IS NULL OR c.agent_code = $3)
  AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM agents_briques b WHERE b.id = c.brique_id AND b.brique_code = $4))
  AND ($5::uuid IS NULL OR c.mission_id = $5)`;

function versContribution(l: Record<string, unknown>): ContributionIa {
  return {
    motsBrouillon: l.mots_brouillon as number,
    motsValides: l.mots_valides as number,
    distance: l.distance as number,
    motsConserves: l.mots_conserves as number,
    partConserveePct: (l.part_conservee_pct as number | null) ?? null,
    modification: {
      majeure: l.modification_majeure as boolean,
      tauxModificationPct: l.taux_modification_pct as number,
      seuilPct: l.seuil_pct as number,
    },
    tempsRevue: {
      sessions: l.sessions_revue as number,
      totalSecondes: Number(l.temps_revue_secondes),
      medianeSecondes: Number(l.mediane_revue_secondes),
      maxSecondes: 0,
    },
    exacte: l.exacte as boolean,
  };
}

/**
 * Contributions visibles (page par curseur, plus récentes d'abord) et synthèse
 * (moteur `syntheseContributionsIa`) sur TOUTES les contributions du filtre.
 */
export async function lireContributions(
  db: Db,
  auth: Auth,
  f: FiltresContributions,
): Promise<{
  synthese: SyntheseContributionIa;
  elements: Record<string, unknown>[];
  curseur_suivant: string | null;
}> {
  const base = [voitToutesLesMissions(auth), auth.utilisateurId, f.agent ?? null, f.brique ?? null];
  const tous = await db.query(
    `SELECT c.mots_brouillon, c.mots_valides, c.distance, c.mots_conserves, c.part_conservee_pct,
       c.modification_majeure, c.taux_modification_pct, c.seuil_pct, c.sessions_revue,
       c.temps_revue_secondes::text AS temps_revue_secondes,
       c.mediane_revue_secondes::text AS mediane_revue_secondes, c.exacte
     FROM agents_contributions c WHERE ${VISIBLE(1, 2)} AND ${FILTRES}`,
    [...base, f.mission_id ?? null],
  );
  const apres = decoderCurseur(f.curseur);
  const page = await db.query(
    `SELECT c.id, c.livrable_type, c.livrable_id, c.mission_id, c.execution_id, c.agent_code,
       b.brique_code, c.mots_brouillon, c.mots_valides, c.distance, c.mots_conserves,
       c.part_conservee_pct, c.taux_modification_pct, c.modification_majeure, c.seuil_pct,
       c.sessions_revue, c.temps_revue_secondes::text AS temps_revue_secondes, c.exacte, c.cree_le,
       ${CLE_TRI} AS cle_tri
     FROM agents_contributions c LEFT JOIN agents_briques b ON b.id = c.brique_id
     WHERE ${VISIBLE(1, 2)} AND ${FILTRES}
       AND ($6::text IS NULL OR (${CLE_TRI}, c.id) < ($6, $7::uuid))
     ORDER BY cle_tri DESC, c.id DESC LIMIT $8`,
    [...base, f.mission_id ?? null, apres?.[0] ?? null, apres?.[1] ?? null, f.limite + 1],
  );
  const p = paginer(
    page.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
    f.limite,
  );
  return {
    synthese: syntheseContributionsIa(tous.rows.map(versContribution)),
    elements: p.elements.map((l) => ({
      ...l,
      temps_revue_secondes: Number(l.temps_revue_secondes),
    })),
    curseur_suivant: p.curseur_suivant,
  };
}
