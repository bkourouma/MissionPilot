import { aPermission, type TermeSensible } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Database, Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { lireDemandeVisible } from "../ia/generations.js";
import { chercheurDeTermes } from "../ia/masquage.js";
import { genererContenu, type DependancesIa } from "../ia/orchestrateur.js";
import { variablesDuPrompt, type PromptSeme } from "../ia/prompts.js";

/*
 * Aide commune d'appel de l'orchestrateur pour l'ingestion (ADR-009, décision 7) : le modèle ne fait que
 * PROPOSER des lignes de texte (`donnees.lignes`) ; le code les relit (moteurs `packages/engines`), les
 * borne et les rattache. Le texte du document entre dans le prompt par une variable déclarée NON FIABLE
 * par l'appelant (AGT-07), jamais dans les consignes.
 *
 * MASQUAGE DES NOMS (décision de l'utilisateur du 2026-10-22) : l'appelant peut fournir des `termesSensibles`
 * (noms de personnes et de clients connus du cabinet, voir `copilote/noms-propres.ts`) ; l'orchestrateur les
 * remplace par des jetons avant l'envoi au modèle puis DÉMASQUE la sortie. Seul l'usage `standard_historique`
 * (structuration-standard.ts) l'applique ; `dd_rapport` et `dd_salle` n'en passent pas. Comme le démasquage
 * restitue un nom propre dans les lignes rendues, l'appelant doit REJETER toute ligne qui contient un terme
 * masqué (`ligneSansTerme`, ci-dessous) : un nom de client ne doit jamais entrer dans le standard du cabinet.
 * Aucun nom n'est journalisé.
 *
 * Aucune IA disponible -> `lignes: null` (le document reste lisible par règles, ou `ia_indisponible`) :
 * utilisateur sans `ia.utiliser`, IA désactivée, sans clé, plafond atteint (`repliSiPlafond`), quota ou
 * générations simultanées atteints, échec du fournisseur, sortie inexploitable. Les erreurs inattendues
 * (hors refus d'admission) remontent : le job sera repris.
 */

export interface ParamsLignesIa {
  database: Database;
  deps: DependancesIa;
  auth: Auth;
  promptNom: string;
  /** Sème le prompt du cabinet (idempotent), dans la transaction fournie. */
  assurerPrompt: (db: Db, cabinetId: string) => Promise<void>;
  variables: Record<string, string>;
  /** Variables portant un contenu CLIENT (le texte du document). */
  variablesNonFiables: string[];
  entite: { type: string; id: string };
  /** Noms à masquer avant l'envoi au modèle (facultatif ; absent : aucun masquage de noms propres). */
  termesSensibles?: readonly TermeSensible[];
}

export interface ResultatLignesIa {
  lignes: string[] | null;
  /** Demande de l'orchestrateur (ia_demandes), null si aucun appel n'a eu lieu. */
  demandeId: string | null;
  /** La garde-chiffres a signalé des nombres hors contexte (indicatif : le moteur vérifie les sources). */
  chiffresNonVerifiesIa: boolean;
}

const AUCUNE: ResultatLignesIa = { lignes: null, demandeId: null, chiffresNonVerifiesIa: false };

/** Sème un prompt de l'ingestion (version 1, non « exemple ») dans le cabinet, une fois (idempotent). */
export async function assurerPromptSeme(db: Db, cabinetId: string, p: PromptSeme): Promise<void> {
  const existe = await db.query("SELECT 1 FROM ia_prompts WHERE nom = $1 LIMIT 1", [p.nom]);
  if (existe.rows[0]) return;
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `ia_prompts:${cabinetId}`,
  ]);
  await db.query(
    `INSERT INTO ia_prompts (cabinet_id, nom, version, tache, gabarit_systeme, gabarit_utilisateur,
       variables, schema_sortie, exemple, description)
     SELECT $1, $2, 1, $3, $4, $5, $6, $7, false, $8
     WHERE NOT EXISTS (SELECT 1 FROM ia_prompts WHERE nom = $2)
     ON CONFLICT (cabinet_id, nom, version) DO NOTHING`,
    [
      cabinetId,
      p.nom,
      p.tache,
      p.gabarit_systeme,
      p.gabarit_utilisateur,
      variablesDuPrompt(p.gabarit_systeme, p.gabarit_utilisateur),
      JSON.stringify(p.schema_sortie),
      p.description,
    ],
  );
}

/** Refus d'admission de l'orchestrateur (quota, générations simultanées) : l'IA est simplement indisponible. */
const estRefusAdmission = (e: unknown) =>
  e instanceof AppError && (e.statut === 409 || e.statut === 429);

/**
 * Lignes du modèle sans celles qui contiennent l'un des termes masqués (comparaison normalisée : insensible à
 * la casse et aux accents, mots entiers, comme le masque). Aucun terme -> lignes inchangées.
 */
export function lignesSansTermes(
  lignes: readonly string[],
  termes: readonly TermeSensible[],
): string[] {
  if (termes.length === 0) return [...lignes];
  return lignes.filter((ligne) => {
    const contient = chercheurDeTermes(ligne);
    return !termes.some((t) => contient(t));
  });
}

export async function demanderLignesIa(p: ParamsLignesIa): Promise<ResultatLignesIa> {
  if (!aPermission(p.auth.roles, "ia.utiliser")) return AUCUNE;
  await p.database.withTenant(p.auth.cabinetId, (db) => p.assurerPrompt(db, p.auth.cabinetId));
  let demandeId: string;
  try {
    ({ demandeId } = await genererContenu(p.database, p.deps, {
      tache: "extraction",
      promptNom: p.promptNom,
      variables: p.variables,
      variablesNonFiables: p.variablesNonFiables,
      entite: p.entite,
      utilisateur: p.auth,
      repliSiPlafond: true,
      ...(p.termesSensibles && p.termesSensibles.length > 0
        ? { termesSensibles: p.termesSensibles }
        : {}),
    }));
  } catch (error) {
    if (estRefusAdmission(error)) return AUCUNE;
    throw error;
  }
  return p.database.withTenant(p.auth.cabinetId, async (db) => {
    const demande = await lireDemandeVisible(db, p.auth, demandeId);
    const exploitable =
      demande.statut === "terminee" && demande.g_version !== null && demande.p_gabarit !== true;
    const lignes = exploitable ? demande.g_donnees?.lignes : undefined;
    if (!Array.isArray(lignes)) return { ...AUCUNE, demandeId };
    return {
      lignes: lignes.filter((l): l is string => typeof l === "string"),
      demandeId,
      chiffresNonVerifiesIa: demande.g_chiffres_non_verifies === true,
    };
  });
}
