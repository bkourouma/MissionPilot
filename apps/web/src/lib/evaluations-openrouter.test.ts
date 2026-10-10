import { STATUTS_EVALUATION_OPENROUTER, CAUSES_EVALUATION_OPENROUTER } from "@missionpilot/shared";
import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  ajouterPage,
  CAUSES_CONNUES,
  cheminDemandeEvaluation,
  cheminDemandesEvaluation,
  cheminLancementEvaluation,
  consequenceStatut,
  detailCoutCas,
  droitsEvaluationOpenRouter,
  ECHECS_SONDAGE_MAX,
  estEnAttente,
  etatCas,
  formaterCoutDemande,
  fusionnerDemande,
  INTERVALLE_SONDAGE_MS,
  LIBELLES_CAUSE,
  LIBELLES_STATUT,
  libelleCause,
  libelleProgression,
  libelleRegressions,
  libelleReussite,
  libelleStatut,
  lignesCout,
  lireModeleCandidat,
  lirePromptPreselectionne,
  messageLancementEvaluation,
  noteReference,
  plafondConnu,
  possibiliteLancement,
  questionConfirmation,
  raisonsCas,
  REGLE_PRODUCTION,
  sondageContinue,
  SONDAGES_MAX,
  STATUTS_CONNUS,
  tonaliteStatut,
  type DemandeEvaluationOpenRouter,
} from "./evaluations-openrouter";

const demande = (d: Partial<DemandeEvaluationOpenRouter> = {}): DemandeEvaluationOpenRouter => ({
  demande_id: "d1",
  prompt_id: "p1",
  prompt_nom: "synthese",
  prompt_version: 2,
  jeu_version: 1,
  modele: "openai/gpt-4o-mini",
  statut: "reussie",
  cause: null,
  evaluation_id: "e1",
  cas_total: 3,
  cas_traites: 3,
  cas_reussis: 3,
  regressions: 0,
  appels: 3,
  demande_par_nom: "Awa",
  cree_le: "2026-10-10T09:00:00Z",
  debut_le: "2026-10-10T09:00:05Z",
  termine_le: "2026-10-10T09:01:00Z",
  resultats: [],
  ...d,
});

// Code brut : majuscules et soulignés, sans espace (« CAS_ECHOUES »), jamais lisible par un utilisateur.
const CODE_BRUT = /^[A-Z][A-Z0-9_]+$/;

describe("statuts d'une demande de rejeu réel", () => {
  it("l'API connaît six statuts, tous libellés en français", () => {
    expect([...STATUTS_CONNUS]).toEqual([...STATUTS_EVALUATION_OPENROUTER]);
    expect(STATUTS_CONNUS).toHaveLength(6);
    for (const s of STATUTS_EVALUATION_OPENROUTER) {
      const l = libelleStatut(s);
      expect(l).toBe(LIBELLES_STATUT[s]);
      expect(l).not.toMatch(CODE_BRUT);
      expect(l).not.toBe("Statut inconnu");
      expect(consequenceStatut(s)).not.toBe("");
    }
  });

  it("libellés exacts", () => {
    expect(libelleStatut("en_file")).toBe("En file d'attente");
    expect(libelleStatut("en_cours")).toBe("En cours");
    expect(libelleStatut("reussie")).toBe("Réussie");
    expect(libelleStatut("echouee")).toBe("Échouée");
    expect(libelleStatut("incomplete")).toBe("Incomplète");
    expect(libelleStatut("ignoree")).toBe("Ignorée");
  });

  it("un statut inconnu n'affiche jamais le code brut", () => {
    expect(libelleStatut("nouveau_statut")).toBe("Statut inconnu");
    expect(tonaliteStatut("nouveau_statut")).toBe("neutre");
    expect(consequenceStatut("nouveau_statut")).toBe("");
  });

  it("tonalité : seule la réussite est verte, l'échec est rouge", () => {
    expect(tonaliteStatut("reussie")).toBe("succes");
    expect(tonaliteStatut("echouee")).toBe("danger");
    expect(tonaliteStatut("incomplete")).toBe("attention");
    expect(tonaliteStatut("en_cours")).toBe("attention");
    expect(tonaliteStatut("en_file")).toBe("neutre");
    expect(tonaliteStatut("ignoree")).toBe("neutre");
  });

  it("seules la file et l'exécution sont des états à rafraîchir", () => {
    expect(estEnAttente("en_file")).toBe(true);
    expect(estEnAttente("en_cours")).toBe(true);
    for (const s of ["reussie", "echouee", "incomplete", "ignoree"]) {
      expect(estEnAttente(s)).toBe(false);
    }
  });

  it("seule une évaluation réussie débloque l'activation, le texte le dit", () => {
    expect(consequenceStatut("reussie")).toContain("peut être activée");
    for (const s of ["echouee", "incomplete", "ignoree"]) {
      expect(consequenceStatut(s)).not.toContain("peut être activée");
      expect(consequenceStatut(s)).toMatch(/relancez|ne peut pas|rien/i);
    }
  });
});

