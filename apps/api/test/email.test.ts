import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { trousseauDepuisConfig } from "../src/auth/chiffrement.js";
import { loadConfig } from "../src/config.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { registreAvecEmails, TYPE_JOB_EMAIL } from "../src/notifications/file-email.js";
import {
  creerMailer,
  MailerJournal,
  MailerSmtp,
  type Mailer,
  type MessageEmail,
} from "../src/notifications/mailer.js";
import {
  construireMessage,
  envoyerSmtp,
  ErreurSmtp,
  type OptionsSmtp,
} from "../src/notifications/smtp.js";
import { api } from "./api.js";
import { connecter, creerCabinet, demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Serveur SMTP factice en mémoire (node:net, 127.0.0.1, port éphémère) :
 * aucun réseau externe, aucun e-mail réel.
 */
interface Recu {
  commandes: string[];
  donnees: string[];
}

interface OptionsFactice {
  starttls?: boolean;
  codeRcpt?: number;
  codeAuth?: number;
}

async function serveurFactice(opts: OptionsFactice = {}) {
  const recu: Recu = { commandes: [], donnees: [] };
  const serveur = net.createServer((socket) => {
    let tampon = "";
    let enDonnees = false;
    let donnees = "";
    socket.write("220 factice ESMTP\r\n");
    socket.on("data", (d) => {
      tampon += d.toString("utf8");
      let i: number;
      while ((i = tampon.indexOf("\r\n")) >= 0) {
        const ligne = tampon.slice(0, i);
        tampon = tampon.slice(i + 2);
        if (enDonnees) {
          if (ligne === ".") {
            enDonnees = false;
            recu.donnees.push(donnees);
            donnees = "";
            socket.write("250 OK\r\n");
          } else donnees += `${ligne}\r\n`;
          continue;
        }
        recu.commandes.push(ligne);
        const verbe = ligne.split(" ")[0]!.toUpperCase();
        if (verbe === "EHLO") {
          socket.write(
            `250-factice\r\n${opts.starttls ? "250-STARTTLS\r\n" : ""}250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n`,
          );
        } else if (verbe === "AUTH") socket.write(`${opts.codeAuth ?? 235} Auth\r\n`);
        else if (verbe === "MAIL") socket.write("250 OK\r\n");
        else if (verbe === "RCPT") socket.write(`${opts.codeRcpt ?? 250} rcpt\r\n`);
        else if (verbe === "DATA") {
          enDonnees = true;
          socket.write("354 go\r\n");
        } else if (verbe === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("502 non\r\n");
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((r) => serveur.listen(0, "127.0.0.1", r));
  const port = (serveur.address() as net.AddressInfo).port;
  return {
    recu,
    options: (o: Partial<OptionsSmtp> = {}): OptionsSmtp => ({
      hote: "127.0.0.1",
      port,
      securite: "aucun",
      expediteur: "noreply@missionpilot.test",
      delaiMs: 5_000,
      ...o,
    }),
    fermer: () => new Promise<void>((r) => serveur.close(() => r())),
  };
}

/** Serveur TCP brut au comportement choisi par le test (constat F3). */
async function serveurBrut(surConnexion: (socket: net.Socket) => void) {
  const sockets = new Set<net.Socket>();
  const serveur = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    surConnexion(socket);
  });
  await new Promise<void>((r) => serveur.listen(0, "127.0.0.1", r));
  const port = (serveur.address() as net.AddressInfo).port;
  return {
    options: (o: Partial<OptionsSmtp> = {}): OptionsSmtp => ({
      hote: "127.0.0.1",
      port,
      securite: "aucun",
      expediteur: "noreply@missionpilot.test",
      delaiMs: 5_000,
      ...o,
    }),
    fermer: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        serveur.close(() => r());
      }),
  };
}

const MESSAGE = { a: "dest@exemple.test", sujet: "x", texte: "x" };

/** Décode le corps base64 et les en-têtes d'un message reçu. */
function lire(brut: string) {
  const [entetes, corps] = brut.split("\r\n\r\n");
  return {
    entetes: entetes!,
    texte: Buffer.from(corps!.replace(/\r\n/g, ""), "base64").toString("utf8"),
  };
}

describe("transport SMTP (SOC-08)", () => {
  it("envoie un message complet : AUTH, enveloppe, en-têtes encodés, corps base64", async () => {
    const s = await serveurFactice();
    try {
      await new MailerSmtp(
        s.options({ utilisateur: "compte", motDePasse: "mdp-smtp-secret" }),
      ).envoyer({
        a: "dest@exemple.test",
        sujet: "Invitation à rejoindre Cabinet Élan",
        texte: "Bonjour,\n.ligne qui commence par un point\nÀ bientôt",
      });
      expect(s.recu.commandes[0]).toMatch(/^EHLO /);
      const auth = s.recu.commandes.find((c) => c.startsWith("AUTH PLAIN "))!;
      expect(Buffer.from(auth.slice(11), "base64").toString()).toBe(
        "\u0000compte\u0000mdp-smtp-secret",
      );
      expect(s.recu.commandes).toContain("MAIL FROM:<noreply@missionpilot.test>");
      expect(s.recu.commandes).toContain("RCPT TO:<dest@exemple.test>");
      const { entetes, texte } = lire(s.recu.donnees[0]!);
      expect(entetes).toContain("To: <dest@exemple.test>");
      expect(entetes).toMatch(/^Subject: =\?UTF-8\?B\?/m);
      expect(entetes).toContain("Content-Transfer-Encoding: base64");
      expect(texte).toBe("Bonjour,\r\n.ligne qui commence par un point\r\nÀ bientôt");
    } finally {
      await s.fermer();
    }
  });

  it("assainit le sujet : aucun saut de ligne ni contrôle bidirectionnel (pas d'en-tête injecté)", async () => {
    const s = await serveurFactice();
    try {
      await new MailerSmtp(s.options()).envoyer({
        a: "dest@exemple.test",
        sujet: `Bonjour\r\nBcc: pirate@exemple.test${String.fromCharCode(0x202e, 0x2028)}fin`,
        texte: "x",
      });
      const { entetes } = lire(s.recu.donnees[0]!);
      expect(entetes).not.toMatch(/^Bcc:/im);
      expect(s.recu.commandes.filter((c) => c.startsWith("RCPT"))).toHaveLength(1);
      const sujet = entetes.match(/^Subject: (.*)$/m)![1]!;
      const decode = sujet.startsWith("=?")
        ? Buffer.from(sujet.slice(10, -2), "base64").toString()
        : sujet;
      expect(decode).not.toMatch(/[\r\n\u202E\u2028]/);
    } finally {
      await s.fermer();
    }
  });

  it("refuse un destinataire porteur d'un en-tête, sans rien envoyer", async () => {
    const s = await serveurFactice();
    try {
      await expect(
        new MailerSmtp(s.options()).envoyer({
          a: "dest@exemple.test>\r\nRCPT TO:<pirate@exemple.test",
          sujet: "x",
          texte: "x",
        }),
      ).rejects.toBeInstanceOf(ErreurSmtp);
      expect(s.recu.commandes).toHaveLength(0);
    } finally {
      await s.fermer();
    }
  });

  it("STARTTLS exigé : un serveur qui ne le propose pas est refusé, rien n'est envoyé en clair", async () => {
    const s = await serveurFactice({ starttls: false });
    try {
      await expect(
        envoyerSmtp(s.options({ securite: "starttls", utilisateur: "u", motDePasse: "p" }), {
          a: "dest@exemple.test",
          sujet: "x",
          texte: "x",
        }),
      ).rejects.toThrow("STARTTLS non proposé");
      expect(s.recu.commandes.some((c) => c.startsWith("AUTH"))).toBe(false);
      expect(s.recu.commandes.some((c) => c.startsWith("MAIL"))).toBe(false);
    } finally {
      await s.fermer();
    }
  });

  it("une erreur SMTP ne cite que le code, jamais l'identifiant ni le mot de passe", async () => {
    const s = await serveurFactice({ codeAuth: 535 });
    try {
      const e = await envoyerSmtp(
        s.options({ utilisateur: "compte-smtp", motDePasse: "mdp-tres-secret" }),
        { a: "dest@exemple.test", sujet: "x", texte: "x" },
      ).catch((err: Error) => err);
      expect(e).toBeInstanceOf(ErreurSmtp);
      expect((e as Error).message).toBe("SMTP : AUTH refusé (code 535).");
    } finally {
      await s.fermer();
    }
  });

  it("F3 : des réponses injectées en clair après le 220 de STARTTLS sont refusées", async () => {
    const s = await serveurBrut((socket) => {
      socket.write("220 factice ESMTP\r\n");
      socket.on("data", (d) => {
        const ligne = d.toString("utf8");
        if (ligne.startsWith("EHLO")) socket.write("250-factice\r\n250 STARTTLS\r\n");
        // 220 suivi, dans le même paquet, d'une réponse que le client lirait « chiffrée ».
        else if (ligne.startsWith("STARTTLS"))
          socket.write("220 go\r\n250-AUTH PLAIN\r\n250 OK\r\n");
      });
    });
    try {
      await expect(
        envoyerSmtp(s.options({ securite: "starttls", delaiMs: 2_000 }), MESSAGE),
      ).rejects.toThrow("données inattendues après STARTTLS");
    } finally {
      await s.fermer();
    }
  });

  it("F3 : délai posé avant la négociation TLS (serveur muet en TLS implicite)", async () => {
    const s = await serveurBrut(() => undefined);
    try {
      const debut = Date.now();
      await expect(
        envoyerSmtp(s.options({ securite: "implicite", delaiMs: 200 }), MESSAGE),
      ).rejects.toBeInstanceOf(ErreurSmtp);
      expect(Date.now() - debut).toBeLessThan(3_000);
    } finally {
      await s.fermer();
    }
  }, 8_000);

  it("F3 : délai global par envoi (serveur qui répond au compte-gouttes)", async () => {
    let minuteur: NodeJS.Timeout | undefined;
    const s = await serveurBrut((socket) => {
      // Une ligne de continuation toutes les 40 ms : jamais inactif, jamais fini.
      minuteur = setInterval(() => socket.write("220-patience\r\n"), 40);
      socket.on("close", () => clearInterval(minuteur));
    });
    try {
      await expect(
        envoyerSmtp(s.options({ delaiMs: 1_000, delaiTotalMs: 300 }), MESSAGE),
      ).rejects.toThrow("délai d'envoi dépassé");
    } finally {
      clearInterval(minuteur);
      await s.fermer();
    }
  }, 8_000);

  it("F3 : plafond du nombre de lignes d'une réponse", async () => {
    const s = await serveurBrut((socket) => {
      socket.write(`${"220-bavard\r\n".repeat(150)}220 fin\r\n`);
    });
    try {
      await expect(envoyerSmtp(s.options(), MESSAGE)).rejects.toThrow("réponse trop longue");
    } finally {
      await s.fermer();
    }
  });

  it("serveur injoignable : erreur propre", async () => {
    const s = await serveurFactice();
    const options = s.options();
    await s.fermer();
    await expect(
      envoyerSmtp(options, { a: "dest@exemple.test", sujet: "x", texte: "x" }),
    ).rejects.toBeInstanceOf(ErreurSmtp);
  });

  it("construireMessage : nom affiché sûr, Message-ID sur le domaine de l'expéditeur", () => {
    const m = construireMessage(
      { a: "a@exemple.test", sujet: "S", texte: "T" },
      "noreply@missionpilot.test",
      "Nom <pirate@x.test>",
    );
    expect(m).toMatch(/^From: MissionPilot <noreply@missionpilot\.test>/);
    expect(m).toMatch(/^Message-ID: <[0-9a-f]{32}@missionpilot\.test>$/m);
  });
});

describe("configuration du transport e-mail", () => {
  const prod = {
    NODE_ENV: "production",
    DATABASE_OWNER_URL: "postgres://o:x@db.exemple.test:5432/mp",
    DATABASE_URL: "postgres://a:x@db.exemple.test:5432/mp",
    SESSION_SECRET: "un-secret-de-production-tres-long-0123",
    TFA_MASTER_KEY: "une-cle-maitre-2fa-de-production-4567",
  };

  it("hors développement, refuse de démarrer sans SMTP ou sans TLS", () => {
    expect(() => loadConfig(prod)).toThrow("SMTP_HOST est obligatoire");
    expect(() =>
      loadConfig({
        ...prod,
        SMTP_HOST: "smtp.exemple.test",
        MAIL_FROM: "n@exemple.test",
        SMTP_TLS: "aucun",
      }),
    ).toThrow("TLS obligatoire");
    expect(() => loadConfig({ ...prod, SMTP_HOST: "smtp.exemple.test" })).toThrow("MAIL_FROM");
    const avecMdp = () =>
      loadConfig({
        ...prod,
        SMTP_HOST: "smtp.exemple.test",
        MAIL_FROM: "n@exemple.test",
        SMTP_PASS: "pss-secret",
      });
    expect(avecMdp).toThrow("SMTP_USER et SMTP_PASS vont ensemble.");
    try {
      avecMdp();
    } catch (e) {
      expect((e as Error).message).not.toContain("pss-secret");
    }
    const ok = loadConfig({
      ...prod,
      SMTP_HOST: "smtp.exemple.test",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      MAIL_FROM: "noreply@exemple.test",
    });
    expect(creerMailer(ok)).toBeInstanceOf(MailerSmtp);
  });

  it("MAIL_FROM : adresse simple, sans nom affiché ni saut de ligne", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "test", SMTP_HOST: "h", MAIL_FROM: "a@b.test\r\nBcc: x@y.test" }),
    ).toThrow();
  });

  it("en test sans SMTP : journal silencieux ; en développement : journal", () => {
    expect(creerMailer({ NODE_ENV: "test" })).toBeInstanceOf(MailerJournal);
    expect(creerMailer({ NODE_ENV: "development" })).toBeInstanceOf(MailerJournal);
    expect(() => creerMailer({ NODE_ENV: "production" })).toThrow();
  });
});

