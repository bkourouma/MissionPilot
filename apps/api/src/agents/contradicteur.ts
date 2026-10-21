import {
  BROUILLON_REVUE_MAX,
  CODE_BRIQUE_REVUE_CONTRADICTOIRE,
  NOM_PROMPT_REVUE_CONTRADICTOIRE,
  TYPE_ENTITE_REVUE_CONTRADICTOIRE,
  type ChiffreContexte,
  type SourceIa,
  type TermeSensible,
} from "@missionpilot/shared";
import { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Database, Db } from "../db/pool.js";
import { introuvable, requeteInvalide } from "../errors.js";
import { extraireNombres } from "../ia/garde-chiffres.js";
import { lireDemandeVisible, type DemandeDb } from "../ia/generations.js";
import type { DependancesIa, ResultatExecution } from "../ia/orchestrateur.js";
import { lireParametres, sourceCleDisponible } from "../ia/parametres.js";
import {
  assurerPromptRevueContradictoire,
  JEU_ESSAI_REVUE_CONTRADICTOIRE,
  VARIABLE_BROUILLON_REVUE,
  VARIABLE_CONTEXTE_REVUE,
} from "../ia/prompts/gabarits/revue-contradictoire.js";
import { preuvesDeMission } from "../preuves/donnees.js";
import {
  avecErreursAgents,
  brouillonNonRevisable,
  briqueRevueAbsente,
  revueDejaActive,
  revueIaIndisponible,
  revueNonProduite,
  texteConserveAbsent,
} from "./erreurs.js";
import { creerJeuEssai } from "./evaluations.js";
import { controlerAgent, executerAgent, lireExecution } from "./executions.js";

/*
 * Revue contradictoire (AGT-06, PRD complémentaire §7, ADR-005) : l'agent « contradicteur » RELIT
 * un brouillon IA (génération en état « brouillon_ia » ou « modifie ») et liste contre-preuves,
 * incohérences et affirmations non sourcées.
 *
 * - À LA DEMANDE d'un consultant seulement : une route dédiée ; `executerAgent` refuse cet agent
 *   sans l'origine « consultant » (AGENTS_SUR_DEMANDE_SEULEMENT), donc une règle d'automatisation
 *   ne peut pas le déclencher.
 * - Dans les droits de l'utilisateur : droits du registre (mission.lire, preuve.lire), brouillon
 *   visible (visibilité de sa mission), `ia.utiliser` (route).
 * - Autonomie : niveau effectif de la brique « revue_contradictoire » (plafonds, coupe-circuit,
 *   agent inactif, N0 refusé), plafond de coût de la mission, non-régression du prompt : tout
 *   passe par `executerAgent`, donc par l'orchestrateur IA (jamais d'appel direct au fournisseur).
 * - La sortie est un BROUILLON IA à part (nouvelle demande + exécution tracée, entité liée = le
 *   brouillon relu). Elle n'est JAMAIS bloquante : aucune écriture sur le brouillon relu (ni
 *   statut, ni contenu, ni version), aucune dépendance de sa validation envers une revue.
 * - Le brouillon relu est une DONNÉE non fiable (encadrée, jamais dans les consignes) ; le
 *   contexte est produit par le code. Aucun chiffre du modèle : les seuls nombres qu'il peut citer
 *   sont ceux du brouillon que sa propre garde-chiffres n'a pas signalés ; tout autre nombre
 *   marque la revue « chiffres non vérifiés ».
 * - FIN-02 : le contexte ne contient ni coût, ni taux, ni marge, ni budget ; la vue masque
 *   modèle et coût sans `finance.lire`.
 * - Une seule revue active (en file ou en cours) par brouillon, doublé en base (0279).
 */

export const CODE_AGENT_CONTRADICTEUR = "contradicteur";

/** Nombres du brouillon transmis au contradicteur (au plus). */
const CHIFFRES_MAX = 100;

const contenuRevueSchema = z
  .object({
    contre_preuves: z.array(z.string()),
    incoherences: z.array(z.string()),
    affirmations_non_sourcees: z.array(z.string()),
  })
  .strict();

