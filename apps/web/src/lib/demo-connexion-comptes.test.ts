import { describe, expect, it } from "vitest";
import { ROLE_LIBELLES, ROLES, ROLES_CLIENT } from "@missionpilot/shared";
import { TITRE_GROUPE_EQUIPE, TITRE_GROUPE_PORTAIL, type DemoCompte } from "./demo-connexion";
import {
  CLE_ROLE_AUTRE,
  espacesDisponibles,
  filtreInitial,
  libelleAutresRoles,
  libelleDetailCabinet,
  libelleRole,
  LIBELLE_ROLE_AUTRE,
  optionsRoles,
  repartitionComptes,
  rolePrincipal,
  transitionFiltre,
  vueComptes,
} from "./demo-connexion-comptes";

const compte = (email: string, portail = false, roles: string[] = ["associe"]): DemoCompte => ({
  email,
  nom: `Nom ${email}`,
  roles,
  portail,
});

/** Nombre de comptes équipe par rôle de ROLES (même ordre) : 19 au total. */
const EQUIPE_PAR_ROLE = [3, 3, 2, 3, 2, 2, 2, 2];
/** Nombre de comptes portail par rôle de ROLES_CLIENT (même ordre) : 24 au total. */
const PORTAIL_PAR_ROLE = [10, 8, 6];

/** Jeu de test de volume : 43 comptes, 19 équipe sur 8 rôles, 24 portail sur 3 rôles. */
function jeuVolume(): DemoCompte[] {
  const equipe = ROLES.flatMap((role, i) =>
    Array.from({ length: EQUIPE_PAR_ROLE[i]! }, (_, k) =>
      compte(`equipe-${i}-${k}@demo.test`, false, [role]),
    ),
  );
  const portail = ROLES_CLIENT.flatMap((role, i) =>
    Array.from({ length: PORTAIL_PAR_ROLE[i]! }, (_, k) =>
      compte(`portail-${i}-${k}@demo.test`, true, [role]),
    ),
  );
  return [...equipe, ...portail];
}

describe("rolePrincipal", () => {
  it("prend le premier rôle dans l'ordre ROLES", () => {
    expect(rolePrincipal(compte("a@x.test", false, ["consultant", "associe"]))).toBe("associe");
  });

  it("un rôle client seul donne ce rôle client", () => {
    expect(rolePrincipal(compte("a@x.test", true, ["client_contributeur"]))).toBe(
      "client_contributeur",
    );
  });

  it("un rôle de ROLES passe avant un rôle de ROLES_CLIENT", () => {
    expect(rolePrincipal(compte("a@x.test", false, ["client_dirigeant", "expert_externe"]))).toBe(
      "expert_externe",
    );
  });

  it("compte multi-rôles : le rang le plus petit l'emporte", () => {
    expect(
      rolePrincipal(compte("a@x.test", false, ["gestionnaire", "expert_externe", "consultant"])),
    ).toBe("consultant");
  });

  it("rôle inconnu seul ou liste vide : autre", () => {
    expect(rolePrincipal(compte("a@x.test", false, ["fantome"]))).toBe(CLE_ROLE_AUTRE);
    expect(rolePrincipal(compte("a@x.test", false, []))).toBe(CLE_ROLE_AUTRE);
  });

  it("un rôle inconnu ne masque pas un rôle connu", () => {
    expect(rolePrincipal(compte("a@x.test", false, ["fantome", "chef_mission"]))).toBe(
      "chef_mission",
    );
  });
});

describe("libelleRole", () => {
  it("renvoie le libellé français de ROLE_LIBELLES pour chaque rôle connu", () => {
    for (const cle of Object.keys(ROLE_LIBELLES)) {
      expect(libelleRole(cle)).toBe(ROLE_LIBELLES[cle as keyof typeof ROLE_LIBELLES]);
    }
  });

  it("quelques libellés en clair", () => {
    expect(libelleRole("associe")).toBe("Associé");
    expect(libelleRole("gestionnaire")).toBe("Gestionnaire administratif et financier");
    expect(libelleRole("client_investisseur")).toBe("Investisseur");
  });

  it("rôle inconnu : Autres comptes", () => {
    expect(libelleRole("fantome")).toBe(LIBELLE_ROLE_AUTRE);
    expect(libelleRole(CLE_ROLE_AUTRE)).toBe("Autres comptes");
    expect(libelleRole("constructor")).toBe("Autres comptes");
  });
});

