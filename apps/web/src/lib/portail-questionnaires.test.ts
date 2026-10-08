import { describe, expect, it } from "vitest";
import type { QuestionQuestionnaire } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { entreesPortail } from "./portail";
import {
  aDefinition,
  annonceCollegues,
  annonceVisibilite,
  cheminApiQuestionnaire,
  cheminApiReponses,
  cheminApiSoumission,
  CHEMIN_QUESTIONNAIRES_PORTAIL,
  dateDuJour,
  delaiNouvelleTentative,
  echeance,
  erreursQuestionsServeur,
  estModifiable,
  estReessayable,
  etatQuestionnaire,
  finApresEnvoi,
  finInaccessible,
  finLectureSeule,
  hrefQuestionnaire,
  hrefReconnexion,
  issueBloquante,
  issueRefus,
  libelleMode,
  libelleReponse,
  messageActualisation,
  MESSAGE_REFUS_SERVEUR,
  messageRefus,
  pourcentageAffiche,
  SANS_REPONSE,
  texteProgression,
  texteSauvegarde,
  texteSoumission,
  type QuestionnairePortail,
} from "./portail-questionnaires";

const ID = "3f2b8c1e-5d4a-4b6f-9e7d-1a2b3c4d5e6f";

function questionnaire(modif: Partial<QuestionnairePortail> = {}): QuestionnairePortail {
  return {
    id: ID,
    titre: "Diagnostic préliminaire",
    mode: "individuel",
    statut: "envoye",
    date_limite: "2027-03-15",
    envoye_le: "2027-03-01T09:00:00.000Z",
    fonction: null,
    reponse: {
      statut: "non_commence",
      derniere_saisie: null,
      soumission: null,
      progression: {
        pourcentage: 0,
        complet: false,
        obligatoires_visibles: 10,
        obligatoires_repondues: 0,
      },
    },
    ...modif,
  };
}

const reponse = (r: Partial<QuestionnairePortail["reponse"]>) => ({
  ...questionnaire().reponse,
  ...r,
});

describe("navigation", () => {
  it("la rubrique n'apparaît que pour les rôles qui répondent (jamais l'investisseur)", () => {
    const ids = (roles: string[]) => entreesPortail(roles).map((e) => e.id);
    expect(ids(["client_dirigeant"])).toContain("questionnaires");
    expect(ids(["client_contributeur"])).toContain("questionnaires");
    expect(ids(["client_investisseur"])).not.toContain("questionnaires");
    expect(ids(["associe"])).not.toContain("questionnaires");
    const entree = entreesPortail(["client_contributeur"]).find((e) => e.id === "questionnaires");
    expect(entree?.href).toBe(CHEMIN_QUESTIONNAIRES_PORTAIL);
  });
});

describe("chemins", () => {
  it("identifiants encodés, connexion avec retour sur le questionnaire", () => {
    expect(hrefQuestionnaire(ID)).toBe(`/portail/questionnaires/${ID}`);
    expect(cheminApiQuestionnaire("a/b")).toBe("/api/portail/questionnaires/a%2Fb");
    expect(cheminApiReponses(ID)).toBe(`/api/portail/questionnaires/${ID}/reponses`);
    expect(cheminApiSoumission(ID)).toBe(`/api/portail/questionnaires/${ID}/soumettre`);
    expect(hrefReconnexion(ID)).toBe(
      `/connexion?suite=${encodeURIComponent(`/portail/questionnaires/${ID}`)}`,
    );
  });

  it("une vue sans définition (liste) n'est pas une vue complète", () => {
    expect(aDefinition(questionnaire())).toBe(false);
    expect(
      aDefinition(questionnaire({ definition: { id: "q", version: 1, titre: "Q", sections: [] } })),
    ).toBe(true);
  });
});

