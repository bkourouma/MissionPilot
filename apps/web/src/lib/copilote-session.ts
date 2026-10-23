import { reponseCopiloteSchema, type ReponseCopilote } from "@missionpilot/shared";
import type { EntreeCopilote, EntreeFil } from "./copilote";

/*
 * Conservation locale de la conversation du copilote (AGT-08).
 *
 * La conversation reste UNIQUEMENT dans l'onglet du navigateur de l'utilisateur
 * (`sessionStorage` : vidé à la fermeture de l'onglet, jamais partagé entre onglets, jamais
 * `localStorage`). Elle n'est JAMAIS envoyée au serveur, qui ne conserve aucune conversation :
 * cela reste cohérent avec « Aucune conversation n'est conservée » côté serveur.
 *
 * Garde-fous :
 * - au plus 20 échanges (une question de l'utilisateur et sa réponse) ;
 * - expiration après 30 minutes sans activité (lue au chargement) ;
 * - une proposition d'action en attente n'est JAMAIS conservée : la carte (qui expire en 5
 *   minutes) n'est pas restaurée, seul le message l'est, avec la mention « proposition expirée » ;
 * - les erreurs passagères ne sont pas conservées ;
 * - aucun identifiant de session ; seul l'identifiant de l'utilisateur sert de portée, pour qu'un
 *   autre compte ouvert dans le même onglet ne lise jamais la conversation du précédent ;
 * - tout est tolérant aux pannes : stockage indisponible, plein ou corrompu → on fonctionne sans,
 *   et les données invalides sont ignorées (et effacées).
 */

export const CLE_CONVERSATION = "missionpilot.copilote.conversation";
export const ECHANGES_CONSERVES_MAX = 20;
export const INACTIVITE_MAX_MS = 30 * 60 * 1000;
const VERSION = 1;

/** Sous-ensemble de `Storage` utilisé (permet de tester sans navigateur). */
export interface StockageMinimal {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
  removeItem(cle: string): void;
}

/** `sessionStorage` si disponible (l'accès lui-même peut lever), sinon null. */
export function stockageSession(): StockageMinimal | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

type EntreeStockee =
  { a: "u"; texte: string } | { a: "c"; reponse: ReponseCopilote; expiree: boolean };

/** Ne garde que les 20 derniers échanges (à partir de la 20e dernière question). */
export function limiterEchanges(fil: readonly EntreeFil[]): EntreeFil[] {
  let questions = 0;
  for (let i = fil.length - 1; i >= 0; i -= 1) {
    if (fil[i]?.auteur === "utilisateur") {
      questions += 1;
      if (questions === ECHANGES_CONSERVES_MAX) return fil.slice(i);
    }
  }
  return [...fil];
}

/** Version stockable du fil : sans erreurs, sans carte d'action, plafonnée. */
export function versStockage(fil: readonly EntreeFil[]): EntreeStockee[] {
  const sortie: EntreeStockee[] = [];
  for (const e of limiterEchanges(fil)) {
    if (e.auteur === "utilisateur") sortie.push({ a: "u", texte: e.texte });
    else if (e.auteur === "copilote") {
      const { action, ...reste } = e.reponse;
      // Proposition encore décidable (ou en cours de décision) : jamais restaurée.
      const enAttente =
        action !== undefined &&
        (e.etatAction === "proposee" || e.etatAction === "en_cours" || e.etatAction === "erreur");
      sortie.push({ a: "c", reponse: reste, expiree: enAttente });
    }
  }
  return sortie;
}

export function sauvegarderConversation(
  stockage: StockageMinimal | null,
  portee: string,
  fil: readonly EntreeFil[],
  maintenant: number = Date.now(),
): void {
  if (!stockage) return;
  try {
    const entrees = versStockage(fil);
    if (entrees.length === 0) {
      stockage.removeItem(CLE_CONVERSATION);
      return;
    }
    stockage.setItem(
      CLE_CONVERSATION,
      JSON.stringify({ v: VERSION, portee, maj: maintenant, fil: entrees }),
    );
  } catch {
    /* stockage plein ou refusé : le copilote fonctionne sans */
  }
}

export function effacerConversation(stockage: StockageMinimal | null): void {
  try {
    stockage?.removeItem(CLE_CONVERSATION);
  } catch {
    /* ignoré */
  }
}

/**
 * Relit la conversation. Retourne un fil vide si rien n'est conservé, si la conversation est
 * expirée (30 min), d'un autre utilisateur, ou invalide ; dans ces cas le stockage est vidé.
 */
export function restaurerConversation(
  stockage: StockageMinimal | null,
  portee: string,
  maintenant: number = Date.now(),
): EntreeFil[] {
  if (!stockage) return [];
  try {
    const brut = stockage.getItem(CLE_CONVERSATION);
    if (brut === null) return [];
    const lu: unknown = JSON.parse(brut);
    const fil = lireEnveloppe(lu, portee, maintenant);
    if (!fil) {
      effacerConversation(stockage);
      return [];
    }
    return limiterEchanges(fil);
  } catch {
    effacerConversation(stockage);
    return [];
  }
}

function lireEnveloppe(lu: unknown, portee: string, maintenant: number): EntreeFil[] | null {
  if (typeof lu !== "object" || lu === null) return null;
  const o = lu as Record<string, unknown>;
  if (o.v !== VERSION || o.portee !== portee || typeof o.maj !== "number") return null;
  const age = maintenant - o.maj;
  if (!Number.isFinite(age) || age < 0 || age > INACTIVITE_MAX_MS) return null;
  if (!Array.isArray(o.fil) || o.fil.length > ECHANGES_CONSERVES_MAX * 2 + 2) return null;
  const fil: EntreeFil[] = [];
  for (const [i, brut] of o.fil.entries()) {
    const id = `h${i + 1}`;
    if (typeof brut !== "object" || brut === null) return null;
    const e = brut as Record<string, unknown>;
    if (e.a === "u" && typeof e.texte === "string" && e.texte.length > 0) {
      fil.push({ id, auteur: "utilisateur", texte: e.texte });
    } else if (e.a === "c" && typeof e.expiree === "boolean") {
      const r = reponseCopiloteSchema.safeParse(e.reponse);
      if (!r.success) return null;
      // Une carte d'action n'est jamais restaurée, même si les données en contiennent une.
      const reponse: ReponseCopilote = { ...r.data, action: undefined };
      delete reponse.action;
      const entree: EntreeCopilote = {
        id,
        auteur: "copilote",
        reponse,
        etatAction: null,
        resultat: null,
        erreurAction: null,
        propositionExpiree: e.expiree,
      };
      fil.push(entree);
    } else {
      return null;
    }
  }
  return fil;
}
