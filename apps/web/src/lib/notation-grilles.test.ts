import { describe, expect, it } from "vitest";
import {
  GRILLE_GENERIQUE,
  grilleNotationSchema,
  type GrilleNotationDonnees,
} from "@missionpilot/shared";
import { ErreurApi } from "./api";
import {
  ajouterSecteur,
  anomaliesGrille,
  cheminGrilles,
  cheminValiderVersion,
  codeDepuisTitre,
  contenuDepuisEdition,
  droitsVersionGrille,
  editionDepuisContenu,
  hrefGrilles,
  hrefVersionGrille,
  libelleOrigine,
  libelleStatutGrille,
  lireCurseurGrilles,
  lirePoids,
  messageGrille,
  messageSomme,
  messageSousTotal,
  nomAuteurGrille,
  retirerSecteur,
  sommeConforme,
  sommePoids,
  totauxEdition,
  validerCreationGrille,
} from "./notation-grilles";

const MOI = "00000000-0000-4000-8000-000000000001";
const AUTRE = "00000000-0000-4000-8000-000000000002";

const grille = GRILLE_GENERIQUE as GrilleNotationDonnees;

describe("grille générique : 10 dimensions en 2 familles, sommes de 100", () => {
  it("totaux par famille et global, secteurs complets à 100", () => {
    const e = editionDepuisContenu(grille);
    const t = totauxEdition(grille.dimensions, e);
    expect(t.familles.map((f) => [f.libelle, f.dimensions.length])).toEqual([
      ["Excellence opérationnelle", 6],
      ["Compétitivité", 4],
    ]);
    expect(t.total).toBe(100);
    expect(t.familles.reduce((s, f) => s + (f.total ?? 0), 0)).toBe(100);
    expect(t.secteurs).toHaveLength(5);
    expect(t.secteurs.every((s) => s.total === 100)).toBe(true);
  });

  it("aller-retour sans modification : contenu identique, conforme au schéma", () => {
    const r = contenuDepuisEdition(grille, editionDepuisContenu(grille));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge).toEqual(grille);
      expect(grilleNotationSchema.safeParse(r.charge).success).toBe(true);
    }
  });
});

describe("saisie des poids", () => {
  it("lecture à la française, 0 à 10 000, deux décimales au plus", () => {
    expect(lirePoids("12")).toBe(12);
    expect(lirePoids("7,5")).toBe(7.5);
    expect(lirePoids(" 1 000 ")).toBe(1000);
    expect(lirePoids("")).toBeNull();
    expect(lirePoids("-1")).toBeNaN();
    expect(lirePoids("1,234")).toBeNaN();
    expect(lirePoids("10001")).toBeNaN();
    expect(lirePoids("abc")).toBeNaN();
  });

  it("somme au centième près, sans erreur de virgule flottante", () => {
    expect(sommePoids([0.1, 0.2])).toBe(0.3);
    expect(sommePoids([33.33, 33.33, 33.34])).toBe(100);
    expect(sommePoids([10, null, 5])).toBe(15);
    expect(sommePoids([10, Number.NaN])).toBeNull();
    expect(sommeConforme(100)).toBe(true);
    expect(sommeConforme(99.99)).toBe(false);
    expect(sommeConforme(null)).toBe(false);
  });

  it("message de somme affiché en direct", () => {
    expect(messageSomme(100, "Total")).toBe("Total : somme 100 sur 100, conforme.");
    expect(messageSomme(95.5, "Industrie")).toMatch(/^Industrie : somme 95,5 au lieu de 100/);
    expect(messageSomme(null, "Total")).toMatch(/incalculable/);
    // Une famille n'a pas de cible propre : son sous-total n'est pas comparé à 100.
    expect(messageSousTotal(60, "Excellence opérationnelle")).toBe(
      "Sous-total « Excellence opérationnelle » : 60.",
    );
    expect(messageSousTotal(null, "Compétitivité")).toMatch(/incalculable/);
  });

  it("modifier un poids met à jour le total, la famille et les secteurs qui n'en ont pas", () => {
    const e = editionDepuisContenu(grille);
    const premiere = grille.dimensions[0]!.id;
    const modifiee = { ...e, poids: { ...e.poids, [premiere]: "22" } };
    const t = totauxEdition(grille.dimensions, modifiee);
    expect(t.total).toBe(110);
    expect(t.familles[0]!.total).toBe(t.total! - t.familles[1]!.total!);
    // Les secteurs génériques surchargent toutes les dimensions : inchangés.
    expect(t.secteurs.every((s) => s.total === 100)).toBe(true);
    // Un secteur vidé de sa surcharge reprend les poids par défaut.
    const vide = {
      ...modifiee,
      secteurs: [{ secteur: "x", libelle: "", poids: { [premiere]: "" } }],
    };
    expect(totauxEdition(grille.dimensions, vide).secteurs[0]!.total).toBe(110);
  });

  it("poids invalide : somme incalculable et erreur ciblée", () => {
    const e = editionDepuisContenu(grille);
    const id = grille.dimensions[1]!.id;
    const invalide = { ...e, poids: { ...e.poids, [id]: "douze" } };
    expect(totauxEdition(grille.dimensions, invalide).total).toBeNull();
    const r = contenuDepuisEdition(grille, invalide);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs)).toEqual([`poids.${id}`]);
    const vide = contenuDepuisEdition(grille, { ...e, poids: { ...e.poids, [id]: "" } });
    expect(vide.ok).toBe(false);
  });

  it("titre obligatoire ; poids tous nuls refusés", () => {
    const e = editionDepuisContenu(grille);
    const sansTitre = contenuDepuisEdition(grille, { ...e, titre: "  " });
    expect(sansTitre.ok).toBe(false);
    const nuls = Object.fromEntries(grille.dimensions.map((d) => [d.id, "0"]));
    const r = contenuDepuisEdition(grille, { ...e, poids: nuls });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.global).toMatch(/poids positif/);
  });

  it("surcharge partielle : seuls les poids saisis sont envoyés", () => {
    const base = editionDepuisContenu({ ...grille, secteurs: [] });
    const id = grille.dimensions[0]!.id;
    const ajout = ajouterSecteur(base, "btp", "Bâtiment");
    expect(ajout.ok).toBe(true);
    if (!ajout.ok) return;
    const vides = Object.fromEntries(grille.dimensions.map((d) => [d.id, ""]));
    const e = {
      ...ajout.charge,
      secteurs: [{ ...ajout.charge.secteurs[0]!, poids: { ...vides, [id]: "20" } }],
    };
    const r = contenuDepuisEdition({ ...grille, secteurs: [] }, e);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge.secteurs).toEqual([
        { secteur: "btp", libelle: "Bâtiment", poids: [{ dimension: id, poids: 20 }] },
      ]);
    }
  });
});

