import type { CategorieFaitDossier, ValeurFacteurContexte } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { aujourdhui } from "./acces.js";
import { contexteFacteurs, listerFacteurs } from "./facteurs.js";
import { faitsCourantsParCle, listerFaits, type VueFait } from "./faits.js";

/*
 * API de LECTURE du dossier pour les autres lots (référentiel de méthodes, preuves, agents,
 * qualité) : faits confirmés courants et contexte du client. Ces fonctions lisent dans la
 * transaction reçue (RLS du cabinet) et NE contrôlent PAS la visibilité : l'appelant a déjà
 * vérifié le dossier (`exigerDossierVisible`, `dossier/acces.ts`) ou la mission du client
 * (`exigerMissionVisible`). Elles n'écrivent rien.
 */

/**
 * Valeur courante de chaque clé parmi les faits CONFIRMÉS, ni remplacés ni rejetés, à la date
 * donnée (aujourd'hui par défaut), triée par « catégorie/clé ». Un fait proposé (dont un fait
 * extrait par l'IA non encore confirmé) n'y figure jamais.
 */
export async function lireFaitsConfirmesClient(
  db: Db,
  clientId: string,
  options: { categorie?: CategorieFaitDossier; aLaDate?: string } = {},
): Promise<VueFait[]> {
  const faits = await listerFaits(db, clientId, "courants", options.categorie);
  return faitsCourantsParCle(faits, options.aLaDate ?? aujourdhui());
}

/**
 * Contexte de modulation du client (STD-04) : code du facteur → valeur courante à la date
 * donnée (aujourd'hui par défaut), de la forme de `contexteModulationSchema`.
 */
export async function lireContexteClient(
  db: Db,
  clientId: string,
  aLaDate: string = aujourdhui(),
): Promise<Record<string, ValeurFacteurContexte>> {
  return contexteFacteurs(await listerFacteurs(db, clientId), aLaDate);
}
