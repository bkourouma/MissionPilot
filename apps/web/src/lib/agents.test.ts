import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminAvecCurseur,
  droitsAgents,
  formaterDureeRevue,
  formaterPart,
  hrefBrique,
  hrefPage,
  libelleNiveau,
  libelleOutil,
  libelleRaisonsNiveau,
  lireBrique,
  lireCurseur,
  lireDecisionAutonomie,
  lireIncident,
  lireJeuEssai,
  lireMotif,
  messageAgents,
  niveauxDecidables,
  presentationEligibilite,
  sousPagesAgents,
  tonaliteNiveau,
  type EligibiliteIa,
} from "./agents";

const eligibilite = (e: Partial<EligibiliteIa> = {}): EligibiliteIa => ({
  statistiques: { executions: 0, accepteesSansModificationMajeure: 0, incidentsMajeursFenetre: 0 },
  evaluation: { eligible: false, niveauPropose: null, raisons: [], tauxAcceptation: null },
  niveau_suivant: "N3",
  criteres_requis: true,
  ...e,
});

describe("navigation et droits de la rubrique Agents IA", () => {
  it("ouvre les cinq sous-pages à qui lit les agents, aucune sinon", () => {
    expect(sousPagesAgents(["consultant"]).map((p) => p.id)).toEqual([
      "equipe",
      "autonomie",
      "executions",
      "evaluations",
      "contribution",
    ]);
    expect(sousPagesAgents(["gestionnaire"])).toEqual([]);
  });

  it("seul l'associé décide et lève le coupe-circuit ; l'expert métier gère et coupe", () => {
    expect(droitsAgents(["associe"])).toEqual({
      gerer: true,
      decider: true,
      couper: true,
      lever: true,
      incidentMajeur: true,
      declarerR0: true,
    });
    expect(droitsAgents(["expert_metier"])).toEqual({
      gerer: true,
      decider: false,
      couper: true,
      lever: false,
      incidentMajeur: true,
      declarerR0: false,
    });
    expect(droitsAgents(["consultant"])).toEqual({
      gerer: false,
      decider: false,
      couper: false,
      lever: false,
      incidentMajeur: false,
      declarerR0: false,
    });
  });
});

describe("libellés", () => {
  it("niveaux, raisons, outils et tonalités en français", () => {
    expect(libelleNiveau("N2")).toBe("N2 — Brouillon automatique, validation obligatoire");
    expect(libelleRaisonsNiveau(["COUPE_CIRCUIT_N4", "INCONNU"])).toBe(
      "coupe-circuit N4 du cabinet, INCONNU",
    );
    expect(libelleOutil("envoyer_relance")).toBe("Envoyer une relance (N4)");
    expect(tonaliteNiveau("N4")).toBe("danger");
    expect(tonaliteNiveau("N3")).toBe("attention");
    expect(tonaliteNiveau("N1")).toBe("succes");
    expect(tonaliteNiveau("N0")).toBe("neutre");
  });

  it("durées de revue et parts conservées", () => {
    expect(formaterDureeRevue(45)).toBe("45 s");
    expect(formaterDureeRevue(720)).toBe("12 min");
    expect(formaterDureeRevue(7500)).toBe("2 h 05");
    expect(formaterDureeRevue(-1)).toBe("—");
    expect(formaterPart(null)).toBe("—");
    expect(formaterPart(0.96).replace(/\s/g, " ")).toBe("96 %");
  });
});

