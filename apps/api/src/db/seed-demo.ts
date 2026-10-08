import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { ajouterJours } from "@missionpilot/engines";
import type { Role } from "@missionpilot/shared";
import { buildApp } from "../app.js";
import type { Auth } from "../auth/contexte.js";
import { hashPassword } from "../auth/password.js";
import { baseLocale, estLocal, loadConfig, type Config } from "../config.js";
import { emettre, lireFacture } from "../facturation/factures.js";
import { createDatabase, type Database } from "./pool.js";
import type { ResumePortail } from "./seed-demo-portail.js";

/*
 * Cabinet de démonstration pour la RECETTE HUMAINE des écrans (jamais en
 * production). Contrairement à `seed.ts` (insertions directes), tout passe par
 * les vraies routes de l'API (app.inject) : budget figé à la signature,
 * circuit de validation des factures, numérotation continue, périodes de
 * temps, notifications. Seule exception : l'émission d'une facture à une date
 * passée appelle la fonction métier `emettre` (même code que la route, le
 * paramètre de date est réservé au seed et aux tests).
 *
 * Toutes les entreprises et personnes sont fictives ; les adresses en `.test`
 * ne reçoivent rien. Aucun e-mail ne part : l'application est montée avec
 * NODE_ENV=test (transport muet) et le script refuse SMTP_HOST.
 *
 * En fin d'exécution, `seed-demo-portail.ts` ajoute les comptes du PORTAIL
 * client de démonstration et leur jeu de données (même garde, mêmes routes) ;
 * il se lance aussi seul sur une base déjà peuplée par ce script
 * (`db:seed-demo-portail`).
 *
 * Lancement : `pnpm --filter @missionpilot/api db:seed-demo`.
 * Idempotent par refus : si le cabinet existe déjà, rien n'est écrit. Pour
 * repartir de zéro, utiliser une base neuve.
 */

/** Mot de passe de TOUS les comptes de démonstration : développement local seulement. */
export const MOT_DE_PASSE_DEMO_ABIDJAN = "Demo-Abidjan-2026";
export const NOM_CABINET_ABIDJAN = "Lagune Conseil & Associés (démo)";
const DOMAINE = "lagune-conseil.test";

export const emailAbidjan = (cle: string) => `${cle}@${DOMAINE}`;

interface Personne {
  cle: string;
  role: Role;
  nom: string;
  /** Code de grade, ou null sans collaborateur (fonctions support). */
  grade: string | null;
  cout: number | null;
  type?: "interne" | "externe";
}

const PERSONNES: readonly Personne[] = [
  { cle: "associe", role: "associe", nom: "Awa Koné", grade: "associe", cout: 300_000 },
  {
    cle: "directeur.mission",
    role: "directeur_mission",
    nom: "Yao Kouassi",
    grade: "directeur",
    cout: 220_000,
  },
  {
    cle: "chef.mission",
    role: "chef_mission",
    nom: "Mariam Traoré",
    grade: "manager",
    cout: 150_000,
  },
  { cle: "consultant", role: "consultant", nom: "Koffi N'Guessan", grade: "senior", cout: 90_000 },
  {
    cle: "consultant.junior",
    role: "consultant",
    nom: "Adjoua Kacou",
    grade: "junior",
    cout: 50_000,
  },
  { cle: "ressources", role: "ressources", nom: "Fatou Diallo", grade: null, cout: null },
  { cle: "gestionnaire", role: "gestionnaire", nom: "Serge Bamba", grade: null, cout: null },
  {
    cle: "expert.metier",
    role: "expert_metier",
    nom: "Aminata Ouattara",
    grade: "manager",
    cout: 160_000,
  },
  {
    cle: "expert.externe",
    role: "expert_externe",
    nom: "Ibrahim Sanogo",
    grade: "senior",
    cout: 120_000,
    type: "externe",
  },
];

