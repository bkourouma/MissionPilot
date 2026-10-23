import { afterEach, describe, expect, it, vi } from "vitest";
import { ErreurApi, MESSAGE_INATTENDU, MESSAGE_ORIGINE_REFUSEE } from "./api";
import {
  CHEMIN_DEMO,
  CHEMIN_DEMO_CONNEXION,
  CHEMIN_DEMO_CONNEXION_PLATEFORME,
  connecterCompteDemo,
  connecterSuperAdminDemo,
  connexionCompteReussie,
  ETAT_DEMO_INITIAL,
  grouperComptesCabinet,
  libelleNombreComptes,
  libelleRolesDemo,
  lireDemo,
  MAX_CABINETS_DEMO,
  MAX_COMPTES_PAR_CABINET_DEMO,
  MESSAGE_DEMO_COMPTE_INCONNU,
  MESSAGE_DEMO_DESACTIVEE,
  MESSAGE_DEMO_REFUSEE,
  MESSAGE_DEMO_REPONSE_INATTENDUE,
  MESSAGE_DEMO_TROP_DE_TENTATIVES,
  messageErreurDemo,
  transitionDemo,
  type DemoCompte,
} from "./demo-connexion";

const compte = (email: string, portail = false, roles: string[] = ["associe"]) => ({
  email,
  nom: `Nom ${email}`,
  roles,
  portail,
});

const corpsValide = {
  actif: true,
  superAdmin: { email: "root@demo.test", nom: "Admin Plateforme" },
  cabinets: [
    { id: "c1", nom: "Cabinet Alpha", comptes: [compte("a@alpha.test"), compte("p@x.test", true)] },
    { id: "c2", nom: "Cabinet Beta", comptes: [] },
  ],
};

describe("lireDemo", () => {
  it("lit une réponse valide", () => {
    const demo = lireDemo(corpsValide);
    expect(demo?.superAdmin).toEqual({ email: "root@demo.test", nom: "Admin Plateforme" });
    expect(demo?.cabinets).toHaveLength(2);
    expect(demo?.cabinets[0]?.comptes[1]).toEqual({
      email: "p@x.test",
      nom: "Nom p@x.test",
      roles: ["associe"],
      portail: true,
    });
  });

  it("super admin absent ou null : superAdmin null", () => {
    expect(lireDemo({ actif: true, superAdmin: null, cabinets: [] })?.superAdmin).toBeNull();
    expect(lireDemo({ actif: true, cabinets: [] })).toEqual({ superAdmin: null, cabinets: [] });
  });

  it("corps invalide, inactif ou sans cabinets : null", () => {
    for (const v of [null, undefined, "x", 3, [], {}, { actif: false, cabinets: [] }]) {
      expect(lireDemo(v)).toBeNull();
    }
    expect(lireDemo({ actif: true })).toBeNull();
    expect(lireDemo({ actif: true, cabinets: "x" })).toBeNull();
  });

  it("écarte les entrées mal formées sans rejeter le reste", () => {
    const demo = lireDemo({
      actif: true,
      superAdmin: { email: "pas-un-email", nom: "X" },
      cabinets: [
        null,
        { id: "", nom: "Sans id", comptes: [] },
        { id: "c1", nom: "  ", comptes: [] },
        { id: "c2", nom: "Sans comptes valides", comptes: "x" },
        {
          id: "c3",
          nom: " Bon ",
          comptes: [
            compte("ok@x.test"),
            { email: "mauvais", nom: "N", roles: [], portail: false },
            { email: "b@x.test", nom: "", roles: [], portail: false },
            { email: "c@x.test", nom: "N", roles: "associe", portail: false },
            { email: "d@x.test", nom: "N", roles: [], portail: "oui" },
            compte("OK@x.test"),
          ],
        },
      ],
    });
    expect(demo?.superAdmin).toBeNull();
    expect(demo?.cabinets.map((c) => c.id)).toEqual(["c3"]);
    expect(demo?.cabinets[0]?.nom).toBe("Bon");
    expect(demo?.cabinets[0]?.comptes.map((c) => c.email)).toEqual(["ok@x.test"]);
  });

  it("écarte les cabinets en double et les rôles non textuels", () => {
    const roles = ["associe", 4, "", "associe"] as unknown as string[];
    const demo = lireDemo({
      actif: true,
      cabinets: [
        { id: "c1", nom: "A", comptes: [compte("a@x.test", false, roles)] },
        { id: "c1", nom: "Doublon", comptes: [] },
      ],
    });
    expect(demo?.cabinets).toHaveLength(1);
    expect(demo?.cabinets[0]?.comptes[0]?.roles).toEqual(["associe"]);
  });

  it("ne recopie aucun champ imprévu", () => {
    const demo = lireDemo({
      actif: true,
      motDePasse: "secret",
      superAdmin: { email: "root@demo.test", nom: "Admin", id: "u1", mot_de_passe: "x" },
      cabinets: [
        {
          id: "c1",
          nom: "A",
          secret: "s",
          comptes: [{ ...compte("a@x.test"), mot_de_passe: "y", jeton: "z" }],
        },
      ],
    });
    const json = JSON.stringify(demo);
    expect(json).not.toMatch(/secret|mot_de_passe|motDePasse|jeton|"u1"/);
    expect(Object.keys(demo?.superAdmin ?? {}).sort()).toEqual(["email", "nom"]);
    expect(Object.keys(demo?.cabinets[0] ?? {}).sort()).toEqual(["comptes", "id", "nom"]);
    expect(Object.keys(demo?.cabinets[0]?.comptes[0] ?? {}).sort()).toEqual([
      "email",
      "nom",
      "portail",
      "roles",
    ]);
  });

  it("borne le nombre de cabinets, de comptes et la taille des textes", () => {
    const cabinets = Array.from({ length: MAX_CABINETS_DEMO + 10 }, (_, i) => ({
      id: `c${i}`,
      nom: `Cabinet ${i}`,
      comptes: [],
    }));
    expect(lireDemo({ actif: true, cabinets })?.cabinets).toHaveLength(MAX_CABINETS_DEMO);
    const comptes = Array.from({ length: MAX_COMPTES_PAR_CABINET_DEMO + 5 }, (_, i) =>
      compte(`u${i}@x.test`),
    );
    const demo = lireDemo({ actif: true, cabinets: [{ id: "c", nom: "A", comptes }] });
    expect(demo?.cabinets[0]?.comptes).toHaveLength(MAX_COMPTES_PAR_CABINET_DEMO);
    const long = "n".repeat(201);
    expect(
      lireDemo({ actif: true, cabinets: [{ id: "c", nom: long, comptes: [] }] })?.cabinets,
    ).toEqual([]);
    expect(
      lireDemo({ actif: true, cabinets: [{ id: "i".repeat(101), nom: "A", comptes: [] }] })
        ?.cabinets,
    ).toEqual([]);
    const rolesNombreux = Array.from({ length: 40 }, (_, i) => `role${i}`);
    const d2 = lireDemo({
      actif: true,
      cabinets: [{ id: "c", nom: "A", comptes: [compte("a@x.test", false, rolesNombreux)] }],
    });
    expect(d2?.cabinets[0]?.comptes[0]?.roles).toHaveLength(20);
  });
});

