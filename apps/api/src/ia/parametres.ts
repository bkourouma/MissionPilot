import { TACHES_IA, type TacheIa } from "@missionpilot/shared";
import {
  chiffrer,
  dechiffrer,
  trousseauDepuisConfig,
  type Trousseau,
  type UsageCle,
} from "../auth/chiffrement.js";
import type { Config } from "../config.js";
import type { Db } from "../db/pool.js";
import { associesActifs, notifier, type NotificationCreee } from "../notifications/notifier.js";
import { MODELES_RECOMMANDES, PLAFOND_MENSUEL_DEPART_MICRO_USD } from "./modeles.js";

/*
 * Paramètres IA d'un cabinet (migrations 0100, 0103).
 *
 * L'IA est DÉSACTIVÉE tant que le cabinet ne l'a pas activée explicitement
 * (`ia_activee` faux par défaut, ligne absente comprise) : sans activation,
 * les générations passent par les gabarits déterministes.
 *
 * Clé API OpenRouter du cabinet : chiffrée AES-256-GCM par le trousseau
 * applicatif (auth/chiffrement.ts), avec une clé dérivée PROPRE à cet usage
 * et une AAD liant le chiffré à son cabinet (un chiffré recopié dans un
 * autre cabinet ne se déchiffre pas). Elle n'est déchiffrée qu'au moment de
 * l'appel, par l'orchestrateur, et n'apparaît dans aucune réponse, aucun
 * journal ni aucune erreur : les routes ne renvoient que `cle_configuree`.
 * Un chiffré écrit avec une clé maître précédente est rechiffré avec la clé
 * courante à sa première lecture réussie. Un chiffré ILLISIBLE (clé maître
 * perdue, altération) ne bascule JAMAIS sans bruit sur la clé de plateforme :
 * repli sur gabarit et alerte aux associés (`cle_illisible`).
 * Sans clé de cabinet : clé de plateforme `OPENROUTER_API_KEY`, au plafond
 * mensuel plafonné par IA_PLAFOND_PLATEFORME_MICRO_USD ; sans aucune clé :
 * gabarits déterministes.
 */

/** Usages de clé propres à l'IA (auth/chiffrement.ts) : une clé dérivée distincte chacun. */
export const USAGE_CLE_IA: UsageCle = "ia_cle_api";
export const USAGE_ENTREE_IA: UsageCle = "ia_entree";

const aadCle = (cabinetId: string) => `ia_cle_api:${cabinetId}`;

export interface ParametresIa {
  ia_activee: boolean;
  plafond_mensuel_micro_usd: number;
  cle_configuree: boolean;
  cle_modifiee_le: string | null;
  modifie_par: string | null;
  modifie_le: string | null;
  /** Modèle choisi par le cabinet, par tâche (absent : recommandé). */
  modeles: Partial<Record<TacheIa, string>>;
}

export async function lireParametres(db: Db): Promise<ParametresIa> {
  const r = await db.query(
    `SELECT ia_activee, plafond_mensuel_micro_usd::text AS plafond, cle_chiffree IS NOT NULL AS cle,
       cle_modifiee_le, modifie_par, modifie_le
     FROM ia_parametres_cabinet`,
  );
  const m = await db.query("SELECT tache, modele FROM ia_modeles_taches ORDER BY tache");
  const modeles = Object.fromEntries(m.rows.map((x) => [x.tache as TacheIa, x.modele as string]));
  const p = r.rows[0];
  return {
    // Sans ligne : IA désactivée (activation explicite du cabinet).
    ia_activee: p ? (p.ia_activee as boolean) : false,
    plafond_mensuel_micro_usd: p ? Number(p.plafond) : PLAFOND_MENSUEL_DEPART_MICRO_USD,
    cle_configuree: p ? (p.cle as boolean) : false,
    cle_modifiee_le: p?.cle_modifiee_le ?? null,
    modifie_par: p?.modifie_par ?? null,
    modifie_le: p?.modifie_le ?? null,
    modeles,
  };
}

/** Modèle d'une tâche : celui du cabinet, sinon le recommandé. */
export function modeleDe(p: Pick<ParametresIa, "modeles">, tache: TacheIa): string {
  return p.modeles[tache] ?? MODELES_RECOMMANDES[tache];
}

/** Vue des modèles par tâche (choisi, recommandé, personnalisé). */
export function vueModeles(p: Pick<ParametresIa, "modeles">) {
  return TACHES_IA.map((tache) => ({
    tache,
    modele: modeleDe(p, tache),
    recommande: MODELES_RECOMMANDES[tache],
    personnalise: p.modeles[tache] !== undefined,
  }));
}