describe("secteurs", () => {
  it("ajout : code identifiant unique, poids repris des poids par défaut", () => {
    const e = editionDepuisContenu(grille);
    expect(ajouterSecteur(e, "Mon Secteur", "").ok).toBe(false);
    expect(ajouterSecteur(e, "industrie", "").ok).toBe(false);
    const r = ajouterSecteur(e, "btp", " BTP ");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const s = r.charge.secteurs[r.charge.secteurs.length - 1]!;
      expect(s).toMatchObject({ secteur: "btp", libelle: "BTP" });
      expect(s.poids).toEqual(e.poids);
      expect(totauxEdition(grille.dimensions, r.charge).secteurs.at(-1)!.total).toBe(100);
    }
  });

  it("retrait par rang ; code en double refusé à l'enregistrement", () => {
    const e = editionDepuisContenu(grille);
    expect(retirerSecteur(e, 0).secteurs.map((s) => s.secteur)).toEqual([
      "numerique",
      "industrie",
      "services",
      "commerce",
    ]);
    const doublon = {
      ...e,
      secteurs: [e.secteurs[0]!, { ...e.secteurs[1]!, secteur: e.secteurs[0]!.secteur }],
    };
    const r = contenuDepuisEdition(grille, doublon);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs["secteur.1.code"]).toMatch(/déjà utilisé/);
  });
});

describe("création d'une grille", () => {
  it("code obligatoire et conforme ; titre facultatif ; copie : grille source requise", () => {
    expect(
      validerCreationGrille({ code: "", titre: "", source: "generique", grilleId: "" }).ok,
    ).toBe(false);
    expect(
      validerCreationGrille({ code: "Grille A", titre: "", source: "generique", grilleId: "" }).ok,
    ).toBe(false);
    expect(
      validerCreationGrille({ code: "grille_a", titre: "", source: "copie", grilleId: "" }),
    ).toEqual({ ok: false, erreurs: { grilleId: "Choisissez la grille du cabinet à copier." } });
    expect(
      validerCreationGrille({
        code: "grille_a",
        titre: " Ma grille ",
        source: "generique",
        grilleId: "",
      }),
    ).toEqual({
      ok: true,
      charge: { code: "grille_a", titre: "Ma grille", source: { type: "generique" } },
    });
    expect(
      validerCreationGrille({ code: "grille_b", titre: "", source: "copie", grilleId: "g1" }),
    ).toEqual({
      ok: true,
      charge: { code: "grille_b", source: { type: "copie", grille_id: "g1" } },
    });
  });

  it("code proposé depuis le titre", () => {
    expect(codeDepuisTitre("Grille Industrie 2027")).toBe("grille_industrie_2027");
    expect(codeDepuisTitre("  Qualité & Coûts ")).toBe("qualite_couts");
    expect(codeDepuisTitre("—")).toBe("");
  });
});

