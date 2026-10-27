import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { estNumeroDeTest } from "@missionpilot/engines";
import { buildApp } from "../app.js";
import { journaliser } from "../audit.js";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import {
  ajouterConsentement,
  consentementCourant,
  mentionEnVigueur,
} from "../canaux/consentements.js";
import {
  controlerAvantNumero,
  ecrireNumero,
  exigerUtilisateurClient,
  verifierCodeNumero,
  type DependancesDestinataires,
} from "../canaux/destinataires.js";
import { creerHandlerCanalEnvoi, mettreEnFileEnvoi } from "../canaux/envois.js";
import { creerCanaux } from "../canaux/fabrique.js";
import type { Canaux } from "../canaux/ports.js";
import { nomDuCabinet } from "../canaux/synthese.js";
import { creerHandlerCanalTranscription } from "../canaux/transcriptions.js";
import { fabriquerConteneurAudioSimule } from "../canaux/transcripteur-simule.js";
import { dossierStockage, type Config } from "../config.js";
import type { HandlerJob } from "../jobs/registre.js";
import { createDatabase, type Database } from "./pool.js";
import { pdfDemo } from "./seed-demo-portail.js";
import {
  attendre,
  configDemo,
  emailAbidjan,
  exigerDemoPubliqueCoherente,
  MOT_DE_PASSE_DEMO_ABIDJAN,
  NOM_CABINET_ABIDJAN,
  ouvrirSession,
  type Session,
} from "./seed-demo.js";
import { CLIENT_PORTAIL_DEMO } from "./seed-demo-portail.js";
import { COMPTE_ASSOCIE_2FA, COMPTE_DIRIGEANT_2FA } from "./seed-demo-2fa.js";

/*
 * Données de démonstration des CANAUX SIMULÉS (lot 3c) : compte WhatsApp simulé, destinataires de
 * test, journal d'envois, demande de signature et transcription à relire. Mêmes gardes que
 * `seed-demo.ts` (NODE_ENV local, bases locales) ; sur un serveur de démonstration publique
 * seulement, appelé par `seed-defaut.ts --confirmer-demo` avec `publique` (voir `OptionsCanauxDemo`).
 *
 * Règle ferme du lot : AUCUN envoi réel, aucune clé, aucun appel réseau. Les quatre ports sont les
 * fournisseurs SIMULÉS ou LOCAUX (`creerCanaux`) ; les numéros sont les seuls numéros de TEST du
 * simulateur (le simulateur refuse tout autre numéro) ; les messages « partis » ne vont que dans la
 * boîte en mémoire de ce processus, perdue à sa fin ; l'audio est un conteneur de test synthétique
 * (aucune voix). Tout passe par les services et routes existants (gardes, journal d'audit, chaînes
 * de preuves comprises). Chaque libellé porte la mention « DÉMONSTRATION ».
 *
 * Idempotent, étape par étape : relancé, rien n'est dupliqué (compte déjà actif, numéro et
 * consentement déjà posés, document, demande et transcription retrouvés par leur libellé).
 * Appelé par `db:seed-demo` (en fin de course) ; se lance aussi seul sur une base déjà peuplée :
 *   pnpm --filter @missionpilot/api exec tsx src/db/seed-demo-canaux.ts
 */

export const MARQUE_DEMO = "DÉMONSTRATION";
/** Numéros de TEST du simulateur (SPEC-3c §18) : joignable, puis non joignable (échec d'envoi). */
export const NUMERO_DEMO_JOIGNABLE = "+2250000000012";
export const NUMERO_DEMO_NON_JOIGNABLE = "+2250000000000";
export const NOM_DOCUMENT_SIGNATURE_DEMO = `Lettre de mission - signature electronique (${MARQUE_DEMO})`;
export const REFERENCE_CONSENTEMENT_ENREGISTREMENT_DEMO = `${MARQUE_DEMO} : accord ecrit fictif des participants, reference DEMO-ENR-0001`;
export const REFERENCE_CONSENTEMENT_NUMERO_DEMO = `${MARQUE_DEMO} : formulaire fictif signe, reference DEMO-CONS-0001`;
const NOM_AUDIO_DEMO = "entretien-demonstration.ogg";
const TEXTE_TRANSCRIPTION_DEMO =
  `${MARQUE_DEMO} - texte fictif produit par le transcripteur simule. ` +
  "Le dirigeant confirme que le plan d'action avance et que deux decisions restent a prendre " +
  "avant la fin du mois.";

