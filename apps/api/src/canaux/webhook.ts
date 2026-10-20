import type { FastifyInstance, FastifyRequest } from "fastify";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import { creerLimiteur } from "../auth/limiteur.js";
import { AppError, requeteInvalide } from "../errors.js";
import { envoyerEmails } from "../notifications/notifier.js";
import { traiterEvenements, type CompteResolu } from "./entrants.js";
import { tropDeRequetes } from "./erreurs.js";
import { LimiteMemoire } from "./limite-memoire.js";
import { ErreurCanal, type EvenementCanal } from "./ports.js";

/*
 * Webhook entrant WhatsApp (SPEC-3c §8) : UNE route publique, signée HMAC, anti-rejeu, idempotente.
 * Justification de la route publique : l'appelant est un service, pas une session ; l'authenticité
 * vient de la signature HMAC du CORPS BRUT, vérifiée avant tout traitement et avant toute lecture de
 * la base ; tout est rejeté par défaut ; la route n'existe qu'avec un fournisseur configuré ; elle
 * n'est pas dans la liste blanche du portail (une session du portail qui l'appellerait reçoit 403).
 *
 * Ordre des contrôles : taille et type (413, 415 : analyseur de contenu du plugin), authenticité
 * (401 `WEBHOOK_REFUSE`, même message pour toute cause, compté par `webhook_invalide`, 429 au-delà),
 * forme (400), compte (inconnu ou inactif : 200 sans effet), débit par compte (429), puis, dans la
 * transaction du cabinet, anti-rejeu `(cabinet, canal, evenement)` et traitement. Réponse toujours
 * `200 { recus: n }`, indépendante du contenu.
 */

export const webhookRefuse = () => new AppError(401, "WEBHOOK_REFUSE", "Requête refusée.");

/** Clé unique et globale du compteur des signatures invalides (aucun détail sur la cause). */
const CLE_INVALIDES = "global";

/*
 * Garde EN MÉMOIRE avant la base (route publique) : au-delà de ces plafonds de signatures invalides
 * sur 5 minutes, ni transaction ni requête (429 immédiat). Plafonds volontairement AU-DESSUS du
 * limiteur persistant (30) pour que celui-ci reste la référence ; ils bornent seulement le nombre de
 * transactions qu'un flot peut ouvrir (au plus ~100 par fenêtre et par processus). À valider.
 */
export const INVALIDES_MEMOIRE_GLOBAL = 100;
export const INVALIDES_MEMOIRE_PAR_IP = 50;
const FENETRE_INVALIDES_MS = 5 * 60_000;
const limiteInvalidesGlobale = new LimiteMemoire(INVALIDES_MEMOIRE_GLOBAL, FENETRE_INVALIDES_MS, 1);
const limiteInvalidesParIp = new LimiteMemoire(INVALIDES_MEMOIRE_PAR_IP, FENETRE_INVALIDES_MS);

/** Remet à zéro les compteurs mémoire du webhook (tests). */
export function reinitialiserLimitesWebhook(): void {
  limiteInvalidesGlobale.reinitialiser();
  limiteInvalidesParIp.reinitialiser();
}
const FORMAT_COMPTE = /^cpt-[0-9a-f]{16}$/;

function entetes(request: FastifyRequest): Record<string, string | undefined> {
  const sortie: Record<string, string | undefined> = {};
  for (const [nom, valeur] of Object.entries(request.headers)) {
    sortie[nom.toLowerCase()] = Array.isArray(valeur) ? valeur[0] : valeur;
  }
  return sortie;
}

export async function traiterWebhook(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<{ recus: number }> {
  const canal = app.canaux.whatsapp;
  const { WHATSAPP_WEBHOOK_SECRET: courant, WHATSAPP_WEBHOOK_SECRET_PRECEDENT: precedent } =
    app.config;
  if (!canal || !courant) throw new AppError(404, "INTROUVABLE", "Ressource introuvable.");
  const trousseau = trousseauDepuisConfig(app.config);
  const corps = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);

  let evenements: readonly EvenementCanal[];
  try {
    evenements = canal.verifierWebhook({
      entetes: entetes(request),
      corps,
      maintenant: new Date(),
      secrets: precedent ? [courant, precedent] : [courant],
    });
  } catch (error) {
    if (error instanceof ErreurCanal) {
      if (error.code === "CORPS_INVALIDE") throw requeteInvalide("Données invalides.");
      // Signature ou horodatage : même réponse pour toute cause, signatures invalides comptées.
      // D'abord la garde mémoire (les deux compteurs avancent) : au-delà, 429 sans appeler la base.
      const parIp = limiteInvalidesParIp.reserver(request.ip);
      const globale = limiteInvalidesGlobale.reserver(CLE_INVALIDES);
      if (!parIp || !globale) throw tropDeRequetes();
      const limiteInvalides = creerLimiteur(app.db, "webhook_invalide", trousseau);
      if (!(await limiteInvalides.reserver(CLE_INVALIDES))) throw tropDeRequetes();
      throw webhookRefuse();
    }
    throw error;
  }

  const limiteCompte = creerLimiteur(app.db, "webhook_canal", trousseau);
  const parCompte = new Map<string, EvenementCanal[]>();
  for (const e of evenements) parCompte.set(e.compte, [...(parCompte.get(e.compte) ?? []), e]);
  for (const [identifiant, evs] of parCompte) {
    const resolu: CompteResolu | null = FORMAT_COMPTE.test(identifiant)
      ? await app.db.withoutTenant(async (db) => {
          const r = await db.query(
            "SELECT cabinet_id, compte_id FROM resoudre_compte_canal('whatsapp', $1)",
            [identifiant],
          );
          return r.rows[0]
            ? {
                cabinetId: r.rows[0].cabinet_id as string,
                compteId: r.rows[0].compte_id as string,
                identifiantCompte: identifiant,
              }
            : null;
        })
      : null;
    // Débit par compte (clé = empreinte du compte), même pour un compte inconnu : aucune fuite.
    if (!(await limiteCompte.reserver(identifiant))) throw tropDeRequetes();
    if (!resolu) continue; // compte inconnu ou inactif : 200 sans effet
    const notifications = await app.db.withTenant(resolu.cabinetId, async (db) => {
      const r = await traiterEvenements(
        db,
        { trousseau, compte: resolu, maintenant: new Date() },
        evs,
      );
      return r.notifications;
    });
    await envoyerEmails(app.mailer, notifications, (m) => request.log.warn(m));
  }
  return { recus: evenements.length };
}
