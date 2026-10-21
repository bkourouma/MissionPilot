import { z } from "zod";
import type { TermeSensible } from "@missionpilot/shared";
import { chiffrer, dechiffrer, empreinte, type Trousseau } from "../auth/chiffrement.js";
import type { Db } from "../db/pool.js";
import { neutraliserContenuClient } from "./donnees-non-fiables.js";
import { creerMasque, sansJetons } from "./masquage.js";
import { USAGE_ENTREE_IA } from "./parametres.js";

/*
 * CACHE DES RÉPONSES IA (AGT-06, migration 0278).
 *
 * Objet : ne pas repayer le fournisseur pour une génération STRICTEMENT identique (même prompt
 * versionné, même modèle, mêmes entrées masquées) dans un délai court. Il ne remplace QUE l'appel
 * au fournisseur : l'orchestrateur (ia/orchestrateur.ts, `executerDemande`) passe d'abord TOUTES
 * ses gardes (droit « ia.utiliser », mission visible, IA activée, clé, plafonds du cabinet et de
 * la mission avec réservation du coût estimé, mode dégradé et coupe-circuit des agents en amont),
 * puis, sur un succès en cache, rejoue la validation Zod de la sortie, la GARDE-CHIFFRES et le
 * démasquage local comme pour une réponse fraîche, et crée la version 1 « brouillon_ia » : la
 * validation humaine reste obligatoire.
 *
 * - Activation : `ia_parametres_cabinet.cache_actif`, DÉSACTIVÉ par défaut (hypothèse prudente,
 *   activable par le cabinet via PUT /api/ia/parametres) ; le désactiver vide le cache du
 *   cabinet. Un déclencheur refuse en base toute écriture d'un cabinet au cache désactivé (MQI01).
 * - Clé : empreinte HMAC-SHA-256 (clé dérivée du serveur, usage `ia_entree`, matériau préfixé
 *   « ia_cache/v1 » : séparé de l'empreinte d'entrée des demandes) de la forme canonique (clés
 *   triées) de { cabinet, prompt (nom, version, tâche, gabarits, schéma de sortie), modèle, plafond
 *   de jetons, format JSON, valeurs MASQUÉES des variables et bloc des chiffres masqué }. Changer la
 *   version du prompt, son contenu, le modèle ou une entrée change la clé. La rotation de la clé
 *   maître change aussi les clés : les anciennes entrées ne sont plus trouvées et expirent.
 * - Contenu : la réponse BRUTE du modèle, encore masquée (jamais le texte démasqué), chiffrée
 *   AES-256-GCM (AAD : cabinet et clé de cache). Isolé par cabinet (cabinet_id dans la clé et
 *   dans le matériau, RLS, politique `portail_interdit`).
 * - Durée de vie : DUREE_CACHE_IA_MS (24 heures, plafond imposé aussi en base) ; une entrée échue
 *   n'est jamais servie ; elle est supprimée à l'écriture suivante du cabinet et par le job
 *   « ia_conservation » (ia/conservation.ts). Les 24 heures restent bien en deçà de la durée de
 *   conservation des générations (30 jours au moins) : le cache ne prolonge aucune donnée.
 * - Coût : un succès en cache est inscrit dans `ia_consommations` avec l'issue « cache » et un
 *   coût NUL (aucun plafond consommé : la réservation faite par les gardes est soldée) ; il est
 *   tracé au journal d'audit (`generation_ia`, `cache: true`), jamais avec le contenu.
 *
 * JAMAIS DE CACHE (ni lecture ni écriture) — `motifSansCache` :
 * - cache désactivé par le cabinet ;
 * - prompt d'échange libre ou d'entretien (`PROMPTS_SANS_CACHE` : copilote, entretien,
 *   transcription) ; le copilote passe d'ailleurs par `appelerSansDemande`, jamais caché ;
 * - contenu de CLIENT dans les entrées (variables non fiables, AGT-07) : il peut porter des noms
 *   propres que personne n'a déclarés comme termes sensibles ;
 * - donnée identifiante restée en clair dans les entrées masquées (e-mail, téléphone, IBAN, RCCM,
 *   n° de contribuable, terme sensible déclaré), repérée par un masque NEUF après retrait des
 *   jetons posés (`contientDonneeIdentifiante`).
 * Et pas d'écriture pour une réponse qui contient elle-même une donnée identifiante en clair, ni
 * pour une réponse signalée par la garde-chiffres (une nouvelle génération pourrait être sûre).
 *
 * LIMITE (celle du masquage, ia/masquage.ts) : un nom propre absent des termes sensibles n'est
 * pas repéré ; le cache n'aggrave pas ce risque (la même entrée part déjà au fournisseur), il le
 * borne à 24 heures, chiffré, dans le seul cabinet.
 */

