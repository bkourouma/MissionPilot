import { describe, expect, it } from "vitest";
import {
  actionProposeeSchema,
  choixModeleCopiloteSchema,
  EXPIRATION_ACTION_COPILOTE_MINUTES,
  FENETRE_MESSAGES_COPILOTE_MINUTES,
  IDENTIFIANTS_ACTIONS_COPILOTE,
  IDENTIFIANTS_OUTILS_COPILOTE,
  MESSAGE_COPILOTE_LONGUEUR_MAX,
  MESSAGES_COPILOTE_PAR_FENETRE,
  messageCopiloteSchema,
  reponseCopiloteSchema,
  resultatActionCopiloteSchema,
} from "../index";

const ID = "11111111-1111-4111-8111-111111111111";

describe("message du copilote (AGT-08)", () => {
  it("borne le message à 1 000 caractères et refuse le vide et les contrôles", () => {
    expect(messageCopiloteSchema.parse({ message: "  mes tâches  " })).toEqual({
      message: "mes tâches",
    });
    expect(
      messageCopiloteSchema.safeParse({ message: "a".repeat(MESSAGE_COPILOTE_LONGUEUR_MAX) })
        .success,
    ).toBe(true);
    expect(
      messageCopiloteSchema.safeParse({ message: "a".repeat(MESSAGE_COPILOTE_LONGUEUR_MAX + 1) })
        .success,
    ).toBe(false);
    for (const ko of ["", "   ", "a\u0000b"]) {
      expect(messageCopiloteSchema.safeParse({ message: ko }).success).toBe(false);
    }
  });

  it("n'admet que la mission du contexte, par identifiant, et aucune clé inconnue", () => {
    expect(
      messageCopiloteSchema.safeParse({ message: "x", contexte: { mission_id: ID } }).success,
    ).toBe(true);
    for (const ko of [
      { message: "x", contexte: { mission_id: "abc" } },
      { message: "x", contexte: { mission_id: ID, autre: 1 } },
      { message: "x", role: "associe" },
      { message: "x", outil: "mes_taches" },
    ]) {
      expect(messageCopiloteSchema.safeParse(ko).success).toBe(false);
    }
  });

  it("fixe les limites : 5 minutes d'expiration, 30 messages par 10 minutes", () => {
    expect(EXPIRATION_ACTION_COPILOTE_MINUTES).toBe(5);
    expect(MESSAGES_COPILOTE_PAR_FENETRE).toBe(30);
    expect(FENETRE_MESSAGES_COPILOTE_MINUTES).toBe(10);
  });
});

describe("choix du modèle de langage : liste fermée, paramètres stricts", () => {
  it("accepte un choix valide par outil", () => {
    for (const outil of ["mes_taches", "mes_feuilles_temps", "kpi_rouges", "factures_echues"]) {
      expect(choixModeleCopiloteSchema.parse({ outil, parametres: {} })).toEqual({
        outil,
        parametres: {},
      });
      // Sans « parametres » : valeur par défaut.
      expect(choixModeleCopiloteSchema.parse({ outil }).parametres).toEqual({});
    }
    expect(
      choixModeleCopiloteSchema.parse({ outil: "recherche", parametres: { texte: " plan " } }),
    ).toEqual({ outil: "recherche", parametres: { texte: "plan" } });
    expect(
      choixModeleCopiloteSchema.parse({ outil: "resume_mission", parametres: { mission: null } }),
    ).toEqual({ outil: "resume_mission", parametres: { mission: undefined } });
    expect(choixModeleCopiloteSchema.parse({ outil: "resume_mission" }).parametres).toEqual({});
    expect(
      choixModeleCopiloteSchema.parse({
        outil: "creer_tache",
        parametres: { titre: "Relancer", echeance: "2026-11-15", pour: null },
      }),
    ).toEqual({
      outil: "creer_tache",
      parametres: {
        titre: "Relancer",
        echeance: "2026-11-15",
        pour: undefined,
        mission: undefined,
      },
    });
    expect(choixModeleCopiloteSchema.parse({ outil: "aucun" }).outil).toBe("aucun");
  });

  it("refuse un outil hors catalogue, une clé en trop, un type erroné ou un identifiant", () => {
    for (const ko of [
      { outil: "supprimer_mission", parametres: {} },
      { outil: "mes_taches", parametres: { mission_id: ID } },
      { outil: "mes_taches", parametres: {}, confirme: true },
      { outil: "recherche", parametres: {} },
      { outil: "recherche", parametres: { texte: "a" } },
      { outil: "recherche", parametres: { texte: 42 } },
      { outil: "creer_tache", parametres: { titre: "" } },
      { outil: "creer_tache", parametres: { titre: "x", echeance: "2026-02-31" } },
      { outil: "creer_tache", parametres: { titre: "x", echeance: "2300-01-01" } },
      { outil: "creer_tache", parametres: { titre: "x", assignee_id: ID } },
      { outil: "creer_tache", parametres: { titre: "x".repeat(201) } },
      { outil: "resume_mission", parametres: { mission_id: ID } },
      "mes_taches",
      null,
      [],
    ]) {
      expect(choixModeleCopiloteSchema.safeParse(ko).success).toBe(false);
    }
  });

  it("couvre exactement les outils du catalogue, plus « aucun »", () => {
    for (const outil of IDENTIFIANTS_OUTILS_COPILOTE) {
      const parametres =
        outil === "recherche" ? { texte: "plan" } : outil === "creer_tache" ? { titre: "x" } : {};
      expect(choixModeleCopiloteSchema.safeParse({ outil, parametres }).success).toBe(true);
    }
    expect([...IDENTIFIANTS_ACTIONS_COPILOTE]).toEqual(["creer_tache"]);
    expect(IDENTIFIANTS_OUTILS_COPILOTE).toHaveLength(7);
  });
});