describe("libellés et groupes", () => {
  it("pluralise le nombre de comptes", () => {
    expect(libelleNombreComptes(0)).toBe("Aucun compte");
    expect(libelleNombreComptes(1)).toBe("1 compte");
    expect(libelleNombreComptes(12)).toBe("12 comptes");
  });

  it("libellés de rôles en français, rôle inconnu écarté", () => {
    expect(libelleRolesDemo(["associe"])).not.toBe("");
    expect(libelleRolesDemo(["associe"])).not.toBe("associe");
    expect(libelleRolesDemo(["role_inconnu"])).toBe("");
    expect(libelleRolesDemo(["role_inconnu", "associe", "__proto__"])).toBe(
      libelleRolesDemo(["associe"]),
    );
    expect(libelleRolesDemo([])).toBe("");
  });

  it("groupe l'équipe puis le portail et omet un groupe vide", () => {
    const comptes: DemoCompte[] = [
      compte("p1@x.test", true),
      compte("e1@x.test"),
      compte("e2@x.test"),
    ];
    const groupes = grouperComptesCabinet(comptes);
    expect(groupes.map((g) => g.titre)).toEqual(["Équipe du cabinet", "Espace client (portail)"]);
    expect(groupes[0]?.comptes.map((c) => c.email)).toEqual(["e1@x.test", "e2@x.test"]);
    expect(grouperComptesCabinet([compte("e@x.test")]).map((g) => g.espace)).toEqual(["equipe"]);
    expect(grouperComptesCabinet([compte("p@x.test", true)]).map((g) => g.espace)).toEqual([
      "portail",
    ]);
    expect(grouperComptesCabinet([])).toEqual([]);
  });
});

describe("transitionDemo", () => {
  it("choix, comptes d'un cabinet, retour avec focus sur la carte", () => {
    const e1 = transitionDemo(ETAT_DEMO_INITIAL, { type: "choisir_cabinet", cabinetId: "c1" });
    expect(e1).toEqual({ etape: "cabinet", cabinetId: "c1", focus: "c1" });
    const e2 = transitionDemo(e1, { type: "retour" });
    expect(e2).toEqual({ etape: "choix", cabinetId: null, focus: "c1" });
  });

  it("événements hors étape ignorés", () => {
    expect(transitionDemo(ETAT_DEMO_INITIAL, { type: "retour" })).toBe(ETAT_DEMO_INITIAL);
    const e1 = transitionDemo(ETAT_DEMO_INITIAL, { type: "choisir_cabinet", cabinetId: "c1" });
    expect(transitionDemo(e1, { type: "choisir_cabinet", cabinetId: "c2" })).toBe(e1);
  });
});

