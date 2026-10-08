import {
  aPermission,
  type ChiffreContexte,
  type DecisionExecutionAgentApi,
  type SourceIa,
  type TermeSensible,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Database, Db } from "../db/pool.js";
import { interdit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { signauxInjection } from "../ia/donnees-non-fiables.js";
import {
  genererContenu,
  type DependancesIa,
  type EntiteLiee,
  type ResultatExecution,
} from "../ia/orchestrateur.js";
import { chargerPromptActif } from "../ia/prompts.js";
import { validerSortieAgent } from "../ia/sortie-agent.js";
import {
  exigerMissionVisible,
  filtreVisibilite,
  voitToutesLesMissions,
} from "../missions/acces.js";
import {
  etatAutonomie,
  lireBrique,
  lireBriqueParId,
  lireCoupeCircuit,
  type BriqueDb,
} from "./autonomie.js";
import { enregistrerContributionLivrable } from "./contributions.js";
import {
  agentInactif,
  autonomieN0,
  avecErreursAgents,
  contenuNonValide,
  decisionExiste,
  plafondMissionAtteint,
  sortieNonConforme,
  texteConserveAbsent,
} from "./erreurs.js";
import { etatPlafondMission } from "./plafonds.js";
import { droitsManquants, lireAgent, type AgentCabinet } from "./registre.js";

/*
 * Exécutions d'agents (AGT-09, migration 0261). L'orchestrateur IA reste le
 * SEUL composant qui appelle un modèle (ADR-005) : une exécution d'agent EST
 * une demande de l'orchestrateur, enrichie de ce qui la rend transparente.
 *
 * Un agent agit TOUJOURS dans les droits de l'utilisateur qui le déclenche :
 * ia.utiliser et les permissions déclarées par l'agent, mission visible (RLS
 * et visibilité des missions), prompt de l'une de ses tâches.
 *
 * Services internes exportés (utilisables par les autres modules) :
 * - `executerAgent` : contrôle, génération par l'orchestrateur (contenus
 *   clients encadrés comme données non fiables, mode dégradé si le plafond de
 *   la mission est atteint et que l'appelant l'accepte), puis enregistrement ;
 * - `enregistrerExecutionAgent` : trace une demande déjà générée par
 *   l'orchestrateur comme exécution d'un agent ;
 * - `deciderExecution` : décision humaine (acceptée / modifiée / rejetée) et
 *   mesure de la contribution de l'IA (AGT-05).
 */

export interface EntreeEnregistrement {
  auth: Auth;
  agentCode: string;
  briqueCode?: string | null;
  demandeId: string;
  /** Variables traitées comme données non fiables (AGT-07). */
  variablesNonFiables?: readonly string[];
  /** Signaux d'injection relevés dans ces variables (journalisés avec l'exécution). */
  signauxInjection?: readonly string[];
}

interface Contexte {
  agent: AgentCabinet;
  brique: BriqueDb | null;
  niveau: string;
}

/** Contrôles communs : agent actif, droits du déclencheur, brique de l'agent, niveau ≠ N0. */
async function controlerAgent(
  db: Db,
  auth: Auth,
  agentCode: string,
  briqueCode: string | null | undefined,
): Promise<Contexte> {
  const agent = await lireAgent(db, agentCode);
  if (!agent.actif) throw agentInactif();
  if (droitsManquants(auth, agent).length > 0) throw interdit();
  let brique: BriqueDb | null = null;
  let niveau: string = agent.niveau_max;
  if (briqueCode) {
    brique = await lireBrique(db, briqueCode);
    if (brique.agent_code !== agentCode) {
      throw requeteInvalide("Cette brique est confiée à un autre agent.");
    }
    niveau = etatAutonomie(brique, agent, await lireCoupeCircuit(db)).niveau_effectif;
  }
  if (niveau === "N0") throw autonomieN0();
  return { agent, brique, niveau };
}

/**
 * Trace une demande de l'orchestrateur comme exécution d'agent (dans la transaction de
 * l'appelant). La demande doit être terminée, du déclencheur, d'une tâche de l'agent ; la
 * sortie est revalidée contre le contrat de l'agent (AGT-02).
 */
export async function enregistrerExecutionAgent(
  db: Db,
  e: EntreeEnregistrement,
): Promise<Record<string, unknown>> {
  const { agent, brique, niveau } = await controlerAgent(db, e.auth, e.agentCode, e.briqueCode);
  const d = await db.query(
    `SELECT d.id, d.mission_id, d.demandeur_id, d.prompt_nom, d.prompt_version, d.tache, d.statut,
       d.entree_empreinte, g.fournisseur, g.modele, g.cout_micro_usd::text AS cout, g.sources,
       g.gabarit, g.chiffres_non_verifies, g.texte, g.donnees
     FROM ia_demandes d JOIN ia_generations g ON g.demande_id = d.id AND g.version = 1
     WHERE d.id = $1`,
    [e.demandeId],
  );
  const dem = d.rows[0];
  if (!dem || dem.demandeur_id !== e.auth.utilisateurId) throw introuvable("Demande IA");
  if (!(agent.taches as string[]).includes(dem.tache)) {
    throw requeteInvalide("Le prompt ne sert aucune tâche de cet agent.");
  }
  const validation = validerSortieAgent(agent.schema_sortie, {
    texte: dem.texte as string,
    donnees: dem.donnees,
  });
  const r = await avecErreursAgents(() =>
    db.query(
      `INSERT INTO agents_executions (cabinet_id, agent_code, agent_version, brique_id, mission_id,
         demande_id, declencheur_id, niveau_effectif, classe_risque, prompt_nom, prompt_version, tache,
         fournisseur, modele, mode_degrade, cout_micro_usd, sources, entree_empreinte, sortie_valide,
         chiffres_non_verifies, donnees_non_fiables, signaux_injection)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
         $20, $21, $22) RETURNING id`,
      [
        e.auth.cabinetId,
        agent.code,
        agent.version,
        brique?.id ?? null,
        dem.mission_id,
        dem.id,
        e.auth.utilisateurId,
        niveau,
        brique?.classe_risque ?? null,
        dem.prompt_nom,
        dem.prompt_version,
        dem.tache,
        dem.fournisseur,
        dem.modele,
        dem.gabarit,
        dem.cout,
        JSON.stringify(dem.sources ?? []),
        dem.entree_empreinte,
        validation.valide,
        dem.chiffres_non_verifies,
        [...new Set(e.variablesNonFiables ?? [])].sort(),
        [...new Set(e.signauxInjection ?? [])].sort(),
      ],
    ),
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: e.auth.cabinetId,
    utilisateurId: e.auth.utilisateurId,
    action: "execution_agent_ia",
    entite: "agent_execution",
    entiteId: id,
    // Jamais le contenu : agent, brique, niveau, mode dégradé, conformité, signaux.
    details: {
      agent: agent.code,
      brique: brique?.brique_code ?? null,
      niveau_effectif: niveau,
      mode_degrade: dem.gabarit,
      sortie_valide: validation.valide,
      signaux_injection: e.signauxInjection ?? [],
    },
  });
  return lireExecution(db, e.auth, id);
}

