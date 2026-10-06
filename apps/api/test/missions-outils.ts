import type { Role } from "@missionpilot/shared";
import { cabinetTest, type Api, type CabinetTest } from "./api.js";
import type { Contexte } from "./helpers.js";

export type ApiUtilisateur = Api & { utilisateurId: string };

export interface CabinetMissions extends CabinetTest {
  clientId: string;
  /** Code de grade → identifiant. */
  grades: Record<string, string>;
  /** Type « plan stratégique » du catalogue conseil semé. */
  typePlanId: string;
  directeur: ApiUtilisateur;
  chef: ApiUtilisateur;
  /** Collaborateurs internes par code de grade (un par grade). */
  collaborateurs: Record<string, string>;
}

/** Coût journalier FCFA des collaborateurs de test, par grade. */
export const COUTS_TEST: Record<string, number> = {
  junior: 50_000,
  senior: 90_000,
  manager: 150_000,
  associe: 300_000,
};

function attendre(statut: number, r: { statusCode: number; body: string }, quoi: string) {
  if (r.statusCode !== statut) throw new Error(`${quoi} : ${r.statusCode} ${r.body}`);
}

/** Cabinet prêt pour les missions : catalogue conseil, client, collaborateurs avec coûts. */
export async function preparerCabinet(ctx: Contexte, nom: string): Promise<CabinetMissions> {
  const c = await cabinetTest(ctx, nom);
  attendre(200, await c.associe.post("/api/catalogue/semer-conseil"), "semis");
  const client = await c.associe.post("/api/clients", { raison_sociale: `Client de ${nom}` });
  attendre(201, client, "client");
  const grades = Object.fromEntries(
    (await c.associe.get("/api/grades"))
      .json()
      .elements.map((g: { code: string; id: string }) => [g.code, g.id]),
  ) as Record<string, string>;
  const types = (await c.associe.get("/api/types-mission")).json().elements as {
    code: string;
    id: string;
  }[];
  const collaborateurs: Record<string, string> = {};
  for (const [code, cout] of Object.entries(COUTS_TEST)) {
    const r = await c.associe.post("/api/collaborateurs", {
      nom: `${code} de ${nom}`,
      grade_id: grades[code],
    });
    attendre(201, r, "collaborateur");
    collaborateurs[code] = r.json().id;
    attendre(
      201,
      await c.associe.post(`/api/collaborateurs/${r.json().id}/couts`, {
        cout_journalier: cout,
        devise: "XOF",
        depuis_le: "2026-01-01",
      }),
      "coûts",
    );
  }
  return {
    ...c,
    clientId: client.json().id,
    grades,
    typePlanId: (types.find((t) => t.code === "plan_strategique") as { id: string }).id,
    directeur: await c.avecRoles(["directeur_mission"]),
    chef: await c.avecRoles(["chef_mission"]),
    collaborateurs,
  };
}

/** Crée une mission depuis le type plan stratégique (directeur et chef désignés). */
export async function creerMission(
  c: CabinetMissions,
  corps: Record<string, unknown> = {},
  par: Api = c.associe,
): Promise<Record<string, unknown> & { id: string }> {
  const r = await par.post("/api/missions", {
    intitule: "Plan stratégique 2027-2031",
    client_id: c.clientId,
    type_mission_id: c.typePlanId,
    directeur_id: c.directeur.utilisateurId,
    chef_id: c.chef.utilisateurId,
    date_debut: "2026-11-02",
    date_fin: "2027-01-29",
    ...corps,
  });
  attendre(201, r, "mission");
  return r.json();
}

/** Mission signée : budget initial figé. */
export async function creerMissionSignee(
  c: CabinetMissions,
  corps: Record<string, unknown> = {},
  signature: Record<string, unknown> = {},
): Promise<{ id: string; signature: Record<string, unknown> }> {
  const m = await creerMission(c, corps);
  const s = await c.directeur.post(`/api/missions/${m.id}/signer`, {
    date_signature: "2026-10-01",
    ...signature,
  });
  attendre(200, s, "signature");
  return { id: m.id, signature: s.json() };
}

export const TOUS_LES_ROLES: readonly Role[] = [
  "associe",
  "directeur_mission",
  "chef_mission",
  "consultant",
  "ressources",
  "gestionnaire",
  "expert_metier",
  "expert_externe",
];
