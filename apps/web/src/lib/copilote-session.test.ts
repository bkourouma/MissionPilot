import { describe, expect, it } from "vitest";
import type { ReponseCopilote } from "@missionpilot/shared";
import { ajouterQuestion, ajouterReponse, type EntreeCopilote, type EntreeFil } from "./copilote";
import {
  CLE_CONVERSATION,
  ECHANGES_CONSERVES_MAX,
  effacerConversation,
  INACTIVITE_MAX_MS,
  limiterEchanges,
  restaurerConversation,
  sauvegarderConversation,
  stockageSession,
  type StockageMinimal,
} from "./copilote-session";

const ID = "11111111-1111-4111-8111-111111111111";
const T0 = 1_760_000_000_000;
const P = "utilisateur-1";

const stockageMemoire = (): StockageMinimal & { donnees: Map<string, string> } => {
  const donnees = new Map<string, string>();
  return {
    donnees,
    getItem: (c) => donnees.get(c) ?? null,
    setItem: (c, v) => void donnees.set(c, v),
    removeItem: (c) => void donnees.delete(c),
  };
};

const reponse = (extra: Partial<ReponseCopilote> = {}): ReponseCopilote => ({
  mode: "deterministe",
  outil: "mes_taches",
  statut: "ok",
  texte: "Vous n'avez aucune tâche ouverte.",
  elements: [],
  ...extra,
});

const action = {
  action_id: ID,
  outil: "creer_tache" as const,
  libelle: "Créer une tâche",
  resume: "Créer la tâche « X ».",
  expire_le: "2026-10-12T10:05:00.000Z",
};

const filSimple = (): EntreeFil[] =>
  ajouterReponse(ajouterQuestion([], "q1", "mes tâches"), "r1", reponse());

const filAvecAction = (): EntreeFil[] =>
  ajouterReponse(
    ajouterQuestion([], "q1", "crée une tâche : x"),
    "r1",
    reponse({ statut: "action_proposee", outil: "creer_tache", action }),
  );