export interface DemandeExecutionAgent {
  utilisateur: Auth;
  agentCode: string;
  briqueCode?: string | null;
  promptNom: string;
  variables: Readonly<Record<string, string>>;
  /** Variables portant un contenu client : données non fiables (AGT-07). */
  variablesNonFiables?: readonly string[];
  /** Chiffres CALCULÉS par les moteurs, par le code serveur de l'appelant (jamais d'une requête). */
  contexteChiffres?: readonly ChiffreContexte[];
  termesSensibles?: readonly TermeSensible[];
  sources?: readonly SourceIa[];
  entite?: EntiteLiee;
  /** Plafond (cabinet ou mission) atteint : mode dégradé par gabarit au lieu d'un refus. */
  repliSiPlafond?: boolean;
}

export type ResultatExecutionAgent =
  | { statut: "terminee"; execution: Record<string, unknown>; resultat: ResultatExecution }
  | { statut: "echec" | "annulee"; demande_id: string; resultat: ResultatExecution };

/**
 * Exécute un agent : contrôles (droits du déclencheur, niveau, tâche, plafond de la
 * mission), génération par l'orchestrateur, puis trace de l'exécution. Les notifications
 * renvoyées (`resultat.notifications`) sont à envoyer par l'appelant.
 */
export async function executerAgent(
  database: Database,
  deps: DependancesIa,
  d: DemandeExecutionAgent,
): Promise<ResultatExecutionAgent> {
  const auth = d.utilisateur;
  const maintenant = (deps.horloge ?? (() => new Date()))();
  const missionId = d.entite?.missionId ?? null;
  const modeDegrade = await database.withTenant(auth.cabinetId, async (db) => {
    const { agent } = await controlerAgent(db, auth, d.agentCode, d.briqueCode);
    const prompt = await chargerPromptActif(db, d.promptNom);
    if (!(agent.taches as string[]).includes(prompt.tache)) {
      throw requeteInvalide("Le prompt ne sert aucune tâche de cet agent.");
    }
    if (!missionId) return false;
    await exigerMissionVisible(db, auth, missionId);
    const plafond = await etatPlafondMission(db, missionId, maintenant);
    if (plafond.atteint && !d.repliSiPlafond) throw plafondMissionAtteint();
    return plafond.atteint;
  });
  const nonFiables = [...new Set(d.variablesNonFiables ?? [])];
  const signaux = [
    ...new Set(nonFiables.flatMap((v) => signauxInjection(d.variables[v] ?? ""))),
  ].sort();
  const { demandeId, resultat } = await genererContenu(database, deps, {
    promptNom: d.promptNom,
    variables: d.variables,
    ...(d.contexteChiffres ? { contexteChiffres: d.contexteChiffres } : {}),
    ...(d.termesSensibles ? { termesSensibles: d.termesSensibles } : {}),
    ...(d.sources ? { sources: d.sources } : {}),
    ...(d.entite ? { entite: d.entite } : {}),
    utilisateur: auth,
    repliSiPlafond: d.repliSiPlafond ?? false,
    variablesNonFiables: nonFiables,
    modeDegrade,
  });
  if (resultat.statut !== "terminee") {
    return {
      statut: resultat.statut === "annulee" ? "annulee" : "echec",
      demande_id: demandeId,
      resultat,
    };
  }
  const execution = await database.withTenant(auth.cabinetId, (db) =>
    enregistrerExecutionAgent(db, {
      auth,
      agentCode: d.agentCode,
      briqueCode: d.briqueCode ?? null,
      demandeId,
      variablesNonFiables: nonFiables,
      signauxInjection: signaux,
    }),
  );
  return { statut: "terminee", execution, resultat };
}