describe("causes d'échec, d'arrêt ou d'abandon", () => {
  // Causes de l'API : liste du schéma partagé (une cause sans libellé fait échouer ce test).
  const CAUSES_API: readonly string[] = CAUSES_EVALUATION_OPENROUTER;

  it("chaque cause de l'API a une phrase française, jamais le code brut", () => {
    expect([...CAUSES_CONNUES].sort()).toEqual([...CAUSES_API].sort());
    for (const c of CAUSES_API) {
      const l = libelleCause(c);
      expect(l, c).toBe(LIBELLES_CAUSE[c]);
      expect(l, c).toBeTruthy();
      expect(l, c).not.toContain(c);
      expect(l, c).toMatch(/ /);
      expect((l as string).length).toBeGreaterThan(20);
    }
  });

  it("les causes sans appel disent qu'aucun appel n'a été fait", () => {
    for (const c of [
      "IA_NON_CONFIGUREE",
      "JEU_ESSAI_CHANGE",
      "JEU_ESSAI_INVALIDE",
      "MODELE_NON_AUTORISE",
      "FOURNISSEUR_NON_REEL",
    ]) {
      expect(libelleCause(c), c).toContain("aucun appel n'a été fait");
    }
  });

  it("les causes d'arrêt par plafond disent que des cas n'ont pas été rejoués", () => {
    for (const c of ["PLAFOND_EVALUATION", "PLAFOND_IA_ATTEINT", "DUREE_MAX_ATTEINTE"]) {
      expect(libelleCause(c), c).toContain("n'ont pas été rejoués");
    }
  });

  it("une erreur du fournisseur rappelle qu'on ne répète pas un appel payant", () => {
    expect(libelleCause("ERREUR_INATTENDUE")).toContain("jamais répété");
    expect(libelleCause("DELAI_DEPASSE")).toContain("aucune nouvelle tentative");
  });

  it("pas de cause : rien à afficher ; cause inconnue : texte neutre sans code", () => {
    expect(libelleCause(null)).toBeNull();
    expect(libelleCause(undefined)).toBeNull();
    expect(libelleCause("")).toBeNull();
    const inconnue = libelleCause("CAUSE_FUTURE");
    expect(inconnue).toContain("cause non reconnue");
    expect(inconnue).not.toContain("CAUSE_FUTURE");
  });
});

