/**
 * Commentaires contextuels (SOC-08) : fenêtre de modification, mentions @, droits d'action et
 * découpage du texte pour l'affichage. Logique pure, testée dans `commentaires.test.ts`.
 *
 * Le texte d'un commentaire est du TEXTE BRUT : il est rendu par React comme du texte (échappé),
 * jamais interprété comme du HTML ; les retours à la ligne sont conservés par CSS
 * (`white-space: pre-line`). L'API reste seule juge des droits.
 */
import {
  DELAI_MODIFICATION_COMMENTAIRE_MINUTES,
  MENTIONS_MAX,
  TAILLE_COMMENTAIRE_MAX,
  type TypeEntiteCollaboration,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import type { Resultat } from "./saisie";

export interface Mention {
  id: string;
  nom: string | null;
}

export interface Commentaire {
  id: string;
  entite_type: TypeEntiteCollaboration;
  entite_id: string;
  auteur_id: string;
  auteur_nom: string;
  /** `null` pour un commentaire supprimé. */
  texte: string | null;
  mentions: Mention[];
  cree_le: string;
  modifie_le: string | null;
  modifiable_jusqu_au: string;
  supprime: boolean;
  supprime_le: string | null;
  supprime_par: string | null;
}

export interface PageCommentaires {
  elements: Commentaire[];
  curseur_suivant: string | null;
}

export interface Mentionnable {
  id: string;
  nom: string;
}

export const LIMITE_COMMENTAIRES = 20;
export { DELAI_MODIFICATION_COMMENTAIRE_MINUTES, TAILLE_COMMENTAIRE_MAX };

// --- Fenêtre de modification --------------------------------------------------------------

/** Secondes restantes avant la fin de la fenêtre de modification (0 si dépassée). */
export function secondesRestantes(modifiableJusquAu: string, maintenant: number): number {
  const fin = Date.parse(modifiableJusquAu);
  if (Number.isNaN(fin)) return 0;
  return Math.max(0, Math.floor((fin - maintenant) / 1000));
}

/** « Modifiable encore 12 min » / « … 45 s » ; null une fois la fenêtre close. */
export function libelleDelaiModification(secondes: number): string | null {
  if (secondes <= 0) return null;
  if (secondes < 60) return `Modifiable encore ${secondes} s`;
  return `Modifiable encore ${Math.ceil(secondes / 60)} min`;
}

export interface ActionsCommentaire {
  modifier: boolean;
  supprimer: boolean;
  historique: boolean;
}

/**
 * Modifier : l'auteur, dans la fenêtre (15 min). Supprimer : l'auteur ou un associé.
 * Historique : un commentaire modifié et non supprimé.
 */
export function actionsCommentaire(
  c: Pick<Commentaire, "auteur_id" | "supprime" | "modifiable_jusqu_au" | "modifie_le">,
  utilisateurId: string,
  associe: boolean,
  maintenant: number,
): ActionsCommentaire {
  if (c.supprime) return { modifier: false, supprimer: false, historique: false };
  const auteur = c.auteur_id === utilisateurId;
  return {
    modifier: auteur && secondesRestantes(c.modifiable_jusqu_au, maintenant) > 0,
    supprimer: auteur || associe,
    historique: c.modifie_le !== null,
  };
}

// --- Saisie ---------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Texte d'un commentaire : 1 à 5 000 caractères, sans caractère de contrôle. */
export function validerTexteCommentaire(texte: string): Resultat<string, "texte"> {
  const t = texte.trim();
  if (t === "") return { ok: false, erreurs: { texte: "Écrivez votre commentaire." } };
  if (t.length > TAILLE_COMMENTAIRE_MAX)
    return {
      ok: false,
      erreurs: { texte: `${TAILLE_COMMENTAIRE_MAX.toLocaleString("fr-FR")} caractères au plus.` },
    };
  if (CONTROLES.test(t))
    return { ok: false, erreurs: { texte: "Le texte contient un caractère non autorisé." } };
  return { ok: true, charge: t };
}

/** Message d'erreur propre aux commentaires (fenêtre dépassée, commentaire figé). */
export function messageCommentaire(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.code === "DELAI_MODIFICATION_DEPASSE")
      return `Le délai de ${DELAI_MODIFICATION_COMMENTAIRE_MINUTES} minutes est dépassé : ce commentaire ne peut plus être modifié.`;
    if (e.code === "COMMENTAIRE_FIGE") return "Ce commentaire ne peut plus être modifié.";
    if (e.statut === 404) return "Ce commentaire ou l'élément commenté n'est plus accessible.";
  }
  return messageErreur(e);
}

