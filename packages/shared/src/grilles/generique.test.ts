import { describe, expect, it } from "vitest";
// Les moteurs sont purs et sans dépendance : le test les importe par chemin
// relatif pour vérifier la grille avec les mêmes fonctions que l'API.
import {
  noterQuestionnaire,
  poidsNormalises,
  questionsVisibles,
  scoreGlobal,
  validerDefinition,
  validerGrille,
  verifierCoherence,
} from "../../../engines/src/index";
import {
  ECHELLE_ACCORD,
  ECHELLE_MATURITE,
  GRILLE_GENERIQUE,
  QUESTIONNAIRE_NOTATION_GENERIQUE,
  QUESTIONNAIRE_PRELIMINAIRE_DIRIGEANTS,
  SECTEURS_GRILLE_GENERIQUE,
} from "./generique";
import {
  conditionAffichageSchema,
  definitionQuestionnaireSchema,
  grilleNotationSchema,
  questionSchema,
} from "./schemas";

const questions = QUESTIONNAIRE_NOTATION_GENERIQUE.sections.flatMap((s) => s.questions);
const indicateurs = GRILLE_GENERIQUE.dimensions.flatMap((d) => d.indicateurs);

/** Identifiants publiés : ils ne doivent jamais changer (seul l'ajout est permis). */
const IDENTIFIANTS_STABLES = {
  strategie: [
    "strat.plan_formalise",
    "strat.horizon_plan",
    "strat.communication",
    "strat.declinaison",
    "strat.ressources",
    "strat.revue",
    "strat.veille",
  ],
  processus: [
    "proc.cartographie",
    "proc.modes_operatoires",
    "proc.interfaces",
    "proc.indicateurs",
    "proc.outils",
    "proc.risques",
  ],
  pilotage: [
    "pil.tableau_bord",
    "pil.frequence",
    "pil.cibles",
    "pil.fiabilite",
    "pil.decisions",
    "pil.budget",
  ],
  amelioration: [
    "amel.causes",
    "amel.suggestions",
    "amel.methode",
    "amel.reclamations",
    "amel.generalisation",
    "amel.comparaison",
  ],
  organisation: [
    "org.organigramme",
    "org.delegation",
    "org.attendus",
    "org.competences",
    "org.releve",
    "org.gouvernance",
  ],
  engagement: [
    "eng.reconnaissance",
    "eng.communication",
    "eng.climat",
    "eng.sante_securite",
    "eng.entretiens",
    "eng.departs",
  ],
  qualite: [
    "qual.exigences",
    "qual.controles",
    "qual.certification",
    "qual.service_client",
    "qual.satisfaction",
    "qual.fournisseurs",
  ],
  couts: [
    "cout.revient",
    "cout.marges",
    "cout.pertes",
    "cout.achats",
    "cout.tresorerie",
    "cout.productivite",
  ],
  innovation: [
    "innov.veille",
    "innov.part_nouveautes",
    "innov.idees",
    "innov.moyens",
    "innov.numerique",
    "innov.partenariats",
  ],
  positionnement: [
    "posi.cible",
    "posi.differenciation",
    "posi.concurrents",
    "posi.part_marche",
    "posi.dependance",
    "posi.prix",
    "posi.reputation",
  ],
};