describe("droits sur une version de grille (miroir de l'API)", () => {
  const brouillon = { statut: "brouillon" as const, cree_par: AUTRE, modifie_par: AUTRE };

  it("expert métier non auteur : valide ; averti qu'une modification l'en empêcherait", () => {
    const d = droitsVersionGrille(["expert_metier"], MOI, brouillon);
    expect(d).toMatchObject({ modifier: true, valider: true, explicationValidation: null });
    expect(d.avertissementModification).toMatch(/dernier modificateur/);
  });

  it("expert auteur ou dernier modificateur : pas de validation, séparation des tâches", () => {
    for (const v of [
      { ...brouillon, cree_par: MOI },
      { ...brouillon, modifie_par: MOI },
    ]) {
      const d = droitsVersionGrille(["expert_metier"], MOI, v);
      expect(d.valider).toBe(false);
      expect(d.explicationValidation).toMatch(/séparation des tâches/);
    }
  });

  it("consultant et associé : préparent, ne valident pas", () => {
    for (const roles of [["consultant"], ["associe"]] as const) {
      const d = droitsVersionGrille(roles, MOI, brouillon);
      expect(d.modifier).toBe(true);
      expect(d.valider).toBe(false);
      expect(d.explicationValidation).toMatch(/expert métier/);
    }
  });

  it("version validée : figée", () => {
    const d = droitsVersionGrille(["expert_metier"], MOI, { ...brouillon, statut: "valide" });
    expect(d).toEqual({
      modifier: false,
      valider: false,
      explicationValidation: null,
      avertissementModification: null,
    });
  });
});

describe("erreurs, libellés et chemins", () => {
  it("anomalies du moteur : seuls les messages préfixés d'un code sont repris", () => {
    const e = new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400, {
      formErrors: ["GRILLE_INVALIDE : La grille est invalide."],
      fieldErrors: {
        "dimensions[0].poids": ["POIDS_INVALIDE : Le poids total doit être positif."],
        autre: ["Expected number, received string"],
      },
    });
    expect(anomaliesGrille(e)).toEqual([
      "La grille est invalide.",
      "Le poids total doit être positif.",
    ]);
    expect(anomaliesGrille(new Error("x"))).toEqual([]);
  });

  it("messages : 404, 409, séparation des tâches", () => {
    expect(messageGrille(new ErreurApi("INTROUVABLE", "x", 404))).toMatch(/plus accessible/);
    expect(messageGrille(new ErreurApi("CONFLIT", "Un brouillon existe déjà.", 409))).toBe(
      "Un brouillon existe déjà.",
    );
    expect(
      messageGrille(new ErreurApi("SEPARATION_DES_TACHES", "Un autre expert doit valider.", 403)),
    ).toBe("Un autre expert doit valider.");
  });

  it("auteur d'une version : vous, le nom connu, sinon un libellé neutre", () => {
    const personnes = [{ utilisateur_id: AUTRE, nom: "Awa Koné", grade_libelle: null }];
    expect(nomAuteurGrille(MOI, MOI, personnes)).toBe("vous");
    expect(nomAuteurGrille(AUTRE, MOI, personnes)).toBe("Awa Koné");
    expect(nomAuteurGrille("x", MOI, personnes)).toBe("un membre du cabinet");
    expect(nomAuteurGrille(null, MOI, personnes)).toBe("—");
  });

  it("libellés et chemins", () => {
    expect(libelleOrigine("generique")).toBe("Copie de la grille générique");
    expect(libelleOrigine("x")).toBe("Origine inconnue");
    expect(libelleStatutGrille("valide")).toBe("Validée (figée)");
    expect(cheminGrilles()).toBe("/api/notation/grilles?limite=50");
    expect(lireCurseurGrilles("abc_-1")).toBe("abc_-1");
    expect(lireCurseurGrilles(["x$"])).toBe("");
    expect(lireCurseurGrilles(undefined)).toBe("");
    expect(cheminGrilles("abc", 100)).toBe("/api/notation/grilles?limite=100&curseur=abc");
    expect(cheminValiderVersion("v1")).toBe("/api/notation/grilles/versions/v1/valider");
    expect(hrefGrilles()).toBe("/notation");
    expect(hrefGrilles("c")).toBe("/notation?curseur=c");
    expect(hrefVersionGrille("v 1")).toBe("/notation/versions/v%201");
  });
});
