/** Services candidats : création d'une mission depuis un service (module extrait de `services-candidats.ts`). */
import { UUID, estDevise } from "./services-candidats-outils";
import type { ServiceCandidat } from "./services-candidats-types";
import { CODES_SERVICES_CANDIDATS, type CodeServiceCandidat } from "@missionpilot/shared";
import { type Devise } from "./format";
import {
  SAISIE_MISSION_VIDE,
  validerCreationMission,
  type ChampMission,
  type ChargeCreationMission,
} from "./missions";
import { type Resultat } from "./saisie";

// --- Création d'une mission depuis un service ----------------------------------------

/** Pourquoi une mission ne peut pas encore être créée depuis ce service (`null` : possible). */
export function obstacleCreationMission(s: ServiceCandidat): string | null {
  if (!s.type_mission) return "Le type de mission n'est pas activé : activez-le d'abord.";
  if (!s.methode) return "Aucune méthode publiée dans le standard pour ce service.";
  if (s.coherence && !s.coherence.valide)
    return "La méthode du standard est incohérente : corrigez-la avant de créer une mission.";
  return null;
}

/** Intitulé proposé : « Diagnostic flash — Raison sociale ». */
export function intituleParDefaut(service: Pick<ServiceCandidat, "libelle">, client: string) {
  return client.trim() === "" ? service.libelle : `${service.libelle} — ${client.trim()}`;
}

export interface SaisieMissionService {
  client_id: string;
  intitule: string;
  date_debut: string;
  date_fin: string;
}

export const SAISIE_MISSION_SERVICE_VIDE: SaisieMissionService = {
  client_id: "",
  intitule: "",
  date_debut: "",
  date_fin: "",
};

/** Corps de POST /api/missions : type de mission du service, client, intitulé, dates. */
export function validerMissionService(
  s: SaisieMissionService,
  service: ServiceCandidat,
): Resultat<ChargeCreationMission, ChampMission> {
  const devise: Devise = estDevise(service.prix.devise) ? service.prix.devise : "XOF";
  return validerCreationMission({
    ...SAISIE_MISSION_VIDE,
    client_id: s.client_id,
    intitule: s.intitule,
    date_debut: s.date_debut,
    date_fin: s.date_fin,
    type_mission_id: service.type_mission?.id ?? "",
    devise,
  });
}

/** Corps de PUT /api/missions/:id/methode : version publiée de la méthode, contexte vide. */
export function corpsLiaisonMethode(
  service: Pick<ServiceCandidat, "methode">,
): { version_id: string; contexte: Record<string, never> } | null {
  return service.methode ? { version_id: service.methode.version_id, contexte: {} } : null;
}

export interface PreremplissageService {
  service: CodeServiceCandidat | null;
  client: string | null;
}

/**
 * Lit `?service=<code>&client=<uuid>` (lien posé depuis une fiche client ou une alerte) : une
 * valeur absente, répétée ou invalide est ignorée (`null`), jamais une erreur.
 */
export function lirePreremplissageService(
  params: Record<string, string | string[] | undefined>,
): PreremplissageService {
  const unique = (v: string | string[] | undefined): string | null =>
    typeof v === "string" ? v.trim() : null;
  const code = unique(params.service);
  const client = unique(params.client);
  return {
    service: (CODES_SERVICES_CANDIDATS as readonly string[]).includes(code ?? "")
      ? (code as CodeServiceCandidat)
      : null,
    client: client !== null && UUID.test(client) ? client.toLowerCase() : null,
  };
}

export const cheminMission = (id: string): string => `/missions/${encodeURIComponent(id)}`;
