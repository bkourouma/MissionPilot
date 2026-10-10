import { describe, expect, it } from "vitest";
import { aPermission, ROLES, type Role } from "@missionpilot/shared";
import { PERMISSIONS_RUBRIQUE, sousPagesConnaissances } from "./capitalisation";
import {
  autorise,
  entreesAutorisees,
  entreesBarreBasse,
  estActive,
  NAVIGATION,
  sousPageActive,
  sousPagesAutorisees,
} from "./navigation";

const ids = (roles: Role[]) => entreesAutorisees(roles).map((e) => e.id);

/** Rubriques de la vague 1 (V3), déclarées avant leurs écrans. */
const V3 = ["methodes", "dossiers-clients", "agents-ia", "qualite"];

describe("table de navigation", () => {
  it("a des identifiants et des chemins uniques", () => {
    expect(new Set(NAVIGATION.map((e) => e.id)).size).toBe(NAVIGATION.length);
    expect(new Set(NAVIGATION.map((e) => e.href)).size).toBe(NAVIGATION.length);
  });

  it("contient les rubriques prévues, dans l'ordre", () => {
    expect(NAVIGATION.map((e) => e.libelle)).toEqual([
      "Tableau de bord",
      "Mon planning",
      "Feuille de temps",
      "Missions",
      "Mes tâches",
      "Pipeline",
      "Appels d'offres",
      "Banques et offres",
      "Clients",
      "Collaborateurs",
      "Catalogue",
      "Questionnaires",
      "Notation",
      "Méthodes",
      "Dossiers clients",
      "Agents IA",
      "Qualité",
      "Connaissances",
      "Plan de charge",
      "Prévisions",
      "Facturation",
      "Finance",
      "Indicateurs",
      "Paramètres",
    ]);
  });

  it("marque disponibles tous les écrans de la V1 et de la V2, indicateurs compris", () => {
    expect(NAVIGATION.filter((e) => !V3.includes(e.id)).every((e) => e.disponible)).toBe(true);
    expect(NAVIGATION.find((e) => e.id === "indicateurs")?.disponible).toBe(true);
  });

  it("déclare les rubriques de la vague 1 (écrans disponibles)", () => {
    const v3 = NAVIGATION.filter((e) => V3.includes(e.id));
    expect(v3.map((e) => [e.id, e.href, e.permission, e.disponible])).toEqual([
      ["methodes", "/methodes", "standard.lire", true],
      ["dossiers-clients", "/dossiers", "dossier.lire", true],
      ["agents-ia", "/agents", "agent.lire", true],
      ["qualite", "/qualite", "qualite.relire", true],
    ]);
    // Jamais dans la barre basse du téléphone : un écran absent n'y prend pas de place.
    for (const role of ROLES) {
      const barre = entreesBarreBasse(entreesAutorisees([role])).map((e) => e.id);
      expect(barre.some((id) => V3.includes(id))).toBe(false);
    }
  });

  it("donne des sous-pages aux chemins uniques, rattachées à leur rubrique", () => {
    for (const e of NAVIGATION) {
      const pages = e.sousPages ?? [];
      expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length);
      for (const p of pages) expect(estActive(e, p.href)).toBe(true);
    }
  });
});

