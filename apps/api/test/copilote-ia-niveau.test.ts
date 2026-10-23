import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reponseCopiloteSchema } from "@missionpilot/shared";
import { cabinetTest, type CabinetTest } from "./api.js";
import { proprietaire, type Contexte } from "./helpers.js";
import { demarrerIa, serveurFactice, type ServeurFactice } from "./ia-outils.js";

/*
 * Copilote et niveau d'autonomie : sous N1, les outils d'ACTION ne sont pas envoyés au modèle de
 * langage (catalogue limité à la lecture) ; le journal d'échange compte les noms masqués sans
 * jamais les consigner.
 */

vi.setConfig({ testTimeout: 60_000 });

let serveur: ServeurFactice;
let ctx: Contexte;
let a: CabinetTest;

beforeAll(async () => {
  serveur = await serveurFactice();
  ctx = await demarrerIa(serveur.url);
  a = await cabinetTest(ctx, "Cabinet Copilote Niveau");
  expect((await a.associe.put("/api/ia/parametres", { ia_activee: true })).statusCode).toBe(200);
});
afterAll(async () => {
  await ctx.fermer();
  await serveur.fermer();
});
beforeEach(() => {
  serveur.requetes.length = 0;
  serveur.repondre(() => ({
    contenu: JSON.stringify({ outil: "aucun", parametres: {} }),
    usage: { prompt_tokens: 800, completion_tokens: 20 },
  }));
});

const consigne = () => JSON.stringify(serveur.requetes.at(-1)?.corps);
const plafonner = async (niveau: string | null) => {
  const r = await a.associe.put("/api/agents/copilote/restriction", {
    actif: true,
    niveau_max: niveau,
    motif: "Essai du catalogue envoyé au modèle",
  });
  expect(r.statusCode, r.body).toBe(200);
};

describe("catalogue envoyé au modèle selon le niveau", () => {
  it("sous N1 : aucun outil d'action dans la consigne", async () => {
    await plafonner("N1");
    const r = await a.associe.post("/api/copilote/messages", { message: "Bonjour" });
    expect(r.statusCode, r.body).toBe(200);
    reponseCopiloteSchema.parse(r.json());
    const c = consigne();
    expect(c).toContain("mes_taches");
    for (const outil of ["creer_tache", "ajouter_commentaire", "planifier_relance"]) {
      expect(c).not.toContain(outil);
    }
  });

  it("au niveau N2 : les outils d'action sont proposés au modèle", async () => {
    await plafonner(null);
    const r = await a.associe.post("/api/copilote/messages", { message: "Bonjour" });
    expect(r.statusCode, r.body).toBe(200);
    const c = consigne();
    expect(c).toContain("creer_tache");
    expect(c).toContain("ajouter_commentaire");
  });
});

describe("journal d'échange", () => {
  it("compte les noms masqués sans les consigner", async () => {
    const nom = "Zanzibar Holding Exemple";
    await proprietaire((cl) =>
      cl.query("INSERT INTO clients (cabinet_id, raison_sociale) VALUES ($1, $2)", [
        a.cabinetId,
        nom,
      ]),
    );
    const r = await a.associe.post("/api/copilote/messages", { message: `Résume ${nom}` });
    expect(r.statusCode, r.body).toBe(200);
    const ligne = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            "SELECT details FROM journal_audit WHERE cabinet_id = $1 AND action = 'copilote.echange' ORDER BY id DESC LIMIT 1",
            [a.cabinetId],
          )
        ).rows[0]?.details as Record<string, unknown>,
    );
    expect(ligne.termes_masques).toBe(1);
    expect(JSON.stringify(ligne)).not.toContain("Zanzibar");
    expect(consigne()).not.toContain("Zanzibar");
  });
});