/**
 * Comptes et client sur lesquels portent les données (les comptes du seed par défaut ; les tests
 * passent ceux d'un cabinet de test pour ne pas créer le cabinet de démonstration dans la base partagée).
 */
export interface IdentitesCanauxDemo {
  associe: string;
  directeur: string;
  /** Signataire de la partie cabinet. */
  signataireCabinet: string;
  /** Dirigeant du client, signataire de la partie client (numéro joignable, consentement du portail). */
  signataireClient: string;
  /** Contributeur du client (numéro non joignable, consentement recueilli par le cabinet). */
  contributeur: string;
  clientRaisonSociale: string;
  /** Mission portant la signature et la transcription ; sinon la mission « en cours » du client. */
  missionId?: string;
}

export const IDENTITES_CANAUX_DEMO: IdentitesCanauxDemo = {
  associe: emailAbidjan("associe"),
  directeur: emailAbidjan("directeur.mission"),
  signataireCabinet: emailAbidjan(COMPTE_ASSOCIE_2FA.cle),
  signataireClient: emailAbidjan(COMPTE_DIRIGEANT_2FA.cle),
  contributeur: emailAbidjan("contributeur.client"),
  clientRaisonSociale: CLIENT_PORTAIL_DEMO,
};

export interface ResumeCanauxDemo {
  /** Étapes réellement écrites par cet appel (vide : tout existait déjà). */
  creees: string[];
}

/* ----- Outils ----- */

async function existe(database: Database, email: string): Promise<boolean> {
  return database.withoutTenant(async (c) => {
    const r = await c.query("SELECT 1 FROM trouver_connexion($1)", [email]);
    return (r.rowCount ?? 0) > 0;
  });
}

