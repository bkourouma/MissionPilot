import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminAction,
  cheminActions,
  cheminCampagnes,
  cheminConstat,
  cheminEligibles,
  criteresManquants,
  droitsQualiteFroide,
  estClotureAction,
  formaterCouverture,
  formaterScore,
  formaterTauxRealisation,
  hrefActions,
  hrefCampagne,
  hrefEchantillon,
  libelleConclusion,
  libelleCritere,
  libelleGravite,
  libelleStatutAction,
  libelleStatutCampagne,
  libelleStatutEchantillon,
  libelleViolationIndependance,
  lignesBudget,
  lireFiltresActions,
  messageFroide,
  statutsSuivants,
  tonaliteConclusion,
  tonaliteStatutAction,
  violationsIndependance,
} from "./qualite-froide";
import {
  validerAction,
  validerCampagne,
  validerConstat,
  validerEvaluation,
  validerSuiviAction,
  validerTerminaison,
  type SaisieCampagne,
} from "./qualite-froide-saisie";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

describe("droits d'affichage", () => {
  it("associé : gérer et relire", () => {
    expect(droitsQualiteFroide(["associe"])).toEqual({ gerer: true, relire: true, acces: true });
  });
  it("directeur de mission et expert métier : relire seulement", () => {
    for (const r of ["directeur_mission", "expert_metier"] as const) {
      expect(droitsQualiteFroide([r])).toEqual({ gerer: false, relire: true, acces: true });
    }
  });
  it("chef de mission et gestionnaire : aucun accès", () => {
    expect(droitsQualiteFroide(["chef_mission"]).acces).toBe(false);
    expect(droitsQualiteFroide(["gestionnaire"]).acces).toBe(false);
  });
});

describe("libellés", () => {
  it("statuts, conclusions et gravités en français", () => {
    expect(libelleStatutCampagne("ouverte")).toBe("Ouverte");
    expect(libelleStatutEchantillon("a_affecter")).toBe("À affecter");
    expect(libelleStatutAction("en_cours")).toBe("En cours");
    expect(libelleGravite("critique")).toBe("Critique");
    expect(libelleConclusion("reserves")).toBe("Conforme avec réserves");
    expect(libelleConclusion(null)).toBe("Pas encore de conclusion");
  });
  it("critère : libellé de la grille, ou revue d'ensemble", () => {
    expect(libelleCritere("solidite_preuves")).toBe("Solidité des preuves et des chiffres");
    expect(libelleCritere(null)).toBe("Revue dans son ensemble");
  });
  it("raisons d'inéligibilité en clair, message de l'API en repli", () => {
    expect(libelleViolationIndependance({ code: "EQUIPE", message: "x" })).toBe(
      "équipe de la mission",
    );
    expect(libelleViolationIndependance({ code: "DIRECTEUR", message: "x" })).toBe(
      "directeur de la mission",
    );
    expect(libelleViolationIndependance({ code: "INCONNU", message: "Motif de l'API." })).toBe(
      "Motif de l'API.",
    );
  });
  it("tonalités : la conclusion et le retard", () => {
    expect(tonaliteConclusion("conforme")).toBe("succes");
    expect(tonaliteConclusion("non_conforme")).toBe("danger");
    expect(tonaliteStatutAction({ statut: "a_faire", en_retard: true })).toBe("danger");
    expect(tonaliteStatutAction({ statut: "faite", en_retard: false })).toBe("succes");
  });
});

describe("mise en forme des valeurs du moteur (aucun recalcul)", () => {
  it("score, couverture, taux", () => {
    expect(formaterScore(72.5)).toBe("72,5 sur 100");
    expect(formaterScore(null)).toBe("—");
    expect(formaterCouverture(0.75)).toMatch(/^75\s%$/);
    expect(formaterTauxRealisation(62.5)).toBe("62,5 %");
  });
  it("budget : seules les clés présentes sont affichées (FIN-02)", () => {
    expect(lignesBudget(undefined)).toEqual([]);
    expect(lignesBudget({ version_reference: 2 })).toEqual([]);
    const l = lignesBudget({ version_reference: 1, budget_jours: 12 });
    expect(l.map((x) => x.libelle)).toEqual(["Jours vendus"]);
    const m = lignesBudget({ devise: "XOF", honoraires: 1500000, marge: 200000 });
    expect(m.map((x) => x.libelle)).toEqual(["Honoraires", "Marge"]);
    expect(m[0]?.valeur).toContain("FCFA");
  });
  it("transitions proposées : aucune depuis un état clos", () => {
    expect(statutsSuivants("a_faire")).toEqual(["en_cours", "faite", "abandonnee"]);
    expect(statutsSuivants("faite")).toEqual([]);
    expect(estClotureAction("abandonnee")).toBe(true);
    expect(estClotureAction("en_cours")).toBe(false);
  });
});