// --- Mentions -------------------------------------------------------------------------------

/** Caractères d'un nom tapé après « @ » (lettres, chiffres, espace simple, tiret, apostrophe). */
const CAR_NOM = /[\p{L}\p{N}' .-]/u;

export interface RequeteMention {
  /** Position du « @ ». */
  debut: number;
  /** Texte tapé après « @ » jusqu'au curseur. */
  requete: string;
}

/**
 * Mention en cours de saisie juste avant le curseur : un « @ » en début de texte ou après un
 * blanc, suivi d'au plus 40 caractères de nom (pas de retour à la ligne, pas de double
 * espace). `null` sinon.
 */
export function requeteMention(texte: string, curseur: number): RequeteMention | null {
  const avant = texte.slice(0, Math.max(0, Math.min(curseur, texte.length)));
  const at = avant.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(avant[at - 1]!)) return null;
  const requete = avant.slice(at + 1);
  if (requete.length > 40 || requete.includes("  ")) return null;
  for (const c of requete) if (!CAR_NOM.test(c)) return null;
  return { debut: at, requete };
}

/** Remplace la mention en cours par « @Nom » suivi d'une espace ; renvoie texte et curseur. */
export function insererMention(
  texte: string,
  r: RequeteMention,
  curseur: number,
  nom: string,
): { texte: string; curseur: number } {
  const insertion = `@${nom} `;
  const suite = texte.slice(curseur).replace(/^ /, "");
  const nouveau = texte.slice(0, r.debut) + insertion + suite;
  return { texte: nouveau, curseur: r.debut + insertion.length };
}

/**
 * Identifiants des personnes choisies dont « @Nom » figure encore dans le texte (une mention
 * effacée du texte n'est pas envoyée), sans doublon, au plus 20.
 */
export function mentionsDuTexte(texte: string, choisies: readonly Mentionnable[]): string[] {
  const ids: string[] = [];
  for (const m of choisies) {
    if (ids.includes(m.id)) continue;
    if (texte.includes(`@${m.nom}`)) ids.push(m.id);
  }
  return ids.slice(0, MENTIONS_MAX);
}

export type Segment = { type: "texte"; valeur: string } | { type: "mention"; valeur: string };

/**
 * Découpe le texte pour l'affichage : chaque « @Nom » d'une personne mentionnée devient un
 * segment « mention » (mis en valeur), le reste du texte brut. Aucun HTML n'est produit.
 */
export function segmentsCommentaire(texte: string, mentions: readonly Mention[]): Segment[] {
  const noms = [...new Set(mentions.map((m) => m.nom).filter((n): n is string => !!n))].sort(
    (a, b) => b.length - a.length,
  );
  if (noms.length === 0 || texte === "") return texte ? [{ type: "texte", valeur: texte }] : [];
  const segments: Segment[] = [];
  let tampon = "";
  let i = 0;
  while (i < texte.length) {
    const nom = texte[i] === "@" ? noms.find((n) => texte.startsWith(`@${n}`, i)) : undefined;
    if (nom) {
      if (tampon) segments.push({ type: "texte", valeur: tampon });
      tampon = "";
      segments.push({ type: "mention", valeur: `@${nom}` });
      i += nom.length + 1;
    } else {
      tampon += texte[i];
      i += 1;
    }
  }
  if (tampon) segments.push({ type: "texte", valeur: tampon });
  return segments;
}

/** Ajoute ou remplace des commentaires (par identifiant), triés du plus ancien au plus récent. */
export function fusionnerCommentaires(
  existants: readonly Commentaire[],
  nouveaux: readonly Commentaire[],
): Commentaire[] {
  const parId = new Map(existants.map((c) => [c.id, c]));
  for (const c of nouveaux) parId.set(c.id, c);
  return [...parId.values()].sort(
    (a, b) => a.cree_le.localeCompare(b.cree_le) || a.id.localeCompare(b.id),
  );
}

/** Paramètres de GET /api/commentaires. */
export function requeteCommentaires(
  entiteType: TypeEntiteCollaboration,
  entiteId: string,
  curseur?: string | null,
): string {
  const q = new URLSearchParams({
    entite_type: entiteType,
    entite_id: entiteId,
    limite: String(LIMITE_COMMENTAIRES),
  });
  if (curseur) q.set("curseur", curseur);
  return `/api/commentaires?${q.toString()}`;
}