const CLIENTS = [
  {
    raison_sociale: "Kora Agro-Industries (fictif)",
    forme_juridique: "SA",
    secteur: "Agro-industrie",
    taille: "grande_entreprise",
  },
  {
    raison_sociale: "Lagune Microfinance (fictif)",
    forme_juridique: "SA",
    secteur: "Microfinance",
    taille: "pme",
  },
  {
    raison_sociale: "Transports Akwaba (fictif)",
    forme_juridique: "SARL",
    secteur: "Transport et logistique",
    taille: "pme",
  },
  {
    raison_sociale: "Mutuelle des Enseignants Abidjan (fictif)",
    forme_juridique: "Mutuelle",
    secteur: "Assurance",
    taille: "eti",
  },
  {
    raison_sociale: "Cacao Savane Export (fictif)",
    forme_juridique: "SA",
    secteur: "Agro-industrie",
    taille: "eti",
  },
] as const;

type Reponse = Pick<LightMyRequestResponse, "statusCode" | "body" | "json">;

export function attendre(statut: number, r: Reponse, quoi: string): void {
  if (r.statusCode !== statut) throw new Error(`${quoi} : HTTP ${r.statusCode} ${r.body}`);
}

/** Session ouverte par la vraie route de connexion. */
export interface Session {
  utilisateurId: string;
  /** En-tête `cookie` de la session (requêtes que `get/post/…` ne couvrent pas : multipart). */
  cookie: string;
  get(url: string): Promise<Reponse>;
  post(url: string, corps?: unknown): Promise<Reponse>;
  patch(url: string, corps: unknown): Promise<Reponse>;
  put(url: string, corps: unknown): Promise<Reponse>;
}

