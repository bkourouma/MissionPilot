import { randomBytes } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { ADRESSE_ASCII } from "../config.js";

/*
 * Client SMTP minimal (RFC 5321) sur node:net / node:tls, sans dépendance :
 * EHLO, STARTTLS ou TLS implicite, AUTH PLAIN / LOGIN, MAIL FROM, RCPT TO,
 * DATA, QUIT. Une connexion par message (faible volume : invitations,
 * notifications).
 *
 * Sécurité :
 * - TLS : certificat du serveur toujours vérifié ; en mode « starttls », un
 *   serveur qui n'annonce pas STARTTLS est refusé (pas de repli en clair) ;
 *   l'authentification n'est jamais envoyée sur une connexion en clair, sauf
 *   mode « aucun » (développement et test uniquement, refusé par la config).
 * - En-têtes : destinataire et expéditeur validés (ASCII strict, aucun
 *   caractère d'en-tête) ; sujet sur une ligne, sans caractère de contrôle
 *   ni de contrôle bidirectionnel, encodé RFC 2047 ; corps en base64.
 * - Erreurs : seul le code de réponse SMTP est cité, jamais le texte du
 *   serveur, l'adresse ni les identifiants.
 * - STARTTLS (constat F3) : toute donnée reçue en clair après le « 220 » de
 *   STARTTLS est refusée (injection de réponses avant la négociation), et les
 *   tampons du lecteur sont remis à zéro sur la connexion chiffrée.
 * - Délais (F3) : inactivité posée AVANT la connexion TCP et la négociation
 *   TLS, délai global par envoi, plafond de lignes par réponse et de
 *   réponses en attente : un serveur lent ou bavard ne bloque pas l'appelant.
 */

export type SecuriteSmtp = "implicite" | "starttls" | "aucun";

export interface OptionsSmtp {
  hote: string;
  port: number;
  securite: SecuriteSmtp;
  utilisateur?: string;
  motDePasse?: string;
  expediteur: string;
  /** Nom affiché de l'expéditeur. */
  nomExpediteur?: string;
  /** Délai d'inactivité de la connexion, y compris connexion TCP et TLS (défaut 30 s). */
  delaiMs?: number;
  /** Délai global d'un envoi, de la connexion au QUIT (défaut 60 s). */
  delaiTotalMs?: number;
  /** Options TLS supplémentaires (ex. autorité de test). La vérification reste active. */
  tls?: Pick<tls.ConnectionOptions, "ca">;
}

export interface MessageSmtp {
  a: string;
  sujet: string;
  texte: string;
}

export class ErreurSmtp extends Error {}

const BIDI_ET_LIGNES = /[\r\n\u0085\u2028\u2029\u200e\u200f\u061c\u202A-\u202E\u2066-\u2069]/g;
// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u001f\u007f]/g;

/** Adresse utilisable dans une commande SMTP et un en-tête : ASCII strict, longueur bornée. */
export function adresseSure(adresse: string): string {
  if (adresse.length > 254 || !ADRESSE_ASCII.test(adresse)) {
    throw new ErreurSmtp("Adresse e-mail refusée pour l'envoi.");
  }
  return adresse;
}

/** Sujet sur une seule ligne, sans contrôle ni caractère bidirectionnel, borné. */
export function sujetSur(sujet: string): string {
  return sujet
    .replace(BIDI_ET_LIGNES, " ")
    .replace(CONTROLES, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 250);
}

/** Mot encodé RFC 2047 (UTF-8, base64), découpé sans couper un caractère. */
export function encoderEntete(valeur: string): string {
  if (/^[\x20-\x7e]*$/.test(valeur) && valeur.length <= 900) return valeur;
  const morceaux: string[] = [];
  let courant = "";
  for (const c of valeur) {
    if (Buffer.byteLength(courant + c, "utf8") > 45) {
      morceaux.push(courant);
      courant = "";
    }
    courant += c;
  }
  if (courant) morceaux.push(courant);
  return morceaux
    .map((m) => `=?UTF-8?B?${Buffer.from(m, "utf8").toString("base64")}?=`)
    .join("\r\n ");
}

