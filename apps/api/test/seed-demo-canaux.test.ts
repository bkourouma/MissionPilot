import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { estNumeroDeTest } from "@missionpilot/engines";
import { aadNumero, dechiffrerNumero } from "../src/canaux/numeros.js";
import { trousseauDepuisConfig } from "../src/auth/chiffrement.js";
import { hashPassword } from "../src/auth/password.js";
import {
  IDENTITES_CANAUX_DEMO,
  MARQUE_DEMO,
  NOM_DOCUMENT_SIGNATURE_DEMO,
  NUMERO_DEMO_JOIGNABLE,
  NUMERO_DEMO_NON_JOIGNABLE,
  semerCanauxDemo,
  type IdentitesCanauxDemo,
} from "../src/db/seed-demo-canaux.js";
import { configDemo, emailAbidjan, MOT_DE_PASSE_DEMO_ABIDJAN } from "../src/db/seed-demo.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { attendre, inviterClient } from "./portail-outils.js";

/*
 * Seed de démonstration des canaux simulés (db/seed-demo-canaux.ts). Le seed complet de
 * démonstration dure plus d'une minute et crée des comptes aux adresses FIXES (collision avec
 * `connexion-demo.test.ts` dans la base partagée) : il est vérifié à la main sur une base dédiée
 * (RUNBOOK). Ici, le même code tourne sur un cabinet de test aux comptes équivalents (cabinet,
 * dirigeant et contributeur du client, mission partagée), avec le mot de passe commun de démonstration.
 */

let ctx: Contexte;
let a: CabinetMissions;
let dossier: string;
let missionId: string;
let identites: IdentitesCanauxDemo;
let dirigeantId: string;
let contributeurId: string;
let premier: { creees: string[] };

const comptes = (sql: string, params: unknown[] = []) =>
  proprietaire(async (c) => (await c.query(sql, params)).rows);

beforeAll(async () => {
  dossier = await mkdtemp(path.join(os.tmpdir(), "missionpilot-seed-canaux-"));
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Seed canaux démonstration");
  missionId = (await creerMission(a)).id;
  attendre(
    200,
    await a.associe.put(`/api/portail/partages?client_id=${a.clientId}`, {
      missions: [{ mission_id: missionId }],
      documents: [],
    }),
    "partage de la mission",
  );
  const dirigeant = await inviterClient(ctx, a.associe, a.clientId, ["client_dirigeant"]);
  const contributeur = await inviterClient(ctx, a.chef, a.clientId, ["client_contributeur"]);
  const signataireCabinet = await a.avecRoles(["associe"]);
  dirigeantId = dirigeant.utilisateurId;
  contributeurId = contributeur.utilisateurId;
  // Le seed ouvre les sessions avec le mot de passe commun de démonstration.
  const ids = [a.associeId, a.directeur.utilisateurId, signataireCabinet.utilisateurId];
  const hash = await hashPassword(MOT_DE_PASSE_DEMO_ABIDJAN);
  await proprietaire((c) =>
    c.query("UPDATE utilisateurs SET mot_de_passe_hash = $1 WHERE id = ANY($2::uuid[])", [
      hash,
      ids,
    ]),
  );
  const email = async (id: string) =>
    (await comptes("SELECT email FROM utilisateurs WHERE id = $1", [id]))[0]?.email as string;
  identites = {
    associe: await email(a.associeId),
    directeur: await email(a.directeur.utilisateurId),
    signataireCabinet: await email(signataireCabinet.utilisateurId),
    signataireClient: dirigeant.email,
    contributeur: contributeur.email,
    clientRaisonSociale: "Client de Seed canaux démonstration",
    missionId,
  };
  // Les comptes du client ont aussi le mot de passe commun (ouverture éventuelle de session).
  await proprietaire((c) =>
    c.query("UPDATE utilisateurs SET mot_de_passe_hash = $1 WHERE id = ANY($2::uuid[])", [
      hash,
      [dirigeantId, contributeurId],
    ]),
  );
  const config = { ...ctx.config, STORAGE_DIR: dossier };
  premier = await semerCanauxDemo(ctx.db, config, identites);
}, 240_000);

afterAll(async () => {
  await ctx.fermer();
  await rm(dossier, { recursive: true, force: true });
});

const config = () => ({ ...ctx.config, STORAGE_DIR: dossier });

