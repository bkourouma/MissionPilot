import { describe, expect, it } from "vitest";
import type { ReponseCopilote, Role } from "@missionpilot/shared";
import { IDENTIFIANTS_OUTILS_COPILOTE } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import {
  actionDe,
  afficherLigneExpiration,
  ajouterErreur,
  ajouterQuestion,
  ajouterReponse,
  borner,
  cheminAnnulation,
  cheminConfirmation,
  corpsMessage,
  estExpiree,
  estSuggestionComplete,
  etatApresErreur,
  FIL_MAX,
  libelleCompteur,
  libelleExpiration,
  libelleMode,
  libelleOutil,
  LIBELLES_OUTILS,
  MENTION_CONFIDENTIALITE,
  peutReformuler,
  questionAvant,
  saisieApresEnvoi,
  SUGGESTIONS,
  lienSur,
  lireMissionContexte,
  majAction,
  messageErreurCopilote,
  peutDecider,
  secondesRestantes,
  suggestionsPour,
  validerSaisie,
  type EntreeCopilote,
  type EntreeFil,
} from "./copilote";

const ID = "11111111-1111-4111-8111-111111111111";

const reponse = (extra: Partial<ReponseCopilote> = {}): ReponseCopilote => ({
  mode: "deterministe",
  repli: "ia_desactivee",
  outil: "mes_taches",
  statut: "ok",
  texte: "Vous n'avez aucune tâche ouverte.",
  elements: [],
  ...extra,
});

describe("suggestions selon les droits", () => {
  it("un consultant n'a ni les factures ni la création de tâche", () => {
    const s = suggestionsPour(["consultant" as Role]);
    expect(s).toContain("Quelles sont mes tâches en retard ?");
    expect(s).toContain("Quels KPI sont au rouge sur mes missions ?");
    expect(s.some((x) => x.includes("factures"))).toBe(false);
    expect(s.some((x) => x.startsWith("Crée une tâche"))).toBe(false);
  });

  it("un associé a toutes les suggestions, un gestionnaire pas les KPI", () => {
    expect(suggestionsPour(["associe" as Role])).toHaveLength(7);
    const g = suggestionsPour(["gestionnaire" as Role]);
    expect(g.some((x) => x.includes("factures"))).toBe(true);
    expect(g.some((x) => x.includes("KPI"))).toBe(false);
  });

  it("un chef de mission n'a pas la suggestion des factures échues (l'outil du serveur la refuse)", () => {
    const s = suggestionsPour(["chef_mission" as Role]);
    expect(s.some((x) => x.includes("factures"))).toBe(false);
  });

  it("sans rôle : seule la question ouverte à tous", () => {
    expect(suggestionsPour([])).toEqual(["Quelles sont mes tâches en retard ?"]);
  });
});

describe("suggestions à compléter", () => {
  it("part tout de suite si elle est complète, sinon remplit le champ", () => {
    expect(estSuggestionComplete("Quelles factures sont échues ?")).toBe(true);
    for (const a of ["Où en est la mission…", "Cherche ", "Ajoute un commentaire : "]) {
      expect(estSuggestionComplete(a), a).toBe(false);
    }
  });
});

describe("saisie", () => {
  it("refuse le vide, les contrôles et plus de 1 000 caractères", () => {
    expect(validerSaisie("   ")).toEqual({ ok: false, erreur: "Saisissez une question." });
    expect(validerSaisie("a".repeat(1001))).toMatchObject({ ok: false });
    expect((validerSaisie("a".repeat(1001)) as { erreur: string }).erreur).toContain("1000");
    expect(validerSaisie("a\u0000b")).toMatchObject({ ok: false });
    expect(validerSaisie("  mes tâches  ")).toEqual({ ok: true, texte: "mes tâches" });
    expect(validerSaisie("a".repeat(1000))).toMatchObject({ ok: true });
  });

  it("compteur, corps de requête, mission du contexte", () => {
    expect(libelleCompteur(12)).toBe("12 / 1000 caractères");
    expect(corpsMessage("x", null)).toEqual({ message: "x" });
    expect(corpsMessage("x", ID)).toEqual({ message: "x", contexte: { mission_id: ID } });
    expect(lireMissionContexte({ mission: ID.toUpperCase() })).toBe(ID);
    expect(lireMissionContexte({ mission: "abc" })).toBeNull();
    expect(lireMissionContexte({ mission: [ID] })).toBeNull();
    expect(lireMissionContexte({})).toBeNull();
  });

  it("chemins d'API", () => {
    expect(cheminConfirmation(ID)).toBe(`/api/copilote/actions/${ID}/confirmer`);
    expect(cheminAnnulation(ID)).toBe(`/api/copilote/actions/${ID}/annuler`);
    expect(cheminConfirmation("a/b")).toBe("/api/copilote/actions/a%2Fb/confirmer");
  });
});