describe("messageErreurDemo", () => {
  const erreur = (statut: number, code: string, message = "Message de l'API.") =>
    new ErreurApi(code, message, statut);

  it("401 COMPTE_DEMO_INCONNU", () => {
    expect(messageErreurDemo(erreur(401, "COMPTE_DEMO_INCONNU"))).toBe(MESSAGE_DEMO_COMPTE_INCONNU);
  });
  it("403 : message de l'API, repli si vide", () => {
    expect(messageErreurDemo(erreur(403, "ACCES_REFUSE", "Ce compte utilise la 2FA."))).toBe(
      "Ce compte utilise la 2FA.",
    );
    expect(messageErreurDemo(new ErreurApi("X", " ", 403))).toBe(MESSAGE_DEMO_REFUSEE);
  });
  it("404 : démo désactivée", () => {
    expect(messageErreurDemo(erreur(404, "INTROUVABLE"))).toBe(MESSAGE_DEMO_DESACTIVEE);
  });
  it("429 : trop de tentatives", () => {
    expect(messageErreurDemo(erreur(429, "TROP_DE_TENTATIVES"))).toBe(
      MESSAGE_DEMO_TROP_DE_TENTATIVES,
    );
  });
  it("origine refusée, réseau, inattendu", () => {
    expect(messageErreurDemo(erreur(403, "ORIGINE_REFUSEE"))).toBe(MESSAGE_ORIGINE_REFUSEE);
    expect(messageErreurDemo(erreur(0, "RESEAU_INDISPONIBLE", "Réseau KO."))).toBe("Réseau KO.");
    expect(messageErreurDemo(new Error("boom"))).toBe(MESSAGE_INATTENDU);
    expect(messageErreurDemo("x")).toBe(MESSAGE_INATTENDU);
    expect(messageErreurDemo(erreur(400, "REQUETE_INVALIDE"))).toBe(
      MESSAGE_DEMO_REPONSE_INATTENDUE,
    );
    expect(messageErreurDemo(erreur(500, "SERVICE_INDISPONIBLE", "Indisponible."))).toBe(
      "Indisponible.",
    );
  });
});

describe("appels navigateur", () => {
  afterEach(() => vi.unstubAllGlobals());

  const simuler = (statut: number, corps: unknown) => {
    const fetchSimule = vi.fn(async () => new Response(JSON.stringify(corps), { status: statut }));
    vi.stubGlobal("fetch", fetchSimule);
    return fetchSimule;
  };

  it("chemins", () => {
    expect(CHEMIN_DEMO).toBe("/api/auth/demo");
    expect(CHEMIN_DEMO_CONNEXION).toBe("/api/auth/demo/connexion");
    expect(CHEMIN_DEMO_CONNEXION_PLATEFORME).toBe("/api/auth/demo/connexion-plateforme");
  });

  it("connecterCompteDemo : POST JSON exact", async () => {
    const f = simuler(200, { ok: true, etape: "connecte" });
    const corps = await connecterCompteDemo("c1", "a@alpha.test");
    expect(connexionCompteReussie(corps)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/demo/connexion");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ cabinetId: "c1", email: "a@alpha.test" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("connecterCompteDemo : une réponse 2FA n'est pas une réussite", async () => {
    simuler(200, { ok: true, etape: "code" });
    expect(connexionCompteReussie(await connecterCompteDemo("c1", "a@alpha.test"))).toBe(false);
    expect(connexionCompteReussie(undefined)).toBe(false);
  });

  it("connecterCompteDemo : erreur de l'API en ErreurApi", async () => {
    simuler(401, { erreur: { code: "COMPTE_DEMO_INCONNU", message: "Inconnu." } });
    await expect(connecterCompteDemo("c1", "x@x.test")).rejects.toMatchObject({
      statut: 401,
      code: "COMPTE_DEMO_INCONNU",
    });
  });

  it("connecterSuperAdminDemo : POST JSON exact et réponse vérifiée", async () => {
    const f = simuler(200, {
      ok: true,
      superAdmin: { id: "u1", email: "root@demo.test", nom: "A" },
    });
    expect(await connecterSuperAdminDemo("root@demo.test")).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/demo/connexion-plateforme");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ email: "root@demo.test" }));
  });

  it("connecterSuperAdminDemo : réponse inattendue = false ; 429 = erreur", async () => {
    simuler(200, { ok: true });
    expect(await connecterSuperAdminDemo("root@demo.test")).toBe(false);
    simuler(429, { erreur: { code: "TROP_DE_TENTATIVES", message: "Trop." } });
    await expect(connecterSuperAdminDemo("root@demo.test")).rejects.toMatchObject({ statut: 429 });
  });
});
