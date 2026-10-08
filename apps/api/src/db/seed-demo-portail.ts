import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { ajouterJours } from "@missionpilot/engines";
import { buildApp } from "../app.js";
import { hacherJeton, nouveauJeton } from "../auth/session.js";
import { dossierStockage, type Config } from "../config.js";
import { createDatabase, type Database } from "./pool.js";
import {
  attendre,
  aujourdhuiISO,
  configDemo,
  construireMission,
  emailAbidjan,
  lundi,
  MOT_DE_PASSE_DEMO_ABIDJAN,
  NOM_CABINET_ABIDJAN,
  ouvrirSession,
  signerEtDemarrer,
  type Session,
} from "./seed-demo.js";

/*
 * Comptes et données du PORTAIL CLIENT de démonstration, pour la recette
 * humaine du portail (jamais en production). S'exécute sur une base DÉJÀ
 * peuplée par `seed-demo.ts` (qui l'appelle aussi en fin d'exécution) :
 *
 *   pnpm --filter @missionpilot/api db:seed-demo-portail
 *
 * Mêmes gardes que `seed-demo.ts` (NODE_ENV local, bases locales, pas de
 * SMTP_HOST : `configDemo`) et même méthode : tout passe par les vraies routes
 * (app.inject), comme un vrai cabinet qui invite, partage et suit son client.
 * Refus net si le cabinet de démonstration n'existe pas (code 1) ou si les
 * comptes du portail existent déjà (code 2) : rien n'est alors écrit. Le seed
 * est NON destructif (il n'efface ni ne modifie ce que `seed-demo.ts` a créé).
 *
 * Client : « Cacao Savane Export (fictif) », qui porte déjà la mission
 * clôturée et ses deux factures émises (dont un encaissement partiel). On lui
 * ajoute une mission EN COURS (suivi de la mise en œuvre du plan), car une
 * mission clôturée ne reçoit plus ni jalon, ni document, ni questionnaire, ni
 * KPI.
 *
 * Invitations : la route POST /api/portail/invitations ne renvoie pas le jeton
 * (il n'existe que dans l'e-mail). Le seed l'appelle donc réellement (invitation,
 * audit, alerte des associés), puis remplace le HACHÉ du jeton généré par celui
 * d'un jeton connu du script, avant d'appeler la vraie route publique
 * POST /api/portail/invitations/accepter. Aucune ligne n'est écrite hors des
 * contraintes de la base (CHECK de famille de rôles, MPP01, rattachement figé).
 *
 * 2FA : aucun de ces comptes ne l'active et la politique 2FA du portail reste
 * désactivée (sinon la connexion rapide serait refusée).
 */

export const CLIENT_PORTAIL_DEMO = "Cacao Savane Export (fictif)";

interface ComptePortail {
  cle: string;
  role: "client_dirigeant" | "client_contributeur" | "client_investisseur";
  nom: string;
  /** Fonction dans l'entreprise (libellé de répondant d'un questionnaire « par fonction »). */
  fonction: string;
}

const COMPTES_PORTAIL: readonly ComptePortail[] = [
  {
    cle: "dirigeant.client",
    role: "client_dirigeant",
    nom: "Jean-Baptiste Kouadio",
    fonction: "Directeur général",
  },
  {
    cle: "contributeur.client",
    role: "client_contributeur",
    nom: "Nadège Yapi",
    fonction: "Directrice administrative et financière",
  },
  {
    cle: "investisseur.client",
    role: "client_investisseur",
    nom: "Moussa Coulibaly",
    fonction: "Représentant de l'actionnaire",
  },
];

export interface ResumePortail {
  client: string;
  clientId: string;
  comptes: { email: string; role: string; nom: string }[];
  missionEnCoursId: string;
  missionCloturId: string;
}

/* ----- PDF minimal valide ----- */

