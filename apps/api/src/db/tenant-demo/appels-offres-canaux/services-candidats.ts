import { attendre, type ContexteTenantDemo, type SessionDemo } from "../contexte.js";
import { GUICHETS_TENANT_DEMO } from "./donnees-guichets.js";

/*
 * Services candidats du Tenant démo (lot 5, phase « appels-offres-canaux ») : prix de démonstration
 * du diagnostic flash, activation des deux services, guichets de financement fictifs.
 *
 * Passe par les routes réelles, avec le compte « associé » (droit `services_candidats.gerer`) :
 * - PUT /api/services-candidats/diagnostic_flash/prix : prix fixe DE DÉMONSTRATION (le produit n'en
 *   fournit aucun par défaut) ; il est marqué comme tel dans le commentaire du cabinet ;
 * - POST /api/services-candidats/activer : types de mission des deux services (idempotent côté route) ;
 * - POST /api/guichets-financement : guichets fictifs de `donnees-guichets.ts`.
 *
 * Les missions « Diagnostic flash — Teranga Logistique » et « Business plan bancable — Atlantique
 * Retail » ne sont PAS créées ici (autre lot). Idempotent : prix relu avant d'être réécrit,
 * guichets retrouvés par `nom` avant création. Rejouable sans doublon.
 *
 * Antidatage : impossible pour les guichets (déclencheur MQV01 : `cree_le` est figé, même pour le
 * propriétaire) ; les dates de création sont donc celles du jour de l'exécution (hypothèse, rapport).
 */

/** Prix de démonstration du diagnostic flash (FCFA entiers). Fictif, à réviser par le cabinet. */
export const PRIX_FLASH_TENANT_DEMO = {
  montant: 1_800_000,
  devise: "XOF",
  commentaire:
    "DÉMONSTRATION : prix fictif fixé par le cabinet de démonstration, à réviser avant tout usage.",
} as const;

/** Les deux services candidats, activés dans le cabinet de démonstration. */
const SERVICES_ACTIVES = ["diagnostic_flash", "business_plan_bancable"] as const;

interface ServiceLu {
  code: string;
  type_mission: { id: string } | null;
  prix: { montant: number | null; devise: string; commentaire: string | null };
}

/**
 * Fixe le prix de démonstration du diagnostic flash SEULEMENT s'il n'y en a pas : la phase
 * « missions » (lot 2a) a pu déjà le poser, on ne l'écrase pas.
 */
async function fixerPrixFlash(associe: SessionDemo): Promise<boolean> {
  const lus = await associe.get("/api/services-candidats");
  attendre(200, lus, "services candidats");
  const flash = (lus.json().elements as ServiceLu[]).find((s) => s.code === "diagnostic_flash");
  if (flash?.prix.montant != null) return false;
  attendre(
    200,
    await associe.put("/api/services-candidats/diagnostic_flash/prix", PRIX_FLASH_TENANT_DEMO),
    "prix de démonstration du diagnostic flash",
  );
  return true;
}

/** Active les services dont le type de mission n'existe pas encore (la phase « missions » les active déjà). */
async function activerServices(associe: SessionDemo): Promise<number> {
  const lus = await associe.get("/api/services-candidats");
  attendre(200, lus, "services candidats");
  const elements = lus.json().elements as ServiceLu[];
  let crees = 0;
  for (const service of SERVICES_ACTIVES) {
    if (elements.find((e) => e.code === service)?.type_mission) continue;
    const r = await associe.post("/api/services-candidats/activer", { service });
    attendre(200, r, `activation du service ${service}`);
    crees += (r.json() as { types_crees: number }).types_crees;
  }
  return crees;
}

/** Crée les guichets fictifs absents (retrouvés par leur nom). Renvoie le nombre créé. */
async function semerGuichets(associe: SessionDemo): Promise<number> {
  const lus = await associe.get("/api/guichets-financement?limite=200");
  attendre(200, lus, "guichets de financement");
  const existants = lus.json() as { elements: { nom: string }[]; tronque: boolean };
  if (existants.tronque) {
    throw new Error("Plus de 200 guichets dans le cabinet : idempotence non assurée, arrêt.");
  }
  const noms = new Set(existants.elements.map((g) => g.nom));
  let crees = 0;
  for (const guichet of GUICHETS_TENANT_DEMO) {
    if (noms.has(guichet.nom)) continue;
    attendre(
      201,
      await associe.post("/api/guichets-financement", guichet),
      `guichet « ${guichet.nom} »`,
    );
    crees += 1;
  }
  return crees;
}

export async function semerServicesCandidats(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");
  const prixPose = await fixerPrixFlash(associe);
  const typesCrees = await activerServices(associe);
  const guichetsCrees = await semerGuichets(associe);
  ctx.journal(
    `    services candidats : prix flash ${prixPose ? "fixé" : "déjà fixé"}, ` +
      `${typesCrees} type(s) de mission activé(s), ${guichetsCrees} guichet(s) créé(s).`,
  );
}
