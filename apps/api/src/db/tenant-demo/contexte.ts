import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { journaliser } from "../../audit.js";
import type { Config } from "../../config.js";
import type { Database } from "../pool.js";
import { attendre, type Session } from "../seed-demo.js";
import type { CleClient, CleCollaborateur, CleCompte, CleCompteCabinet } from "./cles.js";
import {
  ACTION_MARQUEUR_PHASE,
  AUJOURDHUI,
  DEBUT_ACTIVITE,
  MOT_DE_PASSE_DEMO_TENANT,
  NOM_CABINET_TENANT_DEMO,
} from "./constantes.js";
import { aleaRacine, dateAvant, jour, type Alea } from "./horloge.js";

/*
 * CONTRAT DU SEED « TENANT DÉMO » : le contexte partagé entre le socle et les phases de domaine.
 *
 * Vue d'ensemble (voir aussi index.ts, phases/index.ts, cles.ts, constantes.ts, horloge.ts) :
 *
 *   semerTenantDemo()  (index.ts)
 *     1. ouvre la base, monte l'application Fastify (NODE_ENV=test : muette, aucun envoi) ;
 *     2. `semerSocle(ctx)` (socle.ts) : cabinet, comptes, paramètres, grades, collaborateurs,
 *        absences, clients, contacts, groupes, dossiers, comptes du portail. IDEMPOTENT par
 *        clé naturelle (e-mail, code, raison sociale…) ; remplit TOUT le contexte ci-dessous ;
 *     3. exécute dans l'ordre les `PHASES` (phases/index.ts), une par domaine. Chaque phase
 *        n'écrit QUE dans son fichier `phases/<nom>.ts` ; l'orchestrateur la saute si elle est
 *        déjà marquée faite (`phaseDejaFaite`) et la marque une fois terminée (`marquerPhase`).
 *
 * RÈGLES POUR LES PHASES :
 * - passer par les VRAIES ROUTES (`ctx.sessions[cle].post(...)`, app.inject) ; le SQL du rôle
 *   propriétaire (`ctx.proprietaire`) est réservé à ce que les routes interdisent (dates
 *   passées de création, drapeaux) ;
 * - droits réels : FIN-02 (coûts, taux, marges) = associés et gestionnaires seulement ; utiliser
 *   la session d'un rôle qui a la permission, comme un vrai cabinet ;
 * - dates : horloge fictive (`ctx.jour(offset)`, `ctx.dateAvant(n)`, `ctx.aujourdhui`) et
 *   hasard à graine (`ctx.alea.deriver("<phase>")`), JAMAIS `Date.now()` ni `Math.random()` ;
 * - aucun envoi réel (le contexte est déjà neutralisé) ; adresses en `@tenant-demo.test` ;
 * - ne rien renommer ni modifier de ce que le socle ou une autre phase a créé ;
 * - une phase peut être relancée après un échec : elle doit alors reprendre sans doublon (clé
 *   naturelle) ou échouer avec un message clair ; une phase terminée n'est plus rejouée.
 *
 * Les clés des tables d'identifiants sont celles de `cles.ts` (typées).
 */

export type SessionDemo = Session;

/** Un compte du cabinet ou du portail tel que le socle l'a créé. */
export interface CompteTenant {
  cle: CleCompte;
  email: string;
  nom: string;
  role: string;
  utilisateurId: string;
}

export interface ContexteTenantDemo {
  /** Configuration du seed (garde `configDemo` appliquée ; SMTP retiré en démonstration publique). */
  readonly config: Config;
  /** Base applicative (rôle sans BYPASSRLS), enveloppée par `neutraliserEnvois` si `publique`. */
  readonly database: Database;
  /** Application Fastify montée comme dans seed-demo.ts : `app.inject(...)`. Fermée par l'orchestrateur. */
  readonly app: FastifyInstance;
  /** Client PostgreSQL du rôle PROPRIÉTAIRE (contourne la RLS) : usage exceptionnel, voir ci-dessus. */
  readonly proprietaire: pg.Client;
  /** Démonstration publique confirmée (DEMO_PUBLIQUE=oui + `--confirmer-demo`). */
  readonly publique: boolean;