export async function ouvrirSession(
  app: FastifyInstance,
  email: string,
  utilisateurId: string,
): Promise<Session> {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/connexion",
    payload: { email, mot_de_passe: MOT_DE_PASSE_DEMO_ABIDJAN },
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

/* ----- Dates (relatives à aujourd'hui, lundis) ----- */

export function aujourdhuiISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Lundi de la semaine de `date`. */
export function lundi(date: string): string {
  const jour = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = dimanche
  return ajouterJours(date, -((jour + 6) % 7));
}

/** Jours répartis du lundi au vendredi, 1 jour au plus par jour (demi-journées). */
function lignesSemaine(
  debut: string,
  travaux: readonly { tache_id: string; jours: number }[],
): { date: string; tache_id: string; jours: number }[] {
  const lignes: { date: string; tache_id: string; jours: number }[] = [];
  let jour = 0;
  let libre = 2;
  for (const t of travaux) {
    let reste = Math.round(t.jours * 2);
    while (reste > 0 && jour < 5) {
      const pris = Math.min(reste, libre);
      const date = ajouterJours(debut, jour);
      const existante = lignes.find((l) => l.date === date && l.tache_id === t.tache_id);
      if (existante) existante.jours += pris / 2;
      else lignes.push({ date, tache_id: t.tache_id, jours: pris / 2 });
      reste -= pris;
      libre -= pris;
      if (libre === 0) {
        jour++;
        libre = 2;
      }
    }
  }
  return lignes;
}

/* ----- Garde : base locale, hors production ----- */

/** Refuse net toute exécution hors machine locale ; renvoie la configuration validée. */
export function configDemo(env: NodeJS.ProcessEnv = process.env): Config {
  if (env.NODE_ENV === "production" || !estLocal(env.NODE_ENV)) {
    throw new Error("Le seed de démonstration est interdit hors développement (NODE_ENV).");
  }
  if (!baseLocale(env.DATABASE_URL) || !baseLocale(env.DATABASE_OWNER_URL)) {
    throw new Error(
      "Le seed de démonstration ne s'exécute que sur une base PostgreSQL locale " +
        "(DATABASE_URL et DATABASE_OWNER_URL sur localhost, 127.0.0.1 ou ::1).",
    );
  }
  if (env.SMTP_HOST) {
    throw new Error(
      "SMTP_HOST est défini : le seed de démonstration ne doit envoyer aucun e-mail.",
    );
  }
  return loadConfig(env);
}

/* ----- Semis ----- */

interface Equipe {
  /** Utilisateurs par clé de PERSONNES. */
  sessions: Record<string, Session>;
  /** Collaborateurs (identifiants) par clé de PERSONNES. */
  collaborateurs: Record<string, string>;
  grades: Record<string, string>;
  clients: Record<string, string>;
  typePlanId: string;
  typeAuditId: string;
  typeFormationId: string;
}

async function creerCabinetEtComptes(
  db: Database,
): Promise<{ cabinetId: string; ids: Record<string, string> } | null> {
  const emailAssocie = emailAbidjan("associe");
  const existe = await db.withoutTenant(async (c) => {
    const r = await c.query("SELECT 1 FROM trouver_connexion($1)", [emailAssocie]);
    return r.rowCount ?? 0;
  });
  if (existe) return null;
  const hash = await hashPassword(MOT_DE_PASSE_DEMO_ABIDJAN);
  const premier = PERSONNES[0] as Personne;
  const cabinetId = await db.withoutTenant(async (c) => {
    const r = await c.query("SELECT creer_cabinet($1, 'CI', $2, $3, $4) AS id", [
      NOM_CABINET_ABIDJAN,
      emailAssocie,
      premier.nom,
      hash,
    ]);
    return r.rows[0].id as string;
  });
  const ids: Record<string, string> = {};
  await db.withTenant(cabinetId, async (c) => {
    for (const p of PERSONNES) {
      const email = emailAbidjan(p.cle);
      const existant = await c.query("SELECT id FROM utilisateurs WHERE lower(email) = $1", [
        email,
      ]);
      ids[p.cle] =
        (existant.rows[0]?.id as string | undefined) ??
        (
          await c.query(
            `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [cabinetId, email, p.nom, [p.role], hash],
          )
        ).rows[0].id;
    }
  });
  return { cabinetId, ids };
}

async function preparerReferentiels(
  app: FastifyInstance,
  ids: Record<string, string>,
): Promise<Equipe> {
  const sessions: Record<string, Session> = {};
  for (const p of PERSONNES) {
    sessions[p.cle] = await ouvrirSession(app, emailAbidjan(p.cle), ids[p.cle] as string);
  }
  const associe = sessions.associe as Session;
  attendre(200, await associe.post("/api/catalogue/semer-conseil"), "catalogue");

  const grades = Object.fromEntries(
    (await associe.get("/api/grades"))
      .json()
      .elements.map((g: { code: string; id: string }) => [g.code, g.id]),
  ) as Record<string, string>;
  const types = (await associe.get("/api/types-mission")).json().elements as {
    code: string;
    id: string;
  }[];
  const type = (code: string) => (types.find((t) => t.code === code) as { id: string }).id;

  const clients: Record<string, string> = {};
  for (const c of CLIENTS) {
    const r = await associe.post("/api/clients", {
      ...c,
      pays: "CI",
      adresse: "Abidjan, Côte d'Ivoire",
    });
    attendre(201, r, `client ${c.raison_sociale}`);
    clients[c.raison_sociale] = r.json().id;
    attendre(
      201,
      await associe.post(`/api/clients/${r.json().id}/contacts`, {
        nom: "Contact Démo",
        fonction: "Directeur général",
        email: `contact.${(r.json().id as string).slice(0, 8)}@client.test`,
        principal: true,
      }),
      "contact",
    );
  }

  const collaborateurs: Record<string, string> = {};
  for (const p of PERSONNES) {
    if (!p.grade) continue;
    const r = await associe.post("/api/collaborateurs", {
      nom: p.nom,
      utilisateur_id: ids[p.cle],
      grade_id: grades[p.grade],
      type: p.type ?? "interne",
      competences: ["Stratégie", "Finance"],
    });
    attendre(201, r, `collaborateur ${p.nom}`);
    collaborateurs[p.cle] = r.json().id;
    attendre(
      201,
      await associe.post(`/api/collaborateurs/${r.json().id}/couts`, {
        cout_journalier: p.cout,
        devise: "XOF",
        depuis_le: `${new Date().getUTCFullYear()}-01-01`,
      }),
      `coûts ${p.nom}`,
    );
  }

  return {
    sessions,
    collaborateurs,
    grades,
    clients,
    typePlanId: type("plan_strategique"),
    typeAuditId: type("audit_organisationnel"),
    typeFormationId: type("formation"),
  };
}

/** Cycle commercial : pipeline, puis une proposition acceptée devenue mission « proposition ». */
async function semerPipeline(e: Equipe): Promise<string> {
  const chef = e.sessions["chef.mission"] as Session;
  const associe = e.sessions.associe as Session;
  const directeur = e.sessions["directeur.mission"] as Session;
  const client = (nom: string) => e.clients[nom] as string;

  const opps = [
    [
      "Audit organisationnel du réseau d'agences",
      "Lagune Microfinance (fictif)",
      e.typeAuditId,
      18_000_000,
      30,
      "qualification",
    ],
    [
      "Formation des managers de proximité",
      "Mutuelle des Enseignants Abidjan (fictif)",
      e.typeFormationId,
      6_500_000,
      20,
      "prospection",
    ],
    [
      "Plan stratégique 2027-2031 Cacao Savane",
      "Cacao Savane Export (fictif)",
      e.typePlanId,
      32_000_000,
      70,
      "negociation",
    ],
  ] as const;
  for (const [intitule, cl, type, montant, probabilite, etape] of opps) {
    attendre(
      201,
      await chef.post("/api/opportunites", {
        client_id: client(cl),
        intitule,
        type_mission_id: type,
        montant_estime: montant,
        probabilite,
        etape,
      }),
      `opportunité ${intitule}`,
    );
  }
  const perdue = await chef.post("/api/opportunites", {
    client_id: client("Mutuelle des Enseignants Abidjan (fictif)"),
    intitule: "Refonte du dispositif de contrôle interne",
    type_mission_id: e.typeAuditId,
    montant_estime: 9_000_000,
    probabilite: 40,
    etape: "proposition",
  });
  attendre(201, perdue, "opportunité perdue");
  attendre(
    200,
    await chef.post(`/api/opportunites/${perdue.json().id}/issue`, {
      statut: "perdue",
      motif_perte: "Budget reporté à l'exercice suivant.",
    }),
    "issue perdue",
  );

  // Opportunité gagnée : proposition validée par l'associé, envoyée, acceptée, puis mission.
  const opp = await chef.post("/api/opportunites", {
    client_id: client("Kora Agro-Industries (fictif)"),
    intitule: "Plan stratégique 2027-2031 Kora",
    type_mission_id: e.typePlanId,
    montant_estime: 45_000_000,
    probabilite: 60,
    etape: "proposition",
  });
  attendre(201, opp, "opportunité Kora");
  const prop = await chef.post(`/api/opportunites/${opp.json().id}/propositions`, {});
  attendre(201, prop, "proposition");
  const url = `/api/propositions/${prop.json().id}`;
  attendre(200, await chef.post(`${url}/statut`, { statut: "a_valider" }), "proposition à valider");
  attendre(200, await associe.post(`${url}/statut`, { statut: "validee" }), "proposition validée");
  attendre(200, await chef.post(`${url}/statut`, { statut: "envoyee" }), "proposition envoyée");
  attendre(
    200,
    await associe.post(`${url}/statut`, { statut: "acceptee" }),
    "proposition acceptée",
  );
  const debut = ajouterJours(lundi(aujourdhuiISO()), 28);
  const m = await associe.post(`${url}/mission`, {
    directeur_id: directeur.utilisateurId,
    chef_id: chef.utilisateurId,
    date_debut: debut,
    date_fin: ajouterJours(debut, 7 * 12 - 3),
  });
  attendre(201, m, "mission depuis la proposition");
  return m.json().id as string;
}

export interface MissionConstruite {
  id: string;
  taches: Record<string, string>;
  debut: string;
}

/** Mission avec phases et tâches budgétées par grade (jours), non signée. */
export async function construireMission(
  e: Pick<Equipe, "sessions" | "clients" | "grades">,
  options: {
    intitule: string;
    client: string;
    debut: string;
    fin: string;
    mode: "forfait" | "regie";
    phases: Record<string, Record<string, number>>;
  },
): Promise<MissionConstruite> {
  const associe = e.sessions.associe as Session;
  const chef = e.sessions["chef.mission"] as Session;
  const m = await associe.post("/api/missions", {
    intitule: options.intitule,
    client_id: e.clients[options.client],
    type_mission_id: null,
    directeur_id: (e.sessions["directeur.mission"] as Session).utilisateurId,
    chef_id: chef.utilisateurId,
    date_debut: options.debut,
    date_fin: options.fin,
    mode_facturation: options.mode,
    activite: "Conseil en stratégie",
    bureau: "Abidjan",
  });
  attendre(201, m, `mission ${options.intitule}`);
  const id = m.json().id as string;
  const taches: Record<string, string> = {};
  for (const [libelle, budget] of Object.entries(options.phases)) {
    const phase = await chef.post(`/api/missions/${id}/phases`, { libelle });
    attendre(201, phase, "phase");
    const tache = await chef.post(`/api/missions/${id}/taches`, {
      parent_id: phase.json().id,
      libelle,
      duree_jours_ouvres: 60,
    });
    attendre(201, tache, "tâche");
    taches[libelle] = tache.json().id;
    attendre(
      200,
      await chef.put(`/api/missions/${id}/taches/${tache.json().id}/budget`, {
        lignes: Object.entries(budget).map(([code, jours]) => ({
          grade_id: e.grades[code],
          jours,
        })),
      }),
      "budget de tâche",
    );
  }
  return { id, taches, debut: options.debut };
}

export async function signerEtDemarrer(
  e: Pick<Equipe, "sessions">,
  m: MissionConstruite,
  dateSignature: string,
) {
  const directeur = e.sessions["directeur.mission"] as Session;
  attendre(
    200,
    await directeur.post(`/api/missions/${m.id}/signer`, { date_signature: dateSignature }),
    "signature (budget figé)",
  );
}

async function affecter(
  e: Equipe,
  m: MissionConstruite,
  cle: string,
  affectations: Record<string, number>,
): Promise<void> {
  const chef = e.sessions["chef.mission"] as Session;
  for (const [libelle, jours] of Object.entries(affectations)) {
    attendre(
      201,
      await chef.post(`/api/missions/${m.id}/affectations`, {
        tache_id: m.taches[libelle],
        collaborateur_id: e.collaborateurs[cle],
        jours_alloues: jours,
        date_debut: m.debut,
        date_fin: ajouterJours(m.debut, 7 * 11 + 4),
      }),
      `affectation ${cle}`,
    );
  }
}

/** Saisit, soumet et (si demandé) fait valider la feuille d'une semaine. */
async function feuille(
  e: Equipe,
  auteur: string,
  semaine: string,
  travaux: readonly { tache_id: string; jours: number }[],
  valider: boolean,
): Promise<void> {
  const s = e.sessions[auteur] as Session;
  const f = await s.post("/api/feuilles-temps", { semaine, pre_remplir: false });
  attendre(201, f, `feuille ${auteur} ${semaine}`);
  const id = f.json().id as string;
  attendre(
    200,
    await s.put(`/api/feuilles-temps/${id}/lignes`, { lignes: lignesSemaine(semaine, travaux) }),
    "lignes de temps",
  );
  attendre(200, await s.post(`/api/feuilles-temps/${id}/soumettre`), "soumission");
  if (valider) {
    attendre(
      200,
      await (e.sessions["chef.mission"] as Session).post(`/api/feuilles-temps/${id}/valider`, {}),
      "validation",
    );
  }
}

/** Mission « signée » : budget initial figé, pas encore démarrée. */
async function semerMissionSignee(e: Equipe): Promise<string> {
  const debut = ajouterJours(lundi(aujourdhuiISO()), 14);
  const m = await construireMission(e, {
    intitule: "Audit organisationnel Transports Akwaba",
    client: "Transports Akwaba (fictif)",
    debut,
    fin: ajouterJours(debut, 7 * 8 - 3),
    mode: "forfait",
    phases: {
      Cadrage: { manager: 4, senior: 6 },
      Diagnostic: { manager: 6, senior: 12, junior: 12 },
      Recommandations: { directeur: 3, manager: 5, senior: 6 },
    },
  });
  await signerEtDemarrer(e, m, aujourdhuiISO());
  return m.id;
}

/**
 * Mission en cours : temps validés sur 4 semaines, une feuille en attente de validation.
 * Elle démarre 10 semaines avant le lundi courant et ses temps validés s'arrêtent 7 semaines
 * avant : les semaines -6 à -2 de Koffi et d'Adjoua restent libres pour le scénario de
 * recette de bout en bout (`docs/recette/`), qui y saisit ses propres feuilles. Seule la
 * feuille de la semaine précédente (-1) est en attente de validation.
 */
async function semerMissionEnCours(e: Equipe): Promise<string> {
  const debut = ajouterJours(lundi(aujourdhuiISO()), -70);
  const m = await construireMission(e, {
    intitule: "Plan stratégique Kora Agro-Industries",
    client: "Kora Agro-Industries (fictif)",
    debut,
    fin: ajouterJours(debut, 7 * 12 - 3),
    mode: "regie",
    phases: {
      Diagnostic: { manager: 6, senior: 20, junior: 16 },
      Orientations: { directeur: 4, manager: 8, senior: 12 },
    },
  });
  await signerEtDemarrer(e, m, ajouterJours(debut, -3));
  attendre(
    200,
    await (e.sessions["directeur.mission"] as Session).post(`/api/missions/${m.id}/statut`, {
      statut: "en_cours",
    }),
    "mission en cours",
  );
  await affecter(e, m, "consultant", { Diagnostic: 20 });
  await affecter(e, m, "consultant.junior", { Diagnostic: 16 });
  const diag = m.taches.Diagnostic as string;
  for (let i = 0; i < 4; i++) {
    const semaine = ajouterJours(debut, 7 * i);
    await feuille(e, "consultant", semaine, [{ tache_id: diag, jours: 4 }], true);
    await feuille(e, "consultant.junior", semaine, [{ tache_id: diag, jours: 3.5 }], true);
  }
  // Semaine précédente (celle de la veille du lundi courant) : soumise, en attente de
  // validation (notifie le chef).
  const derniere = ajouterJours(lundi(aujourdhuiISO()), -7);
  await feuille(e, "consultant", derniere, [{ tache_id: diag, jours: 4 }], false);
  return m.id;
}

const ACTEUR = (cabinetId: string, utilisateurId: string, role: Role): Auth => ({
  cabinetId,
  utilisateurId,
  email: "",
  nom: "",
  roles: [role],
});

/**
 * Mission clôturée : temps validés, échéancier 30 % / 70 %, deux factures émises
 * (numérotation continue) datées dans le passé, encaissement intégral de
 * l'acompte et partiel du solde, puis clôture avec bilan archivé.
 */
async function semerMissionCloturee(
  e: Equipe,
  database: Database,
  cabinetId: string,
): Promise<string> {
  const debut = ajouterJours(lundi(aujourdhuiISO()), -7 * 20);
  const associe = e.sessions.associe as Session;
  const gestionnaire = e.sessions.gestionnaire as Session;
  const directeur = e.sessions["directeur.mission"] as Session;

  // Mentions légales obligatoires pour émettre (IBAN : reconfirmation par mot de passe).
  attendre(
    200,
    await associe.patch("/api/parametres-facturation", {
      raison_sociale: NOM_CABINET_ABIDJAN,
      forme_juridique: "SARL",
      rccm: "CI-ABJ-DEMO-B-7001",
      compte_contribuable: "DEMO7001Z",
      adresse: "Plateau, Abidjan, Côte d'Ivoire",
      telephone: "+225 00 00 00 00 00",
      banque: "Banque Démo (fictive)",
      iban: "CI93CI0000000000000000000000",
      mot_de_passe: MOT_DE_PASSE_DEMO_ABIDJAN,
    }),
    "mentions légales",
  );

  const m = await construireMission(e, {
    intitule: "Plan stratégique Cacao Savane Export",
    client: "Cacao Savane Export (fictif)",
    debut,
    fin: ajouterJours(debut, 7 * 12 - 3),
    mode: "forfait",
    phases: {
      Diagnostic: { manager: 4, senior: 12, junior: 8 },
      Orientations: { directeur: 2, manager: 4, senior: 8 },
    },
  });
  const signature = ajouterJours(debut, -4);
  await signerEtDemarrer(e, m, signature);
  attendre(
    200,
    await directeur.post(`/api/missions/${m.id}/statut`, { statut: "en_cours" }),
    "mission en cours",
  );
  await affecter(e, m, "consultant", { Diagnostic: 12, Orientations: 8 });
  const jours = [
    ["Diagnostic", 3],
    ["Diagnostic", 3],
    ["Diagnostic", 3],
    ["Diagnostic", 3],
    ["Orientations", 4],
    ["Orientations", 4],
  ] as const;
  for (const [i, [libelle, j]] of jours.entries()) {
    await feuille(
      e,
      "consultant",
      ajouterJours(debut, 7 * (i + 1)),
      [{ tache_id: m.taches[libelle] as string, jours: j }],
      true,
    );
  }

  // Échéancier puis factures par le circuit réel (gestionnaire -> associé -> gestionnaire).
  attendre(
    201,
    await gestionnaire.post(`/api/missions/${m.id}/echeancier/generer`, {}),
    "échéancier",
  );
  const ech = (await gestionnaire.get(`/api/missions/${m.id}/echeancier`)).json().echeances as {
    id: string;
  }[];
  const dates = [ajouterJours(signature, 2), ajouterJours(debut, 7 * 12)];
  const factures: { id: string; net: number; client: string }[] = [];
  for (const [i, echeance] of ech.entries()) {
    attendre(
      200,
      await gestionnaire.patch(`/api/echeances/${echeance.id}`, { statut: "a_facturer" }),
      "échéance à facturer",
    );
    const f = await gestionnaire.post(`/api/missions/${m.id}/factures`, {
      echeance_ids: [echeance.id],
    });
    attendre(201, f, "brouillon de facture");
    const id = f.json().id as string;
    attendre(200, await gestionnaire.post(`/api/factures/${id}/soumettre`), "soumission facture");
    attendre(200, await associe.post(`/api/factures/${id}/approuver`), "approbation facture");
    await database.withTenant(cabinetId, async (db) =>
      emettre(
        db,
        ACTEUR(cabinetId, gestionnaire.utilisateurId, "gestionnaire"),
        await lireFacture(db, id, true),
        dates[i] as string,
      ),
    );
    const emise = (await gestionnaire.get(`/api/factures/${id}`)).json();
    factures.push({ id, net: emise.net_a_payer as number, client: emise.client_id as string });
  }

  // Encaissements : acompte soldé, solde réglé à 40 %.
  const clientId = e.clients["Cacao Savane Export (fictif)"] as string;
  const [acompte, solde] = factures as [(typeof factures)[number], (typeof factures)[number]];
  attendre(
    201,
    await gestionnaire.post("/api/finance/encaissements", {
      client_id: clientId,
      date: ajouterJours(dates[0] as string, 20),
      montant: acompte.net,
      mode: "virement",
      reference: "VIR-DEMO-0001",
      imputations: [{ facture_id: acompte.id, montant: acompte.net }],
    }),
    "encaissement de l'acompte",
  );
  const partiel = Math.floor(solde.net * 0.4);
  attendre(
    201,
    await gestionnaire.post("/api/finance/encaissements", {
      client_id: clientId,
      date: ajouterJours(dates[1] as string, 15),
      montant: partiel,
      mode: "mobile_money",
      operateur: "wave",
      reference: "WAVE-DEMO-0002",
      imputations: [{ facture_id: solde.id, montant: partiel }],
    }),
    "encaissement partiel du solde",
  );

  attendre(
    200,
    await directeur.post(`/api/missions/${m.id}/statut`, { statut: "a_cloturer" }),
    "mission à clôturer",
  );
  attendre(200, await associe.post(`/api/missions/${m.id}/cloturer`), "clôture");
  return m.id;
}

/** Absences : validée, refusée, demandée (notifications aux demandeurs et aux valideurs). */
async function semerAbsences(e: Equipe): Promise<void> {
  const ressources = e.sessions.ressources as Session;
  const auj = aujourdhuiISO();
  const consultant = e.sessions.consultant as Session;
  const junior = e.sessions["consultant.junior"] as Session;
  const chef = e.sessions["chef.mission"] as Session;

  const conge = await consultant.post("/api/absences", {
    type: "conge_paye",
    date_debut: ajouterJours(lundi(auj), 56),
    date_fin: ajouterJours(lundi(auj), 60),
    commentaire: "Congés annuels (démo).",
  });
  attendre(201, conge, "congé");
  attendre(
    200,
    await ressources.post(`/api/absences/${conge.json().id}/valider`, {}),
    "congé validé",
  );

  const refus = await junior.post("/api/absences", {
    type: "conge_paye",
    date_debut: ajouterJours(lundi(auj), 21),
    date_fin: ajouterJours(lundi(auj), 23),
  });
  attendre(201, refus, "demande refusée");
  attendre(
    200,
    await ressources.post(`/api/absences/${refus.json().id}/refuser`, {
      motif: "Période de forte charge sur la mission Kora.",
    }),
    "refus d'absence",
  );

  attendre(
    201,
    await chef.post("/api/absences", {
      type: "formation",
      date_debut: ajouterJours(lundi(auj), 35),
      date_fin: ajouterJours(lundi(auj), 36),
      commentaire: "Formation gestion de projet (démo).",
    }),
    "formation demandée",
  );
}

export interface ResumeDemo {
  cabinetId: string;
  missions: { proposition: string; signee: string; en_cours: string; cloturee: string };
  portail: ResumePortail;
}

/** Crée le cabinet de démonstration ; renvoie null si le cabinet existe déjà (rien n'est écrit). */
export async function semerDemoAbidjan(
  database: Database,
  config: Config,
): Promise<ResumeDemo | null> {
  const cree = await creerCabinetEtComptes(database);
  if (!cree) return null;
  // NODE_ENV=test : application muette (aucun journal HTTP, aucun transport de messages).
  const app = await buildApp({ ...config, NODE_ENV: "test", TOTP_REQUIS: "non" }, database);
  let missions: ResumeDemo["missions"];
  try {
    const e = await preparerReferentiels(app, cree.ids);
    const proposition = await semerPipeline(e);
    const signee = await semerMissionSignee(e);
    const cloturee = await semerMissionCloturee(e, database, cree.cabinetId);
    const en_cours = await semerMissionEnCours(e);
    await semerAbsences(e);
    missions = { proposition, signee, en_cours, cloturee };
  } finally {
    await app.close();
  }
  // Import dynamique : seed-demo-portail.ts importe ce fichier (pas de cycle au chargement).
  const { semerPortailDemo } = await import("./seed-demo-portail.js");
  const portail = await semerPortailDemo(database, config);
  if (!portail) throw new Error("Les comptes du portail existent déjà dans un cabinet neuf.");
  return { cabinetId: cree.cabinetId, missions, portail };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let config: Config;
  try {
    config = configDemo();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  const database = createDatabase(config);
  semerDemoAbidjan(database, config)
    .then((r) => {
      if (!r) {
        console.error(
          `${NOM_CABINET_ABIDJAN} existe déjà : rien n'a été écrit. ` +
            "Pour repartir de zéro, utiliser une base neuve.",
        );
        process.exitCode = 2;
        return;
      }
      console.log(
        `${NOM_CABINET_ABIDJAN} prêt (4 missions : proposition, signée, en cours, clôturée).`,
      );
      console.log(
        `Comptes (un par rôle) : ${PERSONNES.map((p) => emailAbidjan(p.cle)).join(", ")}`,
      );
      console.log(
        `Comptes du portail client (${r.portail.client}) : ${r.portail.comptes.map((c) => c.email).join(", ")}`,
      );
      console.log(
        "Mot de passe commun : MOT_DE_PASSE_DEMO_ABIDJAN dans apps/api/src/db/seed-demo.ts " +
          "(développement local uniquement, jamais à réutiliser ailleurs).",
      );
    })
    .catch((error: Error) => {
      console.error(`Échec du seed de démonstration : ${error.message}`);
      console.error(
        "Le cabinet est peut-être à moitié semé : utiliser une base neuve avant de relancer.",
      );
      process.exitCode = 1;
    })
    .finally(() => database.close());
}