describe("repartitionComptes", () => {
  it("liste vide : zéro partout", () => {
    expect(repartitionComptes([])).toEqual({ total: 0, equipe: 0, portail: 0 });
  });

  it("compte équipe et compte portail", () => {
    expect(
      repartitionComptes([
        compte("a@x.test"),
        compte("b@x.test"),
        compte("p@x.test", true, ["client_dirigeant"]),
      ]),
    ).toEqual({ total: 3, equipe: 2, portail: 1 });
  });
});

describe("libelleDetailCabinet", () => {
  it("deux espaces : total, puis répartition entre parenthèses", () => {
    expect(libelleDetailCabinet(jeuVolume())).toBe("43 comptes (19 équipe, 24 client)");
  });

  it("un seul espace : le nombre seul", () => {
    const equipe = [compte("a@x.test"), compte("b@x.test")];
    const portail = [compte("p@x.test", true, ["client_dirigeant"])];
    expect(libelleDetailCabinet(equipe)).toBe("2 comptes");
    expect(libelleDetailCabinet(portail)).toBe("1 compte");
    expect(libelleDetailCabinet(Array.from({ length: 12 }, (_, i) => compte(`e${i}@x.test`)))).toBe(
      "12 comptes",
    );
  });

  it("un seul compte : singulier", () => {
    expect(libelleDetailCabinet([compte("a@x.test")])).toBe("1 compte");
  });

  it("aucun compte : Aucun compte", () => {
    expect(libelleDetailCabinet([])).toBe("Aucun compte");
  });
});

describe("espacesDisponibles", () => {
  it("équipe puis portail quand les deux ont des comptes", () => {
    expect(
      espacesDisponibles([compte("p@x.test", true, ["client_dirigeant"]), compte("a@x.test")]),
    ).toEqual([
      { espace: "equipe", titre: TITRE_GROUPE_EQUIPE, nombre: 1 },
      { espace: "portail", titre: TITRE_GROUPE_PORTAIL, nombre: 1 },
    ]);
  });

  it("espace vide omis : seul le portail", () => {
    expect(espacesDisponibles([compte("p@x.test", true, ["client_dirigeant"])])).toEqual([
      { espace: "portail", titre: TITRE_GROUPE_PORTAIL, nombre: 1 },
    ]);
  });

  it("seul l'équipe", () => {
    expect(espacesDisponibles([compte("a@x.test"), compte("b@x.test")])).toEqual([
      { espace: "equipe", titre: TITRE_GROUPE_EQUIPE, nombre: 2 },
    ]);
  });

  it("aucun compte : liste vide", () => {
    expect(espacesDisponibles([])).toEqual([]);
  });
});

describe("filtreInitial", () => {
  it("équipe d'abord quand elle a des comptes", () => {
    expect(
      filtreInitial([compte("p@x.test", true, ["client_dirigeant"]), compte("a@x.test")]),
    ).toEqual({ espace: "equipe", role: null });
  });

  it("sinon le portail", () => {
    expect(filtreInitial([compte("p@x.test", true, ["client_dirigeant"])])).toEqual({
      espace: "portail",
      role: null,
    });
  });

  it("cabinet vide : équipe", () => {
    expect(filtreInitial([])).toEqual({ espace: "equipe", role: null });
  });
});