/* ----- Lecture ----- */

const COLONNES = `e.id, e.agent_code, e.agent_version, r.nom AS agent_nom, e.brique_id,
  b.brique_code, e.classe_risque, e.mission_id, e.demande_id, e.declencheur_id, u.nom AS declencheur_nom,
  e.niveau_effectif, e.prompt_nom, e.prompt_version, e.tache, e.fournisseur, e.modele, e.mode_degrade,
  e.cout_micro_usd::text AS cout, e.sources, e.entree_empreinte, e.sortie_valide,
  e.chiffres_non_verifies, e.donnees_non_fiables, e.signaux_injection, e.cree_le,
  x.decision, x.taux_modification_pct, x.seuil_pct, x.motif AS decision_motif,
  x.decideur_id, ud.nom AS decideur_nom, x.cree_le AS decision_le`;

const DEPUIS = `agents_executions e
  JOIN agents_registre r ON r.code = e.agent_code AND r.version = e.agent_version
  JOIN utilisateurs u ON u.id = e.declencheur_id
  LEFT JOIN agents_briques b ON b.id = e.brique_id
  LEFT JOIN agents_execution_decisions x ON x.execution_id = e.id
  LEFT JOIN utilisateurs ud ON ud.id = x.decideur_id`;

/** Visibilité : exécution sans mission (déclencheur ou agent.gerer), ou d'une mission visible. */
function visibilite(pGerer: number, pToutes: number, pUtilisateur: number): string {
  return `((e.mission_id IS NULL AND ($${pGerer}::boolean OR e.declencheur_id = $${pUtilisateur}))
    OR (e.mission_id IS NOT NULL AND EXISTS (SELECT 1 FROM missions m WHERE m.id = e.mission_id
        AND ${filtreVisibilite(pToutes, pUtilisateur)})))`;
}

const parametresVisibilite = (auth: Auth) => [
  aPermission(auth.roles, "agent.gerer"),
  voitToutesLesMissions(auth),
  auth.utilisateurId,
];

/** Vue transparente d'une exécution (AGT-09) ; le coût n'apparaît qu'avec finance.lire (FIN-02). */
export function vueExecution(l: Record<string, unknown>, auth: Auth): Record<string, unknown> {
  return {
    id: l.id,
    agent: { code: l.agent_code, version: l.agent_version, nom: l.agent_nom },
    brique: l.brique_id ? { id: l.brique_id, code: l.brique_code } : null,
    classe_risque: l.classe_risque,
    mission_id: l.mission_id,
    demande_id: l.demande_id,
    declencheur: { id: l.declencheur_id, nom: l.declencheur_nom },
    niveau_effectif: l.niveau_effectif,
    prompt: { nom: l.prompt_nom, version: l.prompt_version },
    tache: l.tache,
    fournisseur: l.fournisseur,
    modele: l.modele,
    mode_degrade: l.mode_degrade,
    ...(aPermission(auth.roles, "finance.lire") ? { cout_micro_usd: Number(l.cout) } : {}),
    sources: l.sources,
    entree: { empreinte: l.entree_empreinte },
    sortie_valide: l.sortie_valide,
    chiffres_non_verifies: l.chiffres_non_verifies,
    donnees_non_fiables: l.donnees_non_fiables,
    signaux_injection: l.signaux_injection,
    decision: l.decision
      ? {
          decision: l.decision,
          taux_modification_pct: l.taux_modification_pct,
          seuil_pct: l.seuil_pct,
          motif: l.decision_motif,
          decideur: { id: l.decideur_id, nom: l.decideur_nom },
          cree_le: l.decision_le,
        }
      : null,
    cree_le: l.cree_le,
  };
}