describe("chemins et filtres", () => {
  it("chemins d'API et de pages", () => {
    expect(cheminCampagnes()).toBe("/api/qualite/revue-froide/campagnes?limite=30");
    expect(cheminCampagnes("a_b")).toContain("&curseur=a_b");
    expect(cheminEligibles(ID)).toBe(
      `/api/qualite/revue-froide/echantillons/${ID}/relecteurs-eligibles`,
    );
    expect(cheminConstat(ID, ID2)).toBe(
      `/api/qualite/revue-froide/echantillons/${ID}/constats/${ID2}`,
    );
    expect(cheminAction(ID)).toBe(`/api/qualite/revue-froide/actions/${ID}`);
    expect(hrefCampagne(ID)).toBe(`/qualite/revue-froide/${ID}`);
    expect(hrefEchantillon(ID)).toBe(`/qualite/revue-froide/echantillons/${ID}`);
  });
  it("filtres d'actions : valeurs inconnues écartées", () => {
    expect(lireFiltresActions({ statut: "faite", en_retard: "true", campagne: ID })).toEqual({
      statut: "faite",
      enRetard: true,
      campagne: ID,
      curseur: "",
    });
    expect(lireFiltresActions({ statut: "x", campagne: "pas-un-uuid", curseur: "a b" })).toEqual({
      statut: "",
      enRetard: false,
      campagne: "",
      curseur: "",
    });
  });
  it("requête d'actions et lien de page", () => {
    expect(cheminActions({ statut: "en_cours", enRetard: true, campagne: ID })).toBe(
      `/api/qualite/revue-froide/actions?limite=30&campagne_id=${ID}&statut=en_cours&en_retard=true`,
    );
    expect(hrefActions()).toBe("/qualite/revue-froide/actions");
    expect(hrefActions({ campagne: ID, enRetard: true })).toBe(
      `/qualite/revue-froide/actions?en_retard=true&campagne=${ID}`,
    );
  });
});

describe("messages d'erreur de l'API", () => {
  it("message métier de l'API affiché tel quel", () => {
    const e = new ErreurApi(
      "RELECTEUR_NON_INDEPENDANT",
      "Le relecteur n'est pas indépendant.",
      409,
    );
    expect(messageFroide(e)).toBe("Le relecteur n'est pas indépendant.");
  });
  it("grille incomplète : critères manquants nommés", () => {
    const e = new ErreurApi("GRILLE_INCOMPLETE", "x", 409, {
      manquants: ["usage_ia", "budget_delais"],
    });
    expect(criteresManquants(e)).toEqual(["usage_ia", "budget_delais"]);
    expect(messageFroide(e)).toContain("Usage de l'IA encadré et déclaré");
    expect(messageFroide(e)).toContain("Maîtrise du budget et des délais");
  });
  it("404 et erreur inconnue", () => {
    expect(messageFroide(new ErreurApi("NON_TROUVE", "x", 404))).toContain("n'est plus accessible");
    expect(messageFroide(new Error("boum"))).toContain("inattendue");
  });
  it("violations d'indépendance extraites des détails", () => {
    const e = new ErreurApi("RELECTEUR_NON_INDEPENDANT", "x", 409, {
      violations: [{ code: "EQUIPE", message: "m" }, { code: 3 }, null],
    });
    expect(violationsIndependance(e)).toEqual([{ code: "EQUIPE", message: "m" }]);
    expect(violationsIndependance(new ErreurApi("AUTRE", "x", 409))).toEqual([]);
  });
});

