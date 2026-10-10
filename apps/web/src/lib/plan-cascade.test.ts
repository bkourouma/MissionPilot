import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminCascade,
  cheminNoeuds,
  cheminPorteur,
  cheminVersionNoeud,
  hrefCascade,
  libellePorteur,
  libelleStatutNoeud,
  libelleTrou,
  messageCascade,
  optionsStatut,
  resumeCouverture,
  SAISIE_NOEUD_VIDE,
  saisieDepuisNoeud,
  trousParGravite,
  validerNoeud,
  type NoeudCascade,
} from "./plan-cascade";

const noeud = (id: string, type: NoeudCascade["type"], titre: string): NoeudCascade => ({
  id,
  type,
  parent_id: null,
  titre,
  porteur_id: null,
  actif: true,
  profondeur: 0,
  enfants: [],
  orphelin: false,
  trous: [],
  description: null,
  debut: null,
  echeance: null,
  statut: null,
  modifiable: false,
});

describe("trous et couverture", () => {
  it("groupe les trous par gravité avec le nœud concerné", () => {
    const g = trousParGravite({
      noeuds: [noeud("o", "objectif", "Doubler le CA")],
      trous: [
        { code: "SANS_PORTEUR", gravite: "important", noeud_id: "o", type: "objectif" },
        { code: "OBJECTIF_SANS_KPI", gravite: "bloquant", noeud_id: "o", type: "objectif" },
        { code: "VISION_ABSENTE", gravite: "important", noeud_id: null, type: null },
      ],
    });
    expect(g.map((x) => x.gravite)).toEqual(["bloquant", "important"]);
    expect(g[0]?.trous[0]?.texte).toBe("Objectif « Doubler le CA » : Objectif sans KPI");
    expect(g[1]?.trous[1]?.texte).toContain("Plan : Le plan n'a pas de vision");
    expect(libelleTrou("INCONNU")).toBe("Écart non reconnu");
  });

  it("résume la couverture et nomme les porteurs", () => {
    expect(
      resumeCouverture({
        couverture: {
          noeuds_actifs: 8,
          noeuds_avec_porteur: 5,
          taux_porteurs: 63,
          objectifs: 2,
          objectifs_avec_kpi: 1,
          taux_kpi: 50,
        },
      }),
    ).toBe("5 nœuds sur 8 ont un porteur (63 %) ; 1 objectif sur 2 a un KPI (50 %).");
    expect(
      resumeCouverture({
        couverture: {
          noeuds_actifs: 1,
          noeuds_avec_porteur: 1,
          taux_porteurs: 100,
          objectifs: 0,
          objectifs_avec_kpi: 0,
          taux_kpi: 100,
        },
      }),
    ).toBe("1 nœud sur 1 a un porteur (100 %) ; aucun objectif.");
    // Plan vide : état neutre, jamais « 0 nœud sur 0 a un porteur (100 %) ».
    expect(
      resumeCouverture({
        couverture: {
          noeuds_actifs: 0,
          noeuds_avec_porteur: 0,
          taux_porteurs: 100,
          objectifs: 0,
          objectifs_avec_kpi: 0,
          taux_kpi: 100,
        },
      }),
    ).toBe("Aucun nœud ; aucun objectif.");
    const c = { porteurs: { u1: "Awa" } };
    expect(libellePorteur(c, "u1")).toBe("Awa");
    expect(libellePorteur(c, null)).toBe("Sans porteur");
    expect(libellePorteur(c, "u2")).toBe("Porteur hors liste");
  });

  it("libelle les statuts des projets et des jalons", () => {
    expect(libelleStatutNoeud("projet", "en_cours")).toBe("En cours");
    expect(libelleStatutNoeud("jalon", "atteint")).toBe("Atteint");
    expect(libelleStatutNoeud("objectif", "x")).toBeNull();
    expect(libelleStatutNoeud("jalon", null)).toBeNull();
    expect(optionsStatut("jalon").map((o) => o.valeur)).toEqual(["prevu", "atteint", "manque"]);
  });
});

