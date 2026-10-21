import { describe, expect, it } from "vitest";
import type { RedChecklistItemVue, RedChecklistReponseVue } from "@missionpilot/shared";
import {
  causeVide,
  corpsActivation,
  corpsCauses,
  corpsGenerationCauses,
  corpsNouveauModele,
  corpsReponses,
  corpsVersionModele,
  decouperEnLots,
  itemVide,
  MSG_AUCUNE_REPONSE_MODIFIEE,
  MSG_COMMENTAIRE_SANS_REPONSE,
  prochainIdItem,
  saisieCausesDepuis,
  saisieReponsesDepuis,
} from "./redressement-diagnostic-saisie";

const items: RedChecklistItemVue[] = [
  { id: "a1", domaine: "tresorerie", libelle: "Prévision à jour", aide: null },
  { id: "a2", domaine: "exploitation", libelle: "Comité tenu", aide: "Au moins trimestriel" },
];
const personne = { id: "u1", nom: "Awa" };
const courante = (p: Partial<RedChecklistReponseVue>): RedChecklistReponseVue => ({
  item_id: "a1",
  reponse: "oui",
  commentaire: null,
  auteur: personne,
  cree_le: "2026-10-20T10:00:00Z",
  ...p,
});

describe("réponses d'une check-list", () => {
  it("part des réponses courantes", () => {
    const s = saisieReponsesDepuis(items, [courante({ commentaire: "Fait" })]);
    expect(s.a1).toEqual({ reponse: "oui", commentaire: "Fait" });
    expect(s.a2).toEqual({ reponse: "", commentaire: "" });
  });

  it("n'envoie que les réponses modifiées", () => {
    const courantes = [courante({})];
    const s = saisieReponsesDepuis(items, courantes);
    expect(corpsReponses(items, s, courantes)).toEqual({
      ok: false,
      erreurs: { global: MSG_AUCUNE_REPONSE_MODIFIEE },
    });
    s.a2 = { reponse: "partiel", commentaire: " en cours " };
    const r = corpsReponses(items, s, courantes);
    expect(r).toEqual({
      ok: true,
      charge: [{ reponses: [{ item_id: "a2", reponse: "partiel", commentaire: "en cours" }] }],
    });
  });

  it("détecte un commentaire modifié sur une réponse inchangée", () => {
    const courantes = [courante({})];
    const s = saisieReponsesDepuis(items, courantes);
    s.a1 = { reponse: "oui", commentaire: "Précision" };
    const r = corpsReponses(items, s, courantes);
    expect(r.ok && r.charge[0]?.reponses[0]).toEqual({
      item_id: "a1",
      reponse: "oui",
      commentaire: "Précision",
    });
  });

  it("refuse un commentaire sans réponse ou trop long", () => {
    const s = saisieReponsesDepuis(items, []);
    s.a1 = { reponse: "", commentaire: "Note" };
    expect(corpsReponses(items, s, [])).toEqual({
      ok: false,
      erreurs: { a1: MSG_COMMENTAIRE_SANS_REPONSE },
    });
    s.a1 = { reponse: "non", commentaire: "x".repeat(501) };
    const r = corpsReponses(items, s, []);
    expect(!r.ok && r.erreurs.a1).toContain("trop long");
  });

  it("découpe en lots de 40 au plus", () => {
    const beaucoup = Array.from({ length: 85 }, (_, i) => i);
    expect(decouperEnLots(beaucoup, 40).map((l) => l.length)).toEqual([40, 40, 5]);
    expect(decouperEnLots([], 40)).toEqual([]);
  });
});

