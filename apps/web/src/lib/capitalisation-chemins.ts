import {
  aPermission,
  TYPES_RESULTAT_RECHERCHE,
  type Role,
  type TypeResultatRecherche,
} from "@missionpilot/shared";
import type { ResultatRecherche } from "./capitalisation-types";
import { hrefRapports } from "./rapports";
import type { Resultat } from "./saisie";

/** Recherche, pagination des retours et seuil d'analyse des dérogations : liens et chemins d'API. */

/* ----- Recherche ----- */

const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface Segment {
  texte: string;
  surligne: boolean;
}

/**
 * Découpe un texte en segments dont ceux qui commencent par un mot de la requête (sans tenir
 * compte des accents ni de la casse) sont surlignés : rendu en nœuds texte, jamais en HTML.
 */
export function segmentsSurlignes(texte: string, q: string): Segment[] {
  const mots = [
    ...new Set(
      sansAccents(q)
        .split(/[^a-z0-9]+/)
        .filter((m) => m.length >= 2),
    ),
  ];
  if (mots.length === 0 || texte === "") return texte === "" ? [] : [{ texte, surligne: false }];
  const normal = sansAccents(texte);
  // La normalisation garde la longueur caractère par caractère pour le français courant ;
  // sinon, pas de surlignage plutôt qu'un découpage faux.
  if (normal.length !== texte.length) return [{ texte, surligne: false }];
  const segments: Segment[] = [];
  const re = /[a-z0-9]+/g;
  let curseur = 0;
  for (let m = re.exec(normal); m; m = re.exec(normal)) {
    if (!mots.some((x) => m![0].startsWith(x))) continue;
    if (m.index > curseur) segments.push({ texte: texte.slice(curseur, m.index), surligne: false });
    segments.push({ texte: texte.slice(m.index, m.index + m[0].length), surligne: true });
    curseur = m.index + m[0].length;
  }
  if (curseur < texte.length) segments.push({ texte: texte.slice(curseur), surligne: false });
  return segments;
}

/**
 * Lien d'un résultat vers son écran. Un rapport n'a pas de page propre : il mène à l'onglet
 * « Rapports » de sa mission, où il se télécharge (et non à la fiche de la mission).
 */
export function hrefResultat(r: Pick<ResultatRecherche, "type" | "id" | "mission_id">): string {
  if (r.type === "connaissance") return `/connaissances/retours/${encodeURIComponent(r.id)}`;
  if (r.type === "rapport") return hrefRapports(r.mission_id);
  return `/missions/${encodeURIComponent(r.mission_id)}`;
}

export interface CritereRecherche {
  q: string;
  types: TypeResultatRecherche[];
}

/** Paramètres de la page de recherche → critères valides (requête vide si trop courte). */
export function lireCritereRecherche(
  params: Record<string, string | string[] | undefined>,
): CritereRecherche {
  const brut = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const brutTypes = Array.isArray(params.types) ? params.types : [params.types ?? ""];
  const t = brutTypes.flatMap((x) => x.split(","));
  const types = TYPES_RESULTAT_RECHERCHE.filter((x) => t.includes(x));
  return { q: brut.length >= 2 ? brut : "", types };
}

export function cheminRecherche(c: CritereRecherche, limite = 10): string {
  const p = new URLSearchParams({ q: c.q, limite: String(limite) });
  if (c.types.length > 0) p.set("types", c.types.join(","));
  return `/api/capitalisation/recherche?${p}`;
}

/* ----- Retours : pagination ----- */

export function lireCurseurRetours(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v !== "" && v.length <= 500 ? v : null;
}

export function cheminRetours(curseur: string | null, limite = 30): string {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  return `/api/capitalisation/retours?${q}`;
}

export const hrefRetours = (curseur: string | null) =>
  curseur
    ? `/connaissances/retours?curseur=${encodeURIComponent(curseur)}`
    : "/connaissances/retours";

export function cheminMissionsSansRetour(curseur: string | null, limite = 30): string {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  return `/api/capitalisation/retours/a-ouvrir?${q}`;
}

/** Page « Retours d'expérience » : le curseur de la liste de rattrapage a son propre paramètre. */
export const hrefMissionsSansRetour = (curseur: string | null) =>
  curseur
    ? `/connaissances/retours?a_ouvrir=${encodeURIComponent(curseur)}`
    : "/connaissances/retours";

/** Écran d'un retour d'expérience (redirection après ouverture). */
export const hrefRetour = (id: string) => `/connaissances/retours/${encodeURIComponent(id)}`;

/**
 * Qui peut ouvrir le retour d'expérience d'une mission : `mission.planifier` ET chef, directeur
 * de la mission ou associé (même règle que l'API, qui reste seule juge).
 */
export function peutOuvrirRetour(
  c: { roles: readonly Role[]; utilisateurId: string },
  mission: { chef_id: string | null; directeur_id: string | null },
): boolean {
  return (
    aPermission(c.roles, "mission.planifier") &&
    (c.roles.includes("associe") ||
      mission.chef_id === c.utilisateurId ||
      mission.directeur_id === c.utilisateurId)
  );
}

/* ----- Analyse des dérogations : seuil ----- */

/** Bornes du seuil d'analyse (nombre de missions), identiques à `analyseDerogationsQuerySchema`. */
export const SEUIL_DEROGATIONS_MIN = 2;
export const SEUIL_DEROGATIONS_MAX = 100;

/**
 * Seuil saisi (paramètre d'URL ou champ) : vide → seuil du cabinet servi par l'API ; sinon un
 * entier borné, avec un message lisible hors bornes (jamais une erreur 400 de l'API).
 */
export function lireSeuilDerogations(
  v: string | string[] | undefined,
): Resultat<{ seuil: number | null }, "seuil"> {
  const brut = (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  if (brut === "") return { ok: true, charge: { seuil: null } };
  const n = Number(brut);
  if (
    !/^[0-9]+$/.test(brut) ||
    !Number.isInteger(n) ||
    n < SEUIL_DEROGATIONS_MIN ||
    n > SEUIL_DEROGATIONS_MAX
  ) {
    return {
      ok: false,
      erreurs: {
        seuil: `Indiquez un nombre entier de missions de ${SEUIL_DEROGATIONS_MIN} à ${SEUIL_DEROGATIONS_MAX}.`,
      },
    };
  }
  return { ok: true, charge: { seuil: n } };
}

export function cheminAnalyseDerogations(seuil: number | null): string {
  return seuil === null
    ? "/api/capitalisation/derogations/analyse"
    : `/api/capitalisation/derogations/analyse?seuil=${seuil}`;
}
