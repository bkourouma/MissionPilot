import { describe, expect, it } from "vitest";
import { ROLES } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { SAISIE_CONFIRMATION_VIDE } from "./double-authentification";
import {
  basculerDocument,
  basculerMission,
  basculerOption,
  brouillonDepuisPartages,
  brouillonModifie,
  chargePartages,
  cheminInvitationPortail,
  cheminPartagesPortail,
  cheminStatutUtilisateurPortail,
  cheminUtilisateursPortail,
  detailMissionPartagee,
  documentPartageable,
  documentsDeMission,
  estRefusTfaInactive,
  gereLeClient,
  libellePolitiquePortail,
  libellesRolesPortail,
  MESSAGE_CLIENT_NON_GERE,
  messageErreurPortailGestion,
  messagePolitiquePortail,
  missionGerable,
  missionsPartageables,
  ongletsClientAvecPortail,
  OPTIONS_ROLES_PORTAIL,
  optionsContactPrincipal,
  phraseResume,
  RAISON_CONTENU_IA,
  resumePartages,
  statutUtilisateurPortail,
  validerInvitationPortail,
  validerPolitiquePortail,
  type DocumentCandidat,
  type DocumentPartageLu,
  type MissionClient,
  type PartagesClient,
} from "./portail-gestion";

const MOI = "u-moi";
const CLIENT = "c-1";

const mission = (id: string, extra: Partial<MissionClient> = {}): MissionClient => ({
  id,
  intitule: `Mission ${id}`,
  statut: "en_cours",
  directeur_id: "u-autre",
  chef_id: null,
  date_debut: null,
  date_fin: null,
  ...extra,
});

const candidat = (id: string, extra: Partial<DocumentCandidat> = {}): DocumentCandidat => ({
  id,
  mission_id: "m-1",
  type: "livrable",
  nom: `Livrable ${id}`,
  version: 1,
  statut_contenu: null,
  ...extra,
});

const partageDoc = (id: string, extra: Partial<DocumentPartageLu> = {}): DocumentPartageLu => ({
  document_id: id,
  mission_id: "m-1",
  type: "livrable",
  nom: `Livrable ${id}`,
  version: 1,
  partage_le: "2026-10-01T10:00:00Z",
  ...extra,
});

const partages = (extra: Partial<PartagesClient> = {}): PartagesClient => ({
  client: { id: CLIENT, raison_sociale: "Kora SA", actif: true },
  contact_principal: null,
  missions: [],
  documents: [],
  ...extra,
});

const partageMission = (id: string, extra: Partial<PartagesClient["missions"][number]> = {}) => ({
  mission_id: id,
  intitule: `Mission ${id}`,
  statut: "en_cours" as const,
  jalons: false,
  factures: false,
  partage_le: "2026-10-01T10:00:00Z",
  gerable: true,
  ...extra,
});

describe("chemins", () => {
  it("encode les identifiants", () => {
    expect(cheminUtilisateursPortail("a b")).toBe("/api/portail/utilisateurs?client_id=a%20b");
    expect(cheminPartagesPortail("x&y")).toBe("/api/portail/partages?client_id=x%26y");
    expect(cheminInvitationPortail("i/1")).toBe("/api/portail/invitations/i%2F1");
    expect(cheminStatutUtilisateurPortail("u1", "desactiver")).toBe(
      "/api/portail/utilisateurs/u1/desactiver",
    );
  });
});

describe("ongletsClientAvecPortail", () => {
  const ids = (roles: Parameters<typeof ongletsClientAvecPortail>[1]) =>
    ongletsClientAvecPortail("c", roles).map((o) => o.id);

  it("ajoute « Portail client » à qui a portail.gerer", () => {
    expect(ids(["associe"])).toEqual(["fiche", "taux", "portail"]);
    expect(ids(["directeur_mission"])).toEqual(["fiche", "portail"]);
    expect(ids(["chef_mission"])).toEqual(["fiche", "portail"]);
  });

  it("ne le montre ni au consultant ni au gestionnaire", () => {
    expect(ids(["consultant"])).toEqual(["fiche"]);
    expect(ids(["gestionnaire"])).toEqual(["fiche", "taux"]);
  });

  it("pointe vers la page du portail du client", () => {
    expect(ongletsClientAvecPortail("c", ["associe"]).at(-1)?.href).toBe("/clients/c/portail");
  });
});

