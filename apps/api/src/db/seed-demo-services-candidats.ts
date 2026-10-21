import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../app.js";
import { type Config } from "../config.js";
import { createDatabase, type Database } from "./pool.js";
import { CLIENT_PORTAIL_DEMO } from "./seed-demo-portail.js";
import {
  attendre,
  configDemo,
  emailAbidjan,
  NOM_CABINET_ABIDJAN,
  ouvrirSession,
} from "./seed-demo.js";

/*
 * Données de démonstration des SERVICES CANDIDATS (lot 7) : types de mission « diagnostic flash »
 * et « business plan bancable » activés, une mission flash et une mission business plan pour le
 * client de démonstration (méthode du standard liée), deux guichets de financement FICTIFS.
 * Tout passe par les routes existantes (droits, journal d'audit). Aucun appel réseau.
 *
 * CONTENU FICTIF ET À VALIDER : les guichets ne correspondent à aucun organisme réel ; le prix du
 * diagnostic flash (aucun prix par défaut en production) est un prix de DÉMONSTRATION, marqué comme tel.
 * Idempotent : relancé, rien n'est dupliqué (missions retrouvées par intitulé, guichets par nom).
 * Appelé par `db:seed-demo` (une ligne) ; se lance aussi seul sur une base déjà peuplée :
 *   pnpm --filter @missionpilot/api exec tsx src/db/seed-demo-services-candidats.ts
 */

export const MARQUE_SERVICES_DEMO = "DÉMONSTRATION";
export const INTITULE_FLASH_DEMO = `Diagnostic flash (${MARQUE_SERVICES_DEMO})`;
export const INTITULE_BP_DEMO = `Business plan bancable (${MARQUE_SERVICES_DEMO})`;
/** Prix de démonstration (le produit n'en fournit aucun) : jamais une donnée de cabinet. */
export const PRIX_FLASH_DEMO = {
  montant: 1_000_000,
  devise: "XOF",
  commentaire: MARQUE_SERVICES_DEMO,
};
export const GUICHETS_DEMO = [
  {
    nom: `Guichet fictif A - banque commerciale (${MARQUE_SERVICES_DEMO}, à valider)`,
    type: "banque",
    pays: ["CI"],
    secteurs: [],
    filieres: [],
    tailles: [],
    objets: ["investissement", "bfr"],
    devises: ["XOF"],
    montant_min: 10_000_000,
    montant_max: 200_000_000,
    devise_montant: "XOF",
    date_limite: null,
    description: "Guichet FICTIF créé par le seed de démonstration : aucune source réelle.",
    actif: true,
  },
  {
    nom: `Guichet fictif B - programme de soutien (${MARQUE_SERVICES_DEMO}, à valider)`,
    type: "programme_public",
    pays: [],
    secteurs: [],
    filieres: ["cacao", "anacarde"],
    tailles: [],
    objets: ["croissance", "export"],
    devises: [],
    montant_min: null,
    montant_max: null,
    devise_montant: null,
    date_limite: null,
    description: "Guichet FICTIF créé par le seed de démonstration : aucune source réelle.",
    actif: true,
  },
] as const;

/**
 * Comptes et client sur lesquels portent les données (les comptes du seed par défaut ; les tests
 * passent ceux d'un cabinet de test pour ne pas créer le cabinet de démonstration dans la base partagée).
 */
export interface IdentitesServicesCandidatsDemo {
  associe: string;
  directeur: string;
  chef: string;
  clientRaisonSociale: string;
}

export const IDENTITES_SERVICES_CANDIDATS_DEMO: IdentitesServicesCandidatsDemo = {
  associe: emailAbidjan("associe"),
  directeur: emailAbidjan("directeur.mission"),
  chef: emailAbidjan("chef.mission"),
  clientRaisonSociale: CLIENT_PORTAIL_DEMO,
};

export interface ResumeServicesCandidatsDemo {
  /** Étapes réellement écrites par cet appel (vide : tout existait déjà). */
  creees: string[];
}

interface ServiceLu {
  code: string;
  methode: { version_id: string } | null;
  type_mission: { id: string } | null;
}