describe("grille générique de départ (NOT-01)", () => {
  it("respecte les schémas partagés", () => {
    expect(grilleNotationSchema.safeParse(GRILLE_GENERIQUE).success).toBe(true);
    expect(definitionQuestionnaireSchema.safeParse(QUESTIONNAIRE_NOTATION_GENERIQUE).success).toBe(
      true,
    );
    expect(
      definitionQuestionnaireSchema.safeParse(QUESTIONNAIRE_PRELIMINAIRE_DIRIGEANTS).success,
    ).toBe(true);
  });

  it("est validée par les moteurs : définition, grille et cohérence des deux", () => {
    expect(validerDefinition(QUESTIONNAIRE_NOTATION_GENERIQUE).erreurs).toEqual([]);
    expect(validerDefinition(QUESTIONNAIRE_PRELIMINAIRE_DIRIGEANTS).erreurs).toEqual([]);
    expect(validerGrille(GRILLE_GENERIQUE)).toEqual([]);
    expect(verifierCoherence(GRILLE_GENERIQUE, QUESTIONNAIRE_NOTATION_GENERIQUE)).toEqual([]);
  });

  it("compte 6 piliers d'excellence et 4 facteurs de compétitivité, de 5 à 8 questions chacun", () => {
    const parFamille = (f: string) =>
      GRILLE_GENERIQUE.dimensions.filter((d) => d.famille === f).map((d) => d.id);
    expect(parFamille("excellence")).toEqual([
      "strategie",
      "processus",
      "pilotage",
      "amelioration",
      "organisation",
      "engagement",
    ]);
    expect(parFamille("competitivite")).toEqual([
      "qualite",
      "couts",
      "innovation",
      "positionnement",
    ]);
    for (const d of GRILLE_GENERIQUE.dimensions) {
      expect(d.indicateurs.length).toBeGreaterThanOrEqual(5);
      expect(d.indicateurs.length).toBeLessThanOrEqual(8);
    }
    expect(questions).toHaveLength(62);
  });

  it("garde des identifiants stables", () => {
    const actuels = Object.fromEntries(
      QUESTIONNAIRE_NOTATION_GENERIQUE.sections.map((s) => [s.id, s.questions.map((q) => q.id)]),
    );
    expect(actuels).toEqual(IDENTIFIANTS_STABLES);
    expect(GRILLE_GENERIQUE.id).toBe("notation_generique");
    expect(QUESTIONNAIRE_PRELIMINAIRE_DIRIGEANTS.id).toBe("preliminaire_dirigeants");
    expect(SECTEURS_GRILLE_GENERIQUE.map((s) => s.code)).toEqual([
      "agro_industrie",
      "numerique",
      "industrie",
      "services",
      "commerce",
    ]);
  });

  it("est complète : chaque question est notée une fois, aucune référence orpheline", () => {
    const notees = indicateurs.map((i) => i.question);
    expect(new Set(notees).size).toBe(notees.length);
    expect([...notees].sort()).toEqual(questions.map((q) => q.id).sort());
    // Les sections du questionnaire suivent les dimensions de la grille.
    expect(QUESTIONNAIRE_NOTATION_GENERIQUE.sections.map((s) => s.id)).toEqual(
      GRILLE_GENERIQUE.dimensions.map((d) => d.id),
    );
    // Toute condition cite une question du même questionnaire.
    for (const q of questions) {
      if (q.condition && "question" in q.condition) {
        expect(questions.some((x) => x.id === (q.condition as { question: string }).question)).toBe(
          true,
        );
      }
    }
  });

  it("utilise des échelles de Likert 1-5 libellées et quelques questions à choix", () => {
    const likert = questions.filter((q) => q.type === "likert");
    expect(likert.length).toBeGreaterThanOrEqual(40);
    for (const q of likert) expect(q).toMatchObject({ points: 5, libelles: [...ECHELLE_MATURITE] });
    expect(questions.filter((q) => q.type === "choix_unique").length).toBeGreaterThanOrEqual(5);
    for (const q of questions) expect(q.libelle.length).toBeGreaterThan(10);
  });

  it("pondère à 100 par défaut et pour chaque secteur", () => {
    const somme = (v: number[]) => v.reduce((a, b) => a + b, 0);
    expect(somme(GRILLE_GENERIQUE.dimensions.map((d) => d.poids))).toBe(100);
    expect(GRILLE_GENERIQUE.secteurs?.map((s) => s.secteur)).toEqual(
      SECTEURS_GRILLE_GENERIQUE.map((s) => s.code),
    );
    for (const s of GRILLE_GENERIQUE.secteurs ?? []) {
      expect(s.poids.map((p) => p.dimension)).toEqual(GRILLE_GENERIQUE.dimensions.map((d) => d.id));
      expect(somme(s.poids.map((p) => p.poids))).toBe(100);
      const normalises = poidsNormalises(GRILLE_GENERIQUE, s.secteur);
      expect(normalises.secteurApplique).toBe(s.secteur);
      expect(normalises.poids.map((p) => p.poids)).toEqual(s.poids.map((p) => p.poids));
    }
    expect(somme(poidsNormalises(GRILLE_GENERIQUE).poids.map((p) => p.poids))).toBe(100);
  });

  it("note de 0 à 100 : tout au plus haut → 100 (A), tout au plus bas → 0 (E)", () => {
    const meilleures: Record<string, unknown> = {};
    const pires: Record<string, unknown> = {};
    for (const ind of indicateurs) {
      const r = ind.conversion;
      if (r.type === "likert") {
        meilleures[ind.question] = 5;
        pires[ind.question] = 1;
      } else if (r.type === "choix") {
        const tri = [...r.valeurs].sort((a, b) => b.points - a.points);
        meilleures[ind.question] = tri[0]?.code;
        pires[ind.question] = tri[tri.length - 1]?.code;
      } else if (r.type === "oui_non") {
        meilleures[ind.question] = true;
        pires[ind.question] = false;
      }
    }
    meilleures["eng.departs"] = 2;
    meilleures["qual.service_client"] = 99;
    meilleures["innov.part_nouveautes"] = 45;
    pires["eng.departs"] = 40;
    pires["qual.service_client"] = 50;
    pires["innov.part_nouveautes"] = 0;
    // Sans plan, l'horizon est sans objet ; avec plan, il est noté.
    const haut = noterQuestionnaire(
      GRILLE_GENERIQUE,
      QUESTIONNAIRE_NOTATION_GENERIQUE,
      meilleures as never,
    );
    expect(haut).toMatchObject({ score: 100, classe: "A", notable: true });
    const bas = noterQuestionnaire(
      GRILLE_GENERIQUE,
      QUESTIONNAIRE_NOTATION_GENERIQUE,
      pires as never,
    );
    expect(bas).toMatchObject({ score: 0, classe: "E", notable: true });
    expect(bas.dimensions[0]?.indicateurs[1]?.statut).toBe("sans_objet");
    for (const s of SECTEURS_GRILLE_GENERIQUE) {
      expect(scoreGlobal(GRILLE_GENERIQUE, meilleures as never, { secteur: s.code }).score).toBe(
        100,
      );
    }
  });

  it("pondère différemment selon le secteur un même profil de réponses", () => {
    const reponses: Record<string, unknown> = {};
    for (const ind of indicateurs) {
      if (ind.conversion.type === "likert")
        reponses[ind.question] = ind.question.startsWith("innov.") ? 5 : 3;
    }
    const general = scoreGlobal(GRILLE_GENERIQUE, reponses as never).score as number;
    const numerique = scoreGlobal(GRILLE_GENERIQUE, reponses as never, { secteur: "numerique" })
      .score as number;
    const commerce = scoreGlobal(GRILLE_GENERIQUE, reponses as never, { secteur: "commerce" })
      .score as number;
    expect(numerique).toBeGreaterThan(general);
    expect(commerce).toBeLessThan(general);
  });
});