describe("liens", () => {
  it("n'admet que des liens internes", () => {
    expect(lienSur("/missions/1")).toBe("/missions/1");
    expect(lienSur("/temps?semaine=2026-10-05")).toBe("/temps?semaine=2026-10-05");
    for (const ko of [
      "https://exemple.test",
      "//exemple.test",
      "/\\exemple",
      "javascript:alert(1)",
      "missions",
      "/a\u0000b",
    ]) {
      expect(lienSur(ko), ko).toBe("/");
    }
  });
});

describe("mode et erreurs", () => {
  it("signale le mode sans IA et sa raison", () => {
    expect(libelleMode(reponse())).toBe(
      "Mode sans IA : l'IA n'est pas activée pour votre cabinet.",
    );
    expect(libelleMode(reponse({ repli: "indisponible" }))).toContain("momentanément indisponible");
    expect(libelleMode(reponse({ repli: "non_autorisee" }))).toBe(
      "Mode sans IA : l'IA n'est pas ouverte à votre rôle.",
    );
    expect(libelleMode(reponse({ repli: undefined }))).toBe("Mode sans IA");
    expect(libelleMode(reponse({ mode: "ia", repli: undefined }))).toBe(
      "Demande routée par l'IA du cabinet",
    );
  });

  it("messages d'erreur en français : 429, coupe-circuit, expiration, autres", () => {
    expect(messageErreurCopilote(new ErreurApi("TROP_DE_MESSAGES_COPILOTE", "x", 429))).toContain(
      "trop de messages",
    );
    expect(messageErreurCopilote(new ErreurApi("COPILOTE_DESACTIVE", "x", 409))).toBe(
      "Le copilote est désactivé par votre cabinet.",
    );
    expect(
      messageErreurCopilote(new ErreurApi("ACTION_EXPIREE", "Cette proposition a expiré.", 410)),
    ).toBe("Cette proposition a expiré.");
    expect(messageErreurCopilote(new ErreurApi("CONFLIT", "Déjà confirmée.", 409))).toBe(
      "Déjà confirmée.",
    );
    expect(messageErreurCopilote(new ErreurApi("INTROUVABLE", "Introuvable.", 404))).toBe(
      "Introuvable.",
    );
    expect(messageErreurCopilote(new ErreurApi("INTERDIT", "x", 403))).toContain("rôle");
    expect(messageErreurCopilote(new Error("boom"))).toContain("inattendue");
  });
});

describe("état d'une carte après un échec", () => {
  it("expirée, refusée sans réessai, ou ouverte pour réessayer", () => {
    expect(etatApresErreur(new ErreurApi("ACTION_EXPIREE", "x", 410))).toBe("expiree");
    for (const statut of [403, 404, 409]) {
      expect(etatApresErreur(new ErreurApi("X", "x", statut))).toBe("refusee");
    }
    expect(etatApresErreur(new ErreurApi("REQUETE_INVALIDE", "x", 400))).toBe("erreur");
    expect(etatApresErreur(new ErreurApi("RESEAU_INDISPONIBLE", "x", 0))).toBe("erreur");
    expect(etatApresErreur(new Error("x"))).toBe("erreur");
  });
});

