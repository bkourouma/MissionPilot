import {
  aPermission,
  casEssaiSchema,
  type CasEssai,
  type CauseEvaluationOpenRouter,
  type StatutEvaluationOpenRouter,
  type TacheGenerative,
} from "@missionpilot/shared";
import { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Database, Db } from "../db/pool.js";
import { introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  enregistrerConsommation,
  estimerCoutAppel,
  etatPlafond,
  reserverAppel,
  solderReservation,
  type Consommation,
  type IssueConsommation,
} from "../ia/couts.js";
import { CONSIGNE_DONNEES_NON_FIABLES } from "../ia/donnees-non-fiables.js";
import {
  jugerSortieCas,
  preparerCasEvaluation,
  variablesDansConsignes,
  variablesNonFiablesEvaluation,
  type RaisonEchecCas,
} from "../ia/evaluation.js";
import {
  ErreurLlm,
  estimerTokens,
  fournisseurDepuisConfig,
  type CodeErreurLlm,
  type LlmProvider,
  type ReponseLlm,
} from "../ia/fournisseur.js";
import { blocChiffres } from "../ia/gabarits.js";
import { PLAFOND_EVALUATION_MICRO_USD, MAX_TOKENS_SORTIE, modeleAutorise } from "../ia/modeles.js";
import type { DependancesIa } from "../ia/orchestrateur.js";
import {
  lireParametres,
  modeleDe,
  plafondEffectif,
  resoudreCle,
  sourceCleDisponible,
} from "../ia/parametres.js";
import {
  assurerPromptsExemple,
  chargerPrompt,
  chargerPromptActif,
  type PromptDb,
} from "../ia/prompts.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { HandlerJob } from "../jobs/registre.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import {
  avecErreursAgents,
  evaluationDejaReussie,
  evaluationEnCours,
  iaDesactivee,
  iaNonConfiguree,
  jeuEssaiAbsent,
  plafondEvaluationAtteint,
  plafondEvaluationEstime,
  tropDeRejeux,
} from "./erreurs.js";
import { resultatsSansCout } from "./evaluations.js";
import { lireAgents } from "./registre.js";

/*
 * REJEU RÉEL d'une évaluation de non-régression sur OpenRouter (AGT-04, ADR-005, migration 0270).
 *
 * Jusqu'ici, seule une évaluation sur le fournisseur LOCAL déterministe existait : admise hors
 * production seulement. Ce module rejoue le DERNIER jeu d'essai d'une version de prompt sur le modèle
 * routé de sa tâche par le VRAI fournisseur (ia/fournisseur.ts), par la file `jobs` (ADR-002), et
 * enregistre une évaluation `fournisseur = 'openrouter'` : seule celle-là active un prompt, change un
 * modèle ou autorise un agent en production (réglage `app.evaluation_locale_admise` absent, 0265).
 *
 * MÊME CHAÎNE QUE L'EXÉCUTION D'UN AGENT, cas par cas, sans créer de demande ni de génération
 * (un essai ne produit aucun contenu livrable) : clé résolue (cabinet, sinon plateforme ; jamais
 * de repli sur le fournisseur local), plafond mensuel du cabinet (réservation sous verrou AVANT
 * chaque appel, ia/couts.ts), masquage des données identifiantes, liste blanche de chiffres venue du
 * cas (construite par le code, jamais d'une requête), variables du jeu traitées comme DONNÉES NON
 * FIABLES (neutralisées puis encadrées, AGT-07), sortie validée au schéma du prompt, garde-chiffres,
 * critères exigés/interdits : les MÊMES que le rejeu local (ia/evaluation.ts). Chaque appel est inscrit
 * dans `ia_consommations` (coût réel, jetons) comme toute génération : il compte dans le plafond
 * mensuel.
 *
 * COÛT : estimation prudente avant lancement (409 PLAFOND_EVALUATION_ESTIME si elle dépasse déjà le
 * plafond par évaluation, 409 PLAFOND_IA_ATTEINT si le plafond mensuel ne la couvre pas) ; plafond
 * PAR ÉVALUATION (`PLAFOND_EVALUATION_MICRO_USD`, à valider) vérifié AVANT chaque appel sur le coût
 * engagé + l'estimation du cas, et après : au-delà, l'évaluation s'arrête, est INCOMPLÈTE (cause
 * PLAFOND_EVALUATION) et ne peut jamais activer un prompt. Durée maximale du rejeu :
 * DUREE_MAX_EVALUATION_MS (la file de jobs est traitée job après job).
 *
 * LIMITES DE DEMANDE (un rejeu coûte de l'argent, ceux de l'opérateur avec la clé de plateforme, et
 * occupe le worker) : au plus UN rejeu en file ou en cours par cabinet (index unique, 409
 * EVALUATION_EN_COURS), au plus REJEUX_PAR_JOUR_MAX demandes sur 24 h glissantes par cabinet (429
 * TROP_DE_REJEUX, compté sous le verrou du cabinet), jamais de rejeu d'une combinaison (prompt, jeu
 * d'essai courant, modèle) déjà réussie (409 EVALUATION_DEJA_REUSSIE).
 * SÉPARATION DES TÂCHES : la demande exige `agent.gerer` (qui gère les agents et leurs jeux d'essai),
 * l'ACTIVATION d'un prompt ou le choix d'un modèle exige `ia.configurer` (routes/ia-prompts.ts,
 * ia/parametres) : qui demande l'évaluation n'est donc pas, par le seul rôle, qui active ; la base
 * (MPG04) exige l'évaluation réussie, quelle que soit la personne.
 *
 * CONTENU DES JEUX D'ESSAI : aucun terme sensible n'est connu du masque d'un rejeu (`creerMasque([])`,
 * ia/evaluation.ts) : INTERDICTION de contenu client réel dans un jeu d'essai (textes fictifs ou
 * anonymisés seulement). Une variable de cas insérée dans le message système du prompt est refusée
 * (400 à la demande, comme l'orchestrateur ; cause JEU_ESSAI_INVALIDE si elle apparaît à l'exécution).
 *
 * PROVENANCE : la base n'admet une évaluation `openrouter` que née de la demande en cours, avec ses
 * appels inscrits dans `ia_consommations` (migration 0270) ; limite restante : voir cette migration.
 *
 * AUCUNE NOUVELLE TENTATIVE d'un appel payant : le job a `tentatives_max = 1` et le fournisseur est
 * construit avec une seule tentative. Une erreur du fournisseur arrête l'évaluation (échouée, coût
 * éventuel déjà compté).
 *
 * IDEMPOTENCE : clé de job `agents_evaluation_openrouter:<demande>` (unique par cabinet) ; le job ne
 * démarre que si la demande est « en_file » (transition atomique sous verrou de ligne) : un second
 * passage, un job repris ou doublé ne refait aucun appel payant.
 *
 * ÉTATS d'une demande : en_file, en_cours, puis reussie, echouee (au moins un cas en échec, ou erreur
 * du fournisseur), incomplete (arrêt par un plafond de coût, cas non évalués), ignoree (aucun appel : IA
 * désactivée pour le cabinet, tous les agents de la tâche désactivés, clé absente, jeu ou modèle changé ;
 * rien n'est écrit dans agents_evaluations). Seuls les cas et les codes de raison sont conservés : jamais
 * le texte produit, ni un contenu client, ni la clé.
 *
 * Le coupe-circuit N4 (autonomie vers le client) n'arrête pas ce rejeu : il ne concerne pas les
 * appels internes de l'IA.
 */