describe("droits de gestion", () => {
  it("gère toutes les missions avec mission.modifier_toutes", () => {
    expect(missionGerable(mission("m"), MOI, ["directeur_mission"])).toBe(true);
    expect(missionGerable(mission("m"), MOI, ["associe"])).toBe(true);
  });

  it("limite le chef de mission aux missions qu'il dirige", () => {
    expect(missionGerable(mission("m", { chef_id: MOI }), MOI, ["chef_mission"])).toBe(true);
    expect(missionGerable(mission("m", { directeur_id: MOI }), MOI, ["chef_mission"])).toBe(true);
    expect(missionGerable(mission("m"), MOI, ["chef_mission"])).toBe(false);
  });

  it("gère le client comme l'API (exigerClientGere)", () => {
    expect(gereLeClient([], MOI, ["directeur_mission"])).toBe(true);
    expect(gereLeClient([], MOI, ["chef_mission"])).toBe(false);
    expect(gereLeClient([mission("m")], MOI, ["chef_mission"])).toBe(false);
    expect(
      gereLeClient([mission("m"), mission("n", { chef_id: MOI })], MOI, ["chef_mission"]),
    ).toBe(true);
    expect(gereLeClient([mission("m", { chef_id: MOI })], MOI, ["consultant"])).toBe(false);
  });
});

describe("rôles du portail", () => {
  it("ne propose que les trois rôles client, chacun expliqué", () => {
    expect(OPTIONS_ROLES_PORTAIL.map((o) => o.valeur)).toEqual([
      "client_dirigeant",
      "client_contributeur",
      "client_investisseur",
    ]);
    for (const o of OPTIONS_ROLES_PORTAIL) {
      expect(o.libelle.length).toBeGreaterThan(0);
      expect(o.aide.length).toBeGreaterThan(20);
    }
    expect(OPTIONS_ROLES_PORTAIL[0]?.aide).toMatch(/valide/);
    expect(OPTIONS_ROLES_PORTAIL[1]?.aide).toMatch(/questionnaires/);
    expect(OPTIONS_ROLES_PORTAIL[2]?.aide).toMatch(/restreinte/);
  });

  it("n'affiche que les rôles du portail", () => {
    expect(libellesRolesPortail(["client_dirigeant"])).toBe("Dirigeant client");
    expect(libellesRolesPortail(["associe"])).toBe("Aucun rôle du portail");
  });

  it("libelle le statut d'accès, y compris inconnu", () => {
    expect(statutUtilisateurPortail("actif")).toEqual({
      libelle: "Accès actif",
      tonalite: "succes",
    });
    expect(statutUtilisateurPortail("desactive").libelle).toBe("Accès désactivé");
    expect(statutUtilisateurPortail("autre")).toEqual({
      libelle: "Statut inconnu",
      tonalite: "neutre",
    });
  });
});

describe("validerInvitationPortail", () => {
  it("exige l'e-mail et le rôle", () => {
    const r = validerInvitationPortail({ email: " ", role: "" }, CLIENT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.email).toMatch(/Saisissez/);
      expect(r.erreurs.role).toMatch(/Choisissez/);
    }
  });

  it("refuse un e-mail invalide et un rôle interne", () => {
    const r = validerInvitationPortail({ email: "pas-un-mail", role: "associe" }, CLIENT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.email).toMatch(/invalide/);
      expect(r.erreurs.role).toBeDefined();
    }
    for (const role of ROLES) {
      expect(validerInvitationPortail({ email: "a@b.ci", role }, CLIENT).ok).toBe(false);
    }
  });

  it("normalise l'e-mail et envoie un seul rôle du client", () => {
    expect(
      validerInvitationPortail(
        { email: "  Awa.Kone@Kora.CI ", role: "client_contributeur" },
        CLIENT,
      ),
    ).toEqual({
      ok: true,
      charge: { email: "awa.kone@kora.ci", client_id: CLIENT, roles: ["client_contributeur"] },
    });
  });
});