describe("validerCampagne", () => {
  const base: SaisieCampagne = {
    intitule: " Revue S2 ",
    periode_debut: "2026-01-01",
    periode_fin: "2026-06-30",
    types_mission_ids: [ID],
    directeur_ids: [],
    stratifier_par: "",
    taille: "8",
    graine: "",
    exclure_deja_revues: true,
  };
  it("charge conforme au schéma partagé, graine absente si vide", () => {
    const r = validerCampagne(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charge.intitule).toBe("Revue S2");
    expect(r.charge.taille).toBe(8);
    expect(r.charge.criteres.stratifier_par).toBeNull();
    expect(r.charge.criteres.exclure_deja_revues).toBe(true);
    expect("graine" in r.charge).toBe(false);
  });
  it("graine et stratification transmises", () => {
    const r = validerCampagne({ ...base, graine: "S2_2026", stratifier_par: "directeur" });
    expect(r.ok && r.charge.graine).toBe("S2_2026");
    expect(r.ok && r.charge.criteres.stratifier_par).toBe("directeur");
  });
  it("messages français par champ", () => {
    const r = validerCampagne({
      ...base,
      intitule: " ",
      periode_debut: "2026-07-01",
      taille: "0",
      graine: "avec espace",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erreurs.intitule).toBe("Donnez un intitulé à la campagne.");
    expect(r.erreurs.periode_fin).toBe("La fin de période précède son début.");
    expect(r.erreurs.taille).toContain("1 à 100");
    expect(r.erreurs.graine).toContain("64 caractères");
  });
  it("dates manquantes ou impossibles", () => {
    const r = validerCampagne({ ...base, periode_debut: "", periode_fin: "2026-02-31" });
    expect(!r.ok && r.erreurs.periode_debut).toBeTruthy();
    expect(!r.ok && r.erreurs.periode_fin).toBeTruthy();
  });
});

describe("validerEvaluation", () => {
  it("note 1 à 5", () => {
    const r = validerEvaluation({ critere: "usage_ia", note: "4", commentaire: "  " });
    expect(r).toEqual({ ok: true, charge: { critere: "usage_ia", note: 4, commentaire: null } });
  });
  it("sans objet exige une justification", () => {
    const r = validerEvaluation({ critere: "usage_ia", note: "sans_objet", commentaire: "" });
    expect(!r.ok && r.erreurs.commentaire).toBe("Justifiez un critère sans objet.");
    const ok = validerEvaluation({
      critere: "usage_ia",
      note: "sans_objet",
      commentaire: "Pas d'IA.",
    });
    expect(ok.ok && ok.charge.note).toBeNull();
  });
  it("aucune note choisie", () => {
    const r = validerEvaluation({ critere: "usage_ia", note: "", commentaire: "" });
    expect(!r.ok && r.erreurs.note).toContain("1 à 5");
    const hors = validerEvaluation({ critere: "usage_ia", note: "6", commentaire: "" });
    expect(hors.ok).toBe(false);
  });
});

describe("validerConstat", () => {
  it("gravité et description obligatoires", () => {
    const r = validerConstat({ critere: "", gravite: "", description: " ", recommandation: "" });
    expect(!r.ok && r.erreurs.gravite).toBe("Choisissez la gravité du constat.");
    expect(!r.ok && r.erreurs.description).toBe("Décrivez le constat.");
  });
  it("charge : critère facultatif → null, recommandation vide → null", () => {
    const r = validerConstat({
      critere: "",
      gravite: "majeur",
      description: " Pièce manquante ",
      recommandation: "",
    });
    expect(r).toEqual({
      ok: true,
      charge: {
        critere: null,
        gravite: "majeur",
        description: "Pièce manquante",
        recommandation: null,
      },
    });
  });
});

describe("validerTerminaison", () => {
  it("synthèse obligatoire", () => {
    const r = validerTerminaison("  ");
    expect(!r.ok && r.erreurs.synthese).toBe("La synthèse de la revue est obligatoire.");
    expect(validerTerminaison(" Bonne mission. ")).toEqual({
      ok: true,
      charge: { synthese: "Bonne mission." },
    });
  });
});

describe("validerAction", () => {
  const base = {
    titre: "Revoir la méthode",
    description: "",
    constat_id: "",
    responsable_id: ID,
    echeance: "2026-12-31",
  };
  it("charge valide", () => {
    const r = validerAction(base);
    expect(r).toEqual({
      ok: true,
      charge: {
        titre: "Revoir la méthode",
        description: null,
        constat_id: null,
        responsable_id: ID,
        echeance: "2026-12-31",
      },
    });
  });
  it("champs obligatoires", () => {
    const r = validerAction({ ...base, titre: "", responsable_id: "", echeance: "demain" });
    expect(!r.ok && r.erreurs.titre).toBe("Donnez un titre à l'action.");
    expect(!r.ok && r.erreurs.responsable_id).toBe("Choisissez le responsable de l'action.");
    expect(!r.ok && r.erreurs.echeance).toBe("Indiquez l'échéance de l'action.");
  });
});

describe("validerSuiviAction", () => {
  const actuel = { responsable_id: ID, echeance: "2026-12-31" };
  const saisie = { statut: "", responsable_id: ID, echeance: "2026-12-31", commentaire: "" };
  it("clôturer exige un commentaire", () => {
    const r = validerSuiviAction({ ...saisie, statut: "faite" }, actuel);
    expect(!r.ok && r.erreurs.commentaire).toContain("clôture");
    const ab = validerSuiviAction({ ...saisie, statut: "abandonnee" }, actuel);
    expect(!ab.ok && ab.erreurs.commentaire).toContain("abandon");
  });
  it("seuls les champs modifiés partent", () => {
    const r = validerSuiviAction({ ...saisie, statut: "en_cours" }, actuel);
    expect(r).toEqual({ ok: true, charge: { statut: "en_cours" } });
    const g = validerSuiviAction(
      { ...saisie, responsable_id: ID2, echeance: "2027-01-15" },
      actuel,
    );
    expect(g).toEqual({ ok: true, charge: { responsable_id: ID2, echeance: "2027-01-15" } });
  });
  it("clôture commentée", () => {
    const r = validerSuiviAction({ ...saisie, statut: "faite", commentaire: " Fait. " }, actuel);
    expect(r).toEqual({ ok: true, charge: { statut: "faite", commentaire: "Fait." } });
  });
  it("rien à modifier", () => {
    const r = validerSuiviAction(saisie, actuel);
    expect(!r.ok && r.erreurs.statut).toContain("Rien à modifier");
  });
});
