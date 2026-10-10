import type { FastifyInstance, FastifyRequest } from "fastify";
import { estUtilisateurPortail } from "@missionpilot/shared";
import { AppError } from "../errors.js";
import {
  dansContextePortail,
  SENTINELLE_CLIENT_PORTAIL,
  type ContexteBasePortail,
} from "./contexte.js";

/*
 * Garde du portail client (SOC-09) : LISTE BLANCHE STRICTE, motif par motif.
 *
 * Une session qui porte un rôle client (ils sont disjoints des rôles du
 * cabinet, CHECK en base) n'atteint que les routes (méthode + motif Fastify
 * exact) de LISTE_BLANCHE_PORTAIL ; toute autre route ENREGISTRÉE répond 403
 * PORTAIL_ROUTE_INTERDITE avant tout accès aux données (crochet onRequest,
 * motif de route comparé, jamais l'URL brute). Une route inconnue garde sa
 * réponse 404 ordinaire. Aucun préfixe : une route ajoutée sous /api/portail
 * ou /api/auth reste fermée au portail tant qu'elle n'est pas listée ici
 * (inventaire : test/portail-acces.test.ts).
 *
 * Contexte RLS (portail/contexte.ts) : pour toute route listée, la garde
 * range le client rattaché (ou un client SENTINELLE si le rattachement n'est
 * pas actif) et l'utilisateur ; db/pool.ts les pose à CHAQUE transaction de
 * la requête. SEULES exceptions (`sansContexte`), qui n'agissent que sur la
 * propre session et les propres secrets de l'utilisateur, ou sur un jeton
 * d'invitation : connexion, déconnexion, profil d'authentification, gestion
 * de SA 2FA et acceptations d'invitation. Leurs tables (sessions, *_2fa,
 * invitations) sont `portail_interdit` dans le contexte du portail.
 *
 * Délibérément ABSENTS :
 * - /api/auth/2fa/politique (politique du cabinet) ;
 * - les routes de gestion du portail (portail.gerer : invitations, partages,
 *   utilisateurs, paramètres), réservées au cabinet ;
 * - /api/fichiers/:id : son contrôle (stockage/fichiers.ts) suit les règles
 *   internes ; le livrable partagé se télécharge par
 *   /api/portail/livrables/:id/fichier, qui revérifie le partage ;
 * - /api/commentaires : les fils internes ne sont jamais servis au client.
 *
 * La même garde charge le contexte du portail (client rattaché, statut,
 * politique 2FA du portail) : un rattachement désactivé, ou un client
 * archivé, laisse `request.portail` à null et toute route du portail répond
 * 403/404.
 */

export interface ContextePortail {
  clientId: string;
}

export interface RouteInventoriee {
  methode: string;
  motif: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Contexte du portail d'un utilisateur client actif, sinon null. */
    portail: ContextePortail | null;
    /** Contexte RLS à poser à chaque transaction de la requête (portail/contexte.ts), sinon null. */
    contexteBasePortail: ContexteBasePortail | null;
  }
  interface FastifyInstance {
    /** Inventaire des routes enregistrées (contrôle exhaustif de la liste blanche du portail). */
    routesInventoriees: readonly RouteInventoriee[];
  }
}

export interface RouteOuverte {
  methodes: readonly string[];
  /** Motif Fastify EXACT (`request.routeOptions.url`). */
  motif: string;
  /** Sans contexte RLS du portail : propre session ou jeton d'invitation seulement. */
  sansContexte?: true;
}

const LECTURE = ["GET", "HEAD"] as const;
const POST = ["POST"] as const;

export const LISTE_BLANCHE_PORTAIL: readonly RouteOuverte[] = [
  { methodes: LECTURE, motif: "/api/sante" },
  // Authentification : sa propre session et sa propre 2FA (routes/auth.ts).
  { methodes: POST, motif: "/api/auth/connexion", sansContexte: true },
  { methodes: POST, motif: "/api/auth/connexion/2fa", sansContexte: true },
  { methodes: POST, motif: "/api/auth/deconnexion", sansContexte: true },
  { methodes: LECTURE, motif: "/api/auth/moi", sansContexte: true },
  { methodes: LECTURE, motif: "/api/auth/2fa", sansContexte: true },
  { methodes: POST, motif: "/api/auth/2fa/initialiser", sansContexte: true },
  { methodes: POST, motif: "/api/auth/2fa/activer", sansContexte: true },
  { methodes: POST, motif: "/api/auth/2fa/desactiver", sansContexte: true },
  { methodes: POST, motif: "/api/auth/2fa/codes-secours", sansContexte: true },
  // Routes publiques : le jeton d'invitation fait foi, jamais la session.
  { methodes: POST, motif: "/api/invitations/accepter", sansContexte: true },
  { methodes: POST, motif: "/api/portail/invitations/accepter", sansContexte: true },
  // Ses notifications (filtrées sur le destinataire, et par la politique 0114).
  { methodes: LECTURE, motif: "/api/notifications" },
  { methodes: POST, motif: "/api/notifications/:id/lue" },
  { methodes: POST, motif: "/api/notifications/tout-lire" },
  // Portail, côté client (routes/portail.ts) : chaque route exige sa permission portail.*.
  { methodes: LECTURE, motif: "/api/portail/moi" },
  { methodes: LECTURE, motif: "/api/portail/missions" },
  { methodes: LECTURE, motif: "/api/portail/missions/:id" },
  { methodes: LECTURE, motif: "/api/portail/missions/:id/jalons" },
  { methodes: POST, motif: "/api/portail/missions/:id/jalons/:jalonId/valider" },
  { methodes: LECTURE, motif: "/api/portail/missions/:id/livrables" },
  { methodes: LECTURE, motif: "/api/portail/livrables/:id/fichier" },
  { methodes: LECTURE, motif: "/api/portail/factures" },
  { methodes: LECTURE, motif: "/api/portail/factures/:id" },
  { methodes: LECTURE, motif: "/api/portail/factures/:id/document" },
  // KPI (routes/portail-kpi.ts).
  { methodes: LECTURE, motif: "/api/portail/kpi" },
  { methodes: LECTURE, motif: "/api/portail/kpi/:id" },
  { methodes: LECTURE, motif: "/api/portail/kpi/:id/mesures" },
  { methodes: POST, motif: "/api/portail/kpi/:id/mesures" },
  { methodes: POST, motif: "/api/portail/kpi/mesures/:id/corrections" },
  // Questionnaires (routes/portail-questionnaires.ts).
  { methodes: LECTURE, motif: "/api/portail/questionnaires" },
  { methodes: LECTURE, motif: "/api/portail/questionnaires/:id" },
  { methodes: ["PATCH"], motif: "/api/portail/questionnaires/:id/reponses" },
  { methodes: POST, motif: "/api/portail/questionnaires/:id/soumettre" },
  // Salle de mission (routes/salle-mission.ts, CLI-01) : SES demandes envoyées et le dépôt
  // d'une pièce (multipart, fichier contrôlé comme tout téléversement, sémaphore de réception).
  { methodes: LECTURE, motif: "/api/portail/salle/demandes" },
  { methodes: LECTURE, motif: "/api/portail/salle/demandes/:id" },
  { methodes: POST, motif: "/api/portail/salle/pieces/:id/depots" },
];