describe("documents partageables", () => {
  it("suit la règle de l'API : livrable ou lettre de mission, hors IA ou validé", () => {
    expect(documentPartageable({ type: "livrable", statut_contenu: null })).toBe(true);
    expect(documentPartageable({ type: "lettre_de_mission", statut_contenu: "valide" })).toBe(true);
    expect(documentPartageable({ type: "livrable", statut_contenu: "brouillon_ia" })).toBe(false);
    expect(documentPartageable({ type: "livrable", statut_contenu: "modifie" })).toBe(false);
    expect(documentPartageable({ type: "proposition", statut_contenu: null })).toBe(false);
    expect(documentPartageable({ type: "autre", statut_contenu: null })).toBe(false);
  });

  it("écarte les autres types, explique les brouillons IA, garde l'ancienne version partagée", () => {
    const lignes = documentsDeMission(
      "m-1",
      [
        candidat("d-prop", { type: "proposition" }),
        candidat("d-ia", { nom: "Rapport", statut_contenu: "brouillon_ia" }),
        candidat("d-v3", { nom: "Diagnostic", version: 3 }),
        candidat("d-autre-mission", { mission_id: "m-2" }),
      ],
      [
        partageDoc("d-v2", { nom: "Diagnostic", version: 2 }),
        partageDoc("d-v3", { nom: "Diagnostic", version: 3 }),
        partageDoc("d-ailleurs", { mission_id: "m-2" }),
      ],
    );
    expect(lignes.map((l) => l.id)).toEqual(["d-v3", "d-v2", "d-ia"]);
    expect(lignes[0]).toMatchObject({ partageable: true, versionPlusRecente: null });
    expect(lignes[1]).toMatchObject({ partageable: true, versionPlusRecente: 3 });
    expect(lignes[2]).toMatchObject({ partageable: false, raison: RAISON_CONTENU_IA });
  });
});

describe("missionsPartageables", () => {
  it("réunit missions visibles et partagées ; documents chargés pour les seules gérables", () => {
    const r = missionsPartageables({
      missions: [
        mission("m-1", { chef_id: MOI, intitule: "B" }),
        mission("m-2", { intitule: "A" }),
      ],
      partages: {
        missions: [
          partageMission("m-2", { intitule: "A", gerable: false }),
          partageMission("m-3", { intitule: "C", gerable: false }),
        ],
        documents: [partageDoc("d-2", { mission_id: "m-2" })],
      },
      documents: new Map([["m-1", null]]),
      utilisateurId: MOI,
      roles: ["chef_mission"],
    });
    expect(r.map((m) => [m.id, m.gerable, m.documentsIndisponibles])).toEqual([
      ["m-2", false, false],
      ["m-1", true, true],
      ["m-3", false, false],
    ]);
    expect(r[0]?.documents.map((d) => d.id)).toEqual(["d-2"]);
  });

  it("propose les documents chargés d'une mission gérable", () => {
    const r = missionsPartageables({
      missions: [mission("m-1")],
      partages: { missions: [], documents: [] },
      documents: new Map([["m-1", [candidat("d-1")]]]),
      utilisateurId: MOI,
      roles: ["associe"],
    });
    expect(r[0]).toMatchObject({ gerable: true, documentsIndisponibles: false });
    expect(r[0]?.documents.map((d) => d.id)).toEqual(["d-1"]);
  });
});