describe("dates", () => {
  it("date du jour dans le fuseau d'Abidjan (UTC) ou un autre fuseau", () => {
    const instant = new Date("2027-03-14T23:30:00.000Z");
    expect(dateDuJour(instant)).toBe("2027-03-14");
    expect(dateDuJour(instant, "Africa/Lagos")).toBe("2027-03-15");
  });

  it("date limite : à venir, dernier jour, dépassée (réponse refusée) ; aucune", () => {
    expect(echeance("2027-03-15", "2027-03-10")).toEqual({
      texte: "Date limite : le 15 mars 2027",
      depassee: false,
      dernierJour: false,
    });
    expect(echeance("2027-03-15", "2027-03-15")).toEqual({
      texte: "Date limite : aujourd'hui (15 mars 2027)",
      depassee: false,
      dernierJour: true,
    });
    expect(echeance("2027-03-15", "2027-03-16")).toEqual({
      texte:
        "Date limite dépassée (15 mars 2027) : les réponses ne sont plus acceptées, sauf prolongation par le cabinet",
      depassee: true,
      dernierJour: false,
    });
    expect(echeance(null, "2027-03-16")).toBeNull();
  });
});

describe("libellés et états", () => {
  it("mode de réponse, fonction comprise", () => {
    expect(libelleMode("collectif")).toBe("Réponse partagée par l'entreprise");
    expect(libelleMode("par_fonction", "Directeur financier")).toBe(
      "Réponse en tant que Directeur financier",
    );
    expect(libelleMode("par_fonction")).toBe("Réponse par fonction");
    expect(libelleMode("inconnu")).toBe("Réponse individuelle");
  });

  it("modifiable tant qu'envoyé et non soumis", () => {
    expect(estModifiable(questionnaire())).toBe(true);
    expect(estModifiable(questionnaire({ statut: "clos" }))).toBe(false);
    expect(estModifiable(questionnaire({ reponse: reponse({ statut: "soumise" }) }))).toBe(false);
  });

  it("date limite passée : plus de saisie (le jour même reste ouvert)", () => {
    const q = questionnaire({ date_limite: "2027-03-15" });
    expect(estModifiable(q, "2027-03-15")).toBe(true);
    expect(estModifiable(q, "2027-03-16")).toBe(false);
    // Sans le jour du jour, seul l'état de l'envoi compte.
    expect(estModifiable(q)).toBe(true);
    expect(estModifiable(questionnaire({ date_limite: null }), "2030-01-01")).toBe(true);
  });

  it("statut affiché selon la réponse, la clôture et la date limite", () => {
    const j = "2027-03-10";
    expect(etatQuestionnaire(questionnaire(), j)).toEqual({
      libelle: "À commencer",
      tonalite: "neutre",
    });
    expect(etatQuestionnaire(questionnaire(), "2027-04-01").tonalite).toBe("danger");
    expect(
      etatQuestionnaire(questionnaire({ reponse: reponse({ statut: "brouillon" }) }), j),
    ).toEqual({ libelle: "En cours", tonalite: "attention" });
    expect(
      etatQuestionnaire(questionnaire({ reponse: reponse({ statut: "brouillon" }) }), "2027-04-01")
        .libelle,
    ).toBe("En cours, date limite dépassée");
    expect(etatQuestionnaire(questionnaire({ statut: "clos" }), j).libelle).toBe(
      "Clos, plus de réponse possible",
    );
    const soumis = reponse({
      statut: "soumise",
      soumission: { le: "2027-03-12T10:00:00.000Z", par_moi: false },
    });
    expect(etatQuestionnaire(questionnaire({ reponse: soumis }), j)).toEqual({
      libelle: "Envoyé",
      tonalite: "succes",
    });
    expect(
      etatQuestionnaire(questionnaire({ mode: "collectif", reponse: soumis }), j).libelle,
    ).toBe("Envoyé par votre entreprise");
  });

  it("progression de l'API reprise telle quelle, bornée pour la barre", () => {
    const p = {
      pourcentage: 40,
      complet: false,
      obligatoires_visibles: 10,
      obligatoires_repondues: 4,
    };
    expect(texteProgression(p)).toBe("4 questions obligatoires sur 10 renseignées");
    expect(texteProgression({ ...p, obligatoires_repondues: 1 })).toBe(
      "1 question obligatoire sur 10 renseignée",
    );
    expect(texteProgression({ ...p, obligatoires_visibles: 0 })).toBe(
      "Aucune question obligatoire à renseigner",
    );
    expect(pourcentageAffiche({ pourcentage: 140 })).toBe(100);
    expect(pourcentageAffiche({ pourcentage: Number.NaN })).toBe(0);
    expect(pourcentageAffiche({ pourcentage: 66 })).toBe(66);
  });

  it("phrase de soumission selon le mode et l'auteur", () => {
    const soumise = (par_moi: boolean) =>
      reponse({ statut: "soumise", soumission: { le: "2027-03-12T14:05:00.000Z", par_moi } });
    expect(texteSoumission(questionnaire({ reponse: soumise(true) }))).toBe(
      "Vos réponses ont été envoyées le 12 mars 2027 à 14:05.",
    );
    expect(texteSoumission(questionnaire({ mode: "collectif", reponse: soumise(false) }))).toBe(
      "Un collègue a envoyé la réponse de votre entreprise le 12 mars 2027 à 14:05.",
    );
    expect(texteSoumission(questionnaire({ mode: "collectif", reponse: soumise(true) }))).toMatch(
      /^Vous avez envoyé la réponse de votre entreprise/,
    );
    expect(texteSoumission(questionnaire())).toBeNull();
  });
});

