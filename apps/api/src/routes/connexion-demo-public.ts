import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { estUtilisateurPortail, ROLES, ROLES_CLIENT, type Role } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { serviceIdentite, tropDeTentatives } from "../auth/confirmer-identite.js";
import { lireEtat, rolesObligatoires } from "../auth/double-authentification.js";
import { creerLimiteur } from "../auth/limiteur.js";
import { creerSession, poserCookieSession } from "../auth/ouvrir-session.js";
import { hacherJeton, nouveauJeton } from "../auth/session.js";
import {
  AVERTISSEMENT_DEMO_PUBLIQUE,
  demoConnexionActive,
  demoPubliqueHorsLocal,
} from "../config.js";
import type { Config } from "../config.js";
import type { Database } from "../db/pool.js";
import { AppError } from "../errors.js";
import { poserCookiePlateforme } from "../plateforme/session.js";
import { sansCache } from "./auth.js";

/*
 * Connexion de démonstration « un clic », multi-cabinets et super admin : session SANS
 * mot de passe, traitée comme une porte dérobée potentielle (docs/governance/SECURITY.md
 * §3, « Connexion rapide »). Les routes historiques /comptes-demo et /connexion-demo
 * (connexion-demo.ts) restent inchangées.
 *
 * - Les routes n'EXISTENT que si `demoConnexionActive` (config.ts : CONNEXION_RAPIDE_DEMO
 *   en local, ou DEMO_PUBLIQUE=oui) ; sinon 404 ordinaire de Fastify. Avec DEMO_PUBLIQUE
 *   hors local, l'enregistrement journalise `AVERTISSEMENT_DEMO_PUBLIQUE`.
 * - Périmètre : uniquement ce que renvoient les fonctions SECURITY DEFINER `demo_*`
 *   (migration 0580) : cabinets et super admins marqués démo PAR LE SQL propriétaire, actifs,
 *   comptes actifs de famille de rôles pure. L'API n'ajoute aucun filtre, ne pose jamais
 *   `est_demo` et n'a aucun autre accès à ces comptes.
 * - GET /demo : liste publique, sans cache, sans les comptes que la 2FA rendrait inconnectables
 *   (2FA active ou obligatoire : base 0583, plancher TOTP_REQUIS : ici) ; ils restent refusés
 *   en 403 si on les demande. Le seul identifiant exposé est celui du cabinet
 *   (aucun identifiant d'utilisateur, de client ni haché).
 * - POST /demo/connexion : limiteur de l'espace `connexion` réservé AVANT tout travail (même
 *   compteur que la connexion par mot de passe), 401 uniforme pour tout compte hors liste
 *   (e-mail inconnu, cabinet réel, désactivé ou inadéquat), 403 si la 2FA est active ou
 *   obligatoire (jamais contournée, et le refus compte dans le limiteur), puis même mécanisme
 *   que POST /api/auth/connexion : session hachée, cookie httpOnly, audit `connexion`
 *   (détail `demo: true`).
 * - POST /demo/connexion-plateforme : session de plateforme (cookie mp_plateforme) d'un super
 *   admin de démo actif, ouverte et journalisée (demo: true) par la fonction SQL.
 * - Garde d'origine (CSRF) et crochet 2FA d'app.ts : appliqués comme partout.
 */

const connexionSchema = z
  .object({ cabinetId: z.string().uuid(), email: z.string().email().max(254) })
  .strict();
const plateformeSchema = z.object({ email: z.string().email().max(254) }).strict();

const compteDemoInconnu = () =>
  new AppError(401, "COMPTE_DEMO_INCONNU", "Compte de démonstration inconnu ou indisponible.");
const connexionRapideSous2fa = () =>
  new AppError(
    403,
    "CONNEXION_RAPIDE_2FA",
    "Ce compte est protégé par la double authentification : la connexion rapide ne la " +
      "contourne pas. Connectez-vous avec l'adresse e-mail et le mot de passe.",
  );

interface LigneCompte {
  cabinet_id: string;
  cabinet_nom: string;
  email: string;
  nom: string;
  roles: string[];
  portail: boolean;
}
interface CompteListe {
  email: string;
  nom: string;
  roles: string[];
  portail: boolean;
}
interface CabinetListe {
  id: string;
  nom: string;
  comptes: CompteListe[];
}

const ORDRE_ROLES: readonly string[] = [...ROLES, ...ROLES_CLIENT];

/** Rang du premier rôle du compte dans l'ordre d'affichage (associé d'abord). */
function rang(roles: readonly string[]): number {
  const rangs = roles.map((r) => ORDRE_ROLES.indexOf(r)).filter((i) => i >= 0);
  return rangs.length ? Math.min(...rangs) : ORDRE_ROLES.length;
}

/** Comptes du cabinet avant ceux du portail, puis rang du rôle, puis nom. */
function comparerComptes(a: CompteListe, b: CompteListe): number {
  return (
    Number(a.portail) - Number(b.portail) ||
    rang(a.roles) - rang(b.roles) ||
    a.nom.localeCompare(b.nom, "fr")
  );
}

