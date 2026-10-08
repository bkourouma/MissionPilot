/**
 * Téléversement d'un fichier vers l'API (multipart/form-data, champ « fichier »), côté
 * navigateur. XMLHttpRequest plutôt que fetch : seul il donne la progression de l'envoi, utile
 * en 3G pour un justificatif de plusieurs mégaoctets. Même origine (`/api/*` relayé par Next) :
 * le cookie de session httpOnly part seul, aucun jeton n'est manipulé en JavaScript.
 *
 * La lecture de la réponse (`lireReponseTeleversement`) est pure et testée.
 */
import { CHAMP_FICHIER } from "@missionpilot/shared";
import { ErreurApi, erreurDepuisReponse, MESSAGE_DELAI, MESSAGE_RESEAU } from "./api";

/** 15 Mo en 3G (≈ 1 Mbit/s) : environ deux minutes ; marge confortable. */
const DELAI_TELEVERSEMENT_MS = 5 * 60_000;

export interface OptionsTeleversement {
  /** Progression de l'envoi, de 0 à 1 (absente si le navigateur ne la connaît pas). */
  onProgression?: (fraction: number) => void;
  signal?: AbortSignal;
  delaiMs?: number;
}

function json(texte: string): unknown {
  if (texte === "") return undefined;
  try {
    return JSON.parse(texte) as unknown;
  } catch {
    return undefined;
  }
}

/** Corps de la réponse (2xx), ou l'erreur construite depuis l'enveloppe de l'API. */
export function lireReponseTeleversement<T>(
  statut: number,
  texte: string,
): { ok: true; donnees: T } | { ok: false; erreur: ErreurApi } {
  const corps = json(texte);
  if (statut >= 200 && statut < 300) return { ok: true, donnees: corps as T };
  if (statut === 0) {
    return { ok: false, erreur: new ErreurApi("RESEAU_INDISPONIBLE", MESSAGE_RESEAU, 0) };
  }
  return { ok: false, erreur: erreurDepuisReponse(statut, corps) };
}

/** Envoie `fichier` en POST sur `chemin` ; rejette une `ErreurApi` en cas d'échec. */
export function televerser<T>(
  chemin: string,
  fichier: Blob,
  nom: string,
  options: OptionsTeleversement = {},
): Promise<T> {
  return new Promise<T>((resoudre, rejeter) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", chemin);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.timeout = options.delaiMs ?? DELAI_TELEVERSEMENT_MS;
    xhr.withCredentials = false; // même origine : le cookie part sans cette option.
    if (options.onProgression) {
      const surProgression = options.onProgression;
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) surProgression(Math.min(1, ev.loaded / ev.total));
      };
    }
    xhr.onload = () => {
      const r = lireReponseTeleversement<T>(xhr.status, xhr.responseText);
      if (r.ok) resoudre(r.donnees);
      else {
        if (xhr.status === 401 && window.location.pathname !== "/connexion") {
          const suite = window.location.pathname + window.location.search;
          window.location.assign(`/connexion?suite=${encodeURIComponent(suite)}`);
        }
        rejeter(r.erreur);
      }
    };
    xhr.onerror = () => rejeter(new ErreurApi("RESEAU_INDISPONIBLE", MESSAGE_RESEAU, 0));
    xhr.ontimeout = () => rejeter(new ErreurApi("DELAI_DEPASSE", MESSAGE_DELAI, 0));
    xhr.onabort = () => rejeter(new ErreurApi("ANNULE", "Envoi annulé.", 0));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const corps = new FormData();
    corps.append(CHAMP_FICHIER, fichier, nom);
    xhr.send(corps);
  });
}