describe("questionnaire préliminaire des dirigeants (NOT-02)", () => {
  it("couvre style de management, culture et appétence au changement", () => {
    expect(QUESTIONNAIRE_PRELIMINAIRE_DIRIGEANTS.sections.map((s) => s.titre)).toEqual([
      "Votre profil",
      "Style de management",
      "Culture de l'entreprise",
      "Appétence au changement",
    ]);
    const likert = QUESTIONNAIRE_PRELIMINAIRE_DIRIGEANTS.sections
      .flatMap((s) => s.questions)
      .filter((q) => q.type === "likert");
    for (const q of likert) expect(q).toMatchObject({ libelles: [...ECHELLE_ACCORD] });
  });

  it("applique sa logique conditionnelle", () => {
    const visibles = (r: Record<string, unknown>) =>
      questionsVisibles(QUESTIONNAIRE_PRELIMINAIRE_DIRIGEANTS, r as never);
    expect(visibles({})).not.toContain("cult.valeurs_detail");
    expect(visibles({ "cult.valeurs": true })).toContain("cult.valeurs_detail");
    expect(visibles({ "chg.experience": "reussi" })).not.toContain("chg.freins");
    expect(visibles({ "chg.experience": "mitige" })).toContain("chg.freins");
  });
});

describe("schémas partagés des questionnaires et des grilles", () => {
  it("refusent une clé inconnue, un identifiant invalide ou une condition mal formée", () => {
    const base = { id: "q", type: "oui_non", libelle: "Question ?", obligatoire: true };
    expect(questionSchema.safeParse(base).success).toBe(true);
    expect(questionSchema.safeParse({ ...base, inconnu: 1 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, id: "Q majuscule" }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, type: "curseur" }).success).toBe(false);
    expect(
      conditionAffichageSchema.safeParse({
        op: "et",
        conditions: [{ op: "non", condition: { op: "vide", question: "a" } }],
      }).success,
    ).toBe(true);
    expect(conditionAffichageSchema.safeParse({ op: "et", conditions: [] }).success).toBe(false);
    expect(conditionAffichageSchema.safeParse({ op: "egal", question: "a" }).success).toBe(false);
    expect(
      conditionAffichageSchema.safeParse({ op: "xor", question: "a", valeur: 1 }).success,
    ).toBe(false);
    const grille = {
      ...GRILLE_GENERIQUE,
      dimensions: [{ ...GRILLE_GENERIQUE.dimensions[0], poids: -1 }],
    };
    expect(grilleNotationSchema.safeParse(grille).success).toBe(false);
    const indicateurNul = {
      ...GRILLE_GENERIQUE,
      dimensions: [
        {
          ...GRILLE_GENERIQUE.dimensions[0],
          indicateurs: [{ ...GRILLE_GENERIQUE.dimensions[0]!.indicateurs[0], poids: 0 }],
        },
      ],
    };
    expect(grilleNotationSchema.safeParse(indicateurNul).success).toBe(false);
  });
});
