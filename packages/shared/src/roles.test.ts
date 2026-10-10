import { describe, expect, it } from "vitest";
import {
  aPermission,
  estRoleClient,
  estUtilisateurPortail,
  PERMISSIONS,
  PERMISSIONS_PAR_ROLE,
  PERMISSIONS_PORTAIL_CLIENT,
  ROLE_LIBELLES,
  roleClientSchema,
  roleQuelconqueSchema,
  ROLES,
  ROLES_CLIENT,
  roleSchema,
  TOUS_LES_ROLES,
} from "./roles";

describe("droits par rôle", () => {
  it("chaque rôle a une liste de droits connus", () => {
    for (const role of ROLES) {
      for (const p of PERMISSIONS_PAR_ROLE[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  it("les coûts, taux et marges ne sont visibles que des associés et gestionnaires (FIN-02)", () => {
    const voient = ROLES.filter((r) => aPermission([r], "finance.lire"));
    expect(voient.sort()).toEqual(["associe", "gestionnaire"]);
  });

  it("seul un associé valide une proposition (PRD, MIS-05)", () => {
    const valident = ROLES.filter((r) => aPermission([r], "proposition.valider"));
    expect(valident).toEqual(["associe"]);
  });

  it("modifier toute mission : associé et directeur ; lire toutes ne suffit pas", () => {
    const modifient = ROLES.filter((r) => aPermission([r], "mission.modifier_toutes"));
    expect(modifient.sort()).toEqual(["associe", "directeur_mission"]);
    expect(aPermission(["gestionnaire"], "mission.lire_toutes")).toBe(true);
    expect(aPermission(["ressources"], "mission.modifier_toutes")).toBe(false);
  });

  it("un consultant ne peut ni valider un temps ni émettre une facture", () => {
    expect(aPermission(["consultant"], "temps.valider")).toBe(false);
    expect(aPermission(["consultant"], "facture.emettre")).toBe(false);
  });

  it("facturation (FIN-05, FIN-07, FIN-15) : matrice des 8 rôles", () => {
    const qui = (p: Parameters<typeof aPermission>[1]) =>
      ROLES.filter((r) => aPermission([r], p)).sort();
    expect(qui("debours.saisir")).toEqual([...ROLES].sort());
    expect(qui("debours.valider")).toEqual(["associe", "chef_mission", "directeur_mission"]);
    expect(qui("facture.lire")).toEqual([
      "associe",
      "chef_mission",
      "directeur_mission",
      "gestionnaire",
    ]);
    expect(qui("facture.emettre")).toEqual(["associe", "gestionnaire"]);
    expect(qui("facture.valider")).toEqual(["associe", "directeur_mission"]);
    expect(qui("taux.gerer")).toEqual(["associe", "gestionnaire"]);
    // Celui qui émet n'approuve pas seul : seul l'associé cumule les deux droits.
    expect(
      ROLES.filter(
        (r) => aPermission([r], "facture.emettre") && aPermission([r], "facture.valider"),
      ),
    ).toEqual(["associe"]);
  });

  it("collaboration (SOC-08) : matrice des 8 rôles", () => {
    const qui = (p: Parameters<typeof aPermission>[1]) =>
      ROLES.filter((r) => aPermission([r], p)).sort();
    // Tous les rôles internes commentent ; l'expert externe est borné par la visibilité.
    expect(qui("commentaire.ecrire")).toEqual([...ROLES].sort());
    expect(qui("tache.assigner")).toEqual([
      "associe",
      "chef_mission",
      "directeur_mission",
      "gestionnaire",
      "ressources",
    ]);
  });

  it("les droits de plusieurs rôles s'additionnent", () => {
    expect(aPermission(["consultant", "ressources"], "affectation.gerer")).toBe(true);
  });

  it("V2 (plan, KPI, notation) : matrice des 8 rôles ; ni ressources ni gestionnaire", () => {
    const qui = (p: Parameters<typeof aPermission>[1]) =>
      TOUS_LES_ROLES.filter((r) => aPermission([r], p)).sort();
    const lecteurs = [
      "associe",
      "chef_mission",
      "consultant",
      "directeur_mission",
      "expert_metier",
    ];
    const responsables = ["associe", "chef_mission", "directeur_mission"];
    const redacteurs = ["associe", "chef_mission", "consultant", "directeur_mission"];
    expect(qui("plan.lire")).toEqual(lecteurs);
    expect(qui("kpi.lire")).toEqual(lecteurs);
    expect(qui("notation.lire")).toEqual(lecteurs);
    expect(qui("plan.ecrire")).toEqual(redacteurs);
    expect(qui("kpi.saisir")).toEqual(redacteurs);
    expect(qui("plan.valider")).toEqual(responsables);
    expect(qui("kpi.gerer")).toEqual(responsables);
    // La publication d'une notation est réservée à l'expert métier (NOT-07) : pas même l'associé.
    expect(qui("notation.publier")).toEqual(["expert_metier"]);
    expect(qui("notation.gerer")).toContain("associe");
    // La masse salariale et les états financiers du client sont confidentiels.
    for (const role of ["ressources", "gestionnaire", "expert_externe"] as const) {
      for (const p of [
        "plan.lire",
        "plan.ecrire",
        "plan.valider",
        "kpi.lire",
        "kpi.gerer",
        "kpi.saisir",
        "notation.lire",
      ] as const) {
        expect(aPermission([role], p), `${role} ${p}`).toBe(false);
      }
    }
  });
});

describe("V3, vague 1 : méthodes, dossier client, preuves, agents, qualité", () => {
  const qui = (p: Parameters<typeof aPermission>[1]) =>
    TOUS_LES_ROLES.filter((r) => aPermission([r], p)).sort();
  const lecteurs = ["associe", "chef_mission", "consultant", "directeur_mission", "expert_metier"];
  const redacteurs = ["associe", "chef_mission", "consultant", "directeur_mission"];
  const NOUVELLES = [
    "standard.lire",
    "standard.gerer",
    "methode.deroger",
    "dossier.lire",
    "dossier.ecrire",
    "preuve.lire",
    "preuve.ecrire",
    "agent.lire",
    "agent.gerer",
    "autonomie.decider",
    "qualite.relire",
    "qualite.signer",
  ] as const;

  it("déclare les douze permissions de la vague 1", () => {
    for (const p of NOUVELLES) expect(PERMISSIONS).toContain(p);
  });

  it("lecture par les rôles de conseil ; écriture par les rédacteurs", () => {
    for (const p of ["standard.lire", "dossier.lire", "preuve.lire", "agent.lire"] as const) {
      expect(qui(p), p).toEqual(lecteurs);
    }
    expect(qui("dossier.ecrire")).toEqual(redacteurs);
    expect(qui("preuve.ecrire")).toEqual(redacteurs);
  });

  it("méthodes et agents gérés par l'associé et l'expert métier ; dérogation par la mission", () => {
    expect(qui("standard.gerer")).toEqual(["associe", "expert_metier"]);
    expect(qui("agent.gerer")).toEqual(["associe", "expert_metier"]);
    expect(qui("methode.deroger")).toEqual(["associe", "chef_mission", "directeur_mission"]);
  });

  it("promotion d'autonomie : décision d'un associé seul (AGT-03)", () => {
    expect(qui("autonomie.decider")).toEqual(["associe"]);
  });

  it("qualité : relecture par chef, directeur et expert ; signature par le directeur (QUA-04)", () => {
    expect(qui("qualite.relire")).toEqual([
      "associe",
      "chef_mission",
      "directeur_mission",
      "expert_metier",
    ]);
    expect(qui("qualite.signer")).toEqual(["associe", "directeur_mission"]);
    // Le consultant valide ce qu'il produit ; il ne relit ni ne signe.
    expect(aPermission(["consultant"], "qualite.relire")).toBe(false);
  });

  it("ni ressources, ni gestionnaire, ni expert externe, ni portail", () => {
    for (const role of ["ressources", "gestionnaire", "expert_externe", ...ROLES_CLIENT] as const) {
      for (const p of NOUVELLES) expect(aPermission([role], p), `${role} ${p}`).toBe(false);
    }
  });
});

describe("portail client (SOC-09)", () => {
  it("rôles client et rôles du cabinet sont disjoints ; ROLES reste la liste interne", () => {
    expect(ROLES).toHaveLength(8);
    expect(ROLES_CLIENT).toEqual([
      "client_dirigeant",
      "client_contributeur",
      "client_investisseur",
    ]);
    expect(ROLES.some((r) => (ROLES_CLIENT as readonly string[]).includes(r))).toBe(false);
    expect([...TOUS_LES_ROLES].sort()).toEqual([...ROLES, ...ROLES_CLIENT].sort());
    for (const role of TOUS_LES_ROLES) expect(ROLE_LIBELLES[role]).toBeTruthy();
  });

  it("un rôle client ne détient QUE des permissions portail.* ; aucun rôle interne n'en détient", () => {
    for (const role of ROLES_CLIENT) {
      for (const p of PERMISSIONS_PAR_ROLE[role]) {
        expect(PERMISSIONS).toContain(p);
        expect(PERMISSIONS_PORTAIL_CLIENT).toContain(p);
      }
    }
    for (const role of ROLES) {
      for (const p of PERMISSIONS_PORTAIL_CLIENT) expect(aPermission([role], p)).toBe(false);
    }
  });

  it("aucun rôle client ne voit coûts, taux ou marges ni ne gère le portail", () => {
    for (const role of ROLES_CLIENT) {
      for (const p of ["finance.lire", "portail.gerer", "cabinet.gerer", "audit.lire"] as const) {
        expect(aPermission([role], p)).toBe(false);
      }
    }
  });

  it("matrice du portail : gestion par associé, directeur et chef ; lecture par rôle client", () => {
    const qui = (p: Parameters<typeof aPermission>[1]) =>
      TOUS_LES_ROLES.filter((r) => aPermission([r], p)).sort();
    expect(qui("portail.gerer")).toEqual(["associe", "chef_mission", "directeur_mission"]);
    expect(qui("portail.acceder")).toEqual([...ROLES_CLIENT].sort());
    expect(qui("portail.missions.lire")).toEqual(["client_contributeur", "client_dirigeant"]);
    expect(qui("portail.factures.lire")).toEqual(["client_dirigeant"]);
    expect(qui("portail.jalons.valider")).toEqual(["client_dirigeant"]);
    // Saisie sur désignation explicite : jamais l'investisseur.
    expect(qui("portail.kpi.saisir")).toEqual(["client_contributeur", "client_dirigeant"]);
    expect(qui("portail.questionnaires.repondre")).toEqual([
      "client_contributeur",
      "client_dirigeant",
    ]);
    expect(PERMISSIONS_PORTAIL_CLIENT).toEqual([
      "portail.acceder",
      "portail.missions.lire",
      "portail.factures.lire",
      "portail.jalons.valider",
      "portail.kpi.saisir",
      "portail.questionnaires.repondre",
      "portail.salle.deposer",
    ]);
    // Toute permission « portail.* » détenue par un client est une permission du portail.
    expect(PERMISSIONS.filter((p) => p.startsWith("portail.") && p !== "portail.gerer")).toEqual([
      ...PERMISSIONS_PORTAIL_CLIENT,
    ]);
  });

  it("salle de mission (CLI-01) : suivi par l'équipe de conseil ; dépôt par dirigeant et contributeur", () => {
    const qui = (p: Parameters<typeof aPermission>[1]) =>
      TOUS_LES_ROLES.filter((r) => aPermission([r], p)).sort();
    expect(qui("salle.lire")).toEqual([
      "associe",
      "chef_mission",
      "consultant",
      "directeur_mission",
      "expert_metier",
    ]);
    expect(qui("salle.gerer")).toEqual([
      "associe",
      "chef_mission",
      "consultant",
      "directeur_mission",
    ]);
    // Jamais l'investisseur, jamais un rôle interne.
    expect(qui("portail.salle.deposer")).toEqual(["client_contributeur", "client_dirigeant"]);
  });

  it("schémas et prédicats", () => {
    expect(roleSchema.safeParse("client_dirigeant").success).toBe(false);
    expect(roleClientSchema.safeParse("associe").success).toBe(false);
    expect(roleQuelconqueSchema.safeParse("client_investisseur").success).toBe(true);
    expect(estUtilisateurPortail(["client_contributeur"])).toBe(true);
    expect(estUtilisateurPortail(["associe"])).toBe(false);
    expect(estRoleClient("chef_mission")).toBe(false);
  });
});

describe("V3, vague 3 : appels d'offres (lot AO-B, AO-04 à AO-07)", () => {
  const qui = (p: Parameters<typeof aPermission>[1]) =>
    TOUS_LES_ROLES.filter((r) => aPermission([r], p)).sort();

  it("lecture par les rôles de conseil et le gestionnaire ; tenue par les rédacteurs", () => {
    expect(qui("ao.lire")).toEqual([
      "associe",
      "chef_mission",
      "consultant",
      "directeur_mission",
      "expert_metier",
      "gestionnaire",
    ]);
    expect(qui("ao.gerer")).toEqual(["associe", "chef_mission", "consultant", "directeur_mission"]);
  });

  it("offre financière (FIN-02) : seuls associé et gestionnaire réunissent lecture et taux", () => {
    const financiers = ROLES.filter(
      (r) =>
        aPermission([r], "ao.lire") &&
        aPermission([r], "finance.lire") &&
        aPermission([r], "taux.gerer"),
    );
    expect([...financiers].sort()).toEqual(["associe", "gestionnaire"]);
    for (const r of ["ressources", "expert_externe", ...ROLES_CLIENT] as const) {
      expect(aPermission([r], "ao.lire"), r).toBe(false);
    }
  });
});

describe("V3, vague 3 : appels d'offres (lot AO-A, AO-01 à AO-03, AO-08)", () => {
  it("la décision go/no-go est réservée à l'associé (AO-02)", () => {
    expect(PERMISSIONS).toContain("ao.decider");
    expect(TOUS_LES_ROLES.filter((r) => aPermission([r], "ao.decider"))).toEqual(["associe"]);
  });
});

describe("V3, vague 3 : capitalisation (CAP) ; vague 2 : automatisation (AUT)", () => {
  const qui = (p: Parameters<typeof aPermission>[1]) =>
    TOUS_LES_ROLES.filter((r) => aPermission([r], p)).sort();

  it("connaissance.lire : associé, directeur, chef, consultant, expert métier", () => {
    expect(qui("connaissance.lire")).toEqual([
      "associe",
      "chef_mission",
      "consultant",
      "directeur_mission",
      "expert_metier",
    ]);
  });

  it("competence.gerer et competence.lire : associé, directeur de mission, ressources", () => {
    expect(qui("competence.gerer")).toEqual(["associe", "directeur_mission", "ressources"]);
    // La matrice de tous suit la gestion : jamais `collaborateurs.lire` (chef, gestionnaire).
    expect(qui("competence.lire")).toEqual(["associe", "directeur_mission", "ressources"]);
    for (const r of ["chef_mission", "gestionnaire"] as const) {
      expect(aPermission([r], "collaborateurs.lire"), r).toBe(true);
      expect(aPermission([r], "competence.lire"), r).toBe(false);
    }
  });

  it("automatisation.lire : associé, directeur, chef de mission ; gerer : associé et directeur", () => {
    expect(qui("automatisation.lire")).toEqual(["associe", "chef_mission", "directeur_mission"]);
    expect(qui("automatisation.gerer")).toEqual(["associe", "directeur_mission"]);
  });

  it("jamais aux rôles du portail ni à l'expert externe", () => {
    for (const p of [
      "connaissance.lire",
      "competence.gerer",
      "competence.lire",
      "automatisation.lire",
      "automatisation.gerer",
    ] as const) {
      for (const r of [...ROLES_CLIENT, "expert_externe"] as const) {
        expect(aPermission([r], p), `${r} ${p}`).toBe(false);
      }
    }
  });
});