describe("expiration d'une proposition", () => {
  const t0 = new Date("2026-10-12T10:00:00.000Z");
  const expire = "2026-10-12T10:05:00.000Z";

  it("compte à rebours en minutes puis en dessous d'une minute", () => {
    expect(secondesRestantes(expire, t0)).toBe(300);
    expect(libelleExpiration(expire, t0)).toBe("Expire dans 5 minutes.");
    expect(libelleExpiration(expire, new Date("2026-10-12T10:04:00.000Z"))).toBe(
      "Expire dans 1 minute.",
    );
    expect(libelleExpiration(expire, new Date("2026-10-12T10:04:30.000Z"))).toBe(
      "Expire dans moins d'une minute.",
    );
    expect(estExpiree(expire, t0)).toBe(false);
  });

  it("expirée à l'échéance et au-delà ; date illisible traitée comme expirée", () => {
    const fin = new Date(expire);
    expect(secondesRestantes(expire, fin)).toBe(0);
    expect(estExpiree(expire, fin)).toBe(true);
    expect(libelleExpiration(expire, new Date("2026-10-12T11:00:00.000Z"))).toContain("a expiré");
    expect(secondesRestantes("pas une date", t0)).toBeNull();
    expect(estExpiree("pas une date", t0)).toBe(true);
    expect(libelleExpiration("pas une date", t0)).toBe("Délai de validité inconnu.");
  });

  it("les boutons ne s'offrent qu'à une proposition ouverte (ou en échec, pour réessayer)", () => {
    expect(peutDecider("proposee")).toBe(true);
    expect(peutDecider("erreur")).toBe(true);
    for (const e of ["en_cours", "confirmee", "annulee", "expiree", "refusee"] as const) {
      expect(peutDecider(e)).toBe(false);
    }
  });
});

describe("fil de conversation", () => {
  const action = {
    action_id: ID,
    outil: "creer_tache" as const,
    libelle: "Créer une tâche",
    resume: "Créer la tâche « X », pour vous, sans échéance, sans mission liée.",
    expire_le: "2026-10-12T10:05:00.000Z",
  };

  it("ajoute question, réponse et erreur dans l'ordre", () => {
    let fil: EntreeFil[] = [];
    fil = ajouterQuestion(fil, "q1", "mes tâches");
    fil = ajouterReponse(fil, "r1", reponse());
    fil = ajouterErreur(fil, "e1", "Échec");
    expect(fil.map((e) => [e.id, e.auteur])).toEqual([
      ["q1", "utilisateur"],
      ["r1", "copilote"],
      ["e1", "erreur"],
    ]);
    const r = fil[1] as EntreeCopilote;
    expect(r.etatAction).toBeNull();
    expect(actionDe(r)).toBeNull();
  });

  it("une action proposée ouvre une carte « proposee », mise à jour sans toucher aux autres entrées", () => {
    let fil = ajouterQuestion([], "q1", "crée une tâche : x");
    fil = ajouterReponse(
      fil,
      "r1",
      reponse({ statut: "action_proposee", outil: "creer_tache", action }),
    );
    const r = fil[1] as EntreeCopilote;
    expect(r.etatAction).toBe("proposee");
    expect(actionDe(r)).toEqual(action);
    const apres = majAction(fil, "r1", {
      etatAction: "confirmee",
      resultat: { statut: "confirmee", texte: "ok", elements: [] },
    });
    expect((apres[1] as EntreeCopilote).etatAction).toBe("confirmee");
    expect((apres[1] as EntreeCopilote).resultat?.texte).toBe("ok");
    expect(apres[0]).toBe(fil[0]);
    // Identifiant inconnu ou entrée qui n'est pas du copilote : rien ne change.
    expect(majAction(fil, "q1", { etatAction: "annulee" })[0]).toBe(fil[0]);
    expect(majAction(fil, "zzz", { etatAction: "annulee" })).toEqual(fil);
  });

  it(`conserve ${FIL_MAX} entrées au plus`, () => {
    let fil: EntreeFil[] = [];
    for (let i = 0; i < FIL_MAX + 5; i += 1) fil = ajouterQuestion(fil, `q${i}`, "x");
    expect(fil).toHaveLength(FIL_MAX);
    expect(fil[0]?.id).toBe("q5");
    expect(borner(fil)).toHaveLength(FIL_MAX);
  });
});