describe("seed de démonstration des canaux", () => {
  it("les identités par défaut sont celles des comptes du seed de démonstration", () => {
    expect(IDENTITES_CANAUX_DEMO.associe).toBe(emailAbidjan("associe"));
    expect(IDENTITES_CANAUX_DEMO.signataireCabinet).toBe(emailAbidjan("associe.2fa"));
    expect(IDENTITES_CANAUX_DEMO.signataireClient).toBe(emailAbidjan("dirigeant.client.2fa"));
    expect(IDENTITES_CANAUX_DEMO.contributeur).toBe(emailAbidjan("contributeur.client"));
  });

  it("mêmes gardes que le seed de démonstration (jamais en production, base locale)", () => {
    const base = {
      NODE_ENV: "development",
      DATABASE_URL: "postgres://u:p@127.0.0.1:55440/missionpilot_demo",
      DATABASE_OWNER_URL: "postgres://u:p@127.0.0.1:55440/missionpilot_demo",
    };
    expect(() => configDemo({ ...base, NODE_ENV: "production" })).toThrow(/interdit/);
    expect(() => configDemo({ ...base, DATABASE_URL: "postgres://u:p@db.exemple.com/x" })).toThrow(
      /locale/,
    );
  });

  it("compte WhatsApp simulé actif, saisie de KPI activée, alerte KPI à sa valeur par défaut", async () => {
    expect(premier.creees).toContain("compte_whatsapp");
    const [compte] = await comptes(
      "SELECT canal, actif, saisie_kpi, alerte_kpi FROM canaux_comptes WHERE cabinet_id = $1",
      [a.cabinetId],
    );
    expect(compte).toMatchObject({
      canal: "whatsapp",
      actif: true,
      saisie_kpi: true,
      alerte_kpi: false,
    });
  });

  it("destinataires : numéros de test du simulateur UNIQUEMENT, vérifiés, avec consentement et preuve", async () => {
    const lignes = await comptes(
      `SELECT id, utilisateur_id, canal, numero_chiffre, numero_cle_version, verifie_le
       FROM canaux_destinataires WHERE cabinet_id = $1 ORDER BY canal, utilisateur_id`,
      [a.cabinetId],
    );
    expect(lignes).toHaveLength(2);
    const t = trousseauDepuisConfig(ctx.config);
    const numeros = new Map<string, string>();
    for (const l of lignes) {
      expect(l.canal).toBe("whatsapp");
      expect(l.verifie_le).not.toBeNull();
      const numero = dechiffrerNumero(
        t,
        { version: Number(l.numero_cle_version), donnees: l.numero_chiffre as Buffer },
        aadNumero(a.cabinetId, l.utilisateur_id as string, "whatsapp"),
      );
      expect(estNumeroDeTest(numero)).toBe(true);
      numeros.set(l.utilisateur_id as string, numero);
    }
    expect(numeros.get(dirigeantId)).toBe(NUMERO_DEMO_JOIGNABLE);
    expect(numeros.get(contributeurId)).toBe(NUMERO_DEMO_NON_JOIGNABLE);

    const consentements = await comptes(
      `SELECT d.utilisateur_id, c.statut, c.source, c.reference_preuve, c.mention_version, c.acteur_id
       FROM canaux_consentements c JOIN canaux_destinataires d ON d.id = c.destinataire_id
       WHERE c.cabinet_id = $1`,
      [a.cabinetId],
    );
    expect(consentements).toHaveLength(2);
    const duDirigeant = consentements.find((c) => c.utilisateur_id === dirigeantId);
    expect(duDirigeant).toMatchObject({
      statut: "accorde",
      source: "portail",
      reference_preuve: null,
      acteur_id: dirigeantId,
    });
    expect(duDirigeant?.mention_version).toBeTruthy();
    const duContributeur = consentements.find((c) => c.utilisateur_id === contributeurId);
    expect(duContributeur).toMatchObject({
      statut: "accorde",
      source: "recueilli_cabinet",
      acteur_id: a.associeId,
    });
    expect(String(duContributeur?.reference_preuve)).toContain(MARQUE_DEMO);
  });

  it("aucun numéro en clair en base, aucun envoi hors du simulateur", async () => {
    const horsPlage = await comptes(
      "SELECT 1 FROM canaux_destinataires WHERE numero_masque NOT LIKE '+225%'",
    );
    expect(horsPlage).toHaveLength(0);
    const dump = JSON.stringify(
      await comptes("SELECT numero_masque, numero_empreinte FROM canaux_destinataires"),
    );
    expect(dump).not.toContain("2250000000012");
    // Fournisseur de signature local : la demande porte une référence de simulateur.
    const [demande] = await comptes(
      "SELECT mode_fournisseur, reference_externe FROM signatures_demandes WHERE cabinet_id = $1",
      [a.cabinetId],
    );
    expect(demande?.mode_fournisseur).toBe("simule");
  });

  it("demande de signature envoyée : lettre de démonstration, signataires cabinet et client, aucune signature", async () => {
    expect(premier.creees).toContain("demande_signature");
    const demandes = await comptes(
      `SELECT d.id, d.statut, d.objet, md.nom, d.signataires_total, d.signataires_signes
       FROM signatures_demandes d JOIN mission_documents md ON md.id = d.document_id
       WHERE d.cabinet_id = $1`,
      [a.cabinetId],
    );
    expect(demandes).toHaveLength(1);
    expect(demandes[0]).toMatchObject({
      statut: "envoyee",
      objet: "lettre_mission",
      nom: NOM_DOCUMENT_SIGNATURE_DEMO,
      signataires_total: 2,
      signataires_signes: 0,
    });
    expect(NOM_DOCUMENT_SIGNATURE_DEMO).toContain(MARQUE_DEMO);
    const signataires = await comptes(
      "SELECT partie, statut FROM signatures_signataires WHERE demande_id = $1 ORDER BY rang",
      [demandes[0]?.id],
    );
    expect(signataires).toEqual([
      { partie: "cabinet", statut: "invite" },
      { partie: "client", statut: "invite" },
    ]);
  });

  it("journal d'envois : l'invitation à signer part au numéro joignable (simulé), sans contenu stocké", async () => {
    const envois = await comptes(
      `SELECT e.gabarit, e.statut, e.canal, e.destinataire_id FROM canaux_envois e WHERE e.cabinet_id = $1`,
      [a.cabinetId],
    );
    // Le signataire client a un numéro vérifié et un consentement : son invitation est envoyée.
    expect(
      envois.some((e) => e.gabarit === "signature_a_effectuer" && e.statut === "accepte"),
    ).toBe(true);
    const colonnes = await comptes(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'canaux_envois'`,
    );
    expect(colonnes.map((c) => c.column_name as string)).not.toContain("contenu");
    // Aucune tâche d'envoi ou de transcription laissée en attente pour le worker.
    expect(
      await comptes(
        `SELECT 1 FROM jobs WHERE cabinet_id = $1 AND statut = 'en_attente'
           AND type IN ('canal_envoi', 'canal_transcription')`,
        [a.cabinetId],
      ),
    ).toHaveLength(0);
  });

  it("transcription de démonstration en brouillon à relire, consentement d'enregistrement référencé", async () => {
    expect(premier.creees).toContain("transcription");
    const [t] = await comptes(
      `SELECT statut, enregistrement_consenti, reference_consentement FROM transcriptions
       WHERE cabinet_id = $1`,
      [a.cabinetId],
    );
    expect(t).toMatchObject({ statut: "a_relire", enregistrement_consenti: true });
    expect(String(t?.reference_consentement)).toContain(MARQUE_DEMO);
    const versions = await comptes(
      `SELECT origine, texte FROM transcriptions_versions WHERE cabinet_id = $1`,
      [a.cabinetId],
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]?.origine).toBe("automatique");
    expect(String(versions[0]?.texte)).toContain(MARQUE_DEMO);
  });

  it("idempotent : relancé, rien n'est dupliqué", async () => {
    const compter = async () =>
      JSON.stringify(
        await comptes(
          `SELECT (SELECT count(*) FROM canaux_comptes WHERE cabinet_id = $1) AS comptes,
                  (SELECT count(*) FROM canaux_destinataires WHERE cabinet_id = $1) AS destinataires,
                  (SELECT count(*) FROM canaux_consentements WHERE cabinet_id = $1) AS consentements,
                  (SELECT count(*) FROM canaux_envois WHERE cabinet_id = $1) AS envois,
                  (SELECT count(*) FROM signatures_demandes WHERE cabinet_id = $1) AS signatures,
                  (SELECT count(*) FROM mission_documents WHERE cabinet_id = $1) AS documents,
                  (SELECT count(*) FROM transcriptions WHERE cabinet_id = $1) AS transcriptions,
                  (SELECT count(*) FROM fichiers WHERE cabinet_id = $1) AS fichiers,
                  (SELECT count(*) FROM jobs WHERE cabinet_id = $1) AS jobs`,
          [a.cabinetId],
        ),
      );
    const avant = await compter();
    const second = await semerCanauxDemo(ctx.db, config(), identites);
    expect(second.creees).toEqual([]);
    expect(await compter()).toBe(avant);
  });
});
