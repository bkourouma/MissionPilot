import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "../src/auth/password.js";
import { api, type Api } from "./api.js";
import { proprietaire, type Contexte } from "./helpers.js";

/*
 * Outils des tests du super admin de plateforme (contrat du lot 1) : création par SQL
 * propriétaire (aucune route ne crée de super admin), connexion par la route réelle,
 * client HTTP lié au cookie `mp_plateforme`.
 */

export const COOKIE_PLATEFORME = "mp_plateforme";
export const COOKIE_CABINET = "mp_session";
export const MOT_DE_PASSE_PLATEFORME = "Plateforme-motdepasse-1";
/** UUID bien formé qui ne désigne rien. */
export const UUID_INCONNU = "00000000-0000-4000-8000-000000000000";

/** Rôles du cabinet (packages/shared, `ROLES`). */
export const ROLES_CABINET = [
  "associe",
  "directeur_mission",
  "chef_mission",
  "consultant",
  "ressources",
  "gestionnaire",
  "expert_metier",
  "expert_externe",
] as const;

export const unique = (prefixe: string): string => `${prefixe}-${randomBytes(5).toString("hex")}`;

export const emailUnique = (prefixe: string): string => `${unique(prefixe)}@exemple.test`;

export interface SuperAdminTest {
  id: string;
  email: string;
  nom: string;
  motDePasse: string;
}

/** Super admin créé par SQL propriétaire (e-mail unique par appel). */
export async function creerSuperAdmin(
  options: { actif?: boolean; email?: string; motDePasse?: string } = {},
): Promise<SuperAdminTest> {
  const id = randomUUID();
  const email = options.email ?? emailUnique("sa");
  const motDePasse = options.motDePasse ?? MOT_DE_PASSE_PLATEFORME;
  const hash = await hashPassword(motDePasse);
  await proprietaire((c) =>
    c.query(
      `INSERT INTO super_admins (id, email, nom, mot_de_passe_hash, actif)
       VALUES ($1, $2, 'Super Admin Test', $3, $4)`,
      [id, email, hash, options.actif ?? true],
    ),
  );
  return { id, email, nom: "Super Admin Test", motDePasse };
}

/** POST /api/plateforme/connexion (réponse brute). */
export const connexionPlateforme = (ctx: Contexte, email: string, motDePasse: string) =>
  api(ctx).post("/api/plateforme/connexion", { email, motDePasse });

/** Ouvre une session plateforme et renvoie l'en-tête Cookie (`mp_plateforme=…`). */
export async function connecterPlateforme(ctx: Contexte, admin: SuperAdminTest): Promise<string> {
  const r = await connexionPlateforme(ctx, admin.email, admin.motDePasse);
  if (r.statusCode !== 200) throw new Error(`Connexion plateforme échouée : ${r.body}`);
  const c = r.cookies.find((x) => x.name === COOKIE_PLATEFORME);
  if (!c) throw new Error("Pas de cookie mp_plateforme");
  return `${c.name}=${c.value}`;
}

/** Super admin créé, connecté, et client HTTP lié à sa session. */
export async function superAdminConnecte(
  ctx: Contexte,
): Promise<{ admin: SuperAdminTest; cookie: string; p: Api }> {
  const admin = await creerSuperAdmin();
  const cookie = await connecterPlateforme(ctx, admin);
  return { admin, cookie, p: api(ctx, cookie) };
}

/** Valeur (jeton) d'un en-tête Cookie `nom=valeur`. */
export const valeurCookie = (cookie: string): string => cookie.slice(cookie.indexOf("=") + 1);

/** POST /api/auth/connexion d'un compte de cabinet (réponse brute). */
export const connexionCabinet = (ctx: Contexte, email: string, motDePasse: string) =>
  api(ctx).post("/api/auth/connexion", { email, mot_de_passe: motDePasse });

/** Session de cabinet ouverte par la route réelle : en-tête `mp_session=…`. */
export async function sessionCabinet(
  ctx: Contexte,
  email: string,
  motDePasse: string,
): Promise<string> {
  const r = await connexionCabinet(ctx, email, motDePasse);
  const c = r.cookies.find((x) => x.name === COOKIE_CABINET);
  if (r.statusCode !== 200 || !c) throw new Error(`Connexion cabinet échouée : ${r.body}`);
  return `${c.name}=${c.value}`;
}

export interface CabinetCree {
  cabinetId: string;
  associeId: string;
  associeEmail: string;
  motDePasse: string;
}

/** Crée un cabinet par la route plateforme, avec un mot de passe d'associé connu. */
export async function creerCabinetParPlateforme(
  p: Api,
  motDePasse = MOT_DE_PASSE_PLATEFORME,
): Promise<CabinetCree> {
  const associeEmail = emailUnique("assoc");
  const r = await p.post("/api/plateforme/cabinets", {
    nom: unique("Cabinet plateforme"),
    pays: "CI",
    associe: { nom: "Associé Fondateur", email: associeEmail, motDePasse },
  });
  if (r.statusCode !== 201) throw new Error(`Création du cabinet échouée : ${r.body}`);
  const j = r.json();
  return {
    cabinetId: j.cabinet.id as string,
    associeId: j.associe.id as string,
    associeEmail,
    motDePasse,
  };
}

/** Lignes du journal plateforme d'un super admin, dans l'ordre. */
export const journalDe = (superAdminId: string) =>
  proprietaire(
    async (c) =>
      (
        await c.query(
          `SELECT action, cible, cible_id, cabinet_id, details
           FROM journal_plateforme WHERE super_admin_id = $1 ORDER BY id`,
          [superAdminId],
        )
      ).rows as {
        action: string;
        cible: string;
        cible_id: string | null;
        cabinet_id: string | null;
        details: Record<string, unknown>;
      }[],
  );

/** Clés (récursives) d'une valeur JSON, pour contrôler qu'aucun champ inattendu n'apparaît. */
export function cles(valeur: unknown, acc: string[] = []): string[] {
  if (Array.isArray(valeur)) for (const v of valeur) cles(v, acc);
  else if (valeur && typeof valeur === "object") {
    for (const [k, v] of Object.entries(valeur)) {
      acc.push(k);
      cles(v, acc);
    }
  }
  return acc;
}