describe("réponses en lecture seule", () => {
  const likert: QuestionQuestionnaire = {
    id: "l",
    type: "likert",
    libelle: "L",
    obligatoire: true,
    points: 5,
    libelles: ["Inexistant", "Ponctuel", "En place", "Systématique", "Mesuré"],
  };
  const choix: QuestionQuestionnaire = {
    id: "c",
    type: "choix_multiple",
    libelle: "C",
    obligatoire: false,
    options: [
      { code: "a", libelle: "Alpha" },
      { code: "b", libelle: "Bêta" },
    ],
  };

  it("libellés d'échelle, d'options, oui/non, nombres avec unité et dates", () => {
    expect(libelleReponse(likert, 4)).toBe("4 sur 5 : Systématique");
    expect(libelleReponse(choix, ["a", "b"])).toBe("Alpha, Bêta");
    expect(libelleReponse(choix, ["z"])).toBe("z");
    expect(
      libelleReponse({ id: "o", type: "oui_non", libelle: "O", obligatoire: true }, false),
    ).toBe("Non");
    expect(
      libelleReponse(
        { id: "n", type: "numerique", libelle: "N", obligatoire: false, unite: "%" },
        12.5,
      ),
    ).toBe("12,5\u00a0%");
    expect(
      libelleReponse({ id: "d", type: "date", libelle: "D", obligatoire: false }, "2027-03-15"),
    ).toBe("15 mars 2027");
    expect(libelleReponse(likert, null)).toBe(SANS_REPONSE);
    expect(libelleReponse(choix, [])).toBe(SANS_REPONSE);
  });
});