/** Regroupe les lignes par cabinet ; ne garde que les champs du contrat public. */
function grouperParCabinet(lignes: readonly LigneCompte[]): CabinetListe[] {
  const parId = new Map<string, CabinetListe>();
  for (const l of lignes) {
    const cabinet = parId.get(l.cabinet_id) ?? {
      id: l.cabinet_id,
      nom: l.cabinet_nom,
      comptes: [],
    };
    cabinet.comptes.push({ email: l.email, nom: l.nom, roles: l.roles, portail: l.portail });
    parId.set(l.cabinet_id, cabinet);
  }
  const cabinets = [...parId.values()];
  for (const c of cabinets) c.comptes.sort(comparerComptes);
  return cabinets.sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.id.localeCompare(b.id));
}

/**
 * Plancher plateforme (TOTP_REQUIS=oui) : la 2FA devient obligatoire pour les rôles sensibles du
 * cabinet. La base écarte déjà la 2FA active et la politique du cabinet (0583) ; ce plancher est
 * une variable de l'API, donc écarté ici, comme le fait `lireEtat` à la connexion.
 */
function sansTfaPlancher(lignes: LigneCompte[], config: Config): LigneCompte[] {
  const obligatoires = rolesObligatoires([], config);
  if (obligatoires.length === 0) return lignes;
  return lignes.filter(
    (l) => estUtilisateurPortail(l.roles) || !l.roles.some((r) => obligatoires.includes(r)),
  );
}

async function lireListe(database: Database, config: Config) {
  return database.withoutTenant(async (db) => {
    const comptes = await db.query("SELECT * FROM demo_lister_comptes()");
    const admins = await db.query("SELECT * FROM demo_lister_super_admins()");
    return {
      comptes: sansTfaPlancher(comptes.rows as LigneCompte[], config),
      superAdmin: admins.rows[0] as { email: string; nom: string } | undefined,
    };
  });
}

interface CompteTrouve {
  utilisateur_id: string;
  roles: Role[];
}

async function trouverCompte(
  database: Database,
  cabinetId: string,
  email: string,
): Promise<CompteTrouve | undefined> {
  return database.withoutTenant(async (db) => {
    const r = await db.query("SELECT * FROM demo_trouver_compte($1, $2)", [cabinetId, email]);
    return r.rows[0] as CompteTrouve | undefined;
  });
}

export const routesConnexionDemoPublique: FastifyPluginAsync = async (app) => {
  // Désactivée : aucune route enregistrée (404 comme toute adresse inconnue).
  if (!demoConnexionActive(app.config)) return;
  if (demoPubliqueHorsLocal(app.config)) app.log.warn(AVERTISSEMENT_DEMO_PUBLIQUE);
  const limiteur = creerLimiteur(app.db, "connexion", serviceIdentite(app).trousseau);

  app.get("/demo", async (_request, reply) => {
    const { comptes, superAdmin } = await lireListe(app.db, app.config);
    sansCache(reply);
    return {
      actif: true,
      superAdmin: superAdmin ? { email: superAdmin.email, nom: superAdmin.nom } : null,
      cabinets: grouperParCabinet(comptes),
    };
  });

  app.post("/demo/connexion", async (request, reply) => {
    const { cabinetId, email } = connexionSchema.parse(request.body);
    const cle = `demo:${email.toLowerCase()}`;
    if (!(await limiteur.reserver(cle))) throw tropDeTentatives();

    const compte = await trouverCompte(app.db, cabinetId, email);
    if (!compte) throw compteDemoInconnu();
    const jeton = await app.db.withTenant(cabinetId, async (db) => {
      const tfa = await lireEtat(db, cabinetId, compte.utilisateur_id, compte.roles, app.config);
      if (tfa.active || tfa.obligatoire) return null;
      const nouveau = await creerSession(db, cabinetId, compte.utilisateur_id);
      await journaliser(db, {
        cabinetId,
        utilisateurId: compte.utilisateur_id,
        action: "connexion",
        entite: "utilisateur",
        entiteId: compte.utilisateur_id,
        details: { demo: true },
      });
      return nouveau;
    });
    if (!jeton) throw connexionRapideSous2fa();
    await limiteur.liberer(cle);
    sansCache(reply);
    poserCookieSession(reply, app.config, jeton);
    return { ok: true, etape: "connecte" };
  });

  app.post("/demo/connexion-plateforme", async (request, reply) => {
    const { email } = plateformeSchema.parse(request.body);
    const cle = `demo-plateforme:${email.toLowerCase()}`;
    if (!(await limiteur.reserver(cle))) throw tropDeTentatives();

    const jeton = nouveauJeton();
    const admin = await app.db.withoutTenant(async (db) => {
      const r = await db.query("SELECT * FROM demo_ouvrir_session_plateforme($1, $2)", [
        email,
        hacherJeton(jeton),
      ]);
      return r.rows[0] as { super_admin_id: string; email: string; nom: string } | undefined;
    });
    if (!admin) throw compteDemoInconnu();
    await limiteur.liberer(cle);
    sansCache(reply);
    poserCookiePlateforme(reply, app.config, jeton);
    return {
      ok: true,
      superAdmin: { id: admin.super_admin_id, email: admin.email, nom: admin.nom },
    };
  });
};