export const TYPE_JOB_EVALUATION_OPENROUTER = "agents_evaluation_openrouter";
/** Jamais de nouvelle tentative automatique d'un appel payant. */
export const TENTATIVES_EVALUATION_OPENROUTER = 1;
/** Demande « en_file » depuis (création) plus longtemps : réputée abandonnée (worker arrêté). */
export const PEREMPTION_EN_FILE_MS = 60 * 60_000;
/**
 * Demande « en_cours » depuis (début) plus longtemps : réputée interrompue. Largement au-delà de la
 * durée d'un rejeu (DUREE_MAX_EVALUATION_MS + un appel) pour ne jamais couper un rejeu vivant.
 */
export const PEREMPTION_EN_COURS_MS = 30 * 60_000;
/**
 * Demandes de rejeu réel au plus par cabinet sur 24 heures glissantes (hors « ignoree », qui n'a
 * fait aucun appel). VALEUR DE DÉPART À VALIDER par le métier.
 */
export const REJEUX_PAR_JOUR_MAX = 5;
export const FENETRE_REJEUX_MS = 24 * 60 * 60_000;
/**
 * Durée maximale d'un rejeu (valeur de départ à valider) : le worker traite les jobs l'un après
 * l'autre (file partagée entre cabinets), un rejeu de 50 cas à 60 s d'appel bloquerait la file
 * (relances, e-mails) près d'une heure. Passé ce délai, l'évaluation s'arrête, INCOMPLÈTE (cause
 * DUREE_MAX_ATTEINTE). Le contrôle se fait AVANT chaque appel : la durée réelle peut dépasser de
 * celle d'un appel (IA_TIMEOUT_MS, 300 s au plus). DUREE_MAX + IA_TIMEOUT_MS + marge doit rester
 * inférieur au délai de blocage des jobs du worker (jobs/worker.ts, 15 min), sinon le job serait
 * remis en attente pendant qu'il tourne : test sur les constantes.
 */
export const DUREE_MAX_EVALUATION_MS = 8 * 60_000;

/** Surcoût d'encadrement d'une variable non fiable (consigne, balises), en caractères. */
const SURCOUT_ENCADREMENT = CONSIGNE_DONNEES_NON_FIABLES.length + 200;

export const cleJobEvaluation = (demandeId: string) => `agents_evaluation_openrouter:${demandeId}`;

/** Charge du job : l'identifiant de la demande seul (aucun contenu). */
export const chargeJobEvaluationSchema = z.object({ demande_id: z.string().uuid() }).strict();

const casStockesSchema = z.array(casEssaiSchema);

/** Causes d'un état terminal autre que « reussie » (codes stables, lus par l'écran ; liste partagée). */
export type CauseEvaluation = CauseEvaluationOpenRouter;

/** Même modèle, hors suffixe de variante après « : » (« :free », « :nitro »), sans tenir compte de la casse. */
export function memeModele(servi: string, demande: string): boolean {
  const base = (m: string) => (m.split(":")[0] ?? "").trim().toLowerCase();
  return base(servi) === base(demande);
}

type RaisonCas = RaisonEchecCas | "NON_EVALUE";

/** Résultat d'un cas du rejeu réel : codes de raison, jetons et coût ; jamais le texte produit. */
export interface ResultatCasReel {
  code: string;
  reussi: boolean;
  raisons: RaisonCas[];
  tokens_entree: number;
  tokens_sortie: number;
  cout_micro_usd: number;
}

/* ----- Estimation et demande ----- */