/** PDF d'une page, sans flux compressé ni contenu actif (passe `stockage/detection.ts`). */
export function pdfDemo(titre: string, lignes: readonly string[]): Buffer {
  const ascii = (t: string) =>
    t
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\x20-\x7e]/g, " ")
      .replace(/([\\()])/g, "\\$1");
  const texte = [
    "BT /F1 16 Tf 72 760 Td 20 TL",
    `(${ascii(titre)}) Tj`,
    "/F1 11 Tf",
    ...lignes.map((l) => `T* (${ascii(l)}) Tj`),
    "ET",
  ].join("\n");
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R " +
      "/Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(texte, "latin1")} >>\nstream\n${texte}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const morceaux: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const decalages: number[] = [];
  let position = (morceaux[0] as Buffer).length;
  objets.forEach((corps, i) => {
    const objet = Buffer.from(`${i + 1} 0 obj\n${corps}\nendobj\n`, "latin1");
    decalages.push(position);
    morceaux.push(objet);
    position += objet.length;
  });
  const lignesXref = decalages.map((d) => `${String(d).padStart(10, "0")} 00000 n \n`).join("");
  const n = objets.length + 1;
  morceaux.push(
    Buffer.from(
      `xref\n0 ${n}\n0000000000 65535 f \n${lignesXref}trailer\n<< /Size ${n} /Root 1 0 R >>\n` +
        `startxref\n${position}\n%%EOF\n`,
      "latin1",
    ),
  );
  return Buffer.concat(morceaux);
}

