import { describe, expect, it } from "vitest";
import { ErreurApi, MESSAGE_INATTENDU, MESSAGE_ORIGINE_REFUSEE } from "./api";
import {
  CHEMIN_COMPTES_DEMO,
  CHEMIN_CONNEXION_DEMO,
  connexionDemoReussie,
  espaceDuCompte,
  grouperComptesDemo,
  libelleRoles,
  lireComptesDemo,
  MAX_COMPTES_DEMO,
  MESSAGE_CONNEXION_DEMO_INATTENDUE,
  MESSAGE_CONNEXION_DEMO_INDISPONIBLE,
  messageErreurConnexionDemo,
  TITRE_ESPACE_CABINET,
  TITRE_ESPACE_PORTAIL,
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

  it("écarte les comptes invalides, les rôles inconnus, les familles mélangées, les doublons", () => {
    const comptes = lireComptesDemo({
      elements: [
        awa,
        { ...awa, email: "ASSOCIE@lagune-conseil.test" }, // doublon (casse)
        { email: "sans-arobase", nom: "X", roles: ["consultant"] },
        { email: "a b@lagune-conseil.test", nom: "X", roles: ["consultant"] },
        { email: `${"a".repeat(250)}@x.test`, nom: "X", roles: ["consultant"] },
        { email: "vide@lagune-conseil.test", nom: "  ", roles: ["consultant"] },
        { email: "long@lagune-conseil.test", nom: "x".repeat(201), roles: ["consultant"] },
        {
          email: "melange@lagune-conseil.test",
          nom: "Mélange",
          roles: ["consultant", "client_dirigeant"],
        },
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

  it("accepte les comptes du portail client (rôles client)", () => {
    expect(
      lireComptesDemo({
        elements: [
          {
            email: "dirigeant.client@lagune-conseil.test",
            nom: "Jean-Baptiste Kouadio",
            roles: ["client_dirigeant"],
          },
          {
            email: "investisseur.client@lagune-conseil.test",
            nom: "Moussa Coulibaly",
            roles: ["client_investisseur"],
          },
        ],
      }),
    ).toEqual([
      {
        email: "dirigeant.client@lagune-conseil.test",
        nom: "Jean-Baptiste Kouadio",
        roles: ["client_dirigeant"],
      },
      {
        email: "investisseur.client@lagune-conseil.test",
        nom: "Moussa Coulibaly",
        roles: ["client_investisseur"],
      },
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
    expect(libelleRoles(["client_dirigeant"])).toBe("Dirigeant client");
    expect(libelleRoles(["client_contributeur"])).toBe("Contributeur client");
    expect(libelleRoles(["client_investisseur"])).toBe("Investisseur");
  });

  it("espace d'un compte : portail pour les seuls rôles client, cabinet sinon", () => {
    expect(espaceDuCompte({ roles: ["client_dirigeant"] })).toBe("portail");
    expect(espaceDuCompte({ roles: ["client_contributeur", "client_investisseur"] })).toBe(
      "portail",
    );
    expect(espaceDuCompte({ roles: ["associe"] })).toBe("cabinet");
    expect(espaceDuCompte({ roles: [] })).toBe("cabinet");
  });

  it("deux groupes toujours présents, cabinet puis portail, dans l'ordre de l'API", () => {
    const comptes = [
      awa,
      {
        email: "dirigeant.client@lagune-conseil.test",
        nom: "Jean",
        roles: ["client_dirigeant" as const],
      },
      { email: "consultant@lagune-conseil.test", nom: "Koffi", roles: ["consultant" as const] },
      {
        email: "contributeur.client@lagune-conseil.test",
        nom: "Nadège",
        roles: ["client_contributeur" as const],
      },
    ];
    const [cabinet, portail] = grouperComptesDemo(comptes as never);
    expect([cabinet.espace, cabinet.titre]).toEqual(["cabinet", TITRE_ESPACE_CABINET]);
    expect([portail.espace, portail.titre]).toEqual(["portail", TITRE_ESPACE_PORTAIL]);
    expect(cabinet.comptes.map((c) => c.nom)).toEqual(["Awa Koné", "Koffi"]);
    expect(portail.comptes.map((c) => c.nom)).toEqual(["Jean", "Nadège"]);
    expect(TITRE_ESPACE_CABINET).toBe("Espace cabinet");
    expect(TITRE_ESPACE_PORTAIL).toBe("Espace client (portail)");
  });

  it("groupe du portail vide tant que le seed du portail n'a pas été lancé", () => {
    const [cabinet, portail] = grouperComptesDemo([awa] as never);
    expect(cabinet.comptes).toHaveLength(1);
    expect(portail.comptes).toEqual([]);
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