const CONTENU_VIDE = { contre_preuves: [], incoherences: [], affirmations_non_sourcees: [] };

/* ----- Contrôles du brouillon relu ----- */

/** Brouillon relu : terminé, en état « brouillon_ia » ou « modifie », texte conservé, de taille admise. */
function exigerBrouillonRevisable(d: DemandeDb): string {
  if (d.entite_type === TYPE_ENTITE_REVUE_CONTRADICTOIRE) {
    throw brouillonNonRevisable("c'est déjà une revue contradictoire.");
  }
  if (d.statut !== "terminee" || d.g_version === null || d.g_texte === null) {
    throw brouillonNonRevisable("la génération n'a pas produit de contenu.");
  }
  if (d.g_statut_contenu === "valide") {
    throw brouillonNonRevisable("il est déjà validé (définitif).");
  }
  if (d.g_texte_purge_le) throw texteConserveAbsent();
  if (d.g_texte.length > BROUILLON_REVUE_MAX) {
    throw requeteInvalide(
      `Brouillon trop long pour une revue (${BROUILLON_REVUE_MAX} caractères au plus).`,
    );
  }
  return d.g_texte;
}

/** Nombres du brouillon que sa garde-chiffres n'a pas signalés : seuls citables par la revue. */
export function chiffresCitables(texte: string, nonVerifies: readonly string[]): ChiffreContexte[] {
  const signales = new Set(nonVerifies.map((n) => n.trim()));
  const vus = new Set<string>();
  const chiffres: ChiffreContexte[] = [];
  for (const n of extraireNombres(texte)) {
    if (signales.has(n.brut.trim())) continue;
    const cle = `${n.valeur}|${n.pourcentage}`;
    if (vus.has(cle) || !Number.isFinite(n.valeur)) continue;
    vus.add(cle);
    chiffres.push({
      libelle: "Nombre cité dans le brouillon relu",
      valeur: n.valeur,
      ...(n.pourcentage ? { unite: "%" } : {}),
    });
    if (chiffres.length >= CHIFFRES_MAX) break;
  }
  return chiffres;
}

interface MissionRevue {
  intitule: string;
  client: string;
}

/** Contexte fiable (code serveur) : mission et registre des preuves, sans aucune donnée financière. */
async function contexteMission(
  db: Db,
  missionId: string | null,
): Promise<{ contexte: string; mission: MissionRevue | null }> {
  if (!missionId) {
    return {
      contexte: "Brouillon hors mission : aucun registre des preuves à confronter.",
      mission: null,
    };
  }
  const m = await db.query(
    `SELECT m.intitule, c.raison_sociale AS client
     FROM missions m JOIN clients c ON c.id = m.client_id WHERE m.id = $1`,
    [missionId],
  );
  if (!m.rows[0]) throw introuvable("Mission");
  const mission = m.rows[0] as MissionRevue;
  const preuves = await preuvesDeMission(db, missionId, 200);
  const compte = (cle: "fiabilite" | "type_source") => {
    const n = new Map<string, number>();
    for (const p of preuves) n.set(p[cle], (n.get(p[cle]) ?? 0) + 1);
    return [...n.entries()].sort().map(([k, v]) => `${k} : ${v}`);
  };
  const registre =
    preuves.length === 0
      ? "Registre des preuves : aucune preuve enregistrée pour cette mission."
      : `Registre des preuves : ${preuves.length} preuve(s) courante(s) ; ` +
        `par fiabilité (A la plus fiable) : ${compte("fiabilite").join(", ")} ; ` +
        `par type de source : ${compte("type_source").join(", ")}. ` +
        "Le contenu des preuves n'est pas transmis.";
  return { contexte: `Mission : ${mission.intitule}.\n${registre}`, mission };
}

/* ----- Vue ----- */

