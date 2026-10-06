import type { Config } from "../config.js";

export interface MessageEmail {
  a: string;
  sujet: string;
  texte: string;
}

/** Envoi d'e-mails (SOC-08). Un transport réel (SMTP, API) viendra derrière cette interface. */
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

export function creerMailer(config: Pick<Config, "NODE_ENV">): Mailer {
  if (config.NODE_ENV === "development") {
    return new MailerJournal((ligne) => console.info(ligne));
  }
  // Aucun transport externe en V1 : en test et en production, journal silencieux.
  return new MailerJournal();
}
