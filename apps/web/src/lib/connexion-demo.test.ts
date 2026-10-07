import { describe, expect, it } from "vitest";
import { ErreurApi, MESSAGE_INATTENDU, MESSAGE_ORIGINE_REFUSEE } from "./api";
import {
  CHEMIN_COMPTES_DEMO,
  CHEMIN_CONNEXION_DEMO,
  connexionDemoReussie,
  libelleRoles,
  lireComptesDemo,
  MAX_COMPTES_DEMO,
  MESSAGE_CONNEXION_DEMO_INATTENDUE,
  MESSAGE_CONNEXION_DEMO_INDISPONIBLE,
  messageErreurConnexionDemo,
} from "./connexion-demo";

const awa = { email: "associe@lagune-conseil.test", nom: "Awa Koné", roles: ["associe"] };

describe("lireComptesDemo", () => {
  it("garde e-mail, nom et rôles des comptes valides, dans l'ordre de l'API", () => {
    expect(
      lireComptesDemo({
        elements: [
          awa,
          { email: "consultant@lagune-conseil.test", nom: " Koffi ", roles: ["consultant"] },
        ],
      }),
    ).toEqual([
      awa,
      { email: "consultant@lagune-conseil.test", nom: "Koffi", roles: ["consultant"] },
    ]);
  });

  it("ne recopie aucun champ imprévu (identifiant, haché…)", () => {
    const [compte] = lireComptesDemo({
      elements: [{ ...awa, id: "u-1", mot_de_passe_hash: "scrypt$x", cabinet_id: "c-1" }],
    })!;
    expect(Object.keys(compte!).sort()).toEqual(["email", "nom", "roles"]);
  });

  it("forme inattendue : null (aucun bloc affiché)", () => {
    for (const corps of [
      undefined,
      null,
      "texte",
      42,
      [],
      {},
      { elements: "x" },
      { comptes: [awa] },
    ]) {
      expect(lireComptesDemo(corps)).toBeNull();
    }
  });

  it("liste vide servie par l'API : bloc affiché sans compte (seed à lancer)", () => {
    expect(lireComptesDemo({ elements: [] })).toEqual([]);
  });

  it("écarte les comptes invalides, les rôles inconnus ou client, les doublons", () => {
    const comptes = lireComptesDemo({
      elements: [
        awa,
        { ...awa, email: "ASSOCIE@lagune-conseil.test" }, // doublon (casse)
        { email: "sans-arobase", nom: "X", roles: ["consultant"] },
        { email: "a b@lagune-conseil.test", nom: "X", roles: ["consultant"] },
        { email: `${"a".repeat(250)}@x.test`, nom: "X", roles: ["consultant"] },
        { email: "vide@lagune-conseil.test", nom: "  ", roles: ["consultant"] },
        { email: "long@lagune-conseil.test", nom: "x".repeat(201), roles: ["consultant"] },
        { email: "client@lagune-conseil.test", nom: "Client", roles: ["client_dirigeant"] },
        { email: "inconnu@lagune-conseil.test", nom: "Inconnu", roles: ["pirate"] },
        {
          email: "mixte@lagune-conseil.test",
          nom: "Mixte",
          roles: ["pirate", "gestionnaire", "gestionnaire"],
        },
        { email: "roles@lagune-conseil.test", nom: "Sans rôles", roles: "associe" },
        "texte",
        null,
      ],
    });
    expect(comptes).toEqual([
      awa,
      { email: "mixte@lagune-conseil.test", nom: "Mixte", roles: ["gestionnaire"] },
    ]);
  });

  it(`au plus ${MAX_COMPTES_DEMO} comptes`, () => {
    const elements = Array.from({ length: 80 }, (_, i) => ({
      email: `c${i}@lagune-conseil.test`,
      nom: `Compte ${i}`,
      roles: ["consultant"],
    }));
    expect(lireComptesDemo({ elements })).toHaveLength(MAX_COMPTES_DEMO);
  });
});

describe("libellés et réponses", () => {
  it("rôles en clair, en français", () => {
    expect(libelleRoles(["associe"])).toBe("Associé");
    expect(libelleRoles(["gestionnaire", "expert_metier"])).toBe(
      "Gestionnaire administratif et financier, Expert métier",
    );
  });

  it("seule une session ouverte en un temps est acceptée", () => {
    expect(connexionDemoReussie({ ok: true, etape: "connecte" })).toBe(true);
    for (const corps of [
      undefined,
      {},
      { ok: true },
      { ok: false, etape: "2fa_requise", defi: "x".repeat(40) },
      { ok: "true", etape: "connecte" },
    ]) {
      expect(connexionDemoReussie(corps)).toBe(false);
    }
  });

  it("chemins sous /api/auth (relais du web, garde d'origine de l'API)", () => {
    expect(CHEMIN_COMPTES_DEMO).toBe("/api/auth/comptes-demo");
    expect(CHEMIN_CONNEXION_DEMO).toBe("/api/auth/connexion-demo");
  });
});

describe("messageErreurConnexionDemo", () => {
  it("reprend les messages français de l'API (compte inconnu, 2FA, limiteur, réseau)", () => {
    for (const [code, statut, message] of [
      ["COMPTE_DEMO_INCONNU", 401, "Compte de démonstration inconnu ou indisponible."],
      ["CONNEXION_RAPIDE_2FA", 403, "Ce compte est protégé par la double authentification."],
      ["TROP_DE_TENTATIVES", 429, "Trop de tentatives. Réessayez dans quelques minutes."],
      ["RESEAU_INDISPONIBLE", 0, "Connexion au serveur impossible."],
    ] as const) {
      expect(messageErreurConnexionDemo(new ErreurApi(code, message, statut))).toBe(message);
    }
  });

  it("cas propres à la connexion rapide", () => {
    expect(
      messageErreurConnexionDemo(new ErreurApi("INTROUVABLE", "Ressource introuvable.", 404)),
    ).toBe(MESSAGE_CONNEXION_DEMO_INDISPONIBLE);
    expect(
      messageErreurConnexionDemo(new ErreurApi("ORIGINE_REFUSEE", "Requête refusée.", 403)),
    ).toBe(MESSAGE_ORIGINE_REFUSEE);
    expect(
      messageErreurConnexionDemo(new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400)),
    ).toBe(MESSAGE_CONNEXION_DEMO_INATTENDUE);
    expect(messageErreurConnexionDemo(new Error("boom"))).toBe(MESSAGE_INATTENDU);
  });
});