function multipart(nom: string, contenu: Buffer, type: string) {
  const frontiere = `----mpdemo${Math.random().toString(16).slice(2)}`;
  const entete =
    `--${frontiere}\r\nContent-Disposition: form-data; name="fichier"; filename="${nom}"\r\n` +
    `Content-Type: ${type}\r\n\r\n`;
  return {
    payload: Buffer.concat([
      Buffer.from(entete, "utf8"),
      contenu,
      Buffer.from(`\r\n--${frontiere}--\r\n`, "utf8"),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${frontiere}` },
  };
}

async function televerser(
  app: FastifyInstance,
  s: Session,
  url: string,
  nom: string,
  contenu: Buffer,
  type: string,
): Promise<string> {
  const m = multipart(nom, contenu, type);
  const r = await app.inject({
    method: "POST",
    url,
    headers: { cookie: s.cookie, ...m.headers },
    payload: m.payload,
  });
  attendre(201, r, `téléversement ${nom}`);
  return r.json().id as string;
}

/**
 * Exécute ici, sans le worker, les tâches EN ATTENTE d'un type donné (les ports sont les simulateurs
 * de ce processus) : le journal d'envois et la transcription arrivent à leur état final. Le worker
 * du serveur, lui, ne voit jamais ces tâches (déjà terminées).
 */
async function executerTaches(
  database: Database,
  cabinetId: string,
  handlers: Record<string, HandlerJob>,
): Promise<void> {
  const types = Object.keys(handlers);
  for (;;) {
    const tache = await database.withTenant(cabinetId, async (db) => {
      const r = await db.query(
        `SELECT id, type, charge FROM jobs
         WHERE type = ANY($1::text[]) AND statut = 'en_attente' ORDER BY execute_a, id LIMIT 1`,
        [types],
      );
      return r.rows[0] as { id: string; type: string; charge: Record<string, unknown> } | undefined;
    });
    if (!tache) return;
    await database.withTenant(cabinetId, async (db) => {
      await (handlers[tache.type] as HandlerJob)({
        db,
        cabinetId,
        jobId: tache.id,
        charge: tache.charge ?? {},
        maintenant: new Date(),
        database,
      });
      await db.query("UPDATE jobs SET statut = 'termine', progression = 100 WHERE id = $1", [
        tache.id,
      ]);
    });
  }
}

/* ----- Étapes ----- */

async function activerCompteWhatsapp(associe: Session): Promise<boolean> {
  const comptes = await associe.get("/api/canaux/comptes");
  attendre(200, comptes, "comptes de canal");
  const wa = (comptes.json().elements as { canal: string; actif: boolean }[]).find(
    (c) => c.canal === "whatsapp",
  );
  if (wa?.actif) return false;
  // Options prudentes : seule la saisie de KPI est activée ; l'alerte KPI garde sa valeur par défaut.
  attendre(
    200,
    await associe.put("/api/canaux/comptes/whatsapp", {
      actif: true,
      saisie_kpi: true,
      mot_de_passe: MOT_DE_PASSE_DEMO_ABIDJAN,
    }),
    "activation du compte WhatsApp simulé",
  );
  return true;
}

interface DestinataireDemo {
  email: string;
  numero: string;
  source: "portail" | "recueilli_cabinet";
}

/**
 * Numéro de test vérifié (code émis en mémoire et consommé aussitôt : aucun message) puis
 * consentement : source « portail » (la personne agit pour elle-même) ou recueilli par le cabinet
 * (référence de la preuve obligatoire). Renvoie l'identifiant du destinataire et s'il a été écrit.
 */
async function preparerDestinataire(
  database: Database,
  cabinetId: string,
  deps: DependancesDestinataires,
  associeId: string,
  d: DestinataireDemo,
): Promise<{ id: string; ecrit: boolean }> {
  if (!estNumeroDeTest(d.numero)) {
    throw new Error("Le seed des canaux n'admet que les numéros de test du simulateur.");
  }
  return database.withTenant(cabinetId, async (db) => {
    const u = await db.query("SELECT id FROM utilisateurs WHERE lower(email) = $1", [d.email]);
    const utilisateurId = u.rows[0]?.id as string | undefined;
    if (!utilisateurId) throw new Error(`Utilisateur ${d.email} introuvable.`);
    await exigerUtilisateurClient(db, utilisateurId);
    const maintenant = new Date();
    const acteurId = d.source === "portail" ? utilisateurId : associeId;
    const numero = await controlerAvantNumero(db, deps, {
      utilisateurId,
      canal: "whatsapp",
      numeroSaisi: d.numero,
      maintenant,
    });
    const r = await ecrireNumero(db, deps, {
      acteur: { cabinetId, utilisateurId: acteurId },
      utilisateurId,
      canal: "whatsapp",
      numero,
      maintenant,
    });
    let ecrit = r.numero_change;
    const id = r.destinataire.id;
    if (r.code !== null) {
      const v = await verifierCodeNumero(db, deps, {
        cabinetId,
        destinataireId: id,
        canal: "whatsapp",
        code: r.code,
        maintenant,
        acteurId,
      });
      if (v.statut !== "verifie")
        throw new Error("Vérification du numéro de démonstration échouée.");
    }
    // Un consentement déjà posé, ou retiré par la personne (STOP), n'est jamais écrasé.
    if ((await consentementCourant(db, id)).statut === "absent") {
      if (d.source === "portail") {
        await ajouterConsentement(db, {
          cabinetId,
          destinataireId: id,
          canal: "whatsapp",
          statut: "accorde",
          source: "portail",
          acteurId,
          mention: mentionEnVigueur("whatsapp"),
        });
      } else {
        await ajouterConsentement(db, {
          cabinetId,
          destinataireId: id,
          canal: "whatsapp",
          statut: "accorde",
          source: "recueilli_cabinet",
          acteurId,
          referencePreuve: REFERENCE_CONSENTEMENT_NUMERO_DEMO,
        });
      }
      await journaliser(db, {
        cabinetId,
        utilisateurId: acteurId,
        action: "canal.consentement.accorder",
        entite: "canal_destinataire",
        entiteId: id,
        details: { canal: "whatsapp", source: d.source, demonstration: true },
      });
      ecrit = true;
    }
    return { id, ecrit };
  });
}

async function missionEnCours(associe: Session, clientId: string): Promise<string> {
  const r = await associe.get(`/api/missions?client_id=${clientId}&limite=50`);
  attendre(200, r, "missions du client");
  const m = (r.json().elements as { id: string; statut: string }[]).find(
    (x) => x.statut === "en_cours",
  );
  if (!m) throw new Error("Mission en cours du client introuvable : lancer db:seed-demo-portail.");
  return m.id;
}

/** Demande de signature (cabinet : Fanta Doumbia ; client : Salimata Bakayoko, 2FA active), envoyée. */
async function semerSignature(
  app: FastifyInstance,
  database: Database,
  cabinetId: string,
  directeur: Session,
  missionId: string,
  identites: IdentitesCanauxDemo,
): Promise<boolean> {
  const deja = await database.withTenant(cabinetId, async (db) => {
    const r = await db.query(
      `SELECT 1 FROM signatures_demandes d JOIN mission_documents md ON md.id = d.document_id
       WHERE d.mission_id = $1 AND md.nom = $2`,
      [missionId, NOM_DOCUMENT_SIGNATURE_DEMO],
    );
    return (r.rowCount ?? 0) > 0;
  });
  if (deja) return false;
  const ids = await database.withTenant(cabinetId, async (db) => {
    const r = await db.query(
      "SELECT id, lower(email) AS email FROM utilisateurs WHERE lower(email) = ANY($1::text[])",
      [[identites.signataireCabinet, identites.signataireClient]],
    );
    return new Map((r.rows as { id: string; email: string }[]).map((x) => [x.email, x.id]));
  });
  const cabinet = ids.get(identites.signataireCabinet);
  const client = ids.get(identites.signataireClient);
  if (!cabinet || !client) throw new Error("Comptes 2FA de démonstration introuvables.");

  // Document : un PDF fictif, déposé comme lettre de mission (type exigé pour l'objet de la demande).
  let documentId = await database.withTenant(cabinetId, async (db) => {
    const r = await db.query(
      "SELECT id FROM mission_documents WHERE mission_id = $1 AND nom = $2",
      [missionId, NOM_DOCUMENT_SIGNATURE_DEMO],
    );
    return r.rows[0]?.id as string | undefined;
  });
  if (!documentId) {
    const fichierId = await televerser(
      app,
      directeur,
      "/api/fichiers",
      "lettre-de-mission-signature-demonstration.pdf",
      pdfDemo(`Lettre de mission (${MARQUE_DEMO})`, [
        "Document fictif genere pour la recette locale de MissionPilot.",
        "Signature electronique SIMULEE : aucune valeur juridique, aucun fournisseur reel.",
      ]),
      "application/pdf",
    );
    const doc = await directeur.post(`/api/missions/${missionId}/documents`, {
      type: "lettre_de_mission",
      nom: NOM_DOCUMENT_SIGNATURE_DEMO,
      fichier_id: fichierId,
    });
    attendre(201, doc, "document de signature");
    documentId = doc.json().id as string;
  }
  const demande = await directeur.post(`/api/missions/${missionId}/signatures`, {
    document_id: documentId,
    objet: "lettre_mission",
    ordre: "parallele",
    expire_jours: 30,
    signataires: [
      { utilisateur_id: cabinet, partie: "cabinet" },
      { utilisateur_id: client, partie: "client" },
    ],
  });
  attendre(201, demande, "demande de signature");
  // Fournisseur LOCAL : l'envoi crée la demande dans le simulateur et invite les signataires.
  attendre(200, await directeur.post(`/api/signatures/${demande.json().id}/envoyer`, {}), "envoi");
  return true;
}

/** Transcription en brouillon à relire (audio de test synthétique, consentement déclaré et référencé). */
async function semerTranscription(
  app: FastifyInstance,
  database: Database,
  cabinetId: string,
  directeur: Session,
  missionId: string,
): Promise<boolean> {
  const deja = await database.withTenant(cabinetId, async (db) => {
    const r = await db.query(
      "SELECT 1 FROM transcriptions WHERE mission_id = $1 AND reference_consentement = $2",
      [missionId, REFERENCE_CONSENTEMENT_ENREGISTREMENT_DEMO],
    );
    return (r.rowCount ?? 0) > 0;
  });
  if (deja) return false;
  const audio = fabriquerConteneurAudioSimule({
    texte: TEXTE_TRANSCRIPTION_DEMO,
    langue: "fr",
    dureeMs: 4200,
    confiance: 870,
  });
  const fichierId = await televerser(
    app,
    directeur,
    `/api/missions/${missionId}/transcriptions/audio`,
    NOM_AUDIO_DEMO,
    audio,
    "application/octet-stream",
  );
  attendre(
    201,
    await directeur.post(`/api/missions/${missionId}/transcriptions`, {
      fichier_id: fichierId,
      langue: "fr",
      enregistrement_consenti: true,
      reference_consentement: REFERENCE_CONSENTEMENT_ENREGISTREMENT_DEMO,
      duree_secondes: 5,
    }),
    "transcription",
  );
  return true;
}

/* ----- Semis ----- */

/** Options du semis des canaux. */
export interface OptionsCanauxDemo {
  /**
   * Démonstration publique CONFIRMÉE par l'appelant (`demoPubliqueConfirmee` : DEMO_PUBLIQUE=oui ET
   * `--confirmer-demo`) : les ports simulés de l'application EN PROCESSUS du seed sont admis hors
   * base locale (`creerCanaux`, option `seedDemonstrationPublique`). Sans cette option, garde
   * inchangée : développement local seulement.
   */
  publique?: boolean;
}

/** Ajoute les données de démonstration des canaux au cabinet de démonstration (idempotent). */
export async function semerCanauxDemo(
  database: Database,
  config: Config,
  identites: IdentitesCanauxDemo = IDENTITES_CANAUX_DEMO,
  options: OptionsCanauxDemo = {},
): Promise<ResumeCanauxDemo> {
  exigerDemoPubliqueCoherente(config, options.publique);
  for (const [email, aide] of [
    [
      identites.associe,
      `Le cabinet « ${NOM_CABINET_ABIDJAN} » n'existe pas : lancer d'abord db:seed-demo.`,
    ],
    [
      identites.signataireCabinet,
      "Les comptes 2FA de démonstration n'existent pas : lancer db:seed-demo-2fa.",
    ],
    [
      identites.signataireClient,
      "Les comptes 2FA de démonstration n'existent pas : lancer db:seed-demo-2fa.",
    ],
    [
      identites.contributeur,
      "Les comptes du portail n'existent pas : lancer db:seed-demo-portail.",
    ],
  ] as const) {
    if (!(await existe(database, email))) throw new Error(aide);
  }
  // Même dossier de fichiers que le serveur de développement (le PDF et l'audio doivent s'y trouver).
  const stockage = dossierStockage({ NODE_ENV: config.NODE_ENV, STORAGE_DIR: config.STORAGE_DIR });
  const cfg: Config = {
    ...config,
    NODE_ENV: "test",
    TOTP_REQUIS: "non",
    STORAGE_DIR: stockage,
    WHATSAPP_FOURNISSEUR: "simule",
    SMS_FOURNISSEUR: "aucun",
    TRANSCRIPTION_FOURNISSEUR: "simule",
    SIGNATURE_FOURNISSEUR: "local",
  };
  // Les ports : fournisseurs SIMULÉS ou LOCAUX seulement (`creerCanaux` refuse tout le reste ;
  // hors base locale, seulement en démonstration publique confirmée par l'appelant).
  const canaux: Canaux = creerCanaux(cfg, { seedDemonstrationPublique: options.publique === true });
  const app = await buildApp(cfg, database, { canaux });
  const creees: string[] = [];
  try {
    const associe = await ouvrirSession(app, identites.associe, "");
    const directeur = await ouvrirSession(app, identites.directeur, "");
    const moi = await associe.get("/api/auth/moi");
    attendre(200, moi, "profil de l'associé");
    const cabinetId = moi.json().cabinet_id as string;
    const associeId = moi.json().utilisateur.id as string;
    const clients = await associe.get(
      `/api/clients?q=${encodeURIComponent(identites.clientRaisonSociale)}&limite=10`,
    );
    attendre(200, clients, "clients");
    const client = (clients.json().elements as { id: string; raison_sociale: string }[]).find(
      (c) => c.raison_sociale === identites.clientRaisonSociale,
    );
    if (!client) throw new Error(`Client « ${identites.clientRaisonSociale} » introuvable.`);
    const missionId = identites.missionId ?? (await missionEnCours(associe, client.id));

    if (await activerCompteWhatsapp(associe)) creees.push("compte_whatsapp");

    const deps: DependancesDestinataires = { trousseau: trousseauDepuisConfig(cfg), canaux };
    const joignable = await preparerDestinataire(database, cabinetId, deps, associeId, {
      email: identites.signataireClient,
      numero: NUMERO_DEMO_JOIGNABLE,
      source: "portail",
    });
    const injoignable = await preparerDestinataire(database, cabinetId, deps, associeId, {
      email: identites.contributeur,
      numero: NUMERO_DEMO_NON_JOIGNABLE,
      source: "recueilli_cabinet",
    });
    if (joignable.ecrit) creees.push("destinataire_joignable");
    if (injoignable.ecrit) creees.push("destinataire_non_joignable");

    // Journal d'envois : une relance vers le numéro non joignable (échec visible), par le service d'envoi.
    const questionnaire = await database.withTenant(cabinetId, async (db) => {
      const r = await db.query("SELECT id FROM questionnaire_envois ORDER BY id LIMIT 1");
      return r.rows[0]?.id as string | undefined;
    });
    if (questionnaire) {
      const envoi = await database.withTenant(cabinetId, async (db) => {
        const nom = await nomDuCabinet(db, cabinetId);
        return mettreEnFileEnvoi(db, deps.trousseau, {
          cabinetId,
          canal: "whatsapp",
          destinataireId: injoignable.id,
          gabarit: "relance_questionnaire_j10",
          variables: [nom, `/portail/questionnaires/${questionnaire}`],
          objetType: "questionnaire_envoi",
          objetId: questionnaire,
          cle: `demo-canaux:relance:${injoignable.id}`,
          maintenant: new Date(),
        });
      });
      if (envoi && !envoi.existant) creees.push("envoi_non_joignable");
    }

    if (await semerSignature(app, database, cabinetId, directeur, missionId, identites)) {
      creees.push("demande_signature");
    }
    if (await semerTranscription(app, database, cabinetId, directeur, missionId)) {
      creees.push("transcription");
    }

    // Envois et transcription menés à leur état final par les simulateurs de ce processus.
    const dependances = () => ({ config: cfg, canaux });
    await executerTaches(database, cabinetId, {
      canal_envoi: creerHandlerCanalEnvoi(dependances),
      canal_transcription: creerHandlerCanalTranscription(dependances),
    });
    return { creees };
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
  semerCanauxDemo(database, config)
    .then((r) => {
      console.log(
        r.creees.length === 0
          ? "Les données de démonstration des canaux existent déjà : rien n'a été écrit."
          : `Canaux de démonstration (simulés) : ${r.creees.join(", ")}.`,
      );
    })
    .catch((error: Error) => {
      console.error(`Échec du seed des canaux de démonstration : ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => database.close());
}