describe("règle métier et confirmation avant un rejeu facturé", () => {
  it("explique les quatre points de la règle de production", () => {
    const texte = REGLE_PRODUCTION.join(" ");
    expect(REGLE_PRODUCTION).toHaveLength(4);
    expect(texte).toContain("seul un prompt dont l'évaluation sur OpenRouter est réussie");
    expect(texte).toContain("Une évaluation locale ne suffit pas");
    expect(texte).toContain("échouée ou incomplète");
    expect(texte).toContain("prompt, de modèle ou de jeu d'essai impose un nouveau rejeu");
    expect(texte).toContain("facturé");
    expect(texte).toContain("plafond mensuel du cabinet");
  });

  it("affiche le plafond par évaluation quand l'API le fournit (2 $US = 2 000 000 µUSD)", () => {
    const q = questionConfirmation(2_000_000);
    expect(q).toContain("plafonné à 2,00");
    expect(q).toContain("$US");
    expect(q).toContain("plafond mensuel du cabinet");
    expect(q).toContain("Lancer le rejeu réel sur OpenRouter ?");
  });

  it("sans plafond connu : « un rejeu est facturé », sans montant ni zéro", () => {
    for (const absent of [undefined, null, Number.NaN]) {
      const q = questionConfirmation(absent);
      expect(q).toContain("Un rejeu est facturé");
      expect(q).not.toContain("$US");
      expect(q).not.toContain("0,00");
    }
  });

  it("le plafond connu est celui de la demande la plus récente qui le porte", () => {
    expect(plafondConnu([])).toBeNull();
    expect(plafondConnu([demande()])).toBeNull();
    expect(
      plafondConnu([
        demande({ demande_id: "a" }),
        demande({ demande_id: "b", plafond_evaluation_micro_usd: 2_000_000 }),
        demande({ demande_id: "c", plafond_evaluation_micro_usd: 5_000_000 }),
      ]),
    ).toBe(2_000_000);
  });

  it("un plafond nul est un plafond (pas une absence)", () => {
    expect(plafondConnu([demande({ plafond_evaluation_micro_usd: 0 })])).toBe(0);
  });
});

describe("lancement : désactivé avec explication", () => {
  it("possible sans demande en cours avec le droit de gérer", () => {
    expect(possibiliteLancement(true, true, null)).toEqual({ possible: true, raison: null });
    for (const statut of ["reussie", "echouee", "incomplete", "ignoree"] as const) {
      expect(possibiliteLancement(true, true, { statut }).possible).toBe(true);
    }
  });

  it("désactivé si une demande est en file ou en cours", () => {
    for (const statut of ["en_file", "en_cours"] as const) {
      const p = possibiliteLancement(true, true, { statut });
      expect(p.possible).toBe(false);
      expect(p.raison).toContain("déjà en file ou en cours");
    }
  });

  it("désactivé sans le droit de gérer, avec l'explication du droit en premier", () => {
    const p = possibiliteLancement(false, true, { statut: "en_cours" });
    expect(p.possible).toBe(false);
    expect(p.raison).toContain("réservé aux rôles qui gèrent les agents IA");
  });

  it("désactivé sans version choisie", () => {
    const p = possibiliteLancement(true, false, null);
    expect(p.possible).toBe(false);
    expect(p.raison).toContain("Choisissez");
  });

  it("droits d'affichage : lire, lancer, voir les coûts", () => {
    expect(droitsEvaluationOpenRouter(["associe"])).toEqual({
      lire: true,
      lancer: true,
      voitCout: true,
    });
    expect(droitsEvaluationOpenRouter(["consultant"])).toEqual({
      lire: true,
      lancer: false,
      voitCout: false,
    });
    expect(droitsEvaluationOpenRouter(["gestionnaire"])).toEqual({
      lire: false,
      lancer: false,
      voitCout: true,
    });
  });
});