describe("cartographie des causes", () => {
  it("construit le corps et trim les textes", () => {
    const r = corpsCauses([
      {
        id: "c01",
        domaine: "tresorerie",
        libelle: "  Retards clients ",
        description: " Délais longs ",
        confiance: "moyen",
      },
      { ...causeVide(), libelle: "Autre", description: "Détail" },
    ]);
    expect(r).toEqual({
      ok: true,
      charge: {
        causes: [
          {
            id: "c01",
            domaine: "tresorerie",
            libelle: "Retards clients",
            description: "Délais longs",
            confiance: "moyen",
          },
          { domaine: "tresorerie", libelle: "Autre", description: "Détail", confiance: null },
        ],
      },
    });
  });

  it("signale les champs vides par position", () => {
    const r = corpsCauses([causeVide()]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs["0.libelle"]).toBeDefined();
      expect(r.erreurs["0.description"]).toBeDefined();
    }
  });

  it("refuse zéro cause et plus de 12", () => {
    const vide = corpsCauses([]);
    expect(!vide.ok && vide.erreurs.global).toContain("au moins une");
    const remplie = { ...causeVide(), libelle: "a", description: "b" };
    const trop = corpsCauses(Array.from({ length: 13 }, () => remplie));
    expect(!trop.ok && trop.erreurs.global).toContain("12");
  });

  it("revient aux causes de l'API", () => {
    expect(
      saisieCausesDepuis([
        { id: "c01", domaine: "tresorerie", libelle: "L", description: "D", confiance: null },
      ])[0],
    ).toEqual({ id: "c01", domaine: "tresorerie", libelle: "L", description: "D", confiance: "" });
  });

  it("n'envoie le contexte que s'il est renseigné", () => {
    expect(corpsGenerationCauses("   ")).toEqual({ ok: true, charge: {} });
    expect(corpsGenerationCauses(" Contexte ")).toEqual({
      ok: true,
      charge: { contexte: "Contexte" },
    });
    expect(corpsGenerationCauses("x".repeat(2001)).ok).toBe(false);
  });
});

describe("modèles de check-list", () => {
  it("attribue des identifiants d'items libres", () => {
    expect(prochainIdItem([])).toBe("i01");
    expect(prochainIdItem([{ id: "i01" }, { id: "i03" }])).toBe("i02");
    expect(itemVide([{ id: "i01" }]).id).toBe("i02");
  });

  it("valide un nouveau modèle", () => {
    const item = { ...itemVide([]), libelle: "Point à vérifier" };
    const ok = corpsNouveauModele(
      { code: "commerce-2026", intitule: " Commerce ", secteur: "commerce", motif: "" },
      [item],
    );
    expect(ok).toEqual({
      ok: true,
      charge: {
        code: "commerce-2026",
        intitule: "Commerce",
        secteur: "commerce",
        items: [{ id: "i01", domaine: "tresorerie", libelle: "Point à vérifier" }],
      },
    });
    const ko = corpsNouveauModele({ code: "A", intitule: "", secteur: "commerce", motif: "" }, []);
    expect(ko.ok).toBe(false);
    if (!ko.ok) expect(Object.keys(ko.erreurs).sort()).toEqual(["code", "global", "intitule"]);
  });

  it("valide une nouvelle version", () => {
    const item = { ...itemVide([]), libelle: "Point", aide: " Aide " };
    expect(corpsVersionModele([item], " Révision ")).toEqual({
      ok: true,
      charge: {
        items: [{ id: "i01", domaine: "tresorerie", libelle: "Point", aide: "Aide" }],
        motif: "Révision",
      },
    });
    expect(corpsVersionModele([itemVide([])], "").ok).toBe(false);
  });
});

describe("activation", () => {
  it("lit le choix du formulaire", () => {
    expect(corpsActivation("depart:commerce-depart")).toEqual({
      ok: true,
      charge: { origine: "depart", code: "commerce-depart" },
    });
    expect(corpsActivation("modele:abc")).toEqual({
      ok: true,
      charge: { origine: "modele", modele_id: "abc" },
    });
    expect(corpsActivation("")).toEqual({
      ok: false,
      erreur: "Choisissez une check-list à activer.",
    });
  });
});