/** Entrée de la liste blanche pour cette route, ou undefined (route fermée au portail). */
export function routeOuverte(methode: string, motif: string): RouteOuverte | undefined {
  return LISTE_BLANCHE_PORTAIL.find((r) => r.motif === motif && r.methodes.includes(methode));
}

/** La route (motif Fastify) est-elle ouverte à un utilisateur du portail ? */
export function routeOuverteAuPortail(methode: string, motif: string | undefined): boolean {
  if (motif === undefined) return true; // route inconnue : 404 ordinaire, rien n'est servi
  return routeOuverte(methode, motif) !== undefined;
}

export const routeInterditePortail = () =>
  new AppError(
    403,
    "PORTAIL_ROUTE_INTERDITE",
    "Cette fonction n'est pas accessible depuis le portail client.",
  );

interface EtatPortail {
  client_id: string;
  actif: boolean;
  tfa_obligatoire: boolean;
  tfa_active: boolean;
}

/** Rattachement, statut et politique 2FA du portail (avant tout contexte du portail). */
async function lireEtat(app: FastifyInstance, request: FastifyRequest) {
  const auth = request.auth;
  if (!auth) return undefined;
  return app.db.withTenant(auth.cabinetId, async (db) => {
    const r = await db.query(
      `SELECT up.client_id, (up.statut = 'actif' AND c.actif) AS actif,
         COALESCE(pp.tfa_obligatoire, false) AS tfa_obligatoire,
         EXISTS (SELECT 1 FROM utilisateurs_2fa t
                 WHERE t.utilisateur_id = up.utilisateur_id AND t.active_le IS NOT NULL) AS tfa_active
       FROM utilisateurs_portail up
       JOIN clients c ON c.id = up.client_id
       LEFT JOIN portail_parametres pp ON pp.cabinet_id = up.cabinet_id
       WHERE up.utilisateur_id = $1`,
      [auth.utilisateurId],
    );
    return r.rows[0] as EtatPortail | undefined;
  });
}

/**
 * Crochets à installer APRÈS celui qui résout la session (app.ts) et AVANT
 * l'enregistrement des routes (chaque route y est inventoriée). Le crochet
 * onRequest s'exécute avant le crochet 2FA (preHandler), dont il complète
 * `tfaAConfigurer` par la politique du portail ; le crochet preHandler entre
 * dans le contexte RLS du portail, juste avant le gestionnaire de la route.
 */
export function installerGardePortail(app: FastifyInstance): void {
  app.decorateRequest("portail", null);
  app.decorateRequest("contexteBasePortail", null);
  const inventaire: RouteInventoriee[] = [];
  app.decorate("routesInventoriees", inventaire);
  app.addHook("onRoute", (route) => {
    const methodes = Array.isArray(route.method) ? route.method : [route.method];
    for (const methode of methodes) inventaire.push({ methode: String(methode), motif: route.url });
  });
  app.addHook("onRequest", async (request: FastifyRequest) => {
    const auth = request.auth;
    if (!auth || !estUtilisateurPortail(auth.roles)) return;
    const motif = request.routeOptions.url;
    const ouverte = motif === undefined ? undefined : routeOuverte(request.method, motif);
    if (motif !== undefined && !ouverte) throw routeInterditePortail();
    const etat = await lireEtat(app, request);
    request.portail = etat?.actif ? { clientId: etat.client_id } : null;
    request.tfaAConfigurer = Boolean(etat?.tfa_obligatoire && !etat.tfa_active);
    if (!ouverte?.sansContexte) {
      request.contexteBasePortail = {
        clientId: request.portail?.clientId ?? SENTINELLE_CLIENT_PORTAIL,
        utilisateurId: auth.utilisateurId,
      };
    }
  });
  // Style à rappel (et non async) : le gestionnaire de la route est appelé
  // depuis `done`, donc DANS le contexte, corps de requête déjà lu.
  app.addHook("preHandler", (request, _reply, done) => {
    const contexte = request.contexteBasePortail;
    if (!contexte) {
      done();
      return;
    }
    dansContextePortail(contexte, done);
  });
}
