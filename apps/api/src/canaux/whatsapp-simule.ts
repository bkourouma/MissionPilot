import { createHmac, timingSafeEqual } from "node:crypto";
import { webhookCanalSchema } from "@missionpilot/shared";
import {
  ErreurCanal,
  type CanalWhatsApp,
  type EntreeWebhook,
  type EnvoiGabarit,
  type EnvoiSession,
  type EvenementCanal,
  type ResultatEnvoi,
} from "./ports.js";
import type { MediaFlux } from "./media-flux.js";
import {
  ajouterALaBoite,
  exigerNumeroDeTest,
  idExterneSimule,
  refusDe,
  refusSelonNumero,
  type MessageSimule,
} from "./simule-commun.js";

/*
 * CanalWhatsAppSimule (SPEC-3c §4.1) : AUCUN envoi réel, aucune clé, aucune requête réseau. Les
 * messages « envoyés » restent dans une boîte en mémoire (les 100 derniers), lue par le simulateur
 * de développement et par les tests ; ils ne sont écrits ni en base ni dans un journal.
 *
 * Webhook simulé : en-têtes `x-mp-horodatage` (secondes epoch) et `x-mp-signature` = HMAC-SHA-256
 * hexadécimal de « <horodatage>.<corps brut> » avec l'un des secrets (courant, précédent),
 * comparaison en temps constant, fenêtre de ±300 s (300 s incluses). Cette forme est la NÔTRE : le
 * format réel des webhooks de Meta n'est PAS vérifié (O-13).
 */

/** Média déposé en bloc par un test ; le simulateur le rend en flux (blocs de 64 Kio). */
export interface MediaDepose {
  contenu: Buffer;
  typeMime: string;
  tailleDeclaree?: number;
}

/** Suivi d'un média « géant » : permet de PROUVER que la lecture s'arrête au plafond. */
export interface SuiviMediaGeant {
  /** Blocs réellement produits (donc lus) par le flux. */
  blocsLus: number;
  /** Vrai dès que le flux a été fermé par son lecteur (return/cancel). */
  ferme: boolean;
}

const BLOC_SIMULE_OCTETS = 64 * 1024;

export const FENETRE_WEBHOOK_SECONDES = 300;
export const FENETRE_SERVICE_MS = 24 * 3_600_000;
export const ENTETE_HORODATAGE = "x-mp-horodatage";
export const ENTETE_SIGNATURE = "x-mp-signature";

/** En-têtes signés d'un corps de webhook simulé (utilisé par le simulateur et les tests). */
export function signerWebhook(
  corps: string | Buffer,
  secret: string,
  horodatageSecondes: number,
): { [ENTETE_HORODATAGE]: string; [ENTETE_SIGNATURE]: string; "content-type": string } {
  const horodatage = String(horodatageSecondes);
  const signature = createHmac("sha256", secret)
    .update(`${horodatage}.`, "utf8")
    .update(corps)
    .digest("hex");
  return {
    [ENTETE_HORODATAGE]: horodatage,
    [ENTETE_SIGNATURE]: signature,
    "content-type": "application/json",
  };
}

function signatureValide(
  horodatage: string,
  corps: Buffer,
  recue: string,
  secrets: readonly string[],
) {
  if (!/^[0-9a-f]{64}$/.test(recue)) return false;
  const attendue = Buffer.from(recue, "hex");
  let valide = false;
  // Tous les secrets sont comparés (pas de sortie anticipée) : temps constant vis-à-vis du secret.
  for (const secret of secrets) {
    const calculee = createHmac("sha256", secret)
      .update(`${horodatage}.`, "utf8")
      .update(corps)
      .digest();
    if (calculee.length === attendue.length && timingSafeEqual(calculee, attendue)) valide = true;
  }
  return valide;
}

export interface OptionsCanalSimule {
  /** Horloge injectable (fenêtre de 24 h des réponses de session). */
  horloge?: () => Date;
}