describe("refus de l'API", () => {
  const err = (statut: number, code: string, details?: unknown) =>
    new ErreurApi(code, "Message de l'API.", statut, details);

  it("issue de chaque refus", () => {
    expect(issueRefus(err(0, "RESEAU_INDISPONIBLE"))).toBe("reseau");
    expect(issueRefus(err(503, "SERVICE_INDISPONIBLE"))).toBe("indisponible");
    expect(issueRefus(err(429, "TROP_DE_TENTATIVES"))).toBe("indisponible");
    expect(issueRefus(err(401, "NON_AUTHENTIFIE"))).toBe("session");
    expect(issueRefus(err(403, "TFA_A_CONFIGURER"))).toBe("securite");
    expect(issueRefus(err(403, "INTERDIT"))).toBe("interdit");
    expect(issueRefus(err(404, "INTROUVABLE"))).toBe("introuvable");
    expect(issueRefus(err(409, "QUESTIONNAIRE_DEJA_SOUMIS"))).toBe("verrouille");
    expect(issueRefus(err(409, "DATE_LIMITE_DEPASSEE"))).toBe("echeance");
    expect(issueBloquante("echeance")).toBe(true);
    expect(issueRefus(err(409, "REPONSE_VERROUILLEE"))).toBe("verrouille");
    expect(issueRefus(err(409, "CONFLIT"))).toBe("clos");
    expect(issueRefus(err(400, "REQUETE_INVALIDE"))).toBe("invalide");
    expect(issueRefus(new Error("x"))).toBe("autre");
    expect(estReessayable("reseau") && estReessayable("indisponible")).toBe(true);
    expect(estReessayable("invalide")).toBe(false);
    expect(issueBloquante("verrouille") && issueBloquante("clos")).toBe(true);
    expect(issueBloquante("session")).toBe(false);
  });

  it("messages en français selon le mode et le moment", () => {
    expect(messageRefus("verrouille", "collectif", "brouillon")).toBe(
      "La réponse de votre entreprise a déjà été envoyée : elle est verrouillée et ne peut plus être modifiée.",
    );
    expect(messageRefus("verrouille", "individuel", "envoi")).toMatch(/^Vos réponses ont déjà/);
    expect(messageRefus("reseau", "individuel", "brouillon")).toMatch(/Ne fermez pas la page/);
    expect(messageRefus("clos", "individuel", "envoi")).toBe(
      "Le cabinet a clos ce questionnaire : il n'accepte plus de réponse.",
    );
    expect(messageRefus("autre", "individuel", "envoi", err(418, "X"))).toBe("Message de l'API.");
    expect(messageRefus("autre", "individuel", "envoi")).toMatch(/inattendue/);
  });

  it("erreurs par question : codes du moteur traduits, chemins inconnus ignorés", () => {
    const e = err(400, "REQUETE_INVALIDE", {
      formErrors: ["REPONSES_INVALIDES : Réponses invalides."],
      fieldErrors: {
        "strat.plan": ["OBLIGATOIRE : Cette question est obligatoire."],
        "exp.part": ["HORS_BORNES : La valeur doit être comprise entre 0 et 100."],
        "exp.autre": ["CODE_NOUVEAU : texte"],
        reponses: ["Invalid key"],
      },
    });
    expect(erreursQuestionsServeur(e, new Set(["strat.plan", "exp.part", "exp.autre"]))).toEqual({
      "strat.plan": "Cette question est obligatoire.",
      "exp.part": "Valeur hors des limites indiquées.",
      "exp.autre": MESSAGE_REFUS_SERVEUR,
    });
    expect(erreursQuestionsServeur(err(409, "CONFLIT"), new Set(["a"]))).toEqual({});
    expect(erreursQuestionsServeur(err(400, "REQUETE_INVALIDE"), new Set(["a"]))).toEqual({});
  });

  it("nouvelle tentative espacée, plafonnée", () => {
    expect(delaiNouvelleTentative(0)).toBe(2_000);
    expect(delaiNouvelleTentative(2)).toBe(8_000);
    expect(delaiNouvelleTentative(50)).toBe(30_000);
  });
});

describe("sauvegarde et annonces", () => {
  it("état de la sauvegarde", () => {
    expect(texteSauvegarde("a_jour", "2027-03-12T14:05:00.000Z")).toBe(
      "Brouillon enregistré le 12 mars 2027 à 14:05.",
    );
    expect(texteSauvegarde("a_jour", null)).toBe("Aucune modification à enregistrer.");
    expect(texteSauvegarde("hors_ligne", null)).toMatch(/^Connexion perdue/);
  });

  it("annonce des questions qui apparaissent ou disparaissent", () => {
    expect(annonceVisibilite(1, 0)).toBe("Une nouvelle question est affichée.");
    expect(annonceVisibilite(2, 1)).toBe(
      "2 nouvelles questions sont affichées et une question n'est plus affichée.",
    );
    expect(annonceVisibilite(0, 3)).toBe("3 questions ne sont plus affichées.");
    expect(annonceVisibilite(0, 0)).toBe("");
  });
});

