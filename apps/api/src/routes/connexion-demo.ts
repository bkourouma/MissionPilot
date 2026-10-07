import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { estUtilisateurPortail, ROLES, ROLES_CLIENT, type Role } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { serviceIdentite, tropDeTentatives } from "../auth/confirmer-identite.js";
import { lireEtat } from "../auth/double-authentification.js";
import { creerLimiteur } from "../auth/limiteur.js";
import { creerSession, poserCookieSession } from "../auth/ouvrir-session.js";
import { connexionRapideDemoActive } from "../config.js";
import type { Database, Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { sansCache } from "./auth.js";

/*
 * Connexion rapide de démonstration : RECETTE HUMAINE EN LOCAL SEULEMENT.
 *
 * Ouvre une session SANS mot de passe : traitée comme une porte dérobée
 * potentielle (docs/governance/SECURITY.md §3, « Connexion rapide »).
 *
 * - Les routes n'EXISTENT que si `connexionRapideDemoActive` (config.ts) :
 *   CONNEXION_RAPIDE_DEMO=oui, NODE_ENV local (jamais « production ») et bases
 *   locales ; « oui » ailleurs fait refuser le démarrage (`loadConfig`). Sinon,
 *   404 ordinaire de Fastify, comme toute route inconnue.
 * - Périmètre : les comptes ACTIFS du cabinet nommé NOM_CABINET_DEMO dont
 *   l'e-mail finit par DOMAINE_DEMO, rôles du cabinet seulement (jamais un
 *   utilisateur du portail), au plus MAX_COMPTES_DEMO. Le cabinet est celui du
 *   compte fondateur COMPTE_ANCRE_DEMO (seule fonction SECURITY DEFINER
 *   existante qui relie un e-mail à son cabinet : `trouver_connexion`) : un
 *   autre cabinet, même homonyme ou avec des adresses du même domaine, n'est
 *   jamais concerné, et aucune nouvelle capacité n'est ajoutée à la base.
 * - Liste : e-mail, nom et rôles seulement (ni identifiant, ni haché).
 * - Connexion : limiteur de l'espace `connexion` réservé AVANT tout travail
 *   (même compteur que la connexion par mot de passe), réponse uniforme 401
 *   pour tout e-mail hors de la liste, refus 403 si la 2FA est active ou
 *   obligatoire pour le compte (la connexion rapide ne la contourne jamais),
 *   puis même mécanisme que POST /api/auth/connexion : session hachée, cookie
 *   httpOnly, audit `connexion` (détail `demo: true`).
 * - Garde d'origine (CSRF) et crochet 2FA d'app.ts : appliqués comme partout
 *   (motifs sous /api/auth/*, déjà libres pour la seule configuration de la 2FA).
 */

/** Cabinet créé par `db/seed-demo.ts` (`NOM_CABINET_ABIDJAN`, alignement vérifié par test). */
export const NOM_CABINET_DEMO = "Lagune Conseil & Associés (démo)";
/** Domaine des comptes du seed de démonstration (adresses en `.test` : rien n'y est reçu). */
export const DOMAINE_DEMO = "@lagune-conseil.test";
/** Compte fondateur du cabinet de démonstration (premier compte créé par `creer_cabinet`). */
export const COMPTE_ANCRE_DEMO = `associe${DOMAINE_DEMO}`;
/** Borne de la liste (le seed en crée neuf). */
export const MAX_COMPTES_DEMO = 50;

/** Corps local et strict, comme `connexionSchema` d'auth.ts : un e-mail, rien d'autre. */
const connexionDemoSchema = z.object({ email: z.string().email().max(254) }).strict();

const compteDemoInconnu = () =>
  new AppError(401, "COMPTE_DEMO_INCONNU", "Compte de démonstration inconnu ou indisponible.");
const connexionRapideSous2fa = () =>
  new AppError(
    403,
    "CONNEXION_RAPIDE_2FA",
    "Ce compte est protégé par la double authentification : la connexion rapide ne la " +
      "contourne pas. Connectez-vous avec l'adresse e-mail et le mot de passe.",
  );

interface CompteDemo {
  id: string;
  email: string;
  nom: string;
  roles: Role[];
}

const ORDRE_ROLES: readonly string[] = ROLES;

/** Rang du premier rôle du compte dans l'ordre de `ROLES` (associé d'abord). */
function rang(compte: CompteDemo): number {
  const rangs = compte.roles.map((r) => ORDRE_ROLES.indexOf(r)).filter((i) => i >= 0);
  return rangs.length ? Math.min(...rangs) : ORDRE_ROLES.length;
}

/** Cabinet de démonstration (celui du compte fondateur), ou null s'il n'existe pas. */
async function cabinetDemo(database: Database): Promise<string | null> {
  return database.withoutTenant(async (db) => {
    const r = await db.query("SELECT cabinet_id FROM trouver_connexion($1)", [COMPTE_ANCRE_DEMO]);
    return (r.rows[0]?.cabinet_id as string | undefined) ?? null;
  });
}

/** Comptes ouvrables, dans la transaction du cabinet (RLS) ; vide si le nom ne correspond pas. */
async function listerComptesDemo(db: Db, cabinetId: string): Promise<CompteDemo[]> {
  const cabinet = await db.query("SELECT nom FROM cabinets WHERE id = $1", [cabinetId]);
  if (cabinet.rows[0]?.nom !== NOM_CABINET_DEMO) return [];
  const r = await db.query(
    `SELECT id, email, nom, roles FROM utilisateurs
     WHERE cabinet_id = $1 AND actif AND right(lower(email), $2) = $3
       AND NOT (roles && $4::text[])
     ORDER BY lower(email), id
     LIMIT $5`,
    [cabinetId, DOMAINE_DEMO.length, DOMAINE_DEMO, [...ROLES_CLIENT], MAX_COMPTES_DEMO],
  );
  return (r.rows as CompteDemo[])
    .filter((c) => c.email.toLowerCase().endsWith(DOMAINE_DEMO) && !estUtilisateurPortail(c.roles))
    .sort((a, b) => rang(a) - rang(b) || a.nom.localeCompare(b.nom, "fr"));
}

export const routesConnexionDemo: FastifyPluginAsync = async (app) => {
  // Désactivée : aucune route enregistrée (404 comme toute adresse inconnue).
  if (!connexionRapideDemoActive(app.config)) return;
  const limiteur = creerLimiteur(app.db, "connexion", serviceIdentite(app).trousseau);

  app.get("/comptes-demo", async (_request, reply) => {
    const cabinetId = await cabinetDemo(app.db);
    const comptes = cabinetId
      ? await app.db.withTenant(cabinetId, (db) => listerComptesDemo(db, cabinetId))
      : [];
    sansCache(reply);
    return { elements: comptes.map(({ email, nom, roles }) => ({ email, nom, roles })) };
  });

  app.post("/connexion-demo", async (request, reply) => {
    const { email } = connexionDemoSchema.parse(request.body);
    const cle = email.toLowerCase();
    if (!(await limiteur.reserver(cle))) throw tropDeTentatives();

    const cabinetId = await cabinetDemo(app.db);
    if (!cabinetId) throw compteDemoInconnu();
    const resultat = await app.db.withTenant(cabinetId, async (db) => {
      const comptes = await listerComptesDemo(db, cabinetId);
      const compte = comptes.find((c) => c.email.toLowerCase() === cle);
      if (!compte) return { statut: "inconnu" as const };
      const tfa = await lireEtat(db, cabinetId, compte.id, compte.roles, app.config);
      if (tfa.active || tfa.obligatoire) return { statut: "2fa" as const };
      const jeton = await creerSession(db, cabinetId, compte.id);
      await journaliser(db, {
        cabinetId,
        utilisateurId: compte.id,
        action: "connexion",
        entite: "utilisateur",
        entiteId: compte.id,
        details: { demo: true },
      });
      return { statut: "ok" as const, jeton };
    });
    if (resultat.statut === "inconnu") throw compteDemoInconnu();
    if (resultat.statut === "2fa") throw connexionRapideSous2fa();
    await limiteur.liberer(cle);
    sansCache(reply);
    poserCookieSession(reply, app.config, resultat.jeton);
    return { ok: true, etape: "connecte" };
  });
};
