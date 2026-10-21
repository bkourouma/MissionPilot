import { describe, expect, it } from "vitest";
import {
  chargeCache,
  DUREE_CACHE_PAR_DEFAUT_HEURES,
  explicationCache,
  libelleCritere,
  libellePlafondJetons,
  lireEtatCache,
  lireRoutage,
  messageCache,
} from "./routage-cache";

const ligne = (l: Record<string, unknown> = {}) => ({
  tache: "redaction",
  modele_recommande: "anthropic/claude-sonnet-4.5",
  modele_applique: "anthropic/claude-sonnet-4.5",
  personnalise: false,
  critere: "qualite",
  motif: "La qualité prime.",
  plafond_jetons_sortie: 4000,
  ...l,
});

describe("routage des modèles par tâche (AGT-06)", () => {
  it("lit les lignes de l'API et écarte celles qui sont mal formées", () => {
    const r = lireRoutage({
      routage: [
        ligne(),
        ligne({ tache: "embedding", critere: "cout", plafond_jetons_sortie: null }),
        ligne({ tache: "inconnue" }),
        ligne({ critere: "vitesse" }),
        ligne({ modele_applique: 3 }),
        "texte",
      ],
    });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      tache: "redaction",
      critere: "qualite",
      plafond_jetons_sortie: 4000,
    });
    expect(r[1]).toMatchObject({ tache: "embedding", plafond_jetons_sortie: null });
  });

  it("réponse ancienne ou incomplète : aucun routage, sans erreur", () => {
    expect(lireRoutage({})).toEqual([]);
    expect(lireRoutage(null)).toEqual([]);
    expect(lireRoutage({ routage: "non" })).toEqual([]);
  });

  it("valeurs douteuses neutralisées : personnalisé seulement si vrai, plafond entier positif", () => {
    const [l] = lireRoutage({
      routage: [ligne({ personnalise: "oui", plafond_jetons_sortie: -5, motif: 12 })],
    });
    expect(l).toMatchObject({ personnalise: false, plafond_jetons_sortie: null, motif: "" });
  });

  it("libellés en français", () => {
    expect(libelleCritere("qualite")).toBe("Qualité");
    expect(libelleCritere("cout")).toBe("Coût");
    expect(libelleCritere("latence")).toBe("Rapidité");
    expect(libellePlafondJetons(4000)).toBe("4\u00a0000\u00a0jetons");
    expect(libellePlafondJetons(null)).toBe("—");
  });
});

describe("cache des réponses IA (AGT-06)", () => {
  it("désactivé par défaut : seul un `cache_actif: true` explicite l'active", () => {
    expect(lireEtatCache({})).toEqual({ actif: false, dureeHeures: DUREE_CACHE_PAR_DEFAUT_HEURES });
    expect(lireEtatCache(null).actif).toBe(false);
    expect(lireEtatCache({ cache_actif: "true" }).actif).toBe(false);
    expect(lireEtatCache({ cache_actif: true, cache_duree_heures: 12 })).toEqual({
      actif: true,
      dureeHeures: 12,
    });
    expect(lireEtatCache({ cache_actif: true, cache_duree_heures: -1 }).dureeHeures).toBe(24);
  });

  it("charge du PUT et messages : la désactivation annonce la suppression des réponses gardées", () => {
    expect(chargeCache(true)).toEqual({ cache_actif: true });
    expect(chargeCache(false)).toEqual({ cache_actif: false });
    expect(messageCache(false)).toMatch(/supprimées/);
    expect(messageCache(true)).toMatch(/activé/);
  });

  it("explication : durée, brouillon à valider, exclusions, état par défaut", () => {
    const off = explicationCache({ actif: false, dureeHeures: 24 });
    expect(off).toMatch(/^Désactivé par défaut/);
    expect(off).toContain("24\u00a0heures");
    expect(off).toMatch(/brouillon IA à valider/);
    expect(off).toMatch(/copilote/);
    const on = explicationCache({ actif: true, dureeHeures: 1 });
    expect(on).toContain("1\u00a0heure ");
    expect(on).toMatch(/supprime aussitôt/);
  });
});