/** Revue : exécution tracée (AGT-09) + contenu en brouillon, jamais bloquante. */
async function vueRevue(db: Db, auth: Auth, executionId: string): Promise<Record<string, unknown>> {
  const exec = await lireExecution(db, auth, executionId);
  const g = await lireDemandeVisible(db, auth, exec.demande_id as string);
  if (g.entite_type !== TYPE_ENTITE_REVUE_CONTRADICTOIRE) throw introuvable("Revue");
  const contenu = contenuRevueSchema.safeParse(g.g_donnees);
  return {
    ...exec,
    // Identité de la revue = son exécution ; le brouillon relu et le brouillon de la revue.
    generation_id: g.entite_id,
    revue_generation_id: g.id,
    statut_contenu: g.g_statut_contenu,
    version: g.g_version,
    contenu: contenu.success ? contenu.data : CONTENU_VIDE,
    nombres_non_verifies: g.g_nombres_non_verifies ?? [],
    // Contrat : une revue informe, elle ne conditionne rien (ni statut, ni validation).
    bloquante: false,
  };
}

/* ----- Demande ----- */

export interface ResultatDemandeRevue {
  revue: Record<string, unknown>;
  notifications: ResultatExecution["notifications"];
}

/** Une revue de ce brouillon est-elle en file ou en cours ? */
async function revueActive(db: Db, generationId: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM ia_demandes
     WHERE entite_type = $1 AND entite_id = $2 AND statut IN ('en_file', 'en_cours') LIMIT 1`,
    [TYPE_ENTITE_REVUE_CONTRADICTOIRE, generationId],
  );
  return r.rows[0] !== undefined;
}

/**
 * Revue contradictoire d'un brouillon, à la demande de `auth`. Erreurs : 404 (brouillon invisible),
 * 403 (droits), 409 (brouillon non révisable, brique non déclarée, agent inactif, N0, IA
 * indisponible, revue déjà active, plafond, non-régression), 502 (aucune revue exploitable).
 */
export async function demanderRevueContradictoire(
  database: Database,
  deps: DependancesIa,
  auth: Auth,
  generationId: string,
): Promise<ResultatDemandeRevue> {
  const prep = await database.withTenant(auth.cabinetId, (db) =>
    avecErreursAgents(async () => {
      const d = await lireDemandeVisible(db, auth, generationId);
      const brouillon = exigerBrouillonRevisable(d);
      const brique = await db.query(
        "SELECT 1 FROM agents_briques WHERE brique_code = $1 AND agent_code = $2",
        [CODE_BRIQUE_REVUE_CONTRADICTOIRE, CODE_AGENT_CONTRADICTEUR],
      );
      if (!brique.rows[0]) throw briqueRevueAbsente();
      await controlerAgent(
        db,
        auth,
        CODE_AGENT_CONTRADICTEUR,
        CODE_BRIQUE_REVUE_CONTRADICTOIRE,
        "consultant",
      );
      if (await revueActive(db, generationId)) throw revueDejaActive();
      const params = await lireParametres(db);
      if (!params.ia_activee) throw revueIaIndisponible("desactivee");
      if (sourceCleDisponible(params, deps.config) === null) {
        throw revueIaIndisponible("non_configuree");
      }
      await assurerPromptRevueContradictoire(db, auth.cabinetId);
      const { contexte, mission } = await contexteMission(db, d.mission_id);
      return {
        brouillon,
        contexte,
        mission,
        missionId: d.mission_id,
        chiffres: chiffresCitables(brouillon, d.g_nombres_non_verifies ?? []),
      };
    }),
  );
  const termesSensibles: TermeSensible[] = prep.mission
    ? [
        { valeur: prep.mission.client, categorie: "organisation" },
        { valeur: prep.mission.intitule.slice(0, 200), categorie: "autre" },
      ]
    : [];
  const sources: SourceIa[] =
    prep.missionId && prep.mission
      ? [{ type: "mission", id: prep.missionId, libelle: prep.mission.intitule.slice(0, 200) }]
      : [];
  const r = await avecErreursAgents(() =>
    executerAgent(database, deps, {
      utilisateur: auth,
      agentCode: CODE_AGENT_CONTRADICTEUR,
      briqueCode: CODE_BRIQUE_REVUE_CONTRADICTOIRE,
      promptNom: NOM_PROMPT_REVUE_CONTRADICTOIRE,
      variables: {
        [VARIABLE_CONTEXTE_REVUE]: prep.contexte,
        [VARIABLE_BROUILLON_REVUE]: prep.brouillon,
      },
      // Le contexte vient du code ; le brouillon relu reste une donnée non fiable (AGT-07).
      variablesFiables: [VARIABLE_CONTEXTE_REVUE],
      contexteChiffres: prep.chiffres,
      termesSensibles,
      sources,
      entite: {
        missionId: prep.missionId,
        type: TYPE_ENTITE_REVUE_CONTRADICTOIRE,
        id: generationId,
      },
      // Plafond atteint : refus, pas de gabarit (une revue vide laisserait croire à l'absence d'objection).
      repliSiPlafond: false,
      origine: "consultant",
    }),
  );
  if (r.statut !== "terminee") throw revueNonProduite();
  const execution = r.execution as { id: string; mode_degrade?: boolean; sortie_valide?: boolean };
  const revue = await database.withTenant(auth.cabinetId, async (db) => {
    await journaliser(db, {
      cabinetId: auth.cabinetId,
      utilisateurId: auth.utilisateurId,
      action: "revue_contradictoire_demandee",
      entite: "ia_demande",
      entiteId: generationId,
      // Jamais le contenu : exécution, conformité, mode dégradé.
      details: {
        execution_id: execution.id,
        sortie_valide: execution.sortie_valide ?? null,
        mode_degrade: execution.mode_degrade ?? null,
      },
    });
    return vueRevue(db, auth, execution.id);
  });
  // Mode dégradé (sortie du modèle inexploitable) : le gabarit est vide, il ne dit rien du brouillon.
  if (execution.mode_degrade === true || execution.sortie_valide !== true) throw revueNonProduite();
  return { revue, notifications: r.resultat.notifications };
}

/* ----- Lecture ----- */

/** Revues d'un brouillon visible (plus récentes d'abord) et présence d'une revue en cours. */
export async function listerRevuesContradictoires(
  db: Db,
  auth: Auth,
  generationId: string,
  limite: number,
): Promise<{ generation_id: string; revue_active: boolean; elements: Record<string, unknown>[] }> {
  await lireDemandeVisible(db, auth, generationId);
  const r = await db.query(
    `SELECT e.id FROM agents_executions e JOIN ia_demandes d ON d.id = e.demande_id
     WHERE d.entite_type = $1 AND d.entite_id = $2 AND e.agent_code = $3
     ORDER BY e.cree_le DESC, e.id DESC LIMIT $4`,
    [TYPE_ENTITE_REVUE_CONTRADICTOIRE, generationId, CODE_AGENT_CONTRADICTEUR, limite],
  );
  const elements: Record<string, unknown>[] = [];
  for (const ligne of r.rows as { id: string }[]) {
    elements.push(await vueRevue(db, auth, ligne.id));
  }
  return {
    generation_id: generationId,
    revue_active: await revueActive(db, generationId),
    elements,
  };
}

/** Une revue (identifiant de son exécution), ou 404. */
export async function lireRevueContradictoire(db: Db, auth: Auth, id: string) {
  return vueRevue(db, auth, id);
}

/* ----- Préparation (agent.gerer) ----- */

/**
 * Sème le prompt de la revue dans le cabinet et enregistre le jeu d'essai recommandé s'il n'y en a
 * pas : étapes préalables à l'évaluation de non-régression (POST /agents/evaluations). Idempotent.
 */
export async function preparerRevueContradictoire(db: Db, auth: Auth) {
  await assurerPromptRevueContradictoire(db, auth.cabinetId);
  const p = await db.query(
    `SELECT id, nom, version FROM ia_prompts WHERE nom = $1 ORDER BY version DESC LIMIT 1`,
    [NOM_PROMPT_REVUE_CONTRADICTOIRE],
  );
  const jeu = await db.query("SELECT 1 FROM agents_jeux_essai WHERE prompt_nom = $1 LIMIT 1", [
    NOM_PROMPT_REVUE_CONTRADICTOIRE,
  ]);
  let jeuCree = false;
  if (!jeu.rows[0]) {
    await creerJeuEssai(db, auth, JEU_ESSAI_REVUE_CONTRADICTOIRE);
    jeuCree = true;
  }
  return { prompt: p.rows[0], jeu_essai_cree: jeuCree };
}