/** Durée de vie d'une entrée du cache : 24 heures (même plafond en base, migration 0278). */
export const DUREE_CACHE_IA_MS = 24 * 3_600_000;

/** Prompts jamais mis en cache : échanges libres et entretiens (données nominatives probables). */
export const PROMPTS_SANS_CACHE = /copilote|entretien|transcription/;

/** Version du format du matériau de la clé (le changer invalide tout le cache). */
const PREFIXE_CLE = "ia_cache/v1";

/** JSON canonique (clés triées) : même valeur → même texte, quel que soit l'ordre des clés. */
export function canonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonique).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export interface MateriauCleCache {
  cabinetId: string;
  prompt: {
    nom: string;
    version: number;
    tache: string;
    gabaritSysteme: string;
    gabaritUtilisateur: string;
    schemaSortie: unknown;
  };
  modele: string;
  maxTokens: number;
  formatJson: boolean;
  /** Valeurs MASQUÉES des variables (et bloc « chiffres » aux libellés masqués), par nom. */
  entrees: Readonly<Record<string, string>>;
}

/** Matériau canonique de la clé (fonction pure, sans secret). */
export function materiauCleCache(m: MateriauCleCache): string {
  return `${PREFIXE_CLE}\u0000${canonique({
    cabinet: m.cabinetId,
    prompt: m.prompt,
    modele: m.modele,
    max_tokens: m.maxTokens,
    format_json: m.formatJson,
    entrees: m.entrees,
  })}`;
}

/** Clé de cache : HMAC-SHA-256 du matériau, avec la clé dérivée courante du serveur. */
export function cleCacheIa(t: Trousseau, m: MateriauCleCache): { cle: string; version: number } {
  return {
    cle: empreinte(t, USAGE_ENTREE_IA, t.versionActuelle, materiauCleCache(m)),
    version: t.versionActuelle,
  };
}

/** Jetons du masque retirés (tous, quel que soit le masque qui les a posés). */
const sansAucunJeton = (texte: string) => sansJetons(texte, { connait: () => true });

/**
 * Le texte contient-il une donnée identifiante EN CLAIR (e-mail, téléphone, IBAN, RCCM,
 * n° de contribuable, terme sensible déclaré) ? Les jetons déjà posés sont retirés, puis un masque
 * NEUF est appliqué au texte tel quel et neutralisé (caractères invisibles retirés) : s'il pose
 * le moindre jeton, la réponse est oui.
 */
export function contientDonneeIdentifiante(
  texte: string,
  termesSensibles: readonly TermeSensible[],
): boolean {
  const sans = sansAucunJeton(texte);
  for (const forme of [sans, neutraliserContenuClient(sans)]) {
    const m = creerMasque(termesSensibles);
    m.masquer(forme);
    if (Object.keys(m.compte()).length > 0) return true;
  }
  return false;
}

export type MotifSansCache =
  "desactive" | "prompt_exclu" | "contenu_client" | "donnee_identifiante";

/** Pourquoi une génération n'utilise pas le cache (null : elle peut le lire et l'écrire). */
export function motifSansCache(o: {
  actif: boolean;
  promptNom: string;
  variablesNonFiables: readonly string[];
  /** Textes EXACTS envoyés au modèle (valeurs masquées, bloc des chiffres). */
  textesMasques: readonly string[];
  termesSensibles: readonly TermeSensible[];
}): MotifSansCache | null {
  if (!o.actif) return "desactive";
  if (PROMPTS_SANS_CACHE.test(o.promptNom)) return "prompt_exclu";
  if (o.variablesNonFiables.length > 0) return "contenu_client";
  if (o.textesMasques.some((t) => contientDonneeIdentifiante(t, o.termesSensibles))) {
    return "donnee_identifiante";
  }
  return null;
}