export class CanalWhatsAppSimule implements CanalWhatsApp {
  readonly fournisseur = "simule";
  readonly mode = "simule" as const;
  /** Les 100 derniers messages « envoyés » (jamais écrits en base ni dans un journal). */
  readonly boite: MessageSimule[] = [];
  private readonly horloge: () => Date;
  private readonly appels = new Map<string, number>();
  private readonly acceptes = new Map<string, ResultatEnvoi>();
  private readonly derniersEntrants = new Map<string, Date>();
  private readonly medias = new Map<string, () => MediaFlux>();

  constructor(options: OptionsCanalSimule = {}) {
    this.horloge = options.horloge ?? (() => new Date());
  }

  /** Date du dernier message entrant simulé de ce numéro (fenêtre de service de 24 h). */
  noterEntrant(numero: string, instant: Date): void {
    const connu = this.derniersEntrants.get(numero);
    if (!connu || connu < instant) this.derniersEntrants.set(numero, instant);
  }

  /** Dépose un média (audio de test) que `telechargerMedia` rendra EN FLUX : usage du simulateur. */
  deposerMedia(compte: string, refMedia: string, media: MediaDepose): void {
    this.medias.set(`${compte}|${refMedia}`, () => ({
      flux: fluxEnBlocs(media.contenu),
      typeMime: media.typeMime,
      ...(media.tailleDeclaree !== undefined ? { tailleDeclaree: media.tailleDeclaree } : {}),
    }));
  }

  /**
   * Dépose un média « géant » dont le flux ne finit JAMAIS (blocs de 64 Kio, zéros) : sert à prouver
   * qu'un lecteur plafonné s'arrête et ferme le flux. `tailleDeclaree` absent = fournisseur sans
   * en-tête de taille. Rend le suivi (blocs produits, flux fermé).
   */
  deposerMediaGeant(
    compte: string,
    refMedia: string,
    options: {
      typeMime?: string;
      tailleDeclaree?: number;
      blocOctets?: number;
      /** Le flux échoue (ErreurCanal) après ce nombre de blocs au lieu de ne jamais finir. */
      erreurApresBlocs?: number;
    } = {},
  ): SuiviMediaGeant {
    const suivi: SuiviMediaGeant = { blocsLus: 0, ferme: false };
    const bloc = new Uint8Array(options.blocOctets ?? BLOC_SIMULE_OCTETS);
    this.medias.set(`${compte}|${refMedia}`, () => ({
      flux: (async function* () {
        try {
          for (;;) {
            if (
              options.erreurApresBlocs !== undefined &&
              suivi.blocsLus >= options.erreurApresBlocs
            ) {
              throw new ErreurCanal("INDISPONIBLE_INCONNU");
            }
            suivi.blocsLus += 1;
            yield bloc;
          }
        } finally {
          suivi.ferme = true;
        }
      })(),
      typeMime: options.typeMime ?? "audio/ogg",
      ...(options.tailleDeclaree !== undefined ? { tailleDeclaree: options.tailleDeclaree } : {}),
    }));
    return suivi;
  }

  async envoyerGabarit(envoi: EnvoiGabarit): Promise<ResultatEnvoi> {
    return this.envoyer(envoi.idempotence, envoi.compte, envoi.numero, envoi.gabarit, envoi.texte);
  }

  async envoyerSession(envoi: EnvoiSession): Promise<ResultatEnvoi> {
    exigerNumeroDeTest(envoi.numero);
    const dernier = this.derniersEntrants.get(envoi.numero);
    if (!dernier || this.horloge().getTime() - dernier.getTime() > FENETRE_SERVICE_MS) {
      return refusDe("FENETRE_FERMEE", false);
    }
    return this.envoyer(
      envoi.idempotence,
      envoi.compte,
      envoi.numero,
      "reponse_session",
      envoi.texte,
    );
  }