describe("réponses du copilote", () => {
  it("le lien d'un élément est un lien INTERNE sûr (même règle que les notifications)", () => {
    const base = {
      mode: "deterministe",
      outil: "mes_taches",
      statut: "ok",
      texte: "Ok.",
    };
    const avec = (lien: string) =>
      reponseCopiloteSchema.safeParse({ ...base, elements: [{ libelle: "A", lien }] }).success;
    for (const ok of ["/mes-taches", "/missions/abc/kpi", "/temps?semaine=2030-01-07"]) {
      expect(avec(ok), ok).toBe(true);
    }
    for (const ko of [
      "//exemple.test",
      "//exemple.test/x",
      "/\\exemple.test",
      "javascript:alert(1)",
      "https://exemple.test",
      "mes-taches",
      "/mes taches",
      "/mes-taches\n",
      "/mes\u0000taches",
      "/mes\ttaches",
      "",
    ]) {
      expect(avec(ko), JSON.stringify(ko)).toBe(false);
    }
  });

  it("valide la réponse d'un outil et refuse toute clé inconnue", () => {
    const ok = {
      mode: "deterministe",
      repli: "ia_desactivee",
      outil: "mes_taches",
      statut: "ok",
      texte: "Vous n'avez aucune tâche ouverte.",
      elements: [{ libelle: "A", lien: "/mes-taches" }],
    };
    expect(reponseCopiloteSchema.safeParse(ok).success).toBe(true);
    expect(reponseCopiloteSchema.safeParse({ ...ok, cout_micro_usd: 3 }).success).toBe(false);
    expect(reponseCopiloteSchema.safeParse({ ...ok, outil: "supprimer" }).success).toBe(false);
    expect(
      reponseCopiloteSchema.safeParse({
        ...ok,
        elements: [{ libelle: "A", lien: "https://exemple.test" }],
      }).success,
    ).toBe(false);
    expect(
      reponseCopiloteSchema.safeParse({
        ...ok,
        elements: Array.from({ length: 11 }, () => ({ libelle: "A", lien: "/x" })),
      }).success,
    ).toBe(false);
  });

  it("une action proposée porte son identifiant, son résumé et son expiration", () => {
    const action = {
      action_id: ID,
      outil: "creer_tache",
      libelle: "Créer une tâche",
      resume: "Créer la tâche « X », pour vous, sans échéance, sans mission liée.",
      expire_le: "2026-10-12T10:05:00.000Z",
    };
    expect(actionProposeeSchema.safeParse(action).success).toBe(true);
    expect(actionProposeeSchema.safeParse({ ...action, outil: "mes_taches" }).success).toBe(false);
    expect(actionProposeeSchema.safeParse({ ...action, action_id: "x" }).success).toBe(false);
    expect(
      resultatActionCopiloteSchema.safeParse({ statut: "annulee", texte: "ok", elements: [] })
        .success,
    ).toBe(true);
    expect(
      resultatActionCopiloteSchema.safeParse({ statut: "proposee", texte: "ok", elements: [] })
        .success,
    ).toBe(false);
  });
});