describe("fin de la saisie", () => {
  const soumise = (par_moi: boolean) =>
    reponse({ statut: "soumise", soumission: { le: "2027-03-12T14:05:00.000Z", par_moi } });

  it("questionnaire envoyé : lecture seule, réponses non modifiables", () => {
    expect(finLectureSeule(questionnaire({ reponse: soumise(true) }))).toEqual({
      type: "lecture",
      tonalite: "succes",
      titre: "Réponses envoyées",
      message:
        "Vos réponses ont été envoyées le 12 mars 2027 à 14:05. Elles ne sont plus modifiables.",
      lien: null,
    });
    const collectif = finLectureSeule(
      questionnaire({ mode: "collectif", reponse: soumise(false) }),
      2,
    );
    expect(collectif.titre).toBe("Réponse de l'entreprise envoyée");
    expect(collectif.tonalite).toBe("attention");
    expect(collectif.message).toBe(
      "Un collègue a envoyé la réponse de votre entreprise le 12 mars 2027 à 14:05. Elle n'est plus modifiable. Vos dernières modifications (2 questions) n'ont pas pu être enregistrées.",
    );
  });

  it("date limite dépassée : message dédié, brouillon signalé", () => {
    const q = questionnaire({ date_limite: "2027-03-15" });
    expect(finLectureSeule(q, 0, "2027-03-15").titre).toBe("Questionnaire clos");
    const fin = finLectureSeule(q, 0, "2027-03-16");
    expect(fin).toMatchObject({
      type: "lecture",
      tonalite: "attention",
      titre: "Date limite dépassée",
    });
    expect(fin.message).toMatch(/prolongation/);
    expect(
      finLectureSeule(
        questionnaire({ date_limite: "2027-03-15", reponse: reponse({ statut: "brouillon" }) }),
        1,
        "2027-03-16",
      ).message,
    ).toMatch(/brouillon.*1 question\) n'ont pas pu/);
    // Un questionnaire clos reste « clos », même après la date limite.
    expect(
      finLectureSeule(questionnaire({ statut: "clos", date_limite: "2027-03-15" }), 0, "2027-03-16")
        .titre,
    ).toBe("Questionnaire clos");
  });

  it("questionnaire clos, avec ou sans brouillon", () => {
    expect(finLectureSeule(questionnaire({ statut: "clos" })).message).toBe(
      "Le cabinet a clos ce questionnaire : il n'accepte plus de réponse.",
    );
    expect(
      finLectureSeule(
        questionnaire({ statut: "clos", reponse: reponse({ statut: "brouillon" }) }),
        1,
      ).message,
    ).toBe(
      "Le cabinet a clos ce questionnaire : il n'accepte plus de réponse. Les réponses ci-dessous avaient été enregistrées en brouillon, sans être envoyées. Vos dernières modifications (1 question) n'ont pas pu être enregistrées.",
    );
  });

  it("après l'envoi depuis la page ; questionnaire devenu inaccessible", () => {
    const fin = finApresEnvoi(questionnaire({ reponse: soumise(true) }));
    expect(fin.titre).toBe("Merci, vos réponses sont envoyées");
    expect(fin.message).toMatch(/Le cabinet en est informé\.$/);
    expect(finInaccessible("securite", "individuel")).toMatchObject({
      type: "inaccessible",
      titre: "Double authentification à activer",
      lien: { href: "/portail/securite" },
    });
    expect(finInaccessible("introuvable", "individuel")).toMatchObject({
      titre: "Questionnaire inaccessible",
      lien: { href: CHEMIN_QUESTIONNAIRES_PORTAIL },
    });
    expect(finInaccessible("verrouille", "collectif").titre).toBe("Questionnaire verrouillé");
  });

  it("annonces liées aux collègues ; échec de la relecture", () => {
    expect(annonceCollegues(2, 0)).toBe("2 réponses mises à jour par vos collègues.");
    expect(annonceCollegues(1, 1)).toBe(
      "1 réponse mise à jour par vos collègues. Un collègue a modifié une question que vous étiez en train de remplir : choisissez la réponse à garder.",
    );
    expect(annonceCollegues(0, 0)).toBe("");
    expect(messageActualisation("reseau")).toMatch(/vérifiez votre réseau/);
    expect(messageActualisation("session")).toMatch(/^Votre session a expiré/);
  });
});