describe("brouillon des partages", () => {
  const initial = brouillonDepuisPartages(
    partages({
      contact_principal: { id: "u-contact", nom: "Awa" },
      missions: [partageMission("m-1", { jalons: true })],
      documents: [partageDoc("d-1")],
    }),
  );

  it("part de l'état enregistré, rien de modifié", () => {
    expect(initial).toEqual({
      missions: { "m-1": { jalons: true, factures: false } },
      documents: { "d-1": "m-1" },
      contact: "u-contact",
    });
    expect(brouillonModifie(initial, initial)).toBe(false);
    expect(brouillonDepuisPartages(partages())).toEqual({
      missions: {},
      documents: {},
      contact: "",
    });
  });

  it("partager une mission ne coche rien d'autre", () => {
    const b = basculerMission(initial, "m-2", true);
    expect(b.missions["m-2"]).toEqual({ jalons: false, factures: false });
    expect(basculerMission(b, "m-2", true)).toBe(b);
  });

  it("retirer une mission retire ses jalons, factures et documents", () => {
    const b = basculerMission(initial, "m-1", false);
    expect(b.missions).toEqual({});
    expect(b.documents).toEqual({});
    expect(brouillonModifie(b, initial)).toBe(true);
  });

  it("cocher les jalons, les factures ou un document partage la mission", () => {
    expect(basculerOption(initial, "m-2", "factures", true).missions["m-2"]).toEqual({
      jalons: false,
      factures: true,
    });
    expect(basculerOption(initial, "m-2", "jalons", false)).toBe(initial);
    const b = basculerDocument(initial, "d-9", "m-2", true);
    expect(b.missions["m-2"]).toEqual({ jalons: false, factures: false });
    expect(b.documents["d-9"]).toBe("m-2");
  });

  it("décocher un document ne touche pas sa mission ; revenir à l'état initial n'est pas une modification", () => {
    const b = basculerDocument(initial, "d-1", "m-1", false);
    expect(b.documents).toEqual({});
    expect(b.missions["m-1"]).toBeDefined();
    expect(basculerDocument(b, "d-1", "m-1", false)).toBe(b);
    expect(brouillonModifie(basculerDocument(b, "d-1", "m-1", true), initial)).toBe(false);
  });

  it("n'envoie que les missions gérables et leurs documents ; contact seulement s'il change", () => {
    const b = basculerDocument(basculerMission(initial, "m-autre", true), "d-x", "m-autre", true);
    expect(chargePartages(b, initial, new Set(["m-1"]))).toEqual({
      missions: [{ mission_id: "m-1", jalons: true, factures: false }],
      documents: ["d-1"],
    });
    expect(
      chargePartages({ ...b, contact: "" }, initial, new Set()).contact_principal_id,
    ).toBeNull();
    expect(chargePartages({ ...b, contact: "u-2" }, initial, new Set()).contact_principal_id).toBe(
      "u-2",
    );
  });

  it("rien de coché : remplacement par des listes vides (le client ne voit plus rien)", () => {
    const vide = brouillonDepuisPartages(partages());
    expect(chargePartages(vide, vide, new Set(["m-1"]))).toEqual({ missions: [], documents: [] });
  });
});

describe("contact principal", () => {
  const personnes = [{ utilisateur_id: "u-1", nom: "Awa", grade_libelle: "Associé" }];

  it("propose les personnes du cabinet et garde le contact actuel absent de la liste", () => {
    expect(optionsContactPrincipal(personnes, null)).toEqual([
      { valeur: "u-1", libelle: "Awa (Associé)" },
    ]);
    expect(optionsContactPrincipal(personnes, { id: "u-9", nom: "Koffi" })[0]).toEqual({
      valeur: "u-9",
      libelle: "Koffi",
    });
    expect(optionsContactPrincipal(personnes, { id: "u-1", nom: "Awa" })).toHaveLength(1);
  });
});

describe("résumé de ce que voit le client", () => {
  it("rien par défaut", () => {
    const r = resumePartages(partages());
    expect(r).toEqual({ rien: true, contact: null, missions: [], documents: 0 });
    expect(phraseResume(r)).toBe("Votre client ne voit plus aucune mission.");
  });

  it("détaille chaque mission partagée, triée par intitulé", () => {
    const r = resumePartages(
      partages({
        contact_principal: { id: "u-1", nom: "Awa" },
        missions: [
          partageMission("m-2", { intitule: "Zeta", factures: true }),
          partageMission("m-1", { intitule: "Alpha", jalons: true }),
        ],
        documents: [partageDoc("d-1"), partageDoc("d-2")],
      }),
    );
    expect(r.rien).toBe(false);
    expect(r.contact).toBe("Awa");
    expect(r.missions.map((m) => m.intitule)).toEqual(["Alpha", "Zeta"]);
    expect(detailMissionPartagee(r.missions[0]!)).toBe(
      "intitulé, statut et dates · jalons · 2 documents",
    );
    expect(detailMissionPartagee(r.missions[1]!)).toBe(
      "intitulé, statut et dates · factures émises",
    );
    expect(phraseResume(r)).toBe("Votre client voit 2 missions et 2 documents.");
  });
});

