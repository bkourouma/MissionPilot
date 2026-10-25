import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { z, ZodError } from "zod";
import { MOT_DE_PASSE_MIN } from "@missionpilot/shared";
import { hashPassword } from "../auth/password.js";
import { loadConfig } from "../config.js";
import { genererMotDePasse } from "../plateforme/mot-de-passe.js";

/*
 * Création d'un VRAI super admin de plateforme (procédure officielle du premier super admin,
 * utilisable en production). Aucune route ne crée de super admin : le script écrit avec le
 * rôle PROPRIÉTAIRE (DATABASE_OWNER_URL), ne modifie jamais un super admin existant et ne
 * pose jamais `est_demo`.
 *
 *   pnpm --filter @missionpilot/api db:creer-super-admin -- --email x@y.z --nom "Nom"
 *   (image de production : node_modules/.bin/tsx src/db/creer-super-admin.ts --email … --nom …)
 *
 * Mot de passe : option `--mot-de-passe`, sinon variable SUPER_ADMIN_MOT_DE_PASSE (évite
 * l'historique du shell), sinon généré et affiché UNE seule fois. Un mot de passe fourni n'est
 * jamais réaffiché. Codes de sortie : 0 succès, 1 arguments ou configuration invalides ou
 * échec technique, 2 e-mail déjà pris.
 */

export interface Sortie {
  out: (ligne: string) => void;
  err: (ligne: string) => void;
}

export interface EntreeSuperAdmin {
  email: string;
  nom: string;
  motDePasse?: string;
}

export interface SuperAdminCree {
  id: string;
  email: string;
  nom: string;
  /** Présent seulement si le mot de passe a été généré. */
  motDePasse?: string;
  genere: boolean;
}

/** E-mail déjà utilisé par un super admin (comparaison insensible à la casse). */
export class EmailDejaPris extends Error {
  constructor() {
    super("Un super admin utilise déjà cet e-mail.");
    this.name = "EmailDejaPris";
  }
}

/** Erreur d'usage ou de configuration : message sûr à afficher. */
class ErreurUsage extends Error {
  constructor(
    message: string,
    readonly avecUsage = true,
  ) {
    super(message);
  }
}

const USAGE = [
  "Usage : db:creer-super-admin -- --email <e-mail> --nom <nom> [--mot-de-passe <mot de passe>]",
  "  Sans --mot-de-passe, la variable d'environnement SUPER_ADMIN_MOT_DE_PASSE est utilisée si",
  "  elle est définie ; sinon un mot de passe est généré et affiché une seule fois.",
].join("\n");

const OPTIONS = ["email", "nom", "mot-de-passe"] as const;
type Option = (typeof OPTIONS)[number];

const estOption = (cle: string): cle is Option => (OPTIONS as readonly string[]).includes(cle);

const sansControle = (valeur: string): boolean =>
  ![...valeur].some((c) => c.charCodeAt(0) <= 0x1f || c.charCodeAt(0) === 0x7f);

/* Mêmes règles que le schéma de la plateforme (src/plateforme/schemas.ts). */
const emailSchema = z.string().trim().email().max(254);
const nomSchema = z.string().trim().min(1).max(200).refine(sansControle);
const motDePasseSchema = z.string().min(MOT_DE_PASSE_MIN).max(200);

/** Analyse `--clé valeur` et `--clé=valeur` ; ignore un `--` isolé ; refuse tout le reste. */
export function analyserArguments(argv: string[]): Partial<Record<Option, string>> {
  const valeurs: Partial<Record<Option, string>> = {};
  const jetons = argv.filter((a) => a !== "--");
  for (let i = 0; i < jetons.length; i++) {
    const jeton = jetons[i]!;
    const egal = jeton.indexOf("=");
    const cle = jeton.startsWith("--") ? jeton.slice(2, egal > 0 ? egal : undefined) : "";
    if (!estOption(cle)) {
      // Un jeton sans « -- » peut être un mot de passe collé sans option : jamais cité.
      throw new ErreurUsage(
        jeton.startsWith("--")
          ? `Option inconnue : ${jeton.split("=")[0]}`
          : "Argument inattendu (valeur sans option).",
      );
    }
    const valeur = egal > 0 ? jeton.slice(egal + 1) : jetons[++i];
    if (valeur === undefined || (egal < 0 && valeur.startsWith("--"))) {
      throw new ErreurUsage(`L'option --${cle} attend une valeur.`);
    }
    valeurs[cle] = valeur;
  }
  return valeurs;
}