describe("entreesAutorisees", () => {
  it("donne tout à l'associé", () => {
    expect(ids(["associe"])).toEqual(NAVIGATION.map((e) => e.id));
  });

  it("donne au consultant son planning, ses temps et la lecture des missions", () => {
    expect(ids(["consultant"])).toEqual([
      "tableau-de-bord",
      "mon-planning",
      "feuille-de-temps",
      "missions",
      "mes-taches",
      "appels-offres",
      "banques-ao",
      "clients",
      "catalogue",
      "questionnaires",
      "notation",
      "methodes",
      "dossiers-clients",
      "agents-ia",
      "connaissances",
    ]);
  });

  it("rubrique Connaissances : ouverte par la permission de l'une de ses sous-pages", () => {
    // Pas par collaborateurs.lire (la matrice de tous exige competence.lire), mais par
    // connaissance.lire (recherche, retours), temps.saisir (« Compétences » : ses propres
    // niveaux), competence.lire ou competence.gerer (matrice) ou standard.gerer (évolutions).
    const permissions = NAVIGATION.find((e) => e.id === "connaissances")?.permission;
    expect(permissions).toEqual(PERMISSIONS_RUBRIQUE);
    expect(permissions).not.toContain("collaborateurs.lire");
    expect(ids(["chef_mission"])).toContain("connaissances");
    expect(ids(["ressources"])).toContain("connaissances");
    // Le gestionnaire n'a que « Compétences » (temps.saisir) : l'entrée reste atteignable.
    expect(ids(["gestionnaire"])).toContain("connaissances");
    expect(ids(["client_dirigeant"])).not.toContain("connaissances");
  });

  it("rubrique Connaissances : chaque onglet affiché correspond à une page ouverte au rôle", () => {
    const onglets = (role: Role) => sousPagesConnaissances([role]).map((p) => p.id);
    // Expert métier : pas d'estimation (budget.lire_jours) ; gestionnaire : « Compétences » seul.
    expect(onglets("expert_metier")).toEqual([
      "recherche",
      "retours",
      "competences",
      "derogations",
    ]);
    expect(onglets("gestionnaire")).toEqual(["competences"]);
    expect(onglets("ressources")).toEqual(["competences"]);
    // Tout rôle qui voit la rubrique voit au moins un onglet, et l'entrée n'apparaît que si
    // un onglet existe.
    for (const role of ROLES) {
      expect(ids([role]).includes("connaissances")).toBe(onglets(role).length > 0);
    }
  });

  it("ouvre les collaborateurs aux ressources et au gestionnaire, pas au consultant", () => {
    expect(ids(["ressources"])).toContain("collaborateurs");
    expect(ids(["gestionnaire"])).toContain("collaborateurs");
    expect(ids(["consultant"])).not.toContain("collaborateurs");
    expect(ids(["expert_metier"])).not.toContain("collaborateurs");
  });

  it("limite l'expert externe au tableau de bord, à ses temps et à ses tâches", () => {
    // « Connaissances » s'ouvre à tout rôle qui saisit des temps (« Compétences », ses niveaux).
    expect(ids(["expert_externe"])).toEqual([
      "tableau-de-bord",
      "mon-planning",
      "feuille-de-temps",
      "mes-taches",
      "connaissances",
    ]);
  });

  it("ouvre les paramètres à l'associé et au gestionnaire (clôture et import des temps)", () => {
    for (const role of ROLES) {
      expect(ids([role]).includes("parametres")).toBe(
        role === "associe" || role === "gestionnaire",
      );
    }
  });

  it("ouvre la facturation à qui lit les factures, pas au consultant", () => {
    for (const role of ROLES) {
      expect(ids([role]).includes("facturation")).toBe(
        ["associe", "directeur_mission", "chef_mission", "gestionnaire"].includes(role),
      );
    }
  });

  it("ouvre le plan de charge au responsable des ressources", () => {
    expect(ids(["ressources"])).toContain("plan-de-charge");
    expect(ids(["ressources"])).not.toContain("indicateurs");
  });

  it("cumule les droits de plusieurs rôles sans doublon, dans l'ordre de la table", () => {
    const cumul = ids(["expert_metier", "gestionnaire"]);
    expect(new Set(cumul).size).toBe(cumul.length);
    expect(cumul).toContain("catalogue");
    expect(cumul).toContain("facturation");
    const ordre = NAVIGATION.map((e) => e.id).filter((id) => cumul.includes(id));
    expect(cumul).toEqual(ordre);
  });

  it("garde le tableau de bord et « Mes tâches » même sans rôle", () => {
    expect(ids([])).toEqual(["tableau-de-bord", "mes-taches"]);
  });

  it("ouvre « Mes tâches » à tous les rôles (on peut se voir assigner une tâche)", () => {
    for (const role of ROLES) expect(ids([role])).toContain("mes-taches");
    const e = NAVIGATION.find((x) => x.id === "mes-taches");
    expect(e).toMatchObject({ href: "/mes-taches", disponible: true, permission: null });
    expect(estActive(e!, "/mes-taches/nouvelle")).toBe(true);
  });
});

describe("pipeline et barre basse", () => {
  it("réserve le pipeline à qui a pipeline.gerer", () => {
    expect(ids(["chef_mission"])).toContain("pipeline");
    expect(ids(["directeur_mission"])).toContain("pipeline");
    expect(ids(["consultant"])).not.toContain("pipeline");
    expect(ids(["gestionnaire"])).not.toContain("pipeline");
  });

  it("ne met dans la barre basse que des écrans disponibles, planning et temps d'abord", () => {
    const barre = entreesBarreBasse(entreesAutorisees(["chef_mission"]));
    expect(barre.map((e) => e.id)).toEqual([
      "tableau-de-bord",
      "mon-planning",
      "feuille-de-temps",
      "missions",
    ]);
    expect(barre.every((e) => e.disponible)).toBe(true);
    expect(entreesBarreBasse(entreesAutorisees(["expert_externe"])).map((e) => e.id)).toEqual([
      "tableau-de-bord",
      "mon-planning",
      "feuille-de-temps",
      "mes-taches",
    ]);
  });
});