describe("messages d'erreur du lancement (409 et 400)", () => {
  const erreur = (code: string, statut = 409, message = "Message de l'API") =>
    new ErreurApi(code, message, statut);

  it("traduit chaque 409 attendu en français", () => {
    expect(messageLancementEvaluation(erreur("JEU_ESSAI_ABSENT"))).toContain("jeu d'essai");
    expect(messageLancementEvaluation(erreur("IA_DESACTIVEE"))).toContain("désactivée");
    expect(messageLancementEvaluation(erreur("IA_NON_CONFIGUREE"))).toContain("clé API");
    expect(messageLancementEvaluation(erreur("PLAFOND_IA_ATTEINT"))).toContain("plafond mensuel");
    expect(messageLancementEvaluation(erreur("EVALUATION_EN_COURS"))).toContain(
      "déjà en file ou en cours",
    );
  });

  it("aucun message traduit n'expose le code brut", () => {
    for (const code of [
      "JEU_ESSAI_ABSENT",
      "IA_DESACTIVEE",
      "IA_NON_CONFIGUREE",
      "PLAFOND_IA_ATTEINT",
      "EVALUATION_EN_COURS",
    ]) {
      expect(messageLancementEvaluation(erreur(code))).not.toContain(code);
    }
  });

  it("modèle non autorisé (400) : le message précis de l'API est conservé", () => {
    const m = "Modèle non autorisé : choisissez un modèle au tarif connu.";
    expect(messageLancementEvaluation(erreur("REQUETE_INVALIDE", 400, m))).toBe(m);
    expect(
      messageLancementEvaluation(erreur("REQUETE_INVALIDE", 400, "Données invalides.")),
    ).toContain("Le modèle saisi est refusé");
  });

  it("autres erreurs : repli sur les messages des agents, puis sur le message générique", () => {
    expect(messageLancementEvaluation(erreur("ACCES_REFUSE", 403))).toBe(
      "Votre rôle ne vous permet pas d'effectuer cette action.",
    );
    expect(messageLancementEvaluation(new Error("x"))).toContain("erreur inattendue");
  });
});

describe("saisie du modèle candidat", () => {
  it("vide : corps vide, le modèle de la tâche s'applique", () => {
    expect(lireModeleCandidat("")).toEqual({ ok: true, charge: {} });
    expect(lireModeleCandidat("   ")).toEqual({ ok: true, charge: {} });
  });

  it("accepte « fournisseur/modèle » et enlève les espaces", () => {
    expect(lireModeleCandidat(" openai/gpt-4o-mini ")).toEqual({
      ok: true,
      charge: { modele: "openai/gpt-4o-mini" },
    });
  });

  it("refuse un identifiant mal formé", () => {
    for (const m of ["gpt", "OpenAI/GPT", "a/", "/b", "a b/c"]) {
      const r = lireModeleCandidat(m);
      expect(r.ok, m).toBe(false);
      if (!r.ok) expect(r.erreurs.modele).toContain("fournisseur/modèle");
    }
  });
});

describe("chemins de l'API", () => {
  it("construit les trois chemins sous /api", () => {
    expect(cheminLancementEvaluation("abc")).toBe("/api/agents/prompts/abc/evaluations/openrouter");
    expect(cheminDemandeEvaluation("xyz")).toBe("/api/agents/evaluations/openrouter/xyz");
    expect(cheminDemandesEvaluation("abc")).toBe(
      "/api/agents/prompts/abc/evaluations/openrouter?limite=10",
    );
  });

  it("ajoute le curseur à la page suivante, encodé", () => {
    const c = cheminDemandesEvaluation("abc", "a+b/c=", 5);
    expect(c).toBe("/api/agents/prompts/abc/evaluations/openrouter?limite=5&curseur=a%2Bb%2Fc%3D");
  });

  it("n'accepte en préselection qu'un identifiant uuid", () => {
    const id = "0b1f4c2e-3d4a-4b5c-8d6e-7f8091a2b3c4";
    expect(lirePromptPreselectionne(id)).toBe(id);
    expect(lirePromptPreselectionne("pas-un-uuid")).toBeNull();
    expect(lirePromptPreselectionne(undefined)).toBeNull();
    expect(lirePromptPreselectionne([id])).toBeNull();
  });
});