  private envoyer(
    idempotence: string,
    compte: string,
    numero: string,
    gabarit: string,
    texte: string,
  ): ResultatEnvoi {
    exigerNumeroDeTest(numero);
    // Même idempotence : même identifiant, SANS nouveau message dans la boîte.
    const deja = this.acceptes.get(idempotence);
    if (deja) return deja;
    const appel = this.appels.get(idempotence) ?? 0;
    this.appels.set(idempotence, appel + 1);
    const refuse = refusSelonNumero(numero, appel);
    if (refuse) return refuse;
    const resultat: ResultatEnvoi = {
      statut: "accepte",
      idExterne: idExterneSimule("sim-wa-", idempotence),
      codeRefus: null,
      reessayable: false,
    };
    this.acceptes.set(idempotence, resultat);
    ajouterALaBoite(this.boite, {
      idExterne: resultat.idExterne as string,
      compte,
      numero,
      gabarit,
      texte,
      instant: this.horloge(),
    });
    return resultat;
  }

  verifierWebhook(entree: EntreeWebhook): readonly EvenementCanal[] {
    const horodatage = entree.entetes[ENTETE_HORODATAGE];
    const signature = entree.entetes[ENTETE_SIGNATURE];
    if (
      horodatage === undefined ||
      signature === undefined ||
      !/^\d{1,12}$/.test(horodatage) ||
      !signatureValide(horodatage, entree.corps, signature, entree.secrets)
    ) {
      throw new ErreurCanal("SIGNATURE_INVALIDE");
    }
    const ecart = Math.abs(entree.maintenant.getTime() / 1000 - Number(horodatage));
    if (ecart > FENETRE_WEBHOOK_SECONDES) throw new ErreurCanal("HORODATAGE_HORS_FENETRE");

    let brut: unknown;
    try {
      brut = JSON.parse(entree.corps.toString("utf8"));
    } catch {
      throw new ErreurCanal("CORPS_INVALIDE");
    }
    const charge = webhookCanalSchema.safeParse(brut);
    if (!charge.success) throw new ErreurCanal("CORPS_INVALIDE");
    const c = charge.data;
    if (c.type === "statut") {
      return [
        {
          type: "statut",
          idEvenement: c.evenement,
          compte: c.compte,
          idExterneMessage: c.id_externe_message,
          statut: c.statut,
          recuLe: entree.maintenant,
          codeRefus: c.code_refus ?? null,
        },
      ];
    }
    const recuLe = new Date(c.recu_le);
    // Le simulateur tient la date du dernier entrant de chaque numéro (fenêtre de service de 24 h).
    this.noterEntrant(c.numero, recuLe);
    if (c.genre === "texte") {
      if (c.texte === undefined) throw new ErreurCanal("CORPS_INVALIDE");
      return [
        {
          type: "message",
          idEvenement: c.evenement,
          compte: c.compte,
          numero: c.numero,
          recuLe,
          contenu: { genre: "texte", texte: c.texte },
        },
      ];
    }
    if (c.genre === "audio") {
      if (c.ref_media === undefined || c.type_mime === undefined) {
        throw new ErreurCanal("CORPS_INVALIDE");
      }
      return [
        {
          type: "message",
          idEvenement: c.evenement,
          compte: c.compte,
          numero: c.numero,
          recuLe,
          contenu: {
            genre: "audio",
            refMedia: c.ref_media,
            typeMime: c.type_mime,
            dureeMs: c.duree_ms ?? null,
          },
        },
      ];
    }
    return [
      {
        type: "message",
        idEvenement: c.evenement,
        compte: c.compte,
        numero: c.numero,
        recuLe,
        contenu: { genre: "autre" },
      },
    ];
  }

  async telechargerMedia(compte: string, refMedia: string): Promise<MediaFlux> {
    const ouvrir = this.medias.get(`${compte}|${refMedia}`);
    if (!ouvrir) throw new ErreurCanal("MEDIA_INTROUVABLE");
    return ouvrir();
  }
}

async function* fluxEnBlocs(contenu: Buffer): AsyncGenerator<Uint8Array> {
  for (let debut = 0; debut < contenu.length; debut += BLOC_SIMULE_OCTETS) {
    yield contenu.subarray(debut, debut + BLOC_SIMULE_OCTETS);
  }
}