describe("aucune action proposée en dur", () => {
  it("les suggestions sont des lectures : pas de création, commentaire ni relance", () => {
    for (const x of SUGGESTIONS) {
      expect(x.texte, x.texte).not.toMatch(/^(Crée|Ajoute|Relance|Planifie)/i);
    }
    expect(suggestionsPour(["associe" as Role]).some((x) => /tâche :/.test(x))).toBe(false);
    expect(suggestionsPour(["associe" as Role])).toContain("Quelles sont mes missions en retard ?");
    expect(suggestionsPour([])[0]).toBe("Quelles sont mes tâches en retard ?");
  });
});

describe("champ de saisie après l'envoi", () => {
  it("vidé quand le serveur répond, y compris pour un refus ou « non compris »", () => {
    expect(saisieApresEnvoi("crée une tâche : x", "crée une tâche : x", true)).toBe("");
    expect(saisieApresEnvoi("  texte  ", "texte", true)).toBe("");
  });

  it("conservé quand la requête échoue", () => {
    expect(saisieApresEnvoi("texte", "texte", false)).toBe("texte");
    expect(saisieApresEnvoi("", "texte", false)).toBe("texte");
  });

  it("ne remplace jamais ce que l'utilisateur a tapé entre-temps", () => {
    expect(saisieApresEnvoi("autre", "texte", true)).toBe("autre");
    expect(saisieApresEnvoi("autre", "texte", false)).toBe("autre");
  });
});

describe("reprise après refus ou expiration", () => {
  it("seuls un refus et une expiration proposent de reformuler", () => {
    expect(peutReformuler("refusee")).toBe(true);
    expect(peutReformuler("expiree")).toBe(true);
    for (const e of ["proposee", "en_cours", "confirmee", "annulee", "erreur"] as const) {
      expect(peutReformuler(e)).toBe(false);
    }
  });

  it("retrouve la question qui précède la réponse", () => {
    let fil = ajouterQuestion([], "q1", "première");
    fil = ajouterReponse(fil, "r1", reponse());
    fil = ajouterQuestion(fil, "q2", "seconde");
    fil = ajouterReponse(fil, "r2", reponse());
    expect(questionAvant(fil, "r1")).toBe("première");
    expect(questionAvant(fil, "r2")).toBe("seconde");
    expect(questionAvant(fil, "q1")).toBeNull();
    expect(questionAvant(fil, "inconnu")).toBeNull();
  });
});

describe("libellés des outils et confidentialité", () => {
  it("chaque outil du schéma partagé a son libellé français", () => {
    expect(Object.keys(LIBELLES_OUTILS).sort()).toEqual([...IDENTIFIANTS_OUTILS_COPILOTE].sort());
    expect(libelleOutil("missions_en_retard")).toBe("Mes missions en retard");
    expect(libelleOutil("retard_feuilles_temps")).toBe("Retards sur les feuilles de temps");
    expect(libelleOutil("ajouter_commentaire")).toBe("Ajouter un commentaire");
    expect(libelleOutil("planifier_relance")).toBe("Relancer une facture échue");
    expect(libelleOutil(null)).toBeNull();
  });

  it("la mention distingue noms enregistrés (masqués) et texte libre (non masqué)", () => {
    expect(MENTION_CONFIDENTIALITE).toContain("déjà enregistrés");
    expect(MENTION_CONFIDENTIALITE).toContain("ne sont pas masqués");
    expect(MENTION_CONFIDENTIALITE).toContain("informations confidentielles");
  });
});

describe("ligne d'expiration et reprise", () => {
  it("la consigne d'expiration n'apparaît qu'une fois : ligne masquée si la reprise s'affiche", () => {
    expect(afficherLigneExpiration(true, true, true)).toBe(false);
    expect(afficherLigneExpiration(true, true, false)).toBe(true);
    expect(afficherLigneExpiration(true, false, false)).toBe(true);
    expect(afficherLigneExpiration(false, false, false)).toBe(false);
  });
});