describe("progression, réussite et régressions (pluriels)", () => {
  it("progression : singulier et pluriel", () => {
    expect(libelleProgression({ cas_traites: 0, cas_total: 4 })).toBe("0 cas évalué sur 4");
    expect(libelleProgression({ cas_traites: 1, cas_total: 1 })).toBe("1 cas évalué sur 1");
    expect(libelleProgression({ cas_traites: 3, cas_total: 5 })).toBe("3 cas évalués sur 5");
  });

  it("réussite : null tant qu'aucune évaluation n'est enregistrée", () => {
    expect(libelleReussite({ cas_reussis: null, cas_total: 3 })).toBeNull();
    expect(libelleReussite({ cas_reussis: 0, cas_total: 3 })).toBe("0 cas réussi sur 3");
    expect(libelleReussite({ cas_reussis: 1, cas_total: 3 })).toBe("1 cas réussi sur 3");
    expect(libelleReussite({ cas_reussis: 2, cas_total: 3 })).toBe("2 cas réussis sur 3");
  });

  it("régressions : rien à zéro ou inconnu, accord au pluriel", () => {
    expect(libelleRegressions(0)).toBeNull();
    expect(libelleRegressions(null)).toBeNull();
    expect(libelleRegressions(undefined)).toBeNull();
    expect(libelleRegressions(1)).toBe("1 régression");
    expect(libelleRegressions(2)).toBe("2 régressions");
  });
});

describe("résultat par cas", () => {
  it("distingue réussi, échoué et non évalué", () => {
    expect(etatCas({ reussi: true, raisons: [] })).toBe("reussi");
    expect(etatCas({ reussi: false, raisons: ["CONTENU_ATTENDU_ABSENT"] })).toBe("echoue");
    expect(etatCas({ reussi: false, raisons: ["NON_EVALUE"] })).toBe("non_evalue");
  });

  it("traduit les raisons, sans afficher « non évalué » comme une raison d'échec", () => {
    expect(raisonsCas({ raisons: ["CONTENU_ATTENDU_ABSENT", "CHIFFRES_NON_VERIFIES"] })).toEqual([
      "contenu attendu absent",
      "chiffres non vérifiés",
    ]);
    expect(raisonsCas({ raisons: ["NON_EVALUE"] })).toEqual([]);
    expect(raisonsCas({ raisons: ["ERREUR_FOURNISSEUR"] })).toEqual(["erreur du fournisseur"]);
  });

  it("compare à la version active pour un cas échoué seulement", () => {
    expect(noteReference({ reussi: false, reference_reussi: true })).toContain("régression");
    expect(noteReference({ reussi: false, reference_reussi: false })).toContain("échouait aussi");
    expect(noteReference({ reussi: false, reference_reussi: null })).toBeNull();
    expect(noteReference({ reussi: true, reference_reussi: true })).toBeNull();
  });
});