describe("estActive", () => {
  it("ne marque l'accueil actif que sur « / »", () => {
    expect(estActive({ href: "/" }, "/")).toBe(true);
    expect(estActive({ href: "/" }, "/missions")).toBe(false);
  });

  it("marque une rubrique active sur ses sous-pages, pas sur un préfixe trompeur", () => {
    expect(estActive({ href: "/missions" }, "/missions")).toBe(true);
    expect(estActive({ href: "/missions" }, "/missions/42")).toBe(true);
    expect(estActive({ href: "/missions" }, "/missions-archivees")).toBe(false);
  });
});

describe("sous-pages", () => {
  it("donne à chacun les sous-pages des paramètres de ses droits", () => {
    expect(sousPagesAutorisees("parametres", ["associe"]).map((p) => p.id)).toEqual([
      "cabinet",
      "utilisateurs",
      "securite",
      "portail",
      "temps",
      "facturation",
      "cloture",
      "cloture-mission",
      "import",
      "notation",
      "journal",
      "ia",
    ]);
    expect(sousPagesAutorisees("parametres", ["gestionnaire"]).map((p) => p.id)).toEqual([
      "facturation",
      "cloture",
      "import",
    ]);
    expect(sousPagesAutorisees("parametres", ["chef_mission"])).toEqual([]);
    expect(sousPagesAutorisees("parametres", ["consultant"])).toEqual([]);
  });

  it("paramètres : l'onglet actif est le plus long préfixe (cloture-mission n'est pas cloture)", () => {
    const pages = sousPagesAutorisees("parametres", ["associe"]);
    expect(sousPageActive(pages, "/parametres")).toBe("cabinet");
    expect(sousPageActive(pages, "/parametres/cloture")).toBe("cloture");
    expect(sousPageActive(pages, "/parametres/cloture-mission")).toBe("cloture-mission");
    expect(sousPageActive(pages, "/parametres/notation")).toBe("notation");
    expect(sousPageActive(pages, "/parametres/notation/grilles")).toBe("notation");
    expect(sousPageActive(pages, "/parametres/import-temps")).toBe("import");
    // Clôture de mission et notation : droit de paramétrer le cabinet (page cloture-mission).
    expect(
      sousPagesAutorisees("parametres", ["gestionnaire"]).some(
        (p) => p.id === "cloture-mission" || p.id === "notation",
      ),
    ).toBe(false);
  });

  it("donne les congés et la validation selon les droits", () => {
    expect(sousPagesAutorisees("mon-planning", ["consultant"]).map((p) => p.id)).toEqual([
      "semaine",
      "conges",
    ]);
    expect(sousPagesAutorisees("mon-planning", ["ressources"]).map((p) => p.id)).toEqual([
      "semaine",
      "conges",
      "conges-validation",
    ]);
    expect(sousPagesAutorisees("mon-planning", ["expert_externe"]).map((p) => p.id)).toEqual([
      "semaine",
    ]);
  });

  it("réserve la validation des feuilles à qui a temps.valider", () => {
    expect(sousPagesAutorisees("feuille-de-temps", ["consultant"]).map((p) => p.id)).toEqual([
      "feuille",
      "corrections",
      "discipline",
      "debours",
    ]);
    expect(sousPagesAutorisees("feuille-de-temps", ["expert_externe"]).map((p) => p.id)).toContain(
      "debours",
    );
    expect(sousPagesAutorisees("feuille-de-temps", ["chef_mission"]).map((p) => p.id)).toContain(
      "validation",
    );
    const pages = sousPagesAutorisees("feuille-de-temps", ["chef_mission"]);
    expect(sousPageActive(pages, "/temps")).toBe("feuille");
    expect(sousPageActive(pages, "/temps/validation")).toBe("validation");
    expect(sousPageActive(pages, "/temps/feuilles/0b6c2d1e-0000-4000-8000-000000000000")).toBe(
      "feuille",
    );
  });

  it("donne les types et les grades à tout lecteur du catalogue", () => {
    expect(sousPagesAutorisees("catalogue", ["consultant"]).map((p) => p.id)).toEqual([
      "types",
      "grades",
    ]);
    expect(sousPagesAutorisees("inconnue", ["associe"])).toEqual([]);
  });

  it("active la sous-page la plus précise", () => {
    const pages = sousPagesAutorisees("catalogue", ["associe"]);
    expect(sousPageActive(pages, "/catalogue")).toBe("types");
    expect(sousPageActive(pages, "/catalogue/0b6c2d1e-0000-4000-8000-000000000000")).toBe("types");
    expect(sousPageActive(pages, "/catalogue/grades")).toBe("grades");
    expect(sousPageActive(pages, "/clients")).toBeNull();
  });
});