describe("transitionFiltre", () => {
  it("changer d'espace efface le rôle retenu", () => {
    expect(
      transitionFiltre(
        { espace: "equipe", role: "associe" },
        { type: "espace", espace: "portail" },
      ),
    ).toEqual({ espace: "portail", role: null });
  });

  it("même espace : le même objet est renvoyé", () => {
    const filtre = { espace: "equipe" as const, role: "associe" };
    expect(transitionFiltre(filtre, { type: "espace", espace: "equipe" })).toBe(filtre);
  });

  it("second clic sur le rôle retenu le retire", () => {
    expect(
      transitionFiltre({ espace: "equipe", role: "associe" }, { type: "role", role: "associe" }),
    ).toEqual({ espace: "equipe", role: null });
  });

  it("clic sur un autre rôle remplace le rôle retenu", () => {
    expect(
      transitionFiltre({ espace: "equipe", role: "associe" }, { type: "role", role: "consultant" }),
    ).toEqual({ espace: "equipe", role: "consultant" });
  });

  it("premier clic sur un rôle sans rôle retenu", () => {
    expect(
      transitionFiltre(
        { espace: "portail", role: null },
        { type: "role", role: "client_dirigeant" },
      ),
    ).toEqual({ espace: "portail", role: "client_dirigeant" });
  });
});

describe("optionsRoles", () => {
  it("équipe : ordre de ROLES avec les nombres, sans les rôles client", () => {
    const options = optionsRoles(jeuVolume(), "equipe");
    expect(options.map((o) => o.cle)).toEqual([...ROLES]);
    expect(options.map((o) => o.nombre)).toEqual(EQUIPE_PAR_ROLE);
    expect(options.map((o) => o.libelle)).toEqual(ROLES.map((r) => ROLE_LIBELLES[r]));
  });

  it("portail : ordre de ROLES_CLIENT avec les nombres, sans les rôles équipe", () => {
    const options = optionsRoles(jeuVolume(), "portail");
    expect(options.map((o) => o.cle)).toEqual([...ROLES_CLIENT]);
    expect(options.map((o) => o.nombre)).toEqual(PORTAIL_PAR_ROLE);
  });

  it("rôle inconnu de l'équipe : groupe autre en dernier", () => {
    const options = optionsRoles(
      [compte("b@x.test", false, ["fantome"]), compte("a@x.test", false, ["associe"])],
      "equipe",
    );
    expect(options).toEqual([
      { cle: "associe", libelle: "Associé", nombre: 1 },
      { cle: CLE_ROLE_AUTRE, libelle: LIBELLE_ROLE_AUTRE, nombre: 1 },
    ]);
  });

  it("espace sans compte : liste vide", () => {
    expect(optionsRoles([compte("a@x.test")], "portail")).toEqual([]);
  });
});

describe("vueComptes", () => {
  const melange = [
    compte("a@x.test", false, ["associe"]),
    compte("p@x.test", true, ["client_dirigeant"]),
  ];

  it("ne renvoie que les comptes de l'espace retenu", () => {
    const groupes = vueComptes(melange, { espace: "equipe", role: null });
    expect(groupes.flatMap((g) => g.comptes.map((c) => c.email))).toEqual(["a@x.test"]);

    const portail = vueComptes(melange, { espace: "portail", role: null });
    expect(portail.flatMap((g) => g.comptes.map((c) => c.email))).toEqual(["p@x.test"]);
  });

  it("groupes dans l'ordre des rôles, quel que soit l'ordre d'entrée", () => {
    const groupes = vueComptes(
      [
        compte("c1@x.test", false, ["consultant"]),
        compte("a@x.test", false, ["associe"]),
        compte("c2@x.test", false, ["consultant"]),
      ],
      { espace: "equipe", role: null },
    );
    expect(groupes.map((g) => g.cle)).toEqual(["associe", "consultant"]);
    expect(groupes.map((g) => g.libelle)).toEqual(["Associé", "Consultant"]);
  });

  it("tri interne des comptes conservé", () => {
    const groupes = vueComptes(
      [compte("c@x.test", false, ["consultant"]), compte("a@x.test", false, ["consultant"])],
      { espace: "equipe", role: null },
    );
    expect(groupes[0]?.comptes.map((c) => c.email)).toEqual(["c@x.test", "a@x.test"]);
  });

  it("filtre de rôle : seul le groupe retenu", () => {
    const groupes = vueComptes(jeuVolume(), { espace: "equipe", role: "consultant" });
    expect(groupes.map((g) => g.cle)).toEqual(["consultant"]);
    expect(groupes[0]?.comptes).toHaveLength(EQUIPE_PAR_ROLE[3]!);
  });

  it("rôle de filtre absent de l'espace : tous les groupes de l'espace", () => {
    const groupes = vueComptes(jeuVolume(), { espace: "portail", role: "associe" });
    expect(groupes.map((g) => g.cle)).toEqual([...ROLES_CLIENT]);
  });

  it("rôle client retenu dans le portail", () => {
    const groupes = vueComptes(jeuVolume(), { espace: "portail", role: "client_contributeur" });
    expect(groupes.map((g) => g.cle)).toEqual(["client_contributeur"]);
    expect(groupes[0]?.comptes).toHaveLength(PORTAIL_PAR_ROLE[1]!);
  });

  it("espace sans compte : liste vide", () => {
    expect(vueComptes([compte("a@x.test")], { espace: "portail", role: null })).toEqual([]);
  });
});