/** Corps multipart/form-data d'un seul fichier (champ « fichier »). */
function multipart(nom: string, contenu: Buffer) {
  const frontiere = `----mpdemo${Math.random().toString(16).slice(2)}`;
  const entete =
    `--${frontiere}\r\nContent-Disposition: form-data; name="fichier"; filename="${nom}"\r\n` +
    "Content-Type: application/pdf\r\n\r\n";
  return {
    payload: Buffer.concat([
      Buffer.from(entete, "utf8"),
      contenu,
      Buffer.from(`\r\n--${frontiere}--\r\n`, "utf8"),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${frontiere}` },
  };
}

/* ----- Outils ----- */

/** Session ouverte par la vraie route de connexion ; l'identifiant est lu par GET /auth/moi. */
async function session(app: FastifyInstance, email: string): Promise<Session> {
  const brute = await ouvrirSession(app, email, "");
  const moi = await brute.get("/api/auth/moi");
  attendre(200, moi, `profil ${email}`);
  return { ...brute, utilisateurId: moi.json().utilisateur.id as string };
}

async function existe(database: Database, email: string): Promise<boolean> {
  return database.withoutTenant(async (c) => {
    const r = await c.query("SELECT 1 FROM trouver_connexion($1)", [email]);
    return (r.rowCount ?? 0) > 0;
  });
}

async function televerser(app: FastifyInstance, s: Session, nom: string, pdf: Buffer) {
  const m = multipart(nom, pdf);
  const r = await app.inject({
    method: "POST",
    url: "/api/fichiers",
    headers: { cookie: s.cookie, ...m.headers },
    payload: m.payload,
  });
  attendre(201, r, `téléversement ${nom}`);
  return r.json().id as string;
}

/** Premier mois (jour 1) de la date ISO, décalé de `mois` mois. */
const moisPrecedent = (date: string, mois: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - mois, 1);
  return d.toISOString().slice(0, 10);
};

interface Cabinet {
  associe: Session;
  directeur: Session;
  chef: Session;
}

/** Invitation par la vraie route, jeton connu du script, puis acceptation par la vraie route. */
async function inviterEtAccepter(
  app: FastifyInstance,
  database: Database,
  cabinetId: string,
  associe: Session,
  clientId: string,
  compte: ComptePortail,
): Promise<void> {
  const email = emailAbidjan(compte.cle);
  const inv = await associe.post("/api/portail/invitations", {
    email,
    client_id: clientId,
    roles: [compte.role],
  });
  attendre(201, inv, `invitation ${email}`);
  const jeton = nouveauJeton();
  await database.withTenant(cabinetId, (db) =>
    db.query("UPDATE invitations SET jeton_hash = $1 WHERE id = $2 AND acceptee_le IS NULL", [
      hacherJeton(jeton),
      inv.json().id,
    ]),
  );
  const acceptation = await app.inject({
    method: "POST",
    url: "/api/portail/invitations/accepter",
    payload: { jeton, nom: compte.nom, mot_de_passe: MOT_DE_PASSE_DEMO_ABIDJAN },
  });
  attendre(201, acceptation, `acceptation ${email}`);
}

/** Client et mission clôturée créés par `seed-demo.ts`. */
async function trouverClientEtCloturee(associe: Session) {
  const clients = await associe.get(
    `/api/clients?q=${encodeURIComponent(CLIENT_PORTAIL_DEMO)}&limite=10`,
  );
  attendre(200, clients, "clients");
  const client = (clients.json().elements as { id: string; raison_sociale: string }[]).find(
    (c) => c.raison_sociale === CLIENT_PORTAIL_DEMO,
  );
  if (!client)
    throw new Error(`Client « ${CLIENT_PORTAIL_DEMO} » introuvable : lancer db:seed-demo.`);
  const missions = await associe.get(`/api/missions?client_id=${client.id}&limite=50`);
  attendre(200, missions, "missions du client");
  const cloturee = (missions.json().elements as { id: string; statut: string }[]).find(
    (m) => m.statut === "cloturee",
  );
  if (!cloturee) throw new Error("Mission clôturée du client introuvable : lancer db:seed-demo.");
  return { clientId: client.id, clotureeId: cloturee.id };
}

/** Mission en cours du client, avec budget figé (signature) comme les missions de `seed-demo.ts`. */
async function creerMissionEnCours(cab: Cabinet, clientId: string): Promise<string> {
  const grades = Object.fromEntries(
    (await cab.associe.get("/api/grades"))
      .json()
      .elements.map((g: { code: string; id: string }) => [g.code, g.id]),
  ) as Record<string, string>;
  const clients = { [CLIENT_PORTAIL_DEMO]: clientId };
  const sessions = {
    associe: cab.associe,
    "directeur.mission": cab.directeur,
    "chef.mission": cab.chef,
  };
  const debut = ajouterJours(lundi(aujourdhuiISO()), -28);
  const m = await construireMission(
    { sessions, clients, grades },
    {
      intitule: "Accompagnement à la mise en œuvre du plan Cacao Savane",
      client: CLIENT_PORTAIL_DEMO,
      debut,
      fin: ajouterJours(debut, 7 * 16 - 3),
      mode: "forfait",
      phases: {
        "Cadrage de la mise en œuvre": { manager: 3, senior: 5 },
        "Suivi trimestriel": { directeur: 2, manager: 6, senior: 10 },
      },
    },
  );
  await signerEtDemarrer({ sessions }, m, ajouterJours(debut, -3));
  attendre(
    200,
    await cab.directeur.post(`/api/missions/${m.id}/statut`, { statut: "en_cours" }),
    "mission en cours",
  );
  return m.id;
}

/** Jalons : un atteint et validé par le client, un atteint à valider, un à venir. */
async function creerJalons(
  cab: Cabinet,
  missionId: string,
): Promise<{ avalider: string; valide: string }> {
  const auj = aujourdhuiISO();
  const jalons = [
    ["Cadrage validé avec la direction générale", ajouterJours(auj, -21), true, 1],
    ["Diagnostic stratégique restitué", ajouterJours(auj, -3), true, 2],
    ["Plan d'actions 2027 présenté au conseil d'administration", ajouterJours(auj, 30), false, 3],
  ] as const;
  const ids: string[] = [];
  for (const [libelle, date_prevue, atteint, ordre] of jalons) {
    const r = await cab.chef.post(`/api/missions/${missionId}/jalons`, {
      libelle,
      date_prevue,
      atteint,
      ordre,
    });
    attendre(201, r, `jalon ${libelle}`);
    ids.push(r.json().id as string);
  }
  return { valide: ids[0] as string, avalider: ids[1] as string };
}

/** Lettre de mission (sans statut de contenu) et livrable rédigé avec l'IA puis validé. */
async function deposerDocuments(
  app: FastifyInstance,
  cab: Cabinet,
  missionId: string,
): Promise<string[]> {
  const lettre = await televerser(
    app,
    cab.directeur,
    "lettre-de-mission-cacao-savane.pdf",
    pdfDemo("Lettre de mission (demonstration)", [
      "Cacao Savane Export (fictif) - Accompagnement a la mise en oeuvre du plan",
      "Document fictif genere pour la recette locale de MissionPilot.",
    ]),
  );
  const l = await cab.directeur.post(`/api/missions/${missionId}/documents`, {
    type: "lettre_de_mission",
    nom: "Lettre de mission",
    fichier_id: lettre,
  });
  attendre(201, l, "lettre de mission");

  const synthese = await televerser(
    app,
    cab.chef,
    "synthese-diagnostic-strategique.pdf",
    pdfDemo("Synthese du diagnostic strategique (demonstration)", [
      "Trois constats : dependance a deux acheteurs, tresorerie saisonniere, traçabilite.",
      "Trois priorites : diversifier les marches, lisser les besoins, certifier la filiere.",
      "Document fictif genere pour la recette locale de MissionPilot.",
    ]),
  );
  const livrable = await cab.chef.post(`/api/missions/${missionId}/documents`, {
    type: "livrable",
    nom: "Synthèse du diagnostic stratégique",
    fichier_id: synthese,
    statut_contenu: "brouillon_ia",
  });
  attendre(201, livrable, "livrable");
  // Validé par le directeur (ni auteur ni dernier modificateur), seul état servi au client.
  attendre(
    200,
    await cab.directeur.post(`/api/documents/${livrable.json().id}/statut`, { statut: "valide" }),
    "livrable validé",
  );
  return [l.json().id as string, livrable.json().id as string];
}

/** Questionnaires : par fonction (date limite à venir) et collectif (date limite dépassée). */
async function envoyerQuestionnaires(
  cab: Cabinet,
  missionId: string,
  repondants: { dirigeant: string; contributeur: string },
): Promise<{ parFonction: string; collectif: string }> {
  const auj = aujourdhuiISO();
  const preparer = async (code: string, gabarit: string): Promise<string> => {
    const m = await cab.chef.post("/api/questionnaires/modeles", {
      code,
      source: { type: "gabarit", gabarit },
    });
    attendre(201, m, `modèle ${code}`);
    const versionId = m.json().versions[0].id as string;
    attendre(
      200,
      await cab.directeur.post(`/api/questionnaires/versions/${versionId}/valider`),
      `version ${code}`,
    );
    return versionId;
  };
  const envoyer = async (corps: Record<string, unknown>): Promise<string> => {
    const e = await cab.chef.post(`/api/missions/${missionId}/questionnaires`, corps);
    attendre(201, e, "envoi de questionnaire");
    attendre(
      200,
      await cab.chef.post(`/api/questionnaires/envois/${e.json().id}/envoyer`),
      "questionnaire envoyé",
    );
    return e.json().id as string;
  };
  const parFonction = await envoyer({
    version_id: await preparer("preliminaire_dirigeants", "preliminaire_dirigeants"),
    mode: "par_fonction",
    repondants: [
      { utilisateur_id: repondants.dirigeant, fonction: COMPTES_PORTAIL[0]?.fonction },
      { utilisateur_id: repondants.contributeur, fonction: COMPTES_PORTAIL[1]?.fonction },
    ],
    date_limite: ajouterJours(auj, 14),
  });
  const collectif = await envoyer({
    version_id: await preparer("notation_generique", "notation_generique"),
    mode: "collectif",
    repondants: [
      { utilisateur_id: repondants.dirigeant },
      { utilisateur_id: repondants.contributeur },
    ],
    // Date dépassée à dessein : la soumission est refusée après la date limite (MPQ07), le portail passe en lecture seule (recette).
    date_limite: ajouterJours(auj, -3),
  });
  return { parFonction, collectif };
}

/** Trois KPI de la mission en cours, cibles, mesures du cabinet puis du portail. */
async function creerKpi(
  cab: Cabinet,
  contributeur: Session,
  missionId: string,
  contributeurId: string,
): Promise<void> {
  const auj = aujourdhuiISO();
  const kpis = [
    {
      libelle: "Chiffre d'affaires mensuel",
      unite: "M FCFA",
      perspective: "finances",
      sens: "plus_haut_mieux",
      nature: "flux",
      frequence: "mensuelle",
      cible: 450,
      mesures: [410, 432, 455],
    },
    {
      libelle: "Délai moyen de recouvrement des créances",
      unite: "jours",
      perspective: "processus",
      sens: "plus_bas_mieux",
      nature: "stock",
      frequence: "mensuelle",
      cible: 45,
      mesures: [62, 55, 49],
    },
    {
      libelle: "Satisfaction des planteurs partenaires",
      unite: "%",
      perspective: "clients",
      sens: "plus_haut_mieux",
      nature: "stock",
      frequence: "trimestrielle",
      cible: 85,
      mesures: [72, 78],
    },
  ] as const;
  for (const k of kpis) {
    const r = await cab.directeur.post(`/api/missions/${missionId}/kpi`, {
      libelle: k.libelle,
      unite: k.unite,
      perspective: k.perspective,
      sens: k.sens,
      nature: k.nature,
      frequence: k.frequence,
      debut_suivi: moisPrecedent(auj, 4),
      cible: k.cible,
      seuil_vert: 0.95,
      seuil_orange: 0.8,
    });
    attendre(201, r, `KPI ${k.libelle}`);
    const id = r.json().id as string;
    attendre(
      200,
      await cab.directeur.put(`/api/kpi/${id}/contributeurs`, { utilisateurs: [contributeurId] }),
      "contributeur du KPI",
    );
    // Mesures du cabinet (les plus anciennes), puis la dernière saisie par le client.
    const dates = [ajouterJours(auj, -62), ajouterJours(auj, -31), ajouterJours(auj, -2)];
    const cabinet = k.mesures.slice(0, -1);
    for (const [i, valeur] of cabinet.entries()) {
      attendre(
        201,
        await cab.chef.post(`/api/kpi/${id}/mesures`, {
          date_mesure: dates[i + (k.mesures.length === 2 ? 1 : 0)],
          valeur,
        }),
        "mesure du cabinet",
      );
    }
    attendre(
      201,
      await contributeur.post(`/api/portail/kpi/${id}/mesures`, {
        date_mesure: dates[2],
        valeur: k.mesures[k.mesures.length - 1],
        commentaire: "Relevé transmis par la direction administrative et financière.",
      }),
      "mesure du portail",
    );
  }
}

/** Crée les comptes du portail et leur jeu de données ; null si les comptes existent déjà. */
export async function semerPortailDemo(
  database: Database,
  config: Config,
): Promise<ResumePortail | null> {
  if (!(await existe(database, emailAbidjan("associe")))) {
    throw new Error(
      `Le cabinet « ${NOM_CABINET_ABIDJAN} » n'existe pas dans cette base : lancer d'abord db:seed-demo.`,
    );
  }
  if (await existe(database, emailAbidjan(COMPTES_PORTAIL[0]?.cle ?? "dirigeant.client"))) {
    return null;
  }
  // NODE_ENV=test : application muette. Le dossier des fichiers reste celui du développement
  // (sinon le PDF déposé serait introuvable pour le serveur de démonstration).
  const stockage = dossierStockage({ NODE_ENV: config.NODE_ENV, STORAGE_DIR: config.STORAGE_DIR });
  const app = await buildApp(
    { ...config, NODE_ENV: "test", TOTP_REQUIS: "non", STORAGE_DIR: stockage },
    database,
  );
  try {
    const cab: Cabinet = {
      associe: await session(app, emailAbidjan("associe")),
      directeur: await session(app, emailAbidjan("directeur.mission")),
      chef: await session(app, emailAbidjan("chef.mission")),
    };
    const cabinetId = (
      await app.inject({
        method: "GET",
        url: "/api/auth/moi",
        headers: { cookie: cab.associe.cookie },
      })
    ).json().cabinet_id as string;
    const { clientId, clotureeId } = await trouverClientEtCloturee(cab.associe);
    const enCoursId = await creerMissionEnCours(cab, clientId);
    const jalons = await creerJalons(cab, enCoursId);
    const documents = await deposerDocuments(app, cab, enCoursId);

    for (const compte of COMPTES_PORTAIL) {
      await inviterEtAccepter(app, database, cabinetId, cab.associe, clientId, compte);
    }
    const dirigeant = await session(app, emailAbidjan("dirigeant.client"));
    const contributeur = await session(app, emailAbidjan("contributeur.client"));

    // Partages explicites par un associé : missions (jalons, factures), documents validés, contact.
    const partages = await cab.associe.put(`/api/portail/partages?client_id=${clientId}`, {
      missions: [
        { mission_id: enCoursId, jalons: true, factures: true },
        { mission_id: clotureeId, jalons: true, factures: true },
      ],
      documents,
      contact_principal_id: cab.directeur.utilisateurId,
    });
    attendre(200, partages, "partages du portail");

    // Le dirigeant valide le premier jalon ; le second reste à valider.
    attendre(
      201,
      await dirigeant.post(`/api/portail/missions/${enCoursId}/jalons/${jalons.valide}/valider`, {
        commentaire: "Cadrage conforme à nos attentes.",
      }),
      "validation d'un jalon par le client",
    );

    const envois = await envoyerQuestionnaires(cab, enCoursId, {
      dirigeant: dirigeant.utilisateurId,
      contributeur: contributeur.utilisateurId,
    });
    // Brouillon commencé par la contributrice (questionnaire par fonction).
    attendre(
      200,
      await contributeur.patch(`/api/portail/questionnaires/${envois.parFonction}/reponses`, {
        reponses: {
          "prof.fonction": "Directrice administrative et financière",
          "prof.anciennete": "de_2_a_5_ans",
          "mgt.decision": "collegiale",
        },
      }),
      "brouillon de réponse",
    );

    await creerKpi(cab, contributeur, enCoursId, contributeur.utilisateurId);
    return {
      client: CLIENT_PORTAIL_DEMO,
      clientId,
      comptes: COMPTES_PORTAIL.map((c) => ({
        email: emailAbidjan(c.cle),
        role: c.role,
        nom: c.nom,
      })),
      missionEnCoursId: enCoursId,
      missionCloturId: clotureeId,
    };
  } finally {
    await app.close();
  }
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
  semerPortailDemo(database, config)
    .then((r) => {
      if (!r) {
        console.error(
          "Les comptes du portail de démonstration existent déjà : rien n'a été écrit. " +
            "Pour repartir de zéro, utiliser une base neuve.",
        );
        process.exitCode = 2;
        return;
      }
      console.log(`Portail client de démonstration prêt (client : ${r.client}).`);
      for (const c of r.comptes) console.log(`  ${c.email} : ${c.nom} (${c.role})`);
      console.log(
        "Mot de passe commun : MOT_DE_PASSE_DEMO_ABIDJAN dans apps/api/src/db/seed-demo.ts " +
          "(développement local uniquement). Connexion rapide : page de connexion, bloc " +
          "« Espace client (portail) » si CONNEXION_RAPIDE_DEMO=oui.",
      );
    })
    .catch((error: Error) => {
      console.error(`Échec du seed du portail de démonstration : ${error.message}`);
      console.error(
        "Le portail est peut-être à moitié semé : utiliser une base neuve avant de relancer.",
      );
      process.exitCode = 1;
    })
    .finally(() => database.close());
}