describe("messageErreurPortailGestion", () => {
  const erreur = (statut: number, code: string, message = "Message de l'API.") =>
    new ErreurApi(code, message, statut);

  it("explique un 403 selon l'action", () => {
    expect(messageErreurPortailGestion(erreur(403, "INTERDIT"), "invitation")).toBe(
      MESSAGE_CLIENT_NON_GERE,
    );
    expect(messageErreurPortailGestion(erreur(403, "INTERDIT"), "partages")).toMatch(
      /pas sous votre responsabilité/,
    );
    expect(messageErreurPortailGestion(erreur(403, "TFA_A_CONFIGURER"), "partages")).toMatch(
      /double authentification est obligatoire/,
    );
  });

  it("explique un 404 selon l'action", () => {
    expect(messageErreurPortailGestion(erreur(404, "INTROUVABLE"), "revocation")).toMatch(
      /plus en attente/,
    );
    expect(messageErreurPortailGestion(erreur(404, "INTROUVABLE"), "desactivation")).toMatch(
      /introuvable/,
    );
    expect(messageErreurPortailGestion(erreur(404, "INTROUVABLE"), "partages")).toBe(
      "Ce client est introuvable.",
    );
  });

  it("reprend le message français d'un conflit (409) et traduit un partage refusé", () => {
    expect(
      messageErreurPortailGestion(
        erreur(409, "CONFLIT", "Un compte du cabinet ou du portail utilise déjà cet e-mail."),
        "invitation",
      ),
    ).toBe("Un compte du cabinet ou du portail utilise déjà cet e-mail.");
    expect(
      messageErreurPortailGestion(erreur(400, "PORTAIL_PARTAGE_INVALIDE"), "partages"),
    ).toMatch(/plus partageable/);
    expect(messageErreurPortailGestion(new Error("x"), "partages")).toMatch(/inattendue/);
  });
});

describe("politique 2FA du portail", () => {
  it("exige mot de passe et code quand la 2FA de l'auteur est active", () => {
    const r = validerPolitiquePortail(true, { ...SAISIE_CONFIRMATION_VIDE, motDePasse: "x" }, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.code).toBeDefined();
    expect(
      validerPolitiquePortail(true, { motDePasse: "x", code: "123 456", facteur: "totp" }, true),
    ).toEqual({ ok: true, charge: { tfa_obligatoire: true, mot_de_passe: "x", code: "123456" } });
  });

  it("sans 2FA active : mot de passe seul (l'API répond alors TFA_INACTIVE)", () => {
    expect(
      validerPolitiquePortail(false, { ...SAISIE_CONFIRMATION_VIDE, motDePasse: "x" }, false),
    ).toEqual({ ok: true, charge: { tfa_obligatoire: false, mot_de_passe: "x" } });
    const r = validerPolitiquePortail(false, SAISIE_CONFIRMATION_VIDE, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.mot_de_passe).toBeDefined();
  });

  it("reconnaît et explique le refus TFA_INACTIVE", () => {
    const e = new ErreurApi("TFA_INACTIVE", "Activez d'abord…", 409);
    expect(estRefusTfaInactive(e)).toBe(true);
    expect(estRefusTfaInactive(new ErreurApi("CONFLIT", "x", 409))).toBe(false);
    expect(messagePolitiquePortail(e, "totp")).toMatch(/Activez d'abord votre propre/);
    expect(libellePolitiquePortail(true)).toBe("Exigée");
    expect(libellePolitiquePortail(false)).toBe("Facultative");
  });
});