  /** Identifiant du cabinet « Tenant démo » (renseigné par `semerSocle`). */
  cabinetId: string;

  /** Sessions ouvertes (cookie + get/post/patch/put) par clé de compte : cabinet ET portail. */
  readonly sessions: Partial<Record<CleCompte, SessionDemo>>;
  /** Comptes créés, par clé. */
  readonly comptes: Partial<Record<CleCompte, CompteTenant>>;
  /** Identifiants d'UTILISATEUR par clé de compte (`utilisateurs.id`). */
  readonly utilisateurs: Partial<Record<CleCompte, string>>;
  /** Identifiants de COLLABORATEUR (`collaborateurs.id`) par clé (voir cles.ts). */
  readonly collaborateurs: Partial<Record<CleCollaborateur, string>>;
  /** Identifiants de CLIENT par clé. */
  readonly clients: Partial<Record<CleClient, string>>;
  /** Identifiants de DOSSIER client par clé : identiques à `clients` (le dossier a l'id du client). */
  readonly dossiers: Partial<Record<CleClient, string>>;
  /** Identifiants de grade par code (`stagiaire`, `junior`, `senior`, `manager`, `directeur`, `associe`). */
  readonly grades: Record<string, string>;
  /** Identifiants de type de mission par code (`plan_strategique`, `audit_organisationnel`, `formation`, `assistance`…). */
  readonly typesMission: Record<string, string>;

  /** Début de l'activité fictive (2024-10-01). */
  readonly debut: string;
  /** « Aujourd'hui » fictif (2026-10-24). */
  readonly aujourdhui: string;
  /** Date décalée de `offset` jours par rapport à aujourd'hui (négatif = passé). */
  jour(offset: number): string;
  /** Date située `n` jours avant aujourd'hui. */
  dateAvant(n: number): string;
  /** Flux pseudo-aléatoire racine (graine fixe) : une phase prend `ctx.alea.deriver("<phase>")`. */
  readonly alea: Alea;

  /** Session d'un compte (erreur claire si elle n'existe pas). */
  session(cle: CleCompte): SessionDemo;
  /** Identifiant de collaborateur (erreur claire s'il n'existe pas). */
  collaborateur(cle: CleCollaborateur): string;
  /** Identifiant de client (erreur claire s'il n'existe pas). */
  client(cle: CleClient): string;
  /** Journal de progression (console par défaut). */
  journal(ligne: string): void;
}

/** Fabrique un contexte VIDE (aucune table remplie) : `semerSocle` le complète. */
export function creerContexte(entrees: {
  config: Config;
  database: Database;
  app: FastifyInstance;
  proprietaire: pg.Client;
  publique: boolean;
  journal?: (ligne: string) => void;
}): ContexteTenantDemo {
  const ctx: ContexteTenantDemo = {
    config: entrees.config,
    database: entrees.database,
    app: entrees.app,
    proprietaire: entrees.proprietaire,
    publique: entrees.publique,
    cabinetId: "",
    sessions: {},
    comptes: {},
    utilisateurs: {},
    collaborateurs: {},
    clients: {},
    dossiers: {},
    grades: {},
    typesMission: {},
    debut: DEBUT_ACTIVITE,
    aujourdhui: AUJOURDHUI,
    jour,
    dateAvant,
    alea: aleaRacine(),
    session: (cle) => {
      const s = ctx.sessions[cle];
      if (!s) throw new Error(`Session « ${cle} » indisponible : le socle n'a pas créé ce compte.`);
      return s;
    },
    collaborateur: (cle) => {
      const id = ctx.collaborateurs[cle];
      if (!id) throw new Error(`Collaborateur « ${cle} » introuvable dans le contexte.`);
      return id;
    },
    client: (cle) => {
      const id = ctx.clients[cle];
      if (!id) throw new Error(`Client « ${cle} » introuvable dans le contexte.`);
      return id;
    },
    journal: entrees.journal ?? ((ligne) => console.log(ligne)),
  };
  return ctx;
}

