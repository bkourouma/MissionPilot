import type { CandidatBrief, FamilleBrief, SourceBrief } from "@missionpilot/engines";
import { aPermission, type Permission } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { nombre } from "../missions/outils.js";

/*
 * Extraction du brief quotidien (AUT-07) : chaque source lit, DANS LES DROITS de l'utilisateur,
 * les faits bruts d'une famille et les remet au moteur (`packages/engines/src/brief`), seul juge
 * de la gravité, de l'ordre et du bornage. Une source :
 * - n'est consultée que si l'utilisateur détient la permission de l'action correspondante (par
 *   permission, jamais par nom de rôle) ;
 * - applique la visibilité des missions (`filtreVisibilite`, alias `m`) pour tout ce qui se
 *   rattache à une mission ;
 * - ne propose jamais à quelqu'un de décider ce qu'il a rédigé ou soumis (séparation des tâches) ;
 * - est bornée (`LIMIT` paramétré) et compte le total réel par `count(*) OVER ()` ;
 * - ne lit ni ne recopie de contenu client : identifiants, numéros, intitulés internes et dates.
 * Aucun `SUM`/`AVG` : les calculs sont ceux du moteur.
 */

/** Lignes extraites au plus par source (le moteur borne ensuite chaque famille à 10) ; à valider. */
export const PLAFOND_PAR_SOURCE = 50;

export interface ContexteBrief {
  db: Db;
  auth: Auth;
  /** Date de référence AAAA-MM-JJ (jour courant, ou `?date=` pour un rejeu). */
  date: string;
  /** Voit toutes les missions du cabinet (`mission.lire_toutes`). */
  voitToutes: boolean;
  /** Détient `finance.lire` : seul droit qui autorise un montant dans le brief (FIN-02). */
  avecFinance: boolean;
}

export type Extracteur = (c: ContexteBrief) => Promise<SourceBrief | null>;

export function creerContexte(db: Db, auth: Auth, date: string): ContexteBrief {
  return {
    db,
    auth,
    date,
    voitToutes: voitToutesLesMissions(auth),
    avecFinance: aPermission(auth.roles, "finance.lire"),
  };
}

export const a = (c: ContexteBrief, permission: Permission): boolean =>
  aPermission(c.auth.roles, permission);

/** Fragment de visibilité des missions : paramètres $1 (voit toutes) et $2 (utilisateur). */
export const VISIBLE = filtreVisibilite(1, 2);

/** Paramètres de tête de toute requête du brief : $1 voit toutes, $2 utilisateur. */
export const base = (c: ContexteBrief): unknown[] => [c.voitToutes, c.auth.utilisateurId];

/** Date civile UTC (AAAA-MM-JJ) d'un horodatage SQL. */
export const JOUR = (colonne: string): string => `(${colonne} AT TIME ZONE 'UTC')::date::text`;

type Ligne = Record<string, unknown>;

/**
 * Transforme des lignes (portant `total_source`) en source : les lignes au-delà du plafond ne sont
 * pas extraites mais comptent dans le total réel.
 */
export function enSource(
  famille: FamilleBrief,
  lignes: readonly Ligne[],
  versCandidat: (ligne: Ligne) => CandidatBrief | null,
): SourceBrief {
  const total = lignes.length === 0 ? 0 : Number(lignes[0]?.total_source ?? lignes.length);
  const candidats = lignes.map(versCandidat).filter((c): c is CandidatBrief => c !== null);
  return { famille, candidats, restants: Math.max(0, total - lignes.length) };
}

/**
 * Source dont le filtre final se fait en code (garde humaine, solde) ou dont la lecture est bornée
 * (missions, KPI) : parmi les lignes NON lues (au-delà du plafond de la source), le nombre de celles
 * qui auraient été retenues est INCONNU. Rien n'en est donc compté dans `restants` (aucun élément
 * fantôme, comme une ligne non habilitée ou un solde nul) : la source est `incomplet` et la famille
 * est marquée « tronquée » (le total est un minimum). `lectureIncomplete` signale en plus une
 * lecture interrompue en cours de route (volume d'évaluation atteint).
 */
export function enSourceFiltree(
  famille: FamilleBrief,
  lignes: readonly Ligne[],
  candidats: readonly CandidatBrief[],
  lectureIncomplete = false,
): SourceBrief {
  const total = lignes.length === 0 ? 0 : Number(lignes[0]?.total_source ?? lignes.length);
  return { famille, candidats, restants: 0, incomplet: total > lignes.length || lectureIncomplete };
}

export const texte = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Montant bigint de la base, seulement pour un utilisateur qui détient `finance.lire`. */
export function donneesFinancieres(
  c: ContexteBrief,
  montant: unknown,
  devise: unknown,
): { montant?: number; devise?: string } {
  if (!c.avecFinance || montant === null || montant === undefined) return {};
  return { montant: nombre(montant), devise: String(devise) };
}