describe("autorise", () => {
  it("accepte null, une permission, ou l'une d'une liste", () => {
    expect(autorise([], null)).toBe(true);
    expect(autorise(["consultant"], "temps.saisir")).toBe(true);
    expect(autorise(["consultant"], ["cabinet.gerer", "temps.importer"])).toBe(false);
    expect(autorise(["gestionnaire"], ["cabinet.gerer", "temps.importer"])).toBe(true);
  });
});

describe("finance V1 : facturation, finance et indicateurs", () => {
  const sous = (id: string, roles: Role[]) => sousPagesAutorisees(id, roles).map((p) => p.id);

  it("ouvre les encaissements au gestionnaire et à l'associé seulement", () => {
    for (const role of ROLES) {
      expect(sous("facturation", [role]).includes("encaissements")).toBe(
        role === "associe" || role === "gestionnaire",
      );
    }
  });

  it("ouvre les créances à qui gère les encaissements ou lit les indicateurs", () => {
    expect(sous("facturation", ["directeur_mission"])).toEqual(["factures", "creances"]);
    expect(sous("facturation", ["gestionnaire"])).toEqual([
      "factures",
      "encaissements",
      "creances",
    ]);
    expect(sous("facturation", ["chef_mission"])).toEqual(["factures"]);
    expect(sous("facturation", ["consultant"])).toEqual([]);
  });

  it("réserve la rentabilité à finance.lire et l'export à export.comptable", () => {
    for (const role of ROLES) {
      const pages = sous("finance", [role]);
      expect(pages.includes("rentabilite")).toBe(role === "associe" || role === "gestionnaire");
      expect(pages.includes("export")).toBe(role === "associe" || role === "gestionnaire");
    }
    expect(sous("finance", ["directeur_mission"])).toEqual(["encours"]);
    expect(sous("finance", ["chef_mission"])).toEqual(["encours"]);
    expect(sous("finance", ["consultant"])).toEqual([]);
  });

  it("n'ouvre l'export qu'à qui voit aussi toutes les missions (règle de l'API)", () => {
    for (const role of ROLES) {
      if (sous("finance", [role]).includes("export"))
        expect(aPermission([role], "mission.lire_toutes")).toBe(true);
    }
  });

  it("montre la rubrique Finance seulement avec une sous-page accessible", () => {
    for (const role of ROLES) {
      expect(ids([role]).includes("finance")).toBe(sous("finance", [role]).length > 0);
    }
  });

  it("ouvre les indicateurs à l'associé, au directeur et au gestionnaire", () => {
    for (const role of ROLES) {
      expect(ids([role]).includes("indicateurs")).toBe(
        ["associe", "directeur_mission", "gestionnaire"].includes(role),
      );
    }
  });

  it("active la bonne sous-page de la facturation et de la finance", () => {
    const fact = sousPagesAutorisees("facturation", ["associe"]);
    expect(sousPageActive(fact, "/facturation")).toBe("factures");
    expect(sousPageActive(fact, "/facturation/0b6c2d1e-0000-4000-8000-000000000000")).toBe(
      "factures",
    );
    expect(sousPageActive(fact, "/facturation/encaissements/abc")).toBe("encaissements");
    expect(sousPageActive(fact, "/facturation/creances")).toBe("creances");
    const fin = sousPagesAutorisees("finance", ["associe"]);
    expect(sousPageActive(fin, "/finance/rentabilite")).toBe("rentabilite");
    expect(sousPageActive(fin, "/finance/export")).toBe("export");
  });
});

describe("appels d'offres (lot AO-A)", () => {
  it("ouvre la rubrique à qui lit les appels d'offres, ni aux ressources ni à l'expert externe", () => {
    const e = NAVIGATION.find((x) => x.id === "appels-offres");
    expect([e?.href, e?.permission, e?.disponible]).toEqual(["/appels-offres", "ao.lire", true]);
    for (const role of ["associe", "chef_mission", "consultant", "gestionnaire"] as const) {
      expect(ids([role])).toContain("appels-offres");
    }
    expect(ids(["ressources"])).not.toContain("appels-offres");
    expect(ids(["expert_externe"])).not.toContain("appels-offres");
  });
});
