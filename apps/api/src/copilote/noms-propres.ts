import type { TermeSensible } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { chercheurDeTermes, formeComparaison } from "../ia/masquage.js";

/*
 * NOMS PROPRES CONNUS DU CABINET, à masquer avant tout envoi au modèle (AGT-08, SECURITY.md §7 bis).
 *
 * Le masque par formats (ia/masquage.ts) ne repère ni un nom de client, ni un collaborateur, ni un
 * intitulé de mission. Cette fonction lit, DANS la transaction d'admission et sous la RLS du cabinet
 * de l'utilisateur, les noms que le cabinet connaît (raisons sociales des clients, noms des
 * utilisateurs, comptes du portail client compris, noms des contacts clients, intitulés de
 * missions) et ne retient que ceux dont une forme normalisée APPARAÎT dans le message. Le modèle
 * ne voit donc plus ces noms ; il renvoie des jetons ([ORGANISATION_1]…) que le masque démasque
 * localement dans les paramètres du choix.
 *
 * On masque TOUS les noms du cabinet, quels que soient les droits de l'utilisateur : c'est un
 * masquage, rien n'est divulgué (le démasquage ne restitue que ce que l'utilisateur a lui-même
 * tapé). En revanche la lecture ne doit pas fuiter : aucune donnée d'un autre cabinet (RLS, plus
 * un filtre explicite sur le cabinet), aucun nom dans les journaux, les erreurs ni le retour au
 * service (seul le NOMBRE de noms masqués remonte, via le masque).
 *
 * Bornes strictes (valeurs provisoires, à valider par le métier) : 2 000 noms lus au plus par
 * table, 200 termes retenus au plus (les plus longs d'abord), termes de moins de 3 caractères
 * ignorés, 200 mots du message au plus pour la présélection (une seule tranche : COPILOTE, inchangé).
 *
 * Document long (INGESTION, `BORNES_NOMS_INGESTION`) : la présélection porte sur TOUT le texte transmis.
 * Les mots distincts du texte sont découpés en tranches de 200, une lecture de noms par tranche et par
 * table (2 000 noms au plus par lecture), les termes sont dédoublonnés entre tranches ; bornes : 40
 * tranches au plus (8 000 mots distincts examinés ; au-delà, les mots suivants ne servent pas à la
 * présélection) et 200 termes retenus au total (les plus longs d'abord, comme pour le copilote). Au pire
 * 160 requêtes indexées par document. Valeurs provisoires, à valider par le métier.
 *
 * Présélection EN SQL (l'annuaire n'est pas chargé) : un nom n'est lu que si l'un de ses mots
 * (minuscules, sans accents, lettres et chiffres ASCII) est un mot du message. Le test précis
 * (casse, accents, séparateurs souples, sigles, mots entiers) est ensuite celui du masque
 * lui-même (`chercheurDeTermes`).
 *
 * LIMITES : un nom écrit en entier dans le message est masqué ; un fragment seul (prénom seul,
 * mot isolé d'une raison sociale), une faute de frappe, un nom absent des fiches du cabinet ou
 * écrit sans lettre latine ni chiffre partent en clair.
 */

export const MAX_NOMS_LUS_PAR_TABLE = 2000;
export const MAX_TERMES_NOMS_PROPRES = 200;
export const MIN_CARACTERES_NOM = 3;
const MAX_MOTS_MESSAGE = 200;

/** Bornes de la présélection : nombre de tranches de MAX_MOTS_MESSAGE mots et termes retenus au total. */
export interface BornesNomsPropres {
  readonly maxTranches: number;
  readonly maxTermes: number;
}
/** Copilote : un message court, une seule tranche (comportement historique). */
export const BORNES_NOMS_COPILOTE: BornesNomsPropres = {
  maxTranches: 1,
  maxTermes: MAX_TERMES_NOMS_PROPRES,
};
/** Ingestion de documents : jusqu'à 40 tranches de 200 mots (8 000 mots distincts), 200 termes. */
export const BORNES_NOMS_INGESTION: BornesNomsPropres = { maxTranches: 40, maxTermes: 200 };

const SOURCES = [
  { table: "clients", colonne: "raison_sociale", categorie: "organisation" },
  { table: "utilisateurs", colonne: "nom", categorie: "personne" },
  { table: "contacts_client", colonne: "nom", categorie: "personne" },
  { table: "missions", colonne: "intitule", categorie: "autre" },
] as const;