describe("saisie d'un projet ou d'un jalon", () => {
  it("valide et construit le contenu ; un jalon n'a pas de début", () => {
    const projet = validerNoeud("projet", {
      ...SAISIE_NOEUD_VIDE,
      titre: " Étude ",
      debut: "2027-01-01",
      echeance: "2027-03-31",
      porteur_id: "u1",
    });
    expect(projet.donnees).toEqual({
      titre: "Étude",
      description: null,
      porteur_id: "u1",
      debut: "2027-01-01",
      echeance: "2027-03-31",
    });
    const jalon = validerNoeud("jalon", {
      ...SAISIE_NOEUD_VIDE,
      titre: "Rapport",
      debut: "2027-01-01",
      echeance: "2027-03-31",
      statut: "atteint",
    });
    expect(jalon.donnees).toEqual({
      titre: "Rapport",
      description: null,
      porteur_id: null,
      echeance: "2027-03-31",
      statut: "atteint",
    });
  });

  it("refuse titre vide, échéance absente, début après échéance, statut d'un autre type", () => {
    const r = validerNoeud("projet", {
      ...SAISIE_NOEUD_VIDE,
      debut: "2027-05-01",
      echeance: "2027-03-31",
      statut: "atteint",
      description: "x".repeat(5001),
    });
    expect(Object.keys(r.erreurs).sort()).toEqual(["debut", "description", "statut", "titre"]);
    expect(r.erreurs.debut).toBe("Le début doit précéder l'échéance.");
    expect(validerNoeud("jalon", { ...SAISIE_NOEUD_VIDE, titre: "x".repeat(201) }).erreurs).toEqual(
      {
        titre: "200 caractères au plus.",
        echeance: "L'échéance est obligatoire.",
      },
    );
    expect(
      validerNoeud("projet", {
        ...SAISIE_NOEUD_VIDE,
        titre: "a",
        debut: "x",
        echeance: "2027-01-01",
      }).erreurs.debut,
    ).toBe("Date invalide.");
    // Dates hors de 2000 à 2100 : refusées avant l'appel (CHECK SQL doublé par l'API).
    const horsBornes = validerNoeud("projet", {
      ...SAISIE_NOEUD_VIDE,
      titre: "a",
      debut: "1999-12-31",
      echeance: "2101-01-01",
    });
    expect(horsBornes.erreurs).toEqual({
      debut: "Date comprise entre 2000 et 2100 attendue.",
      echeance: "Date comprise entre 2000 et 2100 attendue.",
    });
    expect(
      validerNoeud("jalon", { ...SAISIE_NOEUD_VIDE, titre: "a", echeance: "2100-12-31" }).erreurs,
    ).toEqual({});
  });

  it("préremplit depuis un nœud existant", () => {
    expect(
      saisieDepuisNoeud({
        ...noeud("p", "projet", "Étude"),
        description: "Desc",
        debut: "2027-01-01",
        echeance: "2027-02-01",
        statut: "en_cours",
        porteur_id: "u1",
      }),
    ).toEqual({
      titre: "Étude",
      description: "Desc",
      porteur_id: "u1",
      debut: "2027-01-01",
      echeance: "2027-02-01",
      statut: "en_cours",
    });
    expect(saisieDepuisNoeud(noeud("j", "jalon", "J")).echeance).toBe("");
  });
});

describe("messages et chemins", () => {
  it("traduit les refus", () => {
    expect(messageCascade(new ErreurApi("INTROUVABLE", "x", 404))).toContain("introuvable");
    expect(messageCascade(new ErreurApi("CONFLIT", "Déjà désigné.", 409))).toBe("Déjà désigné.");
    expect(messageCascade(new ErreurApi("REQUETE_INVALIDE", "Porteur inconnu.", 400))).toBe(
      "Porteur inconnu.",
    );
    expect(messageCascade(new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400))).toContain(
      "Vérifiez",
    );
  });

  it("construit les chemins", () => {
    expect(hrefCascade("m", "p")).toBe("/missions/m/plan/p/cascade");
    expect(cheminCascade("p")).toBe("/api/plans/p/cascade");
    expect(cheminPorteur("p", "e")).toBe("/api/plans/p/elements/e/porteur");
    expect(cheminNoeuds("p")).toBe("/api/plans/p/cascade/noeuds");
    expect(cheminVersionNoeud("p", "n")).toBe("/api/plans/p/cascade/noeuds/n/versions");
  });
});