function verifier<T>(schema: z.ZodType<T>, valeur: string | undefined, message: string): T {
  const r = schema.safeParse(valeur);
  if (!r.success) throw new ErreurUsage(message);
  return r.data;
}

/** Valide les entrées (arguments puis variable d'environnement) sans jamais citer le mot de passe. */
export function construireEntree(argv: string[], env: NodeJS.ProcessEnv): EntreeSuperAdmin {
  const o = analyserArguments(argv);
  const email = verifier(
    emailSchema,
    o.email,
    "--email est obligatoire : e-mail valide (254 caractères au plus).",
  );
  const nom = verifier(
    nomSchema,
    o.nom,
    "--nom est obligatoire : 1 à 200 caractères, sans caractère de contrôle.",
  );
  const fourni = o["mot-de-passe"] ?? (env.SUPER_ADMIN_MOT_DE_PASSE || undefined);
  if (fourni === undefined) return { email, nom };
  const motDePasse = verifier(
    motDePasseSchema,
    fourni,
    `Le mot de passe fourni doit compter de ${MOT_DE_PASSE_MIN} à 200 caractères.`,
  );
  return { email, nom, motDePasse };
}

const estDoublon = (e: unknown): boolean => (e as { code?: string } | null)?.code === "23505";

/** Insère le super admin (non démo, actif) avec le rôle propriétaire. */
export async function creerSuperAdmin(
  ownerUrl: string,
  entree: EntreeSuperAdmin,
): Promise<SuperAdminCree> {
  const genere = entree.motDePasse === undefined;
  const motDePasse = entree.motDePasse ?? genererMotDePasse();
  const hash = await hashPassword(motDePasse);
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const r = await client.query(
      `INSERT INTO super_admins (email, nom, mot_de_passe_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      [entree.email, entree.nom, hash],
    );
    const id = r.rows[0].id as string;
    return { id, email: entree.email, nom: entree.nom, genere, ...(genere ? { motDePasse } : {}) };
  } catch (e) {
    if (estDoublon(e)) throw new EmailDejaPris();
    throw e;
  } finally {
    await client.end();
  }
}

/** Échec technique : jamais le texte de l'erreur (il peut contenir une chaîne de connexion). */
function messageTechnique(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return `Échec de la création du super admin${typeof code === "string" ? ` (code ${code})` : ""}.`;
}

function lireConfiguration(env: NodeJS.ProcessEnv): string {
  try {
    return loadConfig(env).DATABASE_OWNER_URL;
  } catch (e) {
    const detail =
      e instanceof ZodError
        ? ` Variables en cause : ${[...new Set(e.issues.map((i) => i.path.join(".")))].join(", ")}.`
        : "";
    throw new ErreurUsage(`Configuration invalide (DATABASE_OWNER_URL notamment).${detail}`, false);
  }
}

function afficher(c: SuperAdminCree, sortie: Sortie): void {
  sortie.out("Super admin créé.");
  sortie.out(`  Identifiant : ${c.id}`);
  sortie.out(`  E-mail : ${c.email}`);
  sortie.out(`  Nom : ${c.nom}`);
  if (c.genere) {
    sortie.out(
      `Mot de passe généré (affiché une seule fois, à transmettre par un canal sûr) : ${c.motDePasse}`,
    );
  }
}

/** Exécute la commande et renvoie le code de sortie (0, 1 ou 2). */
export async function executer(
  argv: string[],
  env: NodeJS.ProcessEnv,
  sortie: Sortie,
): Promise<number> {
  try {
    const entree = construireEntree(argv, env);
    afficher(await creerSuperAdmin(lireConfiguration(env), entree), sortie);
    return 0;
  } catch (e) {
    if (e instanceof EmailDejaPris) {
      sortie.err("Cet e-mail est déjà utilisé par un super admin : rien n'a été écrit.");
      return 2;
    }
    if (e instanceof ErreurUsage) {
      sortie.err(e.message);
      if (e.avecUsage) sortie.err(USAGE);
      return 1;
    }
    sortie.err(messageTechnique(e));
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  executer(process.argv.slice(2), process.env, {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  }).then((code) => {
    process.exitCode = code;
  });
}
