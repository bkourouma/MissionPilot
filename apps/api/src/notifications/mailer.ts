import { estLocal, type Config } from "../config.js";
import { envoyerSmtp, type OptionsSmtp } from "./smtp.js";

export interface MessageEmail {
  a: string;
  sujet: string;
  texte: string;
}

/** Envoi d'e-mails (SOC-08). Lève une erreur si le message n'a pas été accepté. */
export interface Mailer {
  envoyer(message: MessageEmail): Promise<void>;
}

declare module "fastify" {
  interface FastifyInstance {
    mailer: Mailer;
  }
}

const TAILLE_BOITE = 100;

/**
 * Transport « journal » pour le développement et les tests : rien ne sort de
 * la machine. Les messages restent dans `boite` (les 100 derniers). Leur
 * contenu (qui peut porter un lien d'invitation) n'est affiché dans la
 * console qu'en développement ; ailleurs, seul le sujet est tracé.
 */
export class MailerJournal implements Mailer {
  readonly boite: MessageEmail[] = [];

  constructor(private readonly afficher: (ligne: string) => void = () => undefined) {}

  async envoyer(message: MessageEmail): Promise<void> {
    this.boite.push(message);
    if (this.boite.length > TAILLE_BOITE) this.boite.shift();
    this.afficher(`[e-mail] À : ${message.a} — ${message.sujet}\n${message.texte}`);
  }

  dernierPour(a: string): MessageEmail | undefined {
    return [...this.boite].reverse().find((m) => m.a === a);
  }
}

/** Transport SMTP réel (voir smtp.ts). Les identifiants ne sont jamais journalisés. */
export class MailerSmtp implements Mailer {
  constructor(private readonly options: OptionsSmtp) {}

  async envoyer(message: MessageEmail): Promise<void> {
    await envoyerSmtp(this.options, message);
  }
}

type ConfigMailer = Pick<
  Config,
  "NODE_ENV" | "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASS" | "SMTP_TLS" | "MAIL_FROM"
>;

/** Options SMTP depuis la configuration ; null si SMTP_HOST n'est pas défini. */
export function optionsSmtp(config: ConfigMailer): OptionsSmtp | null {
  if (!config.SMTP_HOST) return null;
  if (!config.MAIL_FROM) throw new Error("MAIL_FROM est obligatoire avec SMTP_HOST.");
  const port = config.SMTP_PORT ?? (config.SMTP_TLS === "implicite" ? 465 : 587);
  const securite = config.SMTP_TLS ?? (port === 465 ? "implicite" : "starttls");
  if (securite === "aucun" && !estLocal(config.NODE_ENV)) {
    throw new Error("SMTP sans TLS refusé hors développement.");
  }
  return {
    hote: config.SMTP_HOST,
    port,
    securite,
    expediteur: config.MAIL_FROM,
    ...(config.SMTP_USER !== undefined && config.SMTP_PASS !== undefined
      ? { utilisateur: config.SMTP_USER, motDePasse: config.SMTP_PASS }
      : {}),
  };
}

/**
 * SMTP si SMTP_HOST est défini ; sinon journal local en développement (affiché)
 * et en test (silencieux). Hors développement et test sans SMTP, refus :
 * loadConfig l'a déjà refusé, ce contrôle protège un appel direct.
 */
export function creerMailer(config: ConfigMailer): Mailer {
  const smtp = optionsSmtp(config);
  if (smtp) return new MailerSmtp(smtp);
  if (!estLocal(config.NODE_ENV)) {
    throw new Error("Aucun transport e-mail configuré (SMTP_HOST) hors développement.");
  }
  if (config.NODE_ENV === "development") {
    return new MailerJournal((ligne) => console.info(ligne));
  }
  return new MailerJournal();
}
