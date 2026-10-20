import { cache } from "react";
import { chargerServeur } from "./api-serveur";
import {
  API_CANAUX_COMPTES,
  API_CANAUX_DESTINATAIRES,
  LIMITE_LISTE_CANAUX,
  listeDepuis,
  pageDepuis,
  type CompteCanalApi,
  type DestinataireCanalApi,
} from "./canaux";
import type { Client } from "./clients";
import { chargerToutesLesPages, type ChargementPage, type PageCurseur } from "./pagination";

/**
 * Chargements serveur des écrans de canaux (Server Components). À ne pas importer dans un
 * composant client (dépend de `next/headers` par `api-serveur`).
 *
 * Les routes de ce lot rendent `{ elements, curseur_suivant }` ; `chargerToutesLesPages` attend
 * `suivant` : la conversion est faite ici, par `pageDepuis`.
 */

/** Page d'une route de ce lot, convertie ; une erreur d'API reste affichable sur place. */
export async function chargerPageCanaux<T>(
  chemin: string,
): Promise<ChargementPage<PageCurseur<T>>> {
  const r = await chargerServeur<unknown>(chemin);
  if (!r.ok) return r;
  return { ok: true, donnees: pageDepuis<T>(r.donnees) };
}

/**
 * Les deux comptes de canal (WhatsApp, SMS) avec leur mode fournisseur, chargés une fois par
 * requête : la mise en page de la rubrique (onglets) et la page les partagent.
 */
export const chargerComptesCanaux = cache(async (): Promise<ChargementPage<CompteCanalApi[]>> => {
  const r = await chargerServeur<unknown>(API_CANAUX_COMPTES);
  if (!r.ok) return r;
  return { ok: true, donnees: listeDepuis<CompteCanalApi>(r.donnees) };
});

/** Clients actifs pour le choix d'un client (route plafonnée à 100 : `limiteMax: 100`). */
export async function chargerClientsPourCanaux(): Promise<
  ChargementPage<{ elements: Client[]; tronquee: boolean }>
> {
  return chargerToutesLesPages<Client>(
    (chemin) => chargerPageCanaux<Client>(chemin),
    "/api/clients?actif=true",
    { limiteMax: 100 },
  );
}

/** Tous les destinataires d'un client (numéros masqués seulement), par pages de 100. */
export async function chargerDestinatairesClient(
  clientId: string,
): Promise<ChargementPage<{ elements: DestinataireCanalApi[]; tronquee: boolean }>> {
  return chargerToutesLesPages<DestinataireCanalApi>(
    (chemin) => chargerPageCanaux<DestinataireCanalApi>(chemin),
    `${API_CANAUX_DESTINATAIRES}?client_id=${encodeURIComponent(clientId)}`,
    { limiteMax: LIMITE_LISTE_CANAUX },
  );
}

/** Toutes les pages d'une liste de ce lot (routes plafonnées à 100 : `limiteMax` déclaré). */
export function chargerToutesPagesCanaux<T>(
  chemin: string,
  limiteMax: number = LIMITE_LISTE_CANAUX,
): Promise<ChargementPage<{ elements: T[]; tronquee: boolean }>> {
  return chargerToutesLesPages<T>((c) => chargerPageCanaux<T>(c), chemin, { limiteMax });
}