describe("libelleAutresRoles", () => {
  it("rôles du compte autres que le principal, en clair", () => {
    expect(libelleAutresRoles(compte("a@x.test", false, ["associe", "consultant"]))).toBe(
      "Consultant",
    );
  });

  it("le principal est écarté même s'il n'est pas le premier de la liste", () => {
    expect(libelleAutresRoles(compte("a@x.test", false, ["consultant", "associe"]))).toBe(
      "Consultant",
    );
  });

  it("compte à un seul rôle : chaîne vide", () => {
    expect(libelleAutresRoles(compte("a@x.test", false, ["associe"]))).toBe("");
  });

  it("rôles inconnus écartés", () => {
    expect(
      libelleAutresRoles(compte("a@x.test", false, ["associe", "fantome", "gestionnaire"])),
    ).toBe("Gestionnaire administratif et financier");
  });

  it("compte sans rôle connu : chaîne vide", () => {
    expect(libelleAutresRoles(compte("a@x.test", false, ["fantome"]))).toBe("");
  });
});

describe("volume : 19 comptes équipe et 24 comptes portail", () => {
  it("8 groupes équipe, 3 groupes portail, 43 comptes sans perte ni doublon", () => {
    const comptes = jeuVolume();
    expect(comptes).toHaveLength(43);

    const equipe = vueComptes(comptes, { espace: "equipe", role: null });
    const portail = vueComptes(comptes, { espace: "portail", role: null });

    expect(equipe.map((g) => g.cle)).toEqual([...ROLES]);
    expect(portail.map((g) => g.cle)).toEqual([...ROLES_CLIENT]);

    const emailsVus = [...equipe, ...portail].flatMap((g) => g.comptes.map((c) => c.email));
    expect(emailsVus).toHaveLength(43);
    expect(new Set(emailsVus).size).toBe(43);
    expect([...emailsVus].sort()).toEqual(comptes.map((c) => c.email).sort());

    expect(equipe.reduce((s, g) => s + g.comptes.length, 0)).toBe(19);
    expect(portail.reduce((s, g) => s + g.comptes.length, 0)).toBe(24);
  });

  it("répartition et détail du cabinet", () => {
    const comptes = jeuVolume();
    expect(repartitionComptes(comptes)).toEqual({ total: 43, equipe: 19, portail: 24 });
    expect(libelleDetailCabinet(comptes)).toBe("43 comptes (19 équipe, 24 client)");
    expect(espacesDisponibles(comptes).map((e) => e.nombre)).toEqual([19, 24]);
  });

  it("options de filtre cohérentes avec les groupes", () => {
    const comptes = jeuVolume();
    expect(optionsRoles(comptes, "equipe").map((o) => o.nombre)).toEqual(EQUIPE_PAR_ROLE);
    expect(optionsRoles(comptes, "portail").map((o) => o.nombre)).toEqual(PORTAIL_PAR_ROLE);
  });
});