/** Caractères d'entrée prévus pour un cas (gabarits, variables, chiffres, encadrement). */
function caracteresPrevus(prompt: PromptDb, cas: CasEssai): number {
  return (
    prompt.gabarit_systeme.length +
    prompt.gabarit_utilisateur.length +
    Object.values(cas.variables).reduce((n, v) => n + v.length, 0) +
    blocChiffres(cas.chiffres).length +
    variablesNonFiablesEvaluation(prompt, cas).size * SURCOUT_ENCADREMENT
  );
}

/**
 * Coût MAXIMAL estimé (µUSD) du rejeu du jeu sur la version candidate : par cas, jetons d'entrée
 * estimés et plafond de jetons de sortie de la tâche (prudent, comme l'orchestrateur). Le
 * rejeu de la version active, pour les seuls cas en échec, n'y figure pas.
 */
export function estimerCoutEvaluation(
  prompt: PromptDb,
  cas: readonly CasEssai[],
  modele: string,
): number {
  return cas.reduce(
    (total, c) =>
      total +
      estimerCoutAppel(modele, caracteresPrevus(prompt, c), MAX_TOKENS_SORTIE[prompt.tache]),
    0,
  );
}

export interface DemandeEvaluationOpenRouter {
  prompt_id: string;
  modele?: string | undefined;
}

/**
 * Met en file un rejeu réel (dans la transaction de l'appelant) : contrôles, estimation du coût,
 * demande et job naissent ensemble. Refus 409 : jeu d'essai absent (JEU_ESSAI_ABSENT), IA
 * désactivée (IA_DESACTIVEE), aucune clé (IA_NON_CONFIGUREE, jamais de repli local), estimation
 * au-dessus du plafond par évaluation (PLAFOND_EVALUATION_ESTIME), rejeu déjà en file ou en cours
 * pour le cabinet (EVALUATION_EN_COURS), combinaison déjà réussie (EVALUATION_DEJA_REUSSIE),
 * plafond mensuel atteint par l'estimation (PLAFOND_IA_ATTEINT) ; 429 TROP_DE_REJEUX (quota sur
 * 24 h) ; 400 si une variable d'un cas est insérée dans les consignes du prompt.
 */