async function lireLigne(db: Db, auth: Auth, id: string): Promise<Record<string, unknown>> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM ${DEPUIS} WHERE e.id = $1 AND ${visibilite(2, 3, 4)}`,
    [id, ...parametresVisibilite(auth)],
  );
  if (!r.rows[0]) throw introuvable("Exécution");
  return r.rows[0];
}

export async function lireExecution(db: Db, auth: Auth, id: string) {
  return vueExecution(await lireLigne(db, auth, id), auth);
}

const CLE_TRI = "lpad(((extract(epoch FROM e.cree_le) * 1000000)::bigint)::text, 17, '0')";

export async function listerExecutions(
  db: Db,
  auth: Auth,
  q: {
    agent?: string | undefined;
    brique?: string | undefined;
    mission_id?: string | undefined;
    limite: number;
    curseur?: string | undefined;
  },
) {
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES}, ${CLE_TRI} AS cle_tri FROM ${DEPUIS}
     WHERE ${visibilite(1, 2, 3)}
       AND ($4::text IS NULL OR e.agent_code = $4)
       AND ($5::text IS NULL OR b.brique_code = $5)
       AND ($6::uuid IS NULL OR e.mission_id = $6)
       AND ($7::text IS NULL OR (${CLE_TRI}, e.id) < ($7, $8::uuid))
     ORDER BY cle_tri DESC, e.id DESC LIMIT $9`,
    [
      ...parametresVisibilite(auth),
      q.agent ?? null,
      q.brique ?? null,
      q.mission_id ?? null,
      apres?.[0] ?? null,
      apres?.[1] ?? null,
      q.limite + 1,
    ],
  );
  const page = paginer(
    r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
    q.limite,
  );
  return { ...page, elements: page.elements.map((l) => vueExecution(l, auth)) };
}

/* ----- Décision humaine ----- */

/**
 * Décision sur une exécution visible (ia.utiliser) : « rejetee » (motif) ou « validee »
 * (contenu validé par le circuit humain de ia/generations). Une validation mesure la
 * contribution de l'IA (moteur pur) et classe la décision : « modifiee » si la
 * modification est majeure, sinon « acceptee ».
 */
export async function deciderExecution(
  db: Db,
  auth: Auth,
  id: string,
  d: DecisionExecutionAgentApi,
): Promise<Record<string, unknown>> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `agents_execution:${id}`,
  ]);
  const l = await lireLigne(db, auth, id);
  if (l.decision) throw decisionExiste();
  if (d.decision === "rejetee") {
    await avecErreursAgents(() =>
      db.query(
        `INSERT INTO agents_execution_decisions (cabinet_id, execution_id, decision, motif, decideur_id)
         VALUES ($1, $2, 'rejetee', $3, $4)`,
        [auth.cabinetId, id, d.motif, auth.utilisateurId],
      ),
    );
  } else {
    if (!l.sortie_valide) throw sortieNonConforme();
    const g = await db.query(
      `SELECT v.texte, v.texte_purge_le, b.texte AS brouillon, b.texte_purge_le AS brouillon_purge_le
       FROM ia_generations v JOIN ia_generations b ON b.demande_id = v.demande_id AND b.version = 1
       WHERE v.demande_id = $1 AND v.statut_contenu = 'valide'`,
      [l.demande_id],
    );
    const v = g.rows[0];
    if (!v) throw contenuNonValide();
    if (v.texte_purge_le || v.brouillon_purge_le) throw texteConserveAbsent();
    const brique = l.brique_id ? await lireBriqueParId(db, l.brique_id as string) : null;
    const c = await avecErreursAgents(() =>
      enregistrerContributionLivrable(db, {
        auth,
        cabinetId: auth.cabinetId,
        livrableType: "ia_demande",
        livrableId: l.demande_id as string,
        missionId: (l.mission_id as string | null) ?? null,
        executionId: id,
        briqueId: brique?.id ?? null,
        agentCode: l.agent_code as string,
        brouillon: v.brouillon as string,
        valide: v.texte as string,
      }),
    );
    await avecErreursAgents(() =>
      db.query(
        `INSERT INTO agents_execution_decisions (cabinet_id, execution_id, decision,
           taux_modification_pct, seuil_pct, decideur_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          auth.cabinetId,
          id,
          c.modification.majeure ? "modifiee" : "acceptee",
          c.modification.tauxModificationPct,
          c.modification.seuilPct,
          auth.utilisateurId,
        ],
      ),
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "decision_execution_agent_ia",
    entite: "agent_execution",
    entiteId: id,
    details: { decision: d.decision },
  });
  return lireExecution(db, auth, id);
}