/* ----- Sessions ----- */

/**
 * Session ouverte par la VRAIE route de connexion avec le mot de passe de démonstration du
 * cabinet (`MOT_DE_PASSE_DEMO_TENANT`). Même forme que `ouvrirSession` de seed-demo.ts (qui, lui,
 * code en dur le mot de passe de Lagune) : les fonctions de seed-demo.ts qui reçoivent des
 * `Session` fonctionnent donc avec celles-ci.
 */
export async function ouvrirSessionTenant(
  app: FastifyInstance,
  email: string,
  utilisateurId: string,
): Promise<SessionDemo> {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/connexion",
    payload: { email, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
  });
  attendre(200, r, `connexion ${email}`);
  const c = r.cookies[0];
  if (!c) throw new Error(`Pas de cookie de session pour ${email}`);
  const cookie = `${c.name}=${c.value}`;
  const appel = (method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { cookie },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  return {
    utilisateurId,
    cookie,
    get: (url) => appel("GET", url),
    post: (url, corps = {}) => appel("POST", url, corps),
    patch: (url, corps) => appel("PATCH", url, corps),
    put: (url, corps) => appel("PUT", url, corps),
  };
}

/** Clés des comptes du cabinet (hors portail) qui portent un collaborateur, dans l'ordre de cles.ts. */
export const sansCollaborateur = (cle: CleCompteCabinet): boolean =>
  cle.startsWith("ressources") || cle.startsWith("gestionnaire");

/* ----- Marqueurs de phase (idempotence des phases) ----- */

/** Vrai si la phase `nom` a déjà été menée à son terme dans ce cabinet. */
export async function phaseDejaFaite(ctx: ContexteTenantDemo, nom: string): Promise<boolean> {
  return ctx.database.withTenant(ctx.cabinetId, async (db) => {
    const r = await db.query(
      "SELECT 1 FROM journal_audit WHERE action = $1 AND details->>'phase' = $2 LIMIT 1",
      [ACTION_MARQUEUR_PHASE, nom],
    );
    return (r.rowCount ?? 0) > 0;
  });
}

/** Consigne (journal d'audit du cabinet) qu'une phase est terminée : elle ne sera plus rejouée. */
export async function marquerPhase(ctx: ContexteTenantDemo, nom: string): Promise<void> {
  await ctx.database.withTenant(ctx.cabinetId, (db) =>
    journaliser(db, {
      cabinetId: ctx.cabinetId,
      utilisateurId: null,
      action: ACTION_MARQUEUR_PHASE,
      entite: "cabinet",
      entiteId: ctx.cabinetId,
      details: { phase: nom, cabinet: NOM_CABINET_TENANT_DEMO },
    }),
  );
}

/* ----- Antidatage (SQL propriétaire) ----- */

/**
 * Remonte `cree_le` d'une ligne à `dateISO` (midi UTC) : les routes créent tout « maintenant »,
 * or le cabinet doit paraître ancien. Réservé aux tables à colonne `cree_le` et à clé `id`
 * (nom de table validé : minuscules et tirets bas seulement). Ne touche pas aux autres colonnes.
 */
export async function antidater(
  ctx: ContexteTenantDemo,
  table: string,
  id: string,
  dateISO: string,
): Promise<void> {
  if (!/^[a-z][a-z_]*$/.test(table)) throw new Error(`Nom de table invalide : ${table}`);
  await ctx.proprietaire.query(`UPDATE ${table} SET cree_le = $2::timestamptz WHERE id = $1`, [
    id,
    `${dateISO}T12:00:00Z`,
  ]);
}

export { attendre };