export async function demanderEvaluationOpenRouter(
  db: Db,
  deps: Pick<DependancesIa, "config" | "horloge">,
  auth: Auth,
  e: DemandeEvaluationOpenRouter,
): Promise<{ demande_id: string; statut: "en_file" }> {
  const maintenant = (deps.horloge ?? (() => new Date()))();
  await assurerPromptsExemple(db, auth.cabinetId);
  const prompt = await chargerPrompt(db, e.prompt_id);
  const jeu = await db.query(
    "SELECT id, cas FROM agents_jeux_essai WHERE prompt_nom = $1 ORDER BY version DESC LIMIT 1",
    [prompt.nom],
  );
  if (!jeu.rows[0]) throw jeuEssaiAbsent();
  const params = await lireParametres(db);
  const modele = e.modele ?? modeleDe(params, prompt.tache);
  if (!modeleAutorise(modele)) {
    throw requeteInvalide("Modèle non autorisé : choisissez un modèle au tarif connu.");
  }
  if (!params.ia_activee) throw iaDesactivee();
  const source = sourceCleDisponible(params, deps.config);
  if (source === null) throw iaNonConfiguree();
  const cas = casStockesSchema.parse(jeu.rows[0].cas);
  // AGT-07 : un contenu de jeu d'essai n'entre jamais dans les consignes (message système).
  const dansConsignes = cas.flatMap((c) =>
    variablesDansConsignes(prompt, c).map((v) => `${c.code} : ${v}`),
  );
  if (dansConsignes.length > 0) {
    throw requeteInvalide(
      `Jeu d'essai refusé : une variable est insérée dans les consignes du prompt (${dansConsignes.join(", ")}).`,
    );
  }
  // Estimation prudente (coût maximal) : refus précoce si elle dépasse déjà le plafond de l'évaluation.
  const estimation = estimerCoutEvaluation(prompt, cas, modele);
  if (estimation > PLAFOND_EVALUATION_MICRO_USD) throw plafondEvaluationEstime();

  // Verrou du cabinet : un seul rejeu en file ou en cours, quota sur 24 h compté sans course. Puis
  // péremption des demandes abandonnées (worker arrêté) qui bloqueraient indéfiniment : « en_file » sur
  // sa création, « en_cours » sur son DÉBUT.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `agents_evaluation_openrouter:${auth.cabinetId}`,
  ]);
  await db.query(
    `UPDATE agents_evaluations_demandes
     SET statut = 'echouee', cause = 'INTERROMPUE', termine_le = now()
     WHERE (statut = 'en_file' AND cree_le < now() - make_interval(secs => $1))
        OR (statut = 'en_cours' AND coalesce(debut_le, cree_le) < now() - make_interval(secs => $2))`,
    [PEREMPTION_EN_FILE_MS / 1000, PEREMPTION_EN_COURS_MS / 1000],
  );
  const enCours = await db.query(
    "SELECT 1 FROM agents_evaluations_demandes WHERE statut IN ('en_file', 'en_cours') LIMIT 1",
  );
  if (enCours.rows[0]) throw evaluationEnCours();
  // Rien à rejouer : cette version a déjà réussi ce jeu (le courant) avec ce modèle.
  const deja = await db.query(
    `SELECT 1 FROM agents_evaluations
     WHERE prompt_id = $1 AND jeu_id = $2 AND modele = $3 AND fournisseur = 'openrouter' AND reussie
     LIMIT 1`,
    [prompt.id, jeu.rows[0].id, modele],
  );
  if (deja.rows[0]) throw evaluationDejaReussie();
  // Quota du cabinet sur 24 h glissantes (une demande « ignoree » n'a fait aucun appel : non comptée).
  const recentes = await db.query(
    `SELECT count(*)::int AS n FROM agents_evaluations_demandes
     WHERE statut <> 'ignoree' AND cree_le > now() - make_interval(secs => $1)`,
    [FENETRE_REJEUX_MS / 1000],
  );
  if ((recentes.rows[0].n as number) >= REJEUX_PAR_JOUR_MAX) throw tropDeRejeux();

  // Plafond mensuel du cabinet : l'estimation doit y tenir (réservations en cours comprises).
  const plafond = plafondEffectif(params, deps.config, source);
  const etat = await etatPlafond(db, auth.cabinetId, plafond, maintenant, estimation);
  if (etat.atteint) throw plafondEvaluationAtteint();

  const r = await avecErreursAgents(async () => {
    try {
      return await db.query(
        `INSERT INTO agents_evaluations_demandes (cabinet_id, jeu_id, prompt_id, modele, cas_total,
           cout_estime_micro_usd, plafond_evaluation_micro_usd, demande_par)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          auth.cabinetId,
          jeu.rows[0].id,
          prompt.id,
          modele,
          cas.length,
          estimation,
          PLAFOND_EVALUATION_MICRO_USD,
          auth.utilisateurId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw evaluationEnCours();
      throw error;
    }
  });
  const demandeId = r.rows[0].id as string;
  const cle = cleJobEvaluation(demandeId);
  const job = await db.query(
    `INSERT INTO jobs (cabinet_id, type, charge, tentatives_max, execute_a, cle)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING RETURNING id`,
    [
      auth.cabinetId,
      TYPE_JOB_EVALUATION_OPENROUTER,
      JSON.stringify({ demande_id: demandeId }),
      TENTATIVES_EVALUATION_OPENROUTER,
      maintenant,
      cle,
    ],
  );
  if (job.rows[0]) {
    await db.query("UPDATE agents_evaluations_demandes SET job_id = $2 WHERE id = $1", [
      demandeId,
      job.rows[0].id,
    ]);
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "demande_evaluation_openrouter_ia",
    entite: "agent_evaluation_demande",
    entiteId: demandeId,
    // Jamais le contenu des cas : prompt, version, modèle, nombre de cas.
    details: { prompt: prompt.nom, version: prompt.version, modele, cas: cas.length },
  });
  return { demande_id: demandeId, statut: "en_file" };
}

/* ----- Lecture ----- */

const COLONNES_DEMANDE = `d.id, d.prompt_id, p.nom AS prompt_nom, p.version AS prompt_version, d.jeu_id,
  j.version AS jeu_version, d.modele, d.statut, d.cause, d.evaluation_id, d.cas_total, d.cas_traites,
  d.appels, d.tokens_entree::text AS tokens_entree, d.tokens_sortie::text AS tokens_sortie,
  d.cout_micro_usd::text AS cout, d.cout_estime_micro_usd::text AS cout_estime,
  d.plafond_evaluation_micro_usd::text AS plafond, d.demande_par, u.nom AS demande_par_nom,
  d.cree_le, d.debut_le, d.termine_le, e.cas_reussis, e.regressions, e.resultats`;
const DEPUIS_DEMANDE = `agents_evaluations_demandes d JOIN ia_prompts p ON p.id = d.prompt_id
  JOIN agents_jeux_essai j ON j.id = d.jeu_id JOIN utilisateurs u ON u.id = d.demande_par
  LEFT JOIN agents_evaluations e ON e.id = d.evaluation_id`;

/**
 * Vue d'une demande : statut, cause, progression et détail par cas (codes de raison seulement).
 * Coût, estimation, plafond et jetons : donnée de gestion (FIN-02), ABSENTE sans `finance.lire`.
 */
function vueDemande(l: Record<string, unknown>, auth: Auth): Record<string, unknown> {
  const { id, cout, cout_estime, plafond, tokens_entree, tokens_sortie, resultats, ...reste } = l;
  const finance = aPermission(auth.roles, "finance.lire");
  return {
    demande_id: id,
    ...reste,
    resultats: finance ? resultats : resultatsSansCout(resultats),
    ...(finance
      ? {
          cout_micro_usd: Number(cout),
          cout_estime_micro_usd: Number(cout_estime),
          plafond_evaluation_micro_usd: Number(plafond),
          tokens_entree: Number(tokens_entree),
          tokens_sortie: Number(tokens_sortie),
        }
      : {}),
  };
}

export async function lireDemandeEvaluation(
  db: Db,
  auth: Auth,
  id: string,
): Promise<Record<string, unknown>> {
  const r = await db.query(`SELECT ${COLONNES_DEMANDE} FROM ${DEPUIS_DEMANDE} WHERE d.id = $1`, [
    id,
  ]);
  if (!r.rows[0]) throw introuvable("Demande d'évaluation");
  return vueDemande(r.rows[0], auth);
}

const CLE_TRI_DEMANDE = "lpad(((extract(epoch FROM d.cree_le) * 1000000)::bigint)::text, 17, '0')";

/** Demandes de rejeu réel d'une version de prompt, de la plus récente à la plus ancienne. */
export async function listerDemandesEvaluation(
  db: Db,
  auth: Auth,
  promptId: string,
  q: { limite: number; curseur?: string | undefined },
) {
  await chargerPrompt(db, promptId); // 404 si la version n'est pas visible du cabinet
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES_DEMANDE}, ${CLE_TRI_DEMANDE} AS cle_tri FROM ${DEPUIS_DEMANDE}
     WHERE d.prompt_id = $1
       AND ($2::text IS NULL OR (${CLE_TRI_DEMANDE}, d.id) < ($2, $3::uuid))
     ORDER BY cle_tri DESC, d.id DESC LIMIT $4`,
    [promptId, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(
    r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
    q.limite,
  );
  return { ...page, elements: page.elements.map((l) => vueDemande(l, auth)) };
}

/* ----- Job ----- */

type Transacteur = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** Issues d'erreur du fournisseur après lesquelles l'appel a pu être facturé (coût estimé inscrit). */
const ISSUES_FACTURABLES: Partial<Record<CodeErreurLlm, IssueConsommation>> = {
  DELAI_DEPASSE: "delai_depasse",
  REPONSE_INVALIDE: "reponse_invalide",
  REPONSE_TROP_GRANDE: "reponse_invalide",
};

interface Depart {
  demandeId: string;
  prompt: PromptDb;
  reference: PromptDb | null;
  cas: CasEssai[];
  modele: string;
  demandeurId: string;
  cle: { cle: string; source: "cabinet" | "plateforme" };
  /** Plafond mensuel du cabinet (µUSD). */
  plafond: number;
  /** Plafond de coût de CETTE évaluation (µUSD), figé à la demande. */
  plafondEvaluation: number;
  fournisseur: LlmProvider;
}

type ResultatDepart = { type: "pret"; depart: Depart } | { type: "rien" };

/** Terminer sans appel (état « ignoree », rien dans agents_evaluations) : tracé et journalisé. */
async function ignorer(
  db: Db,
  cabinetId: string,
  demandeId: string,
  cause: CauseEvaluation,
  maintenant: Date,
): Promise<ResultatDepart> {
  await db.query(
    `UPDATE agents_evaluations_demandes SET statut = 'ignoree', cause = $2, termine_le = $3
     WHERE id = $1 AND statut = 'en_file'`,
    [demandeId, cause, maintenant],
  );
  await journaliser(db, {
    cabinetId,
    utilisateurId: null,
    action: "evaluation_openrouter_ignoree_ia",
    entite: "agent_evaluation_demande",
    entiteId: demandeId,
    details: { cause },
  });
  return { type: "rien" };
}

/**
 * Coupe-circuit IA du cabinet (IA désactivée) ou de l'agent (tous les agents de la tâche coupés) :
 * la cause à signaler, ou null. Relu au démarrage ET avant chaque appel, dans la transaction de
 * réservation (un coupe-circuit actionné pendant un rejeu l'arrête au cas suivant).
 */
async function causeCoupeCircuit(db: Db, tache: TacheGenerative): Promise<CauseEvaluation | null> {
  const params = await lireParametres(db);
  if (!params.ia_activee) return "COUPE_CIRCUIT_IA";
  const servants = (await lireAgents(db)).filter((a) => a.taches.includes(tache));
  if (servants.length > 0 && servants.every((a) => !a.actif)) return "AGENT_DESACTIVE";
  return null;
}

/**
 * Démarrage, en transaction courte sous verrou de la ligne : seule une demande « en_file » démarre
 * (idempotence). Relit les coupe-circuits, le jeu, le modèle et la clé AU MOMENT de l'exécution.
 */
async function demarrer(
  db: Db,
  deps: DependancesIa,
  cabinetId: string,
  demandeId: string,
  maintenant: Date,
): Promise<ResultatDepart> {
  const r = await db.query(
    `SELECT id, prompt_id, jeu_id, modele, statut, demande_par, plafond_evaluation_micro_usd::text AS plafond_ev
     FROM agents_evaluations_demandes WHERE id = $1 FOR UPDATE`,
    [demandeId],
  );
  const d = r.rows[0];
  if (!d || d.statut !== "en_file") return { type: "rien" };
  const ignorerPour = (cause: CauseEvaluation) =>
    ignorer(db, cabinetId, demandeId, cause, maintenant);
  const prompt = await chargerPrompt(db, d.prompt_id as string);
  const dernier = await db.query("SELECT dernier_jeu_essai($1, $2) AS id", [cabinetId, prompt.nom]);
  if (dernier.rows[0]?.id !== d.jeu_id) return ignorerPour("JEU_ESSAI_CHANGE");
  const params = await lireParametres(db);
  const coupe = await causeCoupeCircuit(db, prompt.tache);
  if (coupe) return ignorerPour(coupe);
  if (!modeleAutorise(d.modele as string)) return ignorerPour("MODELE_NON_AUTORISE");
  const fournisseur =
    deps.fournisseur ??
    fournisseurDepuisConfig(deps.config, deps.journal, {
      tentativesMax: 1,
    });
  // Jamais de repli sur le fournisseur local : seul un fournisseur réel produit une évaluation « openrouter ».
  if (fournisseur.nom !== "openrouter") return ignorerPour("FOURNISSEUR_NON_REEL");
  const cle = await resoudreCle(db, deps.config, cabinetId);
  if (cle.statut !== "ok") return ignorerPour("IA_NON_CONFIGUREE");
  const jeu = await db.query("SELECT cas FROM agents_jeux_essai WHERE id = $1", [d.jeu_id]);
  const cas = casStockesSchema.parse(jeu.rows[0].cas);
  // Un contenu de jeu d'essai n'entre jamais dans les consignes (déjà refusé à la demande).
  if (cas.some((c) => variablesDansConsignes(prompt, c).length > 0)) {
    return ignorerPour("JEU_ESSAI_INVALIDE");
  }
  const actif = await chargerPromptActif(db, prompt.nom);
  await db.query(
    "UPDATE agents_evaluations_demandes SET statut = 'en_cours', debut_le = $2 WHERE id = $1",
    [demandeId, maintenant],
  );
  return {
    type: "pret",
    depart: {
      demandeId,
      prompt,
      reference: actif.id === prompt.id ? null : actif,
      cas,
      modele: d.modele as string,
      demandeurId: d.demande_par as string,
      cle: { cle: cle.cle, source: cle.source },
      plafond: plafondEffectif(params, deps.config, cle.source),
      plafondEvaluation: Number(d.plafond_ev),
      fournisseur,
    },
  };
}

interface EtatRejeu {
  /** Heure de début du rejeu (horloge injectable), en millisecondes. */
  debutMs: number;
  cout: number;
  tokensEntree: number;
  tokensSortie: number;
  appels: number;
  notifications: (NotificationCreee | null)[];
}

interface Arret {
  cause: CauseEvaluation;
  statut: "incomplete" | "echouee";
}

const nonEvalue = (code: string): ResultatCasReel => ({
  code,
  reussi: false,
  raisons: ["NON_EVALUE"],
  tokens_entree: 0,
  tokens_sortie: 0,
  cout_micro_usd: 0,
});

/**
 * Rejoue UN cas sur le fournisseur réel : réservation du plafond mensuel avant l'appel, appel hors
 * transaction (aucune nouvelle tentative), solde de la réservation et inscription du coût réel dans
 * la même transaction courte. Cumule coût et jetons dans `etat`.
 */
async function jouerCas(
  transacteur: Transacteur,
  deps: DependancesIa,
  cabinetId: string,
  d: Depart,
  prompt: PromptDb,
  cas: CasEssai,
  etat: EtatRejeu,
): Promise<{ resultat: ResultatCasReel; arret?: Arret }> {
  const horloge = () => (deps.horloge ?? (() => new Date()))();
  // Jamais de contenu de jeu dans les consignes d'un prompt, la version active comprise (comparaison) :
  // sans appel ni résultat (la comparaison l'ignore).
  if (variablesDansConsignes(prompt, cas).length > 0) return { resultat: nonEvalue(cas.code) };
  const prepare = preparerCasEvaluation(prompt, cas, {
    nonFiables: variablesNonFiablesEvaluation(prompt, cas),
  });
  if (!prepare.ok) {
    // Variables du cas incohérentes avec le prompt : échec sans appel, sans coût.
    return {
      resultat: { ...nonEvalue(cas.code), raisons: prepare.raisons },
    };
  }
  // Plafond de l'évaluation AVANT l'appel : coût engagé + estimation (maximale) de ce cas.
  const estimationCas = estimerCoutAppel(
    d.modele,
    prepare.caracteres,
    MAX_TOKENS_SORTIE[prompt.tache],
  );
  if (etat.cout + estimationCas > d.plafondEvaluation) {
    return {
      resultat: nonEvalue(cas.code),
      arret: { cause: "PLAFOND_EVALUATION", statut: "incomplete" },
    };
  }
  if (horloge().getTime() - etat.debutMs > DUREE_MAX_EVALUATION_MS) {
    return {
      resultat: nonEvalue(cas.code),
      arret: { cause: "DUREE_MAX_ATTEINTE", statut: "incomplete" },
    };
  }
  const maintenant = horloge();
  // Coupe-circuits relus AVANT chaque appel, dans la transaction de réservation.
  const reservation = await transacteur(async (db) => {
    const coupe = await causeCoupeCircuit(db, prompt.tache);
    if (coupe) return { statut: "coupe" as const, cause: coupe };
    return reserverAppel(db, {
      cabinetId,
      demandeId: null,
      estimation: estimationCas,
      plafond: d.plafond,
      maintenant,
    });
  });
  if (reservation.statut === "coupe") {
    return {
      resultat: nonEvalue(cas.code),
      arret: { cause: reservation.cause, statut: "incomplete" },
    };
  }
  if (reservation.statut === "plafond") {
    return {
      resultat: nonEvalue(cas.code),
      arret: { cause: "PLAFOND_IA_ATTEINT", statut: "incomplete" },
    };
  }
  if (reservation.statut === "simultanees") {
    return {
      resultat: nonEvalue(cas.code),
      arret: { cause: "GENERATIONS_SIMULTANEES", statut: "incomplete" },
    };
  }
  const base = {
    cabinetId,
    demandeId: null,
    evaluationDemandeId: d.demandeId,
    missionId: null,
    tache: prompt.tache,
    modele: d.modele,
    sourceCle: d.cle.source,
  } as const;
  let consommation: Consommation | null = null;
  let raisons: RaisonCas[] = [];
  let arret: Arret | undefined;
  let tokensEntree = 0;
  let tokensSortie = 0;
  let rep: ReponseLlm | null = null;
  try {
    rep = await d.fournisseur.completer({
      tache: prompt.tache,
      modele: d.modele,
      messages: prepare.messages,
      maxTokens: MAX_TOKENS_SORTIE[prompt.tache],
      formatJson: prompt.schema_sortie.type === "objet",
      cleApi: d.cle.cle,
    });
  } catch (error) {
    // Erreur réseau, 429, délai : aucune nouvelle tentative ; l'évaluation s'arrête, échouée.
    raisons = ["ERREUR_FOURNISSEUR"];
    const code = error instanceof ErreurLlm ? error.code : undefined;
    arret = { cause: code ?? "ERREUR_INATTENDUE", statut: "echouee" };
    const issue = code ? ISSUES_FACTURABLES[code] : undefined;
    if (issue) {
      // L'appel a pu être facturé sans réponse exploitable : coût ESTIMÉ.
      tokensEntree = estimerTokens(prepare.caracteres);
      tokensSortie = MAX_TOKENS_SORTIE[prompt.tache];
      consommation = { ...base, issue, tokensEntree, tokensSortie, dureeMs: 0 };
    }
  }
  if (rep) {
    // Réponse obtenue (donc facturée) : son coût est TOUJOURS inscrit, même si le jugement échoue.
    tokensEntree = rep.tokensEntree;
    tokensSortie = rep.tokensSortie;
    let issue: IssueConsommation = "sortie_invalide";
    if (!memeModele(rep.modele, d.modele)) {
      // Le fournisseur a servi un AUTRE modèle (routage, repli) : l'évaluation ne vaut pas pour le
      // modèle demandé ; la réponse n'est pas jugée et l'appel ne compte pas comme réussi.
      raisons = ["ERREUR_FOURNISSEUR"];
      arret = { cause: "MODELE_SERVI_DIFFERENT", statut: "echouee" };
    } else {
      try {
        const jugement = jugerSortieCas(prompt, cas, prepare.masque, rep.texte);
        raisons = jugement.raisons;
        if (jugement.conforme) issue = "succes";
      } catch {
        raisons = ["SORTIE_NON_CONFORME"];
        arret = { cause: "ERREUR_INATTENDUE", statut: "echouee" };
      }
    }
    consommation = { ...base, issue, tokensEntree, tokensSortie, dureeMs: rep.dureeMs };
  }
  const aInscrire = consommation;
  let cout = 0;
  try {
    cout = await transacteur(async (db) => {
      await solderReservation(db, reservation.id);
      if (!aInscrire) return 0;
      const c = await enregistrerConsommation(db, aInscrire, d.plafond, maintenant);
      // Progression lisible pendant l'exécution : coût, jetons, appels (la ligne est à nous).
      await db.query(
        `UPDATE agents_evaluations_demandes
         SET cout_micro_usd = $2, tokens_entree = $3, tokens_sortie = $4, appels = $5
         WHERE id = $1`,
        [
          d.demandeId,
          etat.cout + c.cout,
          etat.tokensEntree + tokensEntree,
          etat.tokensSortie + tokensSortie,
          etat.appels + 1,
        ],
      );
      etat.notifications.push(...c.notifications);
      return c.cout;
    });
  } catch (error) {
    // Inscription impossible : la réservation ne doit pas peser sur le plafond mensuel (30 min).
    await transacteur((db) => solderReservation(db, reservation.id)).catch(() => undefined);
    throw error;
  }
  if (aInscrire) {
    etat.cout += cout;
    etat.tokensEntree += tokensEntree;
    etat.tokensSortie += tokensSortie;
    etat.appels += 1;
  }
  // Plafond de l'évaluation franchi par cet appel : arrêt (priorité sur une réussite).
  if (etat.cout > d.plafondEvaluation && (!arret || arret.statut !== "echouee")) {
    arret = { cause: "PLAFOND_EVALUATION", statut: "incomplete" };
  }
  return {
    resultat: {
      code: cas.code,
      reussi: raisons.length === 0,
      raisons,
      tokens_entree: tokensEntree,
      tokens_sortie: tokensSortie,
      cout_micro_usd: cout,
    },
    ...(arret ? { arret } : {}),
  };
}

/** Rejeu complet d'une demande : démarrage, cas, comparaison, enregistrement. */
async function executerEvaluation(
  transacteur: Transacteur,
  deps: DependancesIa,
  cabinetId: string,
  demandeId: string,
): Promise<(NotificationCreee | null)[]> {
  const horloge = () => (deps.horloge ?? (() => new Date()))();
  const depart = await transacteur((db) => demarrer(db, deps, cabinetId, demandeId, horloge()));
  if (depart.type === "rien") return [];
  const d = depart.depart;
  const etat: EtatRejeu = {
    debutMs: horloge().getTime(),
    cout: 0,
    tokensEntree: 0,
    tokensSortie: 0,
    appels: 0,
    notifications: [],
  };

  // Version candidate : tous les cas, dans l'ordre, jusqu'à un arrêt.
  const resultats: ResultatCasReel[] = [];
  let arret: Arret | undefined;
  for (const cas of d.cas) {
    if (arret) {
      resultats.push(nonEvalue(cas.code));
      continue;
    }
    const j = await jouerCas(transacteur, deps, cabinetId, d, d.prompt, cas, etat);
    resultats.push(j.resultat);
    if (j.arret) arret = j.arret;
  }

  // Comparaison à la version active, pour les SEULS cas échoués par la candidate (une régression
  // exige un échec) : information, jamais une condition de réussite ; arrêt silencieux sur plafond.
  const referenceReussi = new Map<string, boolean | null>();
  const enEchec = resultats.filter((r) => !r.raisons.includes("NON_EVALUE") && !r.reussi);
  if (d.reference && !arret && enEchec.length > 0) {
    let stop = false;
    for (const r of enEchec) {
      const cas = d.cas.find((c) => c.code === r.code);
      if (!cas || stop) continue;
      const ref = await jouerCas(transacteur, deps, cabinetId, d, d.reference, cas, etat);
      if (ref.arret) stop = true;
      else if (!ref.resultat.raisons.includes("NON_EVALUE")) {
        referenceReussi.set(r.code, ref.resultat.reussi);
      }
    }
  }

  const details = resultats.map((r) => ({
    code: r.code,
    reussi: r.reussi,
    raisons: r.raisons,
    reference_reussi: referenceReussi.get(r.code) ?? null,
    tokens_entree: r.tokens_entree,
    tokens_sortie: r.tokens_sortie,
    cout_micro_usd: r.cout_micro_usd,
  }));
  const reussis = details.filter((x) => x.reussi).length;
  const regressions = details.filter((x) => x.reference_reussi === true && !x.reussi).length;
  const traites = details.filter((x) => !x.raisons.includes("NON_EVALUE")).length;
  const statut: StatutEvaluationOpenRouter = arret
    ? arret.statut
    : reussis === details.length
      ? "reussie"
      : "echouee";
  const cause: CauseEvaluation | null = arret
    ? arret.cause
    : statut === "echouee"
      ? "CAS_ECHOUES"
      : null;
  const maintenant = horloge();

  await transacteur(async (db) => {
    const ev = await avecErreursAgents(() =>
      db.query(
        `INSERT INTO agents_evaluations (cabinet_id, jeu_id, prompt_id, prompt_reference_id, modele,
           fournisseur, cas_total, cas_reussis, regressions, reussie, resultats, cout_micro_usd,
           tokens_entree, tokens_sortie, statut, cause, demande_id, lance_par)
         SELECT d.cabinet_id, d.jeu_id, d.prompt_id, $2::uuid, d.modele, 'openrouter', $3::int, $4::int,
           $5::int, $6::boolean, $7::jsonb, $8::bigint, $9::bigint, $10::bigint, $11::text, $12::text,
           d.id, d.demande_par
         FROM agents_evaluations_demandes d WHERE d.id = $1 RETURNING id`,
        [
          demandeId,
          d.reference?.id ?? null,
          details.length,
          reussis,
          regressions,
          statut === "reussie",
          JSON.stringify(details),
          etat.cout,
          etat.tokensEntree,
          etat.tokensSortie,
          statut,
          cause,
        ],
      ),
    );
    await db.query(
      `UPDATE agents_evaluations_demandes
       SET statut = $2, cause = $3, evaluation_id = $4, cas_traites = $5, termine_le = $6
       WHERE id = $1`,
      [demandeId, statut, cause, ev.rows[0].id, traites, maintenant],
    );
    await journaliser(db, {
      cabinetId,
      utilisateurId: null,
      action: "evaluation_openrouter_ia",
      entite: "agent_evaluation_demande",
      entiteId: demandeId,
      // Traçabilité sans contenu : prompt, modèle, résultat, jetons ; jamais un texte ni la clé.
      details: {
        prompt: d.prompt.nom,
        version: d.prompt.version,
        modele: d.modele,
        fournisseur: "openrouter",
        source_cle: d.cle.source,
        statut,
        cause,
        cas_total: details.length,
        cas_reussis: reussis,
        regressions,
        appels: etat.appels,
        tokens_entree: etat.tokensEntree,
        tokens_sortie: etat.tokensSortie,
      },
    });
  });
  return etat.notifications;
}

/** Termine une demande restée en file ou en cours par une erreur interne (sans jamais rappeler). */
async function terminerEnErreur(transacteur: Transacteur, demandeId: string): Promise<void> {
  await transacteur((db) =>
    db.query(
      `UPDATE agents_evaluations_demandes
       SET statut = 'echouee', cause = 'ERREUR_INTERNE', termine_le = now()
       WHERE id = $1 AND statut IN ('en_file', 'en_cours')`,
      [demandeId],
    ),
  ).catch(() => undefined);
}

/**
 * Handler du job `agents_evaluation_openrouter` (REGISTRE_JOBS). Dans le contexte RLS du cabinet ;
 * les transactions du rejeu sont COURTES et SÉPARÉES de celle du job (`ctx.database`) : réservation,
 * coût et progression visibles des autres appels pendant l'exécution. `tentatives_max = 1` : toute
 * erreur termine la demande en « echouee » (ERREUR_INTERNE), jamais de nouvelle tentative payante.
 */
export function creerHandlerEvaluationOpenRouter(dependances: () => DependancesIa): HandlerJob {
  return async (ctx) => {
    const charge = chargeJobEvaluationSchema.safeParse(ctx.charge);
    if (!charge.success) return [];
    const demandeId = charge.data.demande_id;
    const database: Database | undefined = ctx.database;
    if (!database) {
      // Hors worker (sans base de l'application) : aucun appel dans la transaction du job.
      await ctx.db.query(
        `UPDATE agents_evaluations_demandes
         SET statut = 'echouee', cause = 'ERREUR_INTERNE', termine_le = $2
         WHERE id = $1 AND statut = 'en_file'`,
        [demandeId, ctx.maintenant],
      );
      return [];
    }
    const transacteur: Transacteur = (fn) => database.withTenant(ctx.cabinetId, fn);
    try {
      return await executerEvaluation(transacteur, dependances(), ctx.cabinetId, demandeId);
    } catch {
      // Le message natif n'est jamais repris (il pourrait citer un contenu) : cause stable. Le job
      // passe en échec définitif (tentatives_max = 1) ; le coût déjà engagé reste compté.
      await terminerEnErreur(transacteur, demandeId);
      throw new ErreurJobDefinitive("Rejeu de l'évaluation interrompu : erreur interne.");
    }
  };
}