export async function semerServicesCandidatsDemo(
  database: Database,
  config: Config,
  identites: IdentitesServicesCandidatsDemo = IDENTITES_SERVICES_CANDIDATS_DEMO,
): Promise<ResumeServicesCandidatsDemo> {
  const app = await buildApp({ ...config, NODE_ENV: "test", TOTP_REQUIS: "non" }, database);
  const creees: string[] = [];
  try {
    const associe = await ouvrirSession(app, identites.associe, "");
    const directeur = await ouvrirSession(app, identites.directeur, "");
    const chef = await ouvrirSession(app, identites.chef, "");
    const identifiant = async (s: typeof associe) => {
      const moi = await s.get("/api/auth/moi");
      attendre(200, moi, "profil");
      return moi.json().utilisateur.id as string;
    };
    const directeurId = await identifiant(directeur);
    const chefId = await identifiant(chef);

    const lus = await associe.get("/api/services-candidats");
    attendre(200, lus, "services candidats");
    const flash = (lus.json().elements as { code: string; prix: { personnalise: boolean } }[]).find(
      (x) => x.code === "diagnostic_flash",
    );
    if (!flash?.prix.personnalise) {
      attendre(
        200,
        await associe.put("/api/services-candidats/diagnostic_flash/prix", PRIX_FLASH_DEMO),
        "prix de démonstration du diagnostic flash",
      );
      creees.push("prix_flash");
    }
    for (const [code] of [["diagnostic_flash"], ["business_plan_bancable"]]) {
      const activation = await associe.post("/api/services-candidats/activer", { service: code });
      attendre(200, activation, `activation du type ${code}`);
      if (activation.json().types_crees > 0) creees.push(`type_${code}`);
    }

    const clients = await associe.get(
      `/api/clients?q=${encodeURIComponent(identites.clientRaisonSociale)}&limite=10`,
    );
    attendre(200, clients, "clients");
    const client = (clients.json().elements as { id: string; raison_sociale: string }[]).find(
      (c) => c.raison_sociale === identites.clientRaisonSociale,
    );
    if (!client) {
      throw new Error(
        `Client « ${identites.clientRaisonSociale} » introuvable : lancer db:seed-demo.`,
      );
    }

    const services = await associe.get("/api/services-candidats");
    attendre(200, services, "services candidats");
    const existantes = await associe.get(`/api/missions?client_id=${client.id}&limite=100`);
    attendre(200, existantes, "missions du client");
    const intitules = new Set(
      (existantes.json().elements as { intitule: string }[]).map((m) => m.intitule),
    );
    const missions: [string, string][] = [
      ["diagnostic_flash", INTITULE_FLASH_DEMO],
      ["business_plan_bancable", INTITULE_BP_DEMO],
    ];
    for (const [code, intitule] of missions) {
      if (intitules.has(intitule)) continue;
      const service = (services.json().elements as ServiceLu[]).find((s) => s.code === code);
      if (!service?.methode || !service.type_mission) {
        throw new Error(`Service « ${code} » incomplet : méthode ou type de mission absent.`);
      }
      const mission = await associe.post("/api/missions", {
        intitule,
        client_id: client.id,
        type_mission_id: service.type_mission.id,
        directeur_id: directeurId,
        chef_id: chefId,
      });
      attendre(201, mission, `mission ${code}`);
      const lien = await chef.put(`/api/missions/${mission.json().id}/methode`, {
        version_id: service.methode.version_id,
        contexte: {},
        motif: `${MARQUE_SERVICES_DEMO} : mission créée depuis le service candidat.`,
      });
      attendre(200, lien, `méthode de la mission ${code}`);
      creees.push(`mission_${code}`);
    }

    const guichets = await associe.get("/api/guichets-financement?limite=200");
    attendre(200, guichets, "guichets");
    const noms = new Set((guichets.json().elements as { nom: string }[]).map((g) => g.nom));
    for (const g of GUICHETS_DEMO) {
      if (noms.has(g.nom)) continue;
      attendre(201, await associe.post("/api/guichets-financement", g), "guichet fictif");
      creees.push("guichet");
    }
  } finally {
    await app.close();
  }
  return { creees };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const config = configDemo();
  const database = createDatabase(config);
  semerServicesCandidatsDemo(database, config)
    .then((r) =>
      console.log(
        r.creees.length
          ? `${NOM_CABINET_ABIDJAN} : services candidats semés (${r.creees.join(", ")}).`
          : "Services candidats déjà semés : rien n'a été écrit.",
      ),
    )
    .catch((error: Error) => {
      console.error(`Échec du seed des services candidats : ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => database.close());
}