describe("éligibilité et décisions", () => {
  it("présente l'éligibilité selon le palier suivant", () => {
    expect(presentationEligibilite(eligibilite({ niveau_suivant: null })).titre).toMatch(/maximal/);
    expect(
      presentationEligibilite(eligibilite({ niveau_suivant: "N2", criteres_requis: false })).titre,
    ).toMatch(/simple décision/);
    const non = presentationEligibilite(
      eligibilite({
        evaluation: {
          eligible: false,
          niveauPropose: null,
          raisons: ["EXECUTIONS_INSUFFISANTES", "INCIDENT_MAJEUR_RECENT"],
          tauxAcceptation: null,
        },
      }),
    );
    expect(non.tonalite).toBe("attention");
    expect(non.details).toEqual([
      "moins de 50 exécutions décidées à ce niveau",
      "incident majeur sur les 90 derniers jours",
    ]);
    const oui = presentationEligibilite(
      eligibilite({
        evaluation: { eligible: true, niveauPropose: "N3", raisons: [], tauxAcceptation: 0.96 },
      }),
    );
    expect(oui).toMatchObject({ tonalite: "succes", details: [] });
    expect(oui.titre).toMatch(/associé/);
  });

  it("propose les baisses et le seul palier suivant sous le plafond", () => {
    expect(niveauxDecidables("N2", "N3")).toEqual(["N0", "N1", "N3"]);
    expect(niveauxDecidables("N2", "N2")).toEqual(["N0", "N1"]);
    expect(niveauxDecidables("N0", "N4")).toEqual(["N1"]);
    expect(niveauxDecidables("N4", "N4")).toEqual(["N0", "N1", "N2", "N3"]);
  });

  it("lit la décision, l'incident et le motif, messages en français", () => {
    expect(lireDecisionAutonomie({ niveau: "N3", motif: "  Probant. " })).toEqual({
      ok: true,
      charge: { niveau: "N3", motif: "Probant." },
    });
    expect(lireDecisionAutonomie({ niveau: "", motif: " " })).toEqual({
      ok: false,
      erreurs: { niveau: "Choisissez un niveau.", motif: "Le motif est obligatoire." },
    });
    expect(lireIncident({ gravite: "majeur", description: "Jalon décalé." })).toEqual({
      ok: true,
      charge: { gravite: "majeur", description: "Jalon décalé." },
    });
    expect(lireIncident({ gravite: "grave", description: "" }).ok).toBe(false);
    expect(lireMotif("x".repeat(1001)).ok).toBe(false);
    expect(lireMotif(" ok ")).toEqual({ ok: true, charge: { motif: "ok" } });
  });

  it("lit une brique : code du référentiel, N4 réservé à R0", () => {
    const base = {
      brique_code: "rapport.avancement",
      agent_code: "pmo",
      classe_risque: "R1",
      niveau_max: "N3",
    };
    expect(lireBrique(base)).toEqual({ ok: true, charge: base });
    expect(lireBrique({ ...base, niveau_max: "N4" })).toEqual({
      ok: false,
      erreurs: { niveau_max: "N4 est réservé aux briques de classe R0." },
    });
    const r = lireBrique({
      brique_code: "Code Faux",
      agent_code: "",
      classe_risque: "R9",
      niveau_max: "",
    });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.ok ? {} : r.erreurs).sort()).toEqual([
      "agent_code",
      "brique_code",
      "classe_risque",
      "niveau_max",
    ]);
  });

  it("lit un jeu d'essai en JSON par le schéma partagé", () => {
    const cas = JSON.stringify([{ code: "c1", variables: { texte: "Bonjour." } }]);
    const ok = lireJeuEssai({ prompt_nom: "resume_neutre", description: "", cas });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.charge.cas[0]?.attendu.sans_chiffres_non_verifies).toBe(true);
    expect(lireJeuEssai({ prompt_nom: "resume_neutre", description: "", cas: "[" })).toEqual({
      ok: false,
      erreurs: { cas: "Les cas doivent être un tableau JSON valide." },
    });
    const ko = lireJeuEssai({ prompt_nom: "Mauvais Nom", description: "", cas: "[]" });
    expect(ko.ok ? null : Object.keys(ko.erreurs).sort()).toEqual(["cas", "prompt_nom"]);
  });
});

describe("erreurs et chemins", () => {
  it("traduit les codes d'erreur propres aux agents", () => {
    expect(messageAgents(new ErreurApi("PROMOTION_PAR_PALIER", "x", 409))).toBe(
      "Une hausse d'autonomie se fait d'un niveau à la fois.",
    );
    expect(messageAgents(new ErreurApi("AUTRE", "Message de l'API.", 409))).toBe(
      "Message de l'API.",
    );
  });

  it("construit chemins et liens de pagination", () => {
    expect(lireCurseur("abc")).toBe("abc");
    expect(lireCurseur(["a"])).toBeNull();
    expect(lireCurseur("")).toBeNull();
    expect(cheminAvecCurseur("/api/agents/briques", null)).toBe("/api/agents/briques?limite=30");
    expect(cheminAvecCurseur("/api/agents/briques", "c/d")).toBe(
      "/api/agents/briques?limite=30&curseur=c%2Fd",
    );
    expect(hrefPage("/agents/executions", "x y")).toBe("/agents/executions?curseur=x%20y");
    expect(hrefBrique("rapport.avancement")).toBe("/agents/autonomie/rapport.avancement");
  });
});