function base64Lignes(texte: string): string {
  const b64 = Buffer.from(texte.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64");
  return (b64.match(/.{1,76}/g) ?? []).join("\r\n");
}

/** Message RFC 5322 complet (en-têtes et corps), lignes terminées par CRLF. */
export function construireMessage(
  message: MessageSmtp,
  expediteur: string,
  nomExpediteur: string,
  maintenant = new Date(),
): string {
  const a = adresseSure(message.a);
  const de = adresseSure(expediteur);
  const domaine = de.split("@")[1]!;
  // Nom affiché : lettres, chiffres, espace, point, apostrophe, tiret ; sinon nom par défaut.
  const nomSur = /^[\p{L}\p{N} .'-]{1,60}$/u.test(nomExpediteur) ? nomExpediteur : "MissionPilot";
  const nom = /^[A-Za-z0-9 ]+$/.test(nomSur) ? nomSur : encoderEntete(nomSur);
  return [
    `From: ${nom} <${de}>`,
    `To: <${a}>`,
    `Subject: ${encoderEntete(sujetSur(message.sujet))}`,
    `Date: ${maintenant.toUTCString()}`,
    `Message-ID: <${randomBytes(16).toString("hex")}@${domaine}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lignes(message.texte.split(String.fromCharCode(0)).join("")),
  ].join("\r\n");
}

interface Reponse {
  code: number;
  lignes: string[];
}

/** Lignes d'une réponse (EHLO en compte une dizaine) et réponses en attente, au plus. */
const LIGNES_MAX = 100;
const REPONSES_EN_ATTENTE_MAX = 10;

/** Lecture des réponses SMTP (multi-lignes « 250-… » puis « 250 … »). */
class Lecteur {
  private tampon = "";
  private lignes: string[] = [];
  private prets: Reponse[] = [];
  private attente: { resoudre: (r: Reponse) => void; rejeter: (e: Error) => void } | null = null;
  private erreur: Error | null = null;

  constructor(private socket: net.Socket) {
    this.brancher(socket);
  }

  /** Rien n'a été reçu au-delà des réponses déjà lues. */
  vide(): boolean {
    return this.tampon === "" && this.lignes.length === 0 && this.prets.length === 0;
  }

  brancher(socket: net.Socket): void {
    this.socket = socket;
    // Nouvelle connexion (chiffrée après STARTTLS) : rien de l'ancienne n'est repris.
    this.tampon = "";
    this.lignes = [];
    this.prets = [];
    socket.setEncoding("utf8");
    socket.on("data", (d: string) => this.recevoir(d));
    socket.on("error", () => this.echouer(new ErreurSmtp("SMTP : connexion interrompue.")));
    socket.on("close", () => this.echouer(new ErreurSmtp("SMTP : connexion fermée.")));
  }

  detacher(): void {
    this.socket.removeAllListeners("data");
    this.socket.removeAllListeners("error");
    this.socket.removeAllListeners("close");
  }

  private recevoir(donnees: string): void {
    this.tampon += donnees;
    if (this.tampon.length > 64_000) {
      this.echouer(new ErreurSmtp("SMTP : réponse trop longue."));
      return;
    }
    let i: number;
    while ((i = this.tampon.indexOf("\n")) >= 0) {
      const ligne = this.tampon.slice(0, i).replace(/\r$/, "");
      this.tampon = this.tampon.slice(i + 1);
      this.lignes.push(ligne);
      if (this.lignes.length > LIGNES_MAX) {
        this.echouer(new ErreurSmtp("SMTP : réponse trop longue."));
        return;
      }
      if (!/^\d{3}-/.test(ligne)) {
        const code = Number(ligne.slice(0, 3));
        const r = { code: Number.isInteger(code) ? code : 0, lignes: this.lignes };
        this.lignes = [];
        if (this.attente) {
          const a = this.attente;
          this.attente = null;
          a.resoudre(r);
        } else {
          this.prets.push(r);
          if (this.prets.length > REPONSES_EN_ATTENTE_MAX) {
            this.echouer(new ErreurSmtp("SMTP : réponses inattendues."));
            return;
          }
        }
      }
    }
  }

  private echouer(e: Error): void {
    if (this.erreur) return;
    this.erreur = e;
    if (this.attente) {
      const a = this.attente;
      this.attente = null;
      a.rejeter(e);
    }
  }

  lire(): Promise<Reponse> {
    const r = this.prets.shift();
    if (r) return Promise.resolve(r);
    if (this.erreur) return Promise.reject(this.erreur);
    return new Promise((resoudre, rejeter) => (this.attente = { resoudre, rejeter }));
  }
}

function connecter(options: OptionsSmtp, delai: number): Promise<net.Socket> {
  return new Promise((resoudre, rejeter) => {
    const surErreur = () => rejeter(new ErreurSmtp("SMTP : connexion impossible."));
    const socket: net.Socket =
      options.securite === "implicite"
        ? tls.connect(
            {
              host: options.hote,
              port: options.port,
              servername: options.hote,
              rejectUnauthorized: true,
              minVersion: "TLSv1.2",
              ...options.tls,
            },
            () => {
              socket.off("error", surErreur);
              socket.setTimeout(0);
              resoudre(socket);
            },
          )
        : net.connect({ host: options.hote, port: options.port }, () => {
            socket.off("error", surErreur);
            socket.setTimeout(0);
            resoudre(socket);
          });
    socket.once("error", surErreur);
    // Délai posé AVANT la connexion TCP (et la négociation TLS implicite).
    socket.setTimeout(delai, () => {
      socket.destroy();
      rejeter(new ErreurSmtp("SMTP : délai de connexion dépassé."));
    });
  });
}

function passerEnTls(
  socket: net.Socket,
  options: OptionsSmtp,
  delai: number,
): Promise<tls.TLSSocket> {
  return new Promise((resoudre, rejeter) => {
    const s: tls.TLSSocket = tls.connect(
      {
        socket,
        servername: options.hote,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        ...options.tls,
      },
      () => {
        s.off("error", surErreur);
        s.setTimeout(0);
        resoudre(s);
      },
    );
    const surErreur = () => rejeter(new ErreurSmtp("SMTP : négociation TLS échouée."));
    s.once("error", surErreur);
    // Délai posé AVANT la négociation TLS.
    s.setTimeout(delai, () => {
      s.destroy();
      socket.destroy();
      rejeter(new ErreurSmtp("SMTP : délai de négociation TLS dépassé."));
    });
  });
}

/** Envoie un message ; lève ErreurSmtp en cas d'échec (le message peut être repris). */
export async function envoyerSmtp(options: OptionsSmtp, message: MessageSmtp): Promise<void> {
  const contenu = construireMessage(
    message,
    options.expediteur,
    options.nomExpediteur ?? "MissionPilot",
  );
  const a = adresseSure(message.a);
  const de = adresseSure(options.expediteur);
  const delai = options.delaiMs ?? 30_000;
  const delaiTotal = options.delaiTotalMs ?? 60_000;
  let socket: net.Socket | null = null;
  let expire = false;
  // Délai global : la connexion en cours est détruite, l'attente en cours échoue.
  const minuteur = setTimeout(() => {
    expire = true;
    socket?.destroy();
  }, delaiTotal);
  try {
    socket = await connecter(options, Math.min(delai, delaiTotal));
    if (expire) throw new ErreurSmtp("SMTP : délai d'envoi dépassé.");
    await dialoguer(socket, options, contenu, a, de, delai, (s) => {
      socket = s;
      if (expire) s.destroy();
    });
  } catch (error) {
    if (expire) throw new ErreurSmtp("SMTP : délai d'envoi dépassé.");
    throw error;
  } finally {
    clearTimeout(minuteur);
  }
}

async function dialoguer(
  socketInitial: net.Socket,
  options: OptionsSmtp,
  contenu: string,
  a: string,
  de: string,
  delai: number,
  surNouvelleSocket: (s: net.Socket) => void,
): Promise<void> {
  let socket = socketInitial;
  socket.setTimeout(delai, () => socket.destroy());
  const lecteur = new Lecteur(socket);
  let chiffre = options.securite === "implicite";

  const attendre = async (etape: string, codes: number[]) => {
    const r = await lecteur.lire();
    if (!codes.includes(r.code)) {
      throw new ErreurSmtp(`SMTP : ${etape} refusé (code ${r.code}).`);
    }
    return r;
  };
  const commande = (ligne: string, etape: string, codes: number[]) => {
    socket.write(`${ligne}\r\n`);
    return attendre(etape, codes);
  };

  try {
    await attendre("accueil", [220]);
    const nomLocal = "missionpilot.local";
    let ehlo = await commande(`EHLO ${nomLocal}`, "EHLO", [250]);
    const annonce = (mot: string) =>
      ehlo.lignes.some((l) => l.slice(4).toUpperCase().split(/\s+/)[0] === mot);

    if (options.securite === "starttls") {
      if (!annonce("STARTTLS")) throw new ErreurSmtp("SMTP : STARTTLS non proposé par le serveur.");
      await commande("STARTTLS", "STARTTLS", [220]);
      lecteur.detacher();
      // Des octets reçus en clair après le 220 seraient lus comme des réponses
      // « chiffrées » : refus (injection STARTTLS, CVE-2011-0411 et suivantes).
      if (!lecteur.vide()) throw new ErreurSmtp("SMTP : données inattendues après STARTTLS.");
      socket.on("error", () => undefined);
      socket.setTimeout(0);
      socket = await passerEnTls(socket, options, delai);
      surNouvelleSocket(socket);
      socket.setTimeout(delai, () => socket.destroy());
      lecteur.brancher(socket);
      chiffre = true;
      ehlo = await commande(`EHLO ${nomLocal}`, "EHLO", [250]);
    }

    if (options.utilisateur !== undefined && options.motDePasse !== undefined) {
      if (!chiffre && options.securite !== "aucun") {
        throw new ErreurSmtp("SMTP : authentification refusée sans TLS.");
      }
      const mecanismes = ehlo.lignes
        .filter((l) => /^AUTH[ =]/i.test(l.slice(4)))
        .flatMap((l) => l.slice(9).toUpperCase().split(/\s+/));
      if (mecanismes.includes("PLAIN") || !mecanismes.includes("LOGIN")) {
        const jeton = Buffer.from(
          `\u0000${options.utilisateur}\u0000${options.motDePasse}`,
          "utf8",
        ).toString("base64");
        await commande(`AUTH PLAIN ${jeton}`, "AUTH", [235]);
      } else {
        await commande("AUTH LOGIN", "AUTH", [334]);
        await commande(Buffer.from(options.utilisateur).toString("base64"), "AUTH", [334]);
        await commande(Buffer.from(options.motDePasse).toString("base64"), "AUTH", [235]);
      }
    }

    await commande(`MAIL FROM:<${de}>`, "MAIL FROM", [250]);
    await commande(`RCPT TO:<${a}>`, "RCPT TO", [250, 251]);
    await commande("DATA", "DATA", [354]);
    // Transparence (RFC 5321 § 4.5.2) : toute ligne commençant par « . » est doublée.
    const corps = contenu.replace(/(^|\r\n)\./g, "$1..");
    socket.write(`${corps}\r\n.\r\n`);
    await attendre("message", [250]);
    socket.write("QUIT\r\n");
    await lecteur.lire().catch(() => undefined);
  } finally {
    lecteur.detacher();
    socket.on("error", () => undefined);
    socket.end();
    socket.destroy();
  }
}