/** Lettres accentuées → lettre de base (même table côté SQL : `translate`). */
const ACCENTS: Readonly<Record<string, string>> = {
  a: "àáâãäå",
  c: "ç",
  e: "èéêë",
  i: "ìíîï",
  n: "ñ",
  o: "òóôõö",
  u: "ùúûü",
  y: "ýÿ",
};
const DE = Object.entries(ACCENTS)
  .map(([, accents]) => accents + accents.toUpperCase())
  .join("");
const VERS = Object.entries(ACCENTS)
  .map(([base, accents]) => base.repeat([...accents].length * 2))
  .join("");

/** Mots (≥ 3 caractères, minuscules sans accents, [a-z0-9]) du texte, sans doublon, dans l'ordre. */
function motsDistincts(texte: string): string[] {
  const mots = formeComparaison(texte)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((m) => m.length >= MIN_CARACTERES_NOM);
  return [...new Set(mots)];
}

/** Mots (≥ 3 caractères, minuscules sans accents, [a-z0-9]) du message, sans doublon : 200 au plus. */
export function motsDuMessage(texte: string): string[] {
  return motsDistincts(texte).slice(0, MAX_MOTS_MESSAGE);
}

/** Mots distincts du texte en tranches de 200 mots, `maxTranches` au plus. */
export function tranchesDeMots(texte: string, maxTranches: number): string[][] {
  const mots = motsDistincts(texte).slice(0, MAX_MOTS_MESSAGE * maxTranches);
  const tranches: string[][] = [];
  for (let i = 0; i < mots.length; i += MAX_MOTS_MESSAGE) {
    tranches.push(mots.slice(i, i + MAX_MOTS_MESSAGE));
  }
  return tranches;
}

/** Expression SQL : mots d'une colonne, comme `motsDuMessage` (identifiant issu d'une constante). */
const motsSql = (colonne: string) =>
  `string_to_array(trim(regexp_replace(lower(translate(${colonne}, '${DE}', '${VERS}')), '[^a-z0-9]+', ' ', 'g')), ' ')`;

const CATEGORIE_TERME: Record<
  (typeof SOURCES)[number]["categorie"],
  "personne" | "organisation" | "autre"
> = { personne: "personne", organisation: "organisation", autre: "autre" };

export interface TermesNomsPropres {
  termes: TermeSensible[];
}

/**
 * Termes à masquer pour ce message : noms du cabinet courant (RLS) dont une forme normalisée figure
 * dans `message` (déjà neutralisé par l'appelant). Aucune écriture, aucun journal.
 */
export async function termesNomsPropres(
  db: Db,
  cabinetId: string,
  message: string,
  bornes: BornesNomsPropres = BORNES_NOMS_COPILOTE,
): Promise<TermesNomsPropres> {
  const tranches = tranchesDeMots(message, bornes.maxTranches);
  if (tranches.length === 0) return { termes: [] };
  const apparait = chercheurDeTermes(message);
  const retenus = new Map<string, { terme: TermeSensible; longueur: number }>();
  for (const mots of tranches) {
    for (const source of SOURCES) {
      const r = await db.query(
        `SELECT ${source.colonne} AS nom FROM ${source.table}
         WHERE cabinet_id = $1 AND ${motsSql(source.colonne)} && $2::text[]
         ORDER BY length(${source.colonne}) DESC, ${source.colonne}
         LIMIT ${MAX_NOMS_LUS_PAR_TABLE}`,
        [cabinetId, mots],
      );
      for (const ligne of r.rows) {
        const nom = String(ligne.nom).trim().slice(0, 200);
        const cle = formeComparaison(nom).replace(/\s+/g, " ");
        if (cle.length < MIN_CARACTERES_NOM || retenus.has(cle)) continue;
        const terme: TermeSensible = { valeur: nom, categorie: CATEGORIE_TERME[source.categorie] };
        if (apparait(terme)) retenus.set(cle, { terme, longueur: cle.length });
      }
    }
  }
  const termes = [...retenus.values()]
    .sort((a, b) => b.longueur - a.longueur)
    .slice(0, bornes.maxTermes)
    .map((x) => x.terme);
  return { termes };
}