describe("conservation de la conversation dans l'onglet", () => {
  it("écrit puis relit le fil (ids régénérés, aucune erreur conservée)", () => {
    const s = stockageMemoire();
    const fil: EntreeFil[] = [...filSimple(), { id: "e1", auteur: "erreur", texte: "Échec" }];
    sauvegarderConversation(s, P, fil, T0);
    const lu = restaurerConversation(s, P, T0 + 60_000);
    expect(lu.map((e) => e.auteur)).toEqual(["utilisateur", "copilote"]);
    expect(lu[0]).toMatchObject({ texte: "mes tâches" });
    expect((lu[1] as EntreeCopilote).reponse.texte).toContain("aucune tâche");
    expect((lu[1] as EntreeCopilote).propositionExpiree).toBe(false);
  });

  it("n'écrit aucun identifiant d'action en attente", () => {
    const s = stockageMemoire();
    sauvegarderConversation(s, P, filAvecAction(), T0);
    const brut = s.donnees.get(CLE_CONVERSATION) ?? "";
    expect(brut).not.toContain(ID);
    expect(brut).not.toContain("expire_le");
    expect(brut).not.toContain("action_id");
  });

  it("une proposition en attente n'est pas restaurée : message seul, marqué expiré", () => {
    const s = stockageMemoire();
    sauvegarderConversation(s, P, filAvecAction(), T0);
    const r = restaurerConversation(s, P, T0 + 1000)[1] as EntreeCopilote;
    expect(r.reponse.action).toBeUndefined();
    expect(r.etatAction).toBeNull();
    expect(r.propositionExpiree).toBe(true);
  });

  it("une action déjà traitée (confirmée) n'est pas marquée expirée", () => {
    const s = stockageMemoire();
    const fil = filAvecAction().map((e) =>
      e.id === "r1" ? { ...e, etatAction: "confirmee" as const } : e,
    );
    sauvegarderConversation(s, P, fil, T0);
    const r = restaurerConversation(s, P, T0)[1] as EntreeCopilote;
    expect(r.propositionExpiree).toBe(false);
    expect(r.reponse.action).toBeUndefined();
  });

  it("expire après 30 minutes d'inactivité et vide le stockage", () => {
    const s = stockageMemoire();
    sauvegarderConversation(s, P, filSimple(), T0);
    expect(restaurerConversation(s, P, T0 + INACTIVITE_MAX_MS)).toHaveLength(2);
    expect(restaurerConversation(s, P, T0 + INACTIVITE_MAX_MS + 1)).toEqual([]);
    expect(s.donnees.has(CLE_CONVERSATION)).toBe(false);
  });

  it("plafonne à 20 échanges (les plus récents)", () => {
    let fil: EntreeFil[] = [];
    for (let i = 0; i < ECHANGES_CONSERVES_MAX + 5; i += 1) {
      fil = ajouterQuestion(fil, `q${i}`, `question ${i}`);
      fil = ajouterReponse(fil, `r${i}`, reponse({ texte: `réponse ${i}` }));
    }
    expect(limiterEchanges(fil)).toHaveLength(ECHANGES_CONSERVES_MAX * 2);
    const s = stockageMemoire();
    sauvegarderConversation(s, P, fil, T0);
    const lu = restaurerConversation(s, P, T0);
    expect(lu).toHaveLength(ECHANGES_CONSERVES_MAX * 2);
    expect(lu[0]).toMatchObject({ texte: "question 5" });
  });

  it("ignore et efface des données corrompues ou invalides", () => {
    const enveloppe = (fil: unknown, maj: unknown = T0) =>
      JSON.stringify({ v: 1, portee: P, maj, fil });
    const cas = [
      "pas du json",
      "null",
      JSON.stringify({ v: 2, portee: P, maj: T0, fil: [] }),
      enveloppe([], "hier"),
      enveloppe("x"),
      enveloppe([{ a: "z" }]),
      enveloppe([{ a: "c", reponse: { texte: 1 }, expiree: false }]),
      enveloppe([{ a: "c", reponse: { ...reponse(), pirate: true }, expiree: false }]),
      enveloppe([], T0 + 10 * INACTIVITE_MAX_MS),
    ];
    for (const brut of cas) {
      const s = stockageMemoire();
      s.donnees.set(CLE_CONVERSATION, brut);
      expect(restaurerConversation(s, P, T0), brut).toEqual([]);
      expect(s.donnees.has(CLE_CONVERSATION), brut).toBe(false);
    }
  });

  it("ne rend jamais la conversation d'un autre utilisateur", () => {
    const s = stockageMemoire();
    sauvegarderConversation(s, P, filSimple(), T0);
    expect(restaurerConversation(s, "autre", T0)).toEqual([]);
    expect(s.donnees.has(CLE_CONVERSATION)).toBe(false);
  });

  it("effacer supprime tout ; un fil vide supprime aussi la copie", () => {
    const s = stockageMemoire();
    sauvegarderConversation(s, P, filSimple(), T0);
    effacerConversation(s);
    expect(s.donnees.size).toBe(0);
    sauvegarderConversation(s, P, filSimple(), T0);
    sauvegarderConversation(s, P, [], T0);
    expect(s.donnees.size).toBe(0);
  });

  it("fonctionne sans stockage (indisponible, plein ou qui lève)", () => {
    expect(restaurerConversation(null, P, T0)).toEqual([]);
    expect(() => sauvegarderConversation(null, P, filSimple(), T0)).not.toThrow();
    expect(() => effacerConversation(null)).not.toThrow();
    const casse: StockageMinimal = {
      getItem: () => {
        throw new Error("refusé");
      },
      setItem: () => {
        throw new Error("plein");
      },
      removeItem: () => {
        throw new Error("refusé");
      },
    };
    expect(() => sauvegarderConversation(casse, P, filSimple(), T0)).not.toThrow();
    expect(restaurerConversation(casse, P, T0)).toEqual([]);
    expect(() => effacerConversation(casse)).not.toThrow();
    // Hors navigateur (environnement node) : pas de stockage.
    expect(stockageSession()).toBeNull();
  });
});