describe("reprise des e-mails par la file de tâches", () => {
  let ctx: Contexte;
  let ctxPanne: Contexte & { pannes: number };

  class MailerEnPanne implements Mailer {
    pannes = 0;
    async envoyer(): Promise<void> {
      this.pannes++;
      throw new ErreurSmtp("SMTP : connexion impossible.");
    }
  }

  beforeAll(async () => {
    ctx = await demarrer();
    const mailer = new MailerEnPanne();
    const app = await buildApp(ctx.config, ctx.db, { mailer });
    ctxPanne = {
      ...ctx,
      app,
      get pannes() {
        return mailer.pannes;
      },
      fermer: () => app.close(),
    };
  });
  afterAll(async () => {
    // Base de test partagée : aucun job d'e-mail ne doit rester pour les fichiers suivants.
    await proprietaire((cl) => cl.query("DELETE FROM jobs WHERE type = $1", [TYPE_JOB_EMAIL]));
    await ctxPanne.fermer();
    await ctx.fermer();
  });

  /** L'envoi de l'invitation n'est plus attendu par la route (F3) : la mise en file suit la réponse. */
  async function attendreJobEmail(cabinetId: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const n = await proprietaire(
        async (cl) =>
          (
            await cl.query(
              "SELECT count(*)::int AS n FROM jobs WHERE cabinet_id = $1 AND type = $2",
              [cabinetId, TYPE_JOB_EMAIL],
            )
          ).rows[0].n as number,
      );
      if (n > 0) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error("Aucun e-mail mis en file.");
  }

  it("SMTP indisponible : l'invitation est créée, l'e-mail est mis en file chiffré puis repris", async () => {
    const c = await creerCabinet(ctx, "Cabinet E-mail");
    const associe = api(ctxPanne, await connecter(ctxPanne, c.email));
    const email = `invite-${Date.now()}@exemple.test`;
    const r = await associe.post("/api/invitations", { email, roles: ["consultant"] });
    expect(r.statusCode).toBe(201);
    expect(ctxPanne.pannes).toBe(1);
    await attendreJobEmail(c.cabinetId);

    const job = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT id, statut, tentatives_max, charge::text AS charge FROM jobs WHERE cabinet_id = $1 AND type = $2",
            [c.cabinetId, TYPE_JOB_EMAIL],
          )
        ).rows,
    );
    expect(job).toHaveLength(1);
    expect(job[0].statut).toBe("en_attente");
    expect(job[0].tentatives_max).toBe(5);
    // Ni l'adresse, ni le lien d'invitation en clair dans la file.
    expect(job[0].charge).not.toContain(email);
    expect(job[0].charge).not.toContain("jeton");
    expect(job[0].charge).not.toContain("invitation");

    const plusTard = () => new Date(Date.now() + 5 * 60_000);
    const trousseau = trousseauDepuisConfig(ctx.config);

    // Nouvel échec : nouvelle tentative différée, la charge reste chiffrée.
    const enPanne = new MailerEnPanne();
    const w1 = new WorkerJobs(ctx.db, {
      mailer: enPanne,
      registre: registreAvecEmails(enPanne, trousseau),
      horloge: plusTard,
    });
    let res = null;
    for (let i = 0; i < 50 && res?.id !== job[0].id; i++) res = await w1.traiterUn();
    expect(res).toMatchObject({
      id: job[0].id,
      statut: "reessai",
      erreur: "Envoi de l'e-mail échoué.",
    });

    // SMTP revenu : l'e-mail part, la charge est effacée.
    const boite = new MailerJournal();
    const w2 = new WorkerJobs(ctx.db, {
      mailer: boite,
      registre: registreAvecEmails(boite, trousseau),
      horloge: () => new Date(Date.now() + 60 * 60_000),
    });
    res = null;
    for (let i = 0; i < 50 && res?.id !== job[0].id; i++) res = await w2.traiterUn();
    expect(res).toMatchObject({ id: job[0].id, statut: "termine" });
    const recu = boite.dernierPour(email) as MessageEmail;
    expect(recu.sujet).toContain("Cabinet E-mail");
    expect(recu.texte).toMatch(/#jeton=[\w-]{20,}/);
    const apres = await proprietaire(
      async (cl) =>
        (await cl.query("SELECT statut, charge FROM jobs WHERE id = $1", [job[0].id])).rows[0],
    );
    expect(apres).toEqual({ statut: "termine", charge: {} });
  });

  it("une charge altérée ou d'un autre cabinet n'est pas déchiffrée (échec définitif)", async () => {
    const c1 = await creerCabinet(ctx, "Cabinet E-mail 1");
    const c2 = await creerCabinet(ctx, "Cabinet E-mail 2");
    const associe = api(ctxPanne, await connecter(ctxPanne, c1.email));
    await associe.post("/api/invitations", {
      email: `x-${Date.now()}@exemple.test`,
      roles: ["consultant"],
    });
    await attendreJobEmail(c1.cabinetId);
    // La charge chiffrée du cabinet 1 recopiée dans un job du cabinet 2.
    const id = await proprietaire(async (cl) => {
      const src = (
        await cl.query("SELECT charge FROM jobs WHERE cabinet_id = $1 AND type = $2", [
          c1.cabinetId,
          TYPE_JOB_EMAIL,
        ])
      ).rows[0];
      return (
        await cl.query(
          "INSERT INTO jobs (cabinet_id, type, charge) VALUES ($1, $2, $3) RETURNING id",
          [c2.cabinetId, TYPE_JOB_EMAIL, src.charge],
        )
      ).rows[0].id as string;
    });
    const boite = new MailerJournal();
    const w = new WorkerJobs(ctx.db, {
      mailer: boite,
      registre: registreAvecEmails(boite, trousseauDepuisConfig(ctx.config)),
      horloge: () => new Date(Date.now() + 60_000),
    });
    let res = null;
    for (let i = 0; i < 50 && res?.id !== id; i++) res = await w.traiterUn();
    expect(res).toMatchObject({ id, statut: "echec", erreur: "Charge d'e-mail illisible." });
  });
});