/** Chiffre la clé du cabinet (stockée en base, jamais en clair). */
export function chiffrerCle(t: Trousseau, cabinetId: string, cle: string) {
  return chiffrer(t, USAGE_CLE_IA, Buffer.from(cle, "utf8"), aadCle(cabinetId));
}

export type SourceCle = "cabinet" | "plateforme";

export type CleResolue =
  | { statut: "ok"; cle: string; source: SourceCle }
  | { statut: "absente" }
  /** Clé du cabinet enregistrée mais indéchiffrable : jamais de repli sur la plateforme. */
  | { statut: "illisible" };

/**
 * Clé à utiliser pour un appel : celle du cabinet (déchiffrée à la volée et,
 * au besoin, rechiffrée avec la clé maître courante), sinon celle de la
 * plateforme, sinon « absente » (repli sur gabarit). Un chiffré illisible
 * répond « illisible » : le cabinet a choisi sa clé, on ne lui substitue pas
 * celle de la plateforme.
 */
export async function resoudreCle(db: Db, config: Config, cabinetId: string): Promise<CleResolue> {
  const r = await db.query(
    "SELECT cle_chiffree, cle_version FROM ia_parametres_cabinet WHERE cle_chiffree IS NOT NULL",
  );
  const ligne = r.rows[0];
  if (ligne) {
    const t = trousseauDepuisConfig(config);
    let clair: string;
    try {
      clair = dechiffrer(
        t,
        USAGE_CLE_IA,
        { version: ligne.cle_version as number, donnees: ligne.cle_chiffree as Buffer },
        aadCle(cabinetId),
      ).toString("utf8");
    } catch {
      return { statut: "illisible" };
    }
    if (!clair) return { statut: "illisible" };
    if ((ligne.cle_version as number) !== t.versionActuelle) {
      // Rotation : rechiffrement avec la clé courante, si la clé n'a pas changé entre-temps.
      const c = chiffrerCle(t, cabinetId, clair);
      await db.query(
        `UPDATE ia_parametres_cabinet SET cle_chiffree = $1, cle_version = $2
         WHERE cle_chiffree = $3`,
        [c.donnees, c.version, ligne.cle_chiffree],
      );
    }
    return { statut: "ok", cle: clair, source: "cabinet" };
  }
  const plateforme = config.OPENROUTER_API_KEY?.trim();
  return plateforme
    ? { statut: "ok", cle: plateforme, source: "plateforme" }
    : { statut: "absente" };
}

/** Source de clé disponible, sans déchiffrer (lecture de l'état). */
export function sourceCleDisponible(
  p: Pick<ParametresIa, "cle_configuree">,
  config: Pick<Config, "OPENROUTER_API_KEY">,
): SourceCle | null {
  if (p.cle_configuree) return "cabinet";
  return config.OPENROUTER_API_KEY?.trim() ? "plateforme" : null;
}

/**
 * Plafond mensuel effectif : celui du cabinet, plafonné par celui de la
 * plateforme quand l'appel se fait avec la clé de plateforme (coût à la
 * charge de l'opérateur).
 */
export function plafondEffectif(
  p: Pick<ParametresIa, "plafond_mensuel_micro_usd">,
  config: Pick<Config, "IA_PLAFOND_PLATEFORME_MICRO_USD">,
  source: SourceCle | null,
): number {
  return source === "plateforme"
    ? Math.min(p.plafond_mensuel_micro_usd, config.IA_PLAFOND_PLATEFORME_MICRO_USD)
    : p.plafond_mensuel_micro_usd;
}

/**
 * Alerte les associés qu'une clé du cabinet est illisible (une fois par jour
 * au plus) ; les e-mails partent après la transaction (`envoyerEmails`).
 */
export async function alerterCleIllisible(
  db: Db,
  cabinetId: string,
): Promise<(NotificationCreee | null)[]> {
  const deja = await db.query(
    "SELECT 1 FROM notifications WHERE type = 'ia_cle_illisible' AND cree_le > now() - interval '1 day' LIMIT 1",
  );
  if (deja.rows[0]) return [];
  const notifications: (NotificationCreee | null)[] = [];
  for (const associe of await associesActifs(db)) {
    notifications.push(
      await notifier(db, {
        cabinetId,
        destinataireId: associe,
        type: "ia_cle_illisible",
        titre: "IA : clé API du cabinet illisible, repli sur les gabarits",
        corps:
          "La clé API IA du cabinet ne peut plus être déchiffrée (clé maître du serveur changée ?). " +
          "Les générations utilisent les gabarits déterministes : enregistrez de nouveau la clé.",
        lien: "/parametres/ia",
        email: true,
      }),
    );
  }
  return notifications;
}