describe("coût et jetons : seulement si l'API les fournit", () => {
  it("coût absent ⇒ rien (jamais 0)", () => {
    expect(formaterCoutDemande(undefined)).toBeNull();
    expect(formaterCoutDemande(null)).toBeNull();
    expect(formaterCoutDemande(Number.NaN)).toBeNull();
    expect(lignesCout(demande())).toEqual([]);
    expect(
      detailCoutCas({ code: "c", reussi: true, raisons: [], reference_reussi: null }),
    ).toBeNull();
  });

  it("convertit les micro-dollars en dollars", () => {
    expect(formaterCoutDemande(2_000_000)).toBe("2,00 $US");
    expect(formaterCoutDemande(1_234_567)).toBe("1,23 $US");
    expect(formaterCoutDemande(1500)).toBe("0,0015 $US");
  });

  it("un coût réellement nul est affiché quand l'API le fournit", () => {
    expect(formaterCoutDemande(0)).toBe("0,00 $US");
    expect(lignesCout(demande({ cout_micro_usd: 0 }))).toEqual([
      { libelle: "Coût réel", valeur: "0,00 $US" },
    ]);
  });

  it("liste les champs présents, dans l'ordre : coût, estimation, plafond, jetons", () => {
    const l = lignesCout(
      demande({
        cout_micro_usd: 1_200_000,
        cout_estime_micro_usd: 1_800_000,
        plafond_evaluation_micro_usd: 2_000_000,
        tokens_entree: 12_345,
        tokens_sortie: 678,
      }),
    );
    expect(l.map((x) => x.libelle)).toEqual([
      "Coût réel",
      "Coût maximal estimé",
      "Plafond de l'évaluation",
      "Jetons",
    ]);
    expect(l[0]?.valeur).toBe("1,20 $US");
    expect(l[3]?.valeur).toContain("en entrée");
    expect(l[3]?.valeur).toContain("678 en sortie");
  });

  it("n'affiche que ce qui est présent (plafond seul)", () => {
    expect(lignesCout(demande({ plafond_evaluation_micro_usd: 2_000_000 }))).toEqual([
      { libelle: "Plafond de l'évaluation", valeur: "2,00 $US" },
    ]);
  });

  it("détail par cas : coût et jetons s'ils sont là", () => {
    const d = detailCoutCas({
      code: "c",
      reussi: true,
      raisons: [],
      reference_reussi: null,
      cout_micro_usd: 4000,
      tokens_entree: 300,
      tokens_sortie: 80,
    });
    expect(d).toContain("0,004");
    expect(d).toContain("300 jetons en entrée, 80 en sortie");
  });
});

describe("liste des demandes et sondage", () => {
  it("fusionne : remplace une demande connue, ajoute une nouvelle en tête", () => {
    const a = demande({ demande_id: "a", statut: "en_cours" });
    const b = demande({ demande_id: "b" });
    const maj = demande({ demande_id: "a", statut: "reussie" });
    expect(fusionnerDemande([a, b], maj)).toEqual([maj, b]);
    const c = demande({ demande_id: "c" });
    expect(fusionnerDemande([a, b], c).map((d) => d.demande_id)).toEqual(["c", "a", "b"]);
    expect(fusionnerDemande([], a)).toEqual([a]);
  });

  it("ajoute une page sans doublon et garde la version fraîche déjà affichée", () => {
    const a = demande({ demande_id: "a", statut: "reussie" });
    const aVieux = demande({ demande_id: "a", statut: "en_cours" });
    const b = demande({ demande_id: "b" });
    expect(ajouterPage([a], [aVieux, b])).toEqual([a, b]);
  });

  it("sonde toutes les 5 secondes, de façon bornée", () => {
    expect(INTERVALLE_SONDAGE_MS).toBe(5000);
    expect(SONDAGES_MAX).toBeGreaterThan(0);
    expect(SONDAGES_MAX * INTERVALLE_SONDAGE_MS).toBeGreaterThanOrEqual(10 * 60_000);
    expect(ECHECS_SONDAGE_MAX).toBeGreaterThan(0);
  });

  it("continue tant que la demande est en file ou en cours et que les bornes tiennent", () => {
    expect(sondageContinue("en_file", 1, 0)).toBe(true);
    expect(sondageContinue("en_cours", SONDAGES_MAX - 1, 0)).toBe(true);
    expect(sondageContinue("en_cours", 1, ECHECS_SONDAGE_MAX - 1)).toBe(true);
  });

  it("s'arrête à la fin de la demande, au plafond de sondages et après des échecs répétés", () => {
    for (const s of ["reussie", "echouee", "incomplete", "ignoree"]) {
      expect(sondageContinue(s, 1, 0), s).toBe(false);
    }
    expect(sondageContinue("en_cours", SONDAGES_MAX, 0)).toBe(false);
    expect(sondageContinue("en_cours", 1, ECHECS_SONDAGE_MAX)).toBe(false);
  });
});