/* ----- Lecture et écriture (transaction de l'appelant, contexte du cabinet) ----- */

const aadCache = (cabinetId: string, cle: string) => `ia_cache:${cabinetId}:${cle}`;

const reponseCacheSchema = z.object({ texte: z.string(), modele: z.string() }).strict();
export type ReponseEnCache = z.infer<typeof reponseCacheSchema>;

/** Réponse en cache non échue, déchiffrée ; null si absente, échue ou illisible. */
export async function lireCache(
  db: Db,
  t: Trousseau,
  cabinetId: string,
  cle: string,
  maintenant: Date,
): Promise<ReponseEnCache | null> {
  const r = await db.query(
    `SELECT reponse_chiffree, cle_version FROM ia_cache_reponses
     WHERE cle = $1 AND expire_le > $2`,
    [cle, maintenant],
  );
  const ligne = r.rows[0];
  if (!ligne) return null;
  try {
    const clair = dechiffrer(
      t,
      USAGE_ENTREE_IA,
      { version: ligne.cle_version as number, donnees: ligne.reponse_chiffree as Buffer },
      aadCache(cabinetId, cle),
    );
    const lu = reponseCacheSchema.safeParse(JSON.parse(clair.toString("utf8")));
    return lu.success ? lu.data : null;
  } catch {
    return null;
  }
}

export interface EntreeCache {
  cabinetId: string;
  cle: string;
  promptNom: string;
  promptVersion: number;
  tache: string;
  /** Modèle DEMANDÉ (liste blanche du cabinet) ; le modèle servi est dans le chiffré. */
  modele: string;
  reponse: ReponseEnCache;
  maintenant: Date;
}

/**
 * Écrit une réponse dans le cache si le cabinet l'a activé (vrai si écrite) ; supprime au passage
 * les entrées échues du cabinet. Une entrée encore valide sous la même clé est conservée.
 */
export async function ecrireCache(db: Db, t: Trousseau, e: EntreeCache): Promise<boolean> {
  // FOR SHARE d'abord : même ordre de verrous que la désactivation (paramètres, puis entrées du
  // cache), qui attend donc la fin de cette écriture ou la voit échouer — sans interblocage.
  const p = await db.query("SELECT cache_actif FROM ia_parametres_cabinet FOR SHARE");
  if (!(p.rows[0]?.cache_actif as boolean | undefined)) return false;
  await purgerCacheEchu(db, e.maintenant);
  const c = chiffrer(
    t,
    USAGE_ENTREE_IA,
    Buffer.from(JSON.stringify(e.reponse), "utf8"),
    aadCache(e.cabinetId, e.cle),
  );
  const r = await db.query(
    `INSERT INTO ia_cache_reponses (cabinet_id, cle, prompt_nom, prompt_version, tache, modele,
       reponse_chiffree, cle_version, cree_le, expire_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (cabinet_id, cle) DO NOTHING RETURNING cle`,
    [
      e.cabinetId,
      e.cle,
      e.promptNom,
      e.promptVersion,
      e.tache,
      e.modele,
      c.donnees,
      c.version,
      e.maintenant,
      new Date(e.maintenant.getTime() + DUREE_CACHE_IA_MS),
    ],
  );
  return r.rows[0] !== undefined;
}

/** Supprime les entrées échues du cabinet du contexte ; renvoie leur nombre. */
export async function purgerCacheEchu(db: Db, maintenant: Date): Promise<number> {
  const r = await db.query("DELETE FROM ia_cache_reponses WHERE expire_le <= $1", [maintenant]);
  return r.rowCount ?? 0;
}

/** Vide le cache du cabinet du contexte (désactivation) ; renvoie le nombre d'entrées. */
export async function viderCache(db: Db): Promise<number> {
  const r = await db.query("DELETE FROM ia_cache_reponses");
  return r.rowCount ?? 0;
}
