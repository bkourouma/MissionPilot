import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RED_CATEGORIES_CREANCIER,
  RED_CATEGORIES_DECAISSEMENT,
  RED_CATEGORIES_ENCAISSEMENT,
  RED_CLES_RATIO,
  RED_CODES_LEVIER,
  RED_CRITERES_ALERTE,
  RED_DOMAINES,
  RED_FAMILLES_LEVIER,
  RED_NIVEAUX_ALERTE,
  RED_POSTES,
  RED_REPONSES_URGENCE,
  RED_SECTEURS,
  RED_STATUTS_ACCORD,
  RED_STATUTS_ACTION,
  RED_STATUTS_DOSSIER,
  RED_STATUTS_VERSION_PLAN,
  RED_TYPES_EVENEMENT_NEGOCIATION,
  RED_VOLETS,
  RED_VOYANTS,
  ROLES,
  type RedRatioVue,
  type Role,
} from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { NAVIGATION } from "./navigation";
import {
  AVERTISSEMENT_SEUILS_DEFAUT,
  avertissementTronque,
  BANDEAU_CONFIDENTIALITE,
  cheminAction,
  cheminActionsDossier,
  cheminCommentairesAction,
  cheminCorrespondances,
  cheminCreanciers,
  cheminCreancier,
  cheminCreances,
  cheminDeplacementAction,
  cheminDossierMission,
  cheminDossierRed,
  cheminDossiersRed,
  cheminEcheancesAccords,
  cheminEvenements,
  cheminPlan,
  cheminPointMort,
  cheminPublicationSeuils,
  cheminRatios,
  cheminRealises,
  cheminScores,
  cheminSeuilsSecteur,
  cheminSimulationLevier,
  cheminStatutDossier,
  cheminTresorerie,
  cheminUrgences,
  cheminValidationPlan,
  cheminVersionsPlan,
  cheminVersionsTresorerie,
  droitsRedressement,
  exigeDateFinAction,
  exigeMotifAction,
  formaterPart,
  formaterSemaine,
  formaterSeuil,
  formaterTendance,
  formaterValeurCritere,
  formaterValeurRatio,
  hrefCreancierRed,
  hrefPlanAvecLevier,
  hrefPortefeuille,
  hrefRedressement,
  hrefSeuilsSecteur,
  libelleAvancement,
  libelleCategorieFlux,
  libelleEcartPlan,
  libellePremiereTension,
  libelleRaisonRatio,
  libelleScore,
  libelleSourceSeuils,
  libelleStatutRatio,
  largeurBarre,
  lireFiltresPortefeuille,
  lireSecteur,
  MENTION_SCORE,
  messageBaseIncomplete,
  messageRedressement,
  MOTS_INTERDITS,
  motifCritere,
  optionsCategories,
  majsRangApresDeplacement,
  sousPagesRedressement,
  statutsSuggeres,
  TEXTE_LEVIERS,
  TEXTE_TENSION,
  tonaliteNiveauAlerte,
  tonaliteStatutAccord,
  tonaliteStatutAction,
  tonaliteStatutDossier,
  tonaliteVoyant,
  tousLesLibelles,
  TRANSITIONS_SUGGEREES,
  libelleVoyant,
} from "./redressement";

/** Les espaces insécables des nombres formatés deviennent des espaces simples. */
const norm = (t: string) => t.replace(/[\u00a0\u202f]/g, " ");

const ID = "0b6c2d1e-0000-4000-8000-000000000000";

describe("chemins d'API", () => {
  it("construit un chemin par route de la spécification", () => {
    expect(cheminDossiersRed()).toBe("/api/redressement/dossiers");
    expect(
      cheminDossiersRed({ statut: "ouvert", secteur: "btp", q: "usine a", curseur: "c" }),
    ).toBe("/api/redressement/dossiers?statut=ouvert&secteur=btp&q=usine+a&curseur=c");
    expect(cheminDossierMission(ID)).toBe(`/api/missions/${ID}/redressement`);
    expect(cheminDossierRed(ID)).toBe(`/api/redressement/dossiers/${ID}`);
    expect(cheminStatutDossier(ID)).toBe(`/api/redressement/dossiers/${ID}/statut`);
    expect(cheminCorrespondances(ID)).toBe(`/api/redressement/dossiers/${ID}/correspondances`);
    expect(cheminRatios(ID)).toBe(`/api/redressement/dossiers/${ID}/ratios`);
    expect(cheminUrgences(ID)).toBe(`/api/redressement/dossiers/${ID}/urgences`);
    expect(cheminUrgences(ID, "abc")).toBe(`/api/redressement/dossiers/${ID}/urgences?curseur=abc`);
    expect(cheminSeuilsSecteur()).toBe("/api/redressement/seuils");
    expect(cheminSeuilsSecteur("btp")).toBe("/api/redressement/seuils?secteur=btp");
    expect(cheminPublicationSeuils(ID)).toBe(`/api/redressement/seuils/${ID}/publication`);
    expect(cheminScores(ID, null)).toBe(`/api/redressement/dossiers/${ID}/scores`);
    expect(cheminTresorerie(ID)).toBe(`/api/redressement/dossiers/${ID}/tresorerie`);
    expect(cheminVersionsTresorerie(ID)).toBe(
      `/api/redressement/dossiers/${ID}/tresorerie/versions`,
    );
    expect(cheminRealises(ID)).toBe(`/api/redressement/dossiers/${ID}/tresorerie/realises`);
    expect(cheminEcheancesAccords(ID)).toBe(
      `/api/redressement/dossiers/${ID}/tresorerie/echeances-accords`,
    );
    expect(cheminPointMort(ID)).toBe(`/api/redressement/dossiers/${ID}/point-mort`);
    expect(cheminCreanciers(ID)).toBe(`/api/redressement/dossiers/${ID}/creanciers`);
    expect(cheminCreanciers(ID, "tous")).toBe(
      `/api/redressement/dossiers/${ID}/creanciers?actifs=tous`,
    );
    expect(cheminCreancier(ID)).toBe(`/api/redressement/creanciers/${ID}`);
    expect(cheminCreances(ID)).toBe(`/api/redressement/creanciers/${ID}/creances`);
    expect(cheminEvenements(ID)).toBe(`/api/redressement/creanciers/${ID}/evenements`);
    expect(cheminPlan(ID)).toBe(`/api/redressement/dossiers/${ID}/plan`);
    expect(cheminActionsDossier(ID)).toBe(`/api/redressement/dossiers/${ID}/actions`);
    expect(cheminAction(ID)).toBe(`/api/redressement/actions/${ID}`);
    expect(cheminDeplacementAction(ID)).toBe(`/api/redressement/actions/${ID}/deplacement`);
    expect(cheminCommentairesAction(ID)).toBe(`/api/redressement/actions/${ID}/commentaires`);
    expect(cheminVersionsPlan(ID)).toBe(`/api/redressement/dossiers/${ID}/plan/versions`);
    expect(cheminValidationPlan(ID)).toBe(`/api/redressement/plan/versions/${ID}/validation`);
    expect(cheminSimulationLevier(ID)).toBe(`/api/redressement/dossiers/${ID}/leviers/simulation`);
  });

  it("n'appelle l'API que par /api (jamais d'URL absolue)", () => {
    for (const chemin of [cheminDossierRed(ID), cheminCreanciers(ID), cheminPlan(ID)]) {
      expect(chemin.startsWith("/api/")).toBe(true);
    }
  });

  it("encode un identifiant inattendu", () => {
    expect(cheminDossierRed("a/b")).toBe("/api/redressement/dossiers/a%2Fb");
  });
});

describe("liens des pages", () => {
  it("relie la synthèse, les sections et la fiche d'un créancier", () => {
    expect(hrefRedressement(ID)).toBe(`/missions/${ID}/redressement`);
    expect(hrefRedressement(ID, "tresorerie")).toBe(`/missions/${ID}/redressement/tresorerie`);
    expect(hrefCreancierRed(ID, "c1")).toBe(`/missions/${ID}/redressement/creanciers/c1`);
    expect(hrefPlanAvecLevier(ID, "hausse_prix")).toBe(
      `/missions/${ID}/redressement/plan?levier=hausse_prix`,
    );
    expect(hrefPortefeuille()).toBe("/redressement");
    expect(hrefPortefeuille({ statut: "clos" })).toBe("/redressement?statut=clos");
    expect(hrefSeuilsSecteur("btp")).toBe("/redressement/seuils?secteur=btp");
  });

  it("liste les huit sections du dossier, la synthèse en premier", () => {
    const pages = sousPagesRedressement(ID);
    expect(pages.map((p) => p.id)).toEqual([
      "synthese",
      "ratios",
      "urgence",
      "alerte",
      "tresorerie",
      "creanciers",
      "plan",
      "leviers",
    ]);
    expect(new Set(pages.map((p) => p.href)).size).toBe(8);
  });
});

describe("filtres du portefeuille", () => {
  it("écarte une valeur hors liste et borne la recherche", () => {
    expect(lireFiltresPortefeuille({ statut: "inconnu", secteur: "btp", q: "  usine  " })).toEqual({
      statut: undefined,
      secteur: "btp",
      q: "usine",
      curseur: undefined,
    });
    expect(lireFiltresPortefeuille({ q: "x".repeat(300) }).q).toHaveLength(100);
    expect(lireFiltresPortefeuille({ curseur: "c".repeat(501) }).curseur).toBeUndefined();
    expect(lireFiltresPortefeuille({ statut: ["clos", "ouvert"] }).statut).toBe("clos");
  });

  it("lit le secteur de la page des seuils (« Général » par défaut)", () => {
    expect(lireSecteur(undefined)).toBe("general");
    expect(lireSecteur("nimporte")).toBe("general");
    expect(lireSecteur("btp")).toBe("btp");
  });
});

describe("droitsRedressement", () => {
  const mission = {
    statut: "en_cours" as "en_cours" | "cloturee",
    directeur_id: "dir",
    chef_id: "chef",
    equipe: [{ utilisateur_id: "membre", nom: "Membre" }],
  };
  const d = (roles: Role[], id: string, m = mission, dossier?: { statut: "clos" | "ouvert" }) =>
    droitsRedressement(roles, id, m, dossier);

  it("couvre les huit rôles du cabinet selon les permissions de la matrice", () => {
    const attendu: Record<string, [boolean, boolean, boolean]> = {
      // lire, valider, parametrer
      associe: [true, true, true],
      directeur_mission: [true, true, false],
      chef_mission: [true, false, false],
      consultant: [true, false, false],
      ressources: [false, false, false],
      gestionnaire: [false, false, false],
      expert_metier: [true, false, true],
      expert_externe: [false, false, false],
    };
    for (const [role, [lire, valider, parametrer]] of Object.entries(attendu)) {
      const droits = d([role as Role], "inconnu");
      expect([droits.lire, droits.valider, droits.parametrer]).toEqual([lire, valider, parametrer]);
    }
    expect(ROLES.length).toBeGreaterThanOrEqual(8);
  });

  it("ouvre le dossier au directeur et au chef seulement, jamais à un simple membre", () => {
    expect(d(["directeur_mission"], "dir").ouvrir).toBe(true);
    expect(d(["chef_mission"], "chef").ouvrir).toBe(true);
    expect(d(["consultant"], "membre").ouvrir).toBe(false);
    expect(d(["chef_mission"], "autre").ouvrir).toBe(false);
  });

  it("permet à un membre de l'équipe d'écrire, pas à un étranger à la mission", () => {
    expect(d(["consultant"], "membre").ecrire).toBe(true);
    expect(d(["consultant"], "etranger").ecrire).toBe(false);
  });

  it("ferme l'écriture sur une mission clôturée et sur un dossier clos", () => {
    expect(d(["directeur_mission"], "dir", { ...mission, statut: "cloturee" }).ecrire).toBe(false);
    expect(d(["directeur_mission"], "dir", { ...mission, statut: "cloturee" }).ouvrir).toBe(false);
    expect(d(["directeur_mission"], "dir", mission, { statut: "clos" }).ecrire).toBe(false);
    expect(d(["directeur_mission"], "dir", mission, { statut: "ouvert" }).ecrire).toBe(true);
  });

  it("l'expert métier relit sans écrire", () => {
    const droits = d(["expert_metier"], "dir");
    expect(droits.lire).toBe(true);
    expect(droits.ecrire).toBe(false);
  });

  it("l'associé écrit même sans être membre (modifier toutes les missions)", () => {
    expect(d(["associe"], "etranger").ecrire).toBe(true);
  });

  it("assignerTache suit la permission d'assigner une tâche", () => {
    expect(d(["chef_mission"], "chef").assignerTache).toBe(true);
  });
});

describe("voyants et tonalités", () => {
  it("associe un texte et une tonalité à chaque voyant", () => {
    expect(RED_VOYANTS.map((v) => [v, tonaliteVoyant(v), libelleVoyant(v)])).toEqual([
      ["vert", "succes", "Maîtrisé"],
      ["orange", "attention", "Vigilance"],
      ["rouge", "danger", "Critique"],
      ["non_evalue", "neutre", "Non évalué"],
    ]);
  });

  it("couvre les niveaux d'alerte, statuts de dossier, d'accord et d'action", () => {
    expect(RED_NIVEAUX_ALERTE.map(tonaliteNiveauAlerte)).toEqual([
      "neutre",
      "succes",
      "attention",
      "danger",
      "danger",
    ]);
    expect(RED_STATUTS_DOSSIER.map(tonaliteStatutDossier)).toEqual([
      "neutre",
      "neutre",
      "succes",
      "succes",
      "neutre",
    ]);
    expect(RED_STATUTS_ACCORD.map(tonaliteStatutAccord)).toEqual([
      "succes",
      "danger",
      "neutre",
      "danger",
    ]);
    expect(RED_STATUTS_ACTION.map(tonaliteStatutAction)).toEqual([
      "neutre",
      "attention",
      "danger",
      "succes",
      "neutre",
    ]);
  });
});

describe("libellés", () => {
  it("donne un libellé non vide, sans identifiant technique, à chaque énumération", () => {
    const toutes: readonly string[] = [
      ...RED_SECTEURS,
      ...RED_STATUTS_DOSSIER,
      ...RED_POSTES,
      ...RED_CLES_RATIO,
      ...RED_DOMAINES,
      ...RED_REPONSES_URGENCE,
      ...RED_CRITERES_ALERTE,
      ...RED_NIVEAUX_ALERTE,
      ...RED_CATEGORIES_ENCAISSEMENT,
      ...RED_CATEGORIES_DECAISSEMENT,
      ...RED_CATEGORIES_CREANCIER,
      ...RED_TYPES_EVENEMENT_NEGOCIATION,
      ...RED_VOLETS,
      ...RED_STATUTS_ACTION,
      ...RED_CODES_LEVIER,
      ...RED_FAMILLES_LEVIER,
      ...RED_STATUTS_VERSION_PLAN,
    ];
    expect(toutes.length).toBeGreaterThan(60);
    const libelles = tousLesLibelles();
    for (const l of libelles) {
      expect(l.trim()).not.toBe("");
      expect(l).not.toMatch(/_/);
    }
    // Chaque valeur d'énumération y est représentée par un libellé distinct de son identifiant.
    for (const categorie of [...RED_CATEGORIES_ENCAISSEMENT, ...RED_CATEGORIES_DECAISSEMENT]) {
      expect(libelleCategorieFlux(categorie)).not.toBe(categorie);
    }
  });

  it("n'emploie jamais de qualification juridique de la situation du client", () => {
    for (const l of tousLesLibelles()) {
      for (const mot of MOTS_INTERDITS) expect(l.toLowerCase()).not.toContain(mot);
      if (l !== MENTION_SCORE) expect(l.toLowerCase()).not.toContain("procédure d'alerte");
    }
  });

  it("parcourt aussi la navigation et les sources du module contre les mots interdits", () => {
    const racine = join(__dirname, "..");
    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/.(ts|tsx|css)$/.test(nom) && !/.test./.test(nom)) fichiers.push(chemin);
      }
    };
    parcourir(join(racine, "components", "redressement"));
    parcourir(join(racine, "app", "(app)", "redressement"));
    parcourir(join(racine, "app", "(app)", "missions", "[id]", "redressement"));
    for (const nom of [
      "redressement-saisie.ts",
      "redressement-graphiques.ts",
      "redressement-serveur.ts",
      "navigation.ts",
    ]) {
      fichiers.push(join(racine, "lib", nom));
    }
    expect(fichiers.length).toBeGreaterThan(40);
    for (const f of fichiers) {
      const texte = readFileSync(f, "utf8").toLowerCase();
      for (const mot of MOTS_INTERDITS) expect(texte, f + " : " + mot).not.toContain(mot);
    }
    // Entrée de navigation : libellés, description et sous-pages.
    const e = NAVIGATION.find((x) => x.id === "redressement");
    const textes = [
      e?.libelle,
      e?.libelleCourt,
      e?.description,
      ...(e?.sousPages ?? []).map((p) => p.libelle),
    ];
    for (const t of textes) {
      for (const mot of MOTS_INTERDITS) expect((t ?? "").toLowerCase()).not.toContain(mot);
    }
    expect(e?.description).toBe(
      "Redressement : score d'alerte précoce indicatif, trésorerie à 13 semaines, créanciers et plan d'actions.",
    );
  });

  it("reprend à l'identique les textes fixes de la spécification", () => {
    expect(MENTION_SCORE).toBe(
      "Indicatif. Ce score est une aide à la décision du consultant ; il ne constitue ni une procédure d'alerte au sens du droit OHADA ni un avis juridique.",
    );
    expect(AVERTISSEMENT_SEUILS_DEFAUT).toBe(
      "Seuils par défaut du moteur (provisoires) : à remplacer par ceux de vos experts.",
    );
    expect(TEXTE_TENSION).toBe(
      "Une semaine de tension est une semaine où le solde projeté passe sous le seuil que vous avez fixé. Ce n'est pas une qualification juridique de la situation de l'entreprise.",
    );
    expect(BANDEAU_CONFIDENTIALITE).toBe(
      "Les conditions négociées sont confidentielles : elles ne sont pas reprises dans le journal d'audit.",
    );
    expect(TEXTE_LEVIERS).toContain("Ce n'est pas une recommandation");
  });

  it("propose les catégories du sens choisi", () => {
    expect(optionsCategories("encaissement").map((o) => o.valeur)).toEqual([
      ...RED_CATEGORIES_ENCAISSEMENT,
    ]);
    expect(optionsCategories("decaissement")).toHaveLength(RED_CATEGORIES_DECAISSEMENT.length);
    expect(libelleCategorieFlux("fiscal_social")).toBe("Impôts, taxes et charges sociales");
    expect(libelleCategorieFlux("autre_chose")).toBe("autre_chose");
  });
});

describe("mise en forme des ratios", () => {
  it("formate un rapport, un pourcentage et des jours à partir des valeurs de l'API", () => {
    expect(formaterValeurRatio("liquidite_generale", 13636)).toBe("1,36");
    expect(formaterValeurRatio("endettement", 20000)).toBe("2,00");
    expect(norm(formaterValeurRatio("autonomie_financiere", 1875))).toBe("18,75 %");
    expect(norm(formaterValeurRatio("marge_nette", -125))).toBe("-1,25 %");
    expect(formaterValeurRatio("bfr_jours", 54)).toBe("54 jours");
    expect(formaterValeurRatio("bfr_jours", 1)).toBe("1 jour");
    expect(formaterValeurRatio("marge_brute", null)).toBe("—");
    expect(formaterValeurRatio("marge_brute", Number.NaN)).toBe("—");
  });

  it("formate les critères de l'alerte précoce", () => {
    expect(formaterValeurCritere("liquidite_generale", 12000)).toBe("1,20");
    expect(norm(formaterValeurCritere("croissance_ca", -1000))).toBe("-10,00 %");
    expect(formaterValeurCritere("rejets_bancaires_12m", 3)).toBe("3");
    expect(formaterValeurCritere("arrieres_fiscaux_sociaux", 1)).toBe("Oui");
    expect(formaterValeurCritere("arrieres_fiscaux_sociaux", 0)).toBe("Non");
    expect(formaterValeurCritere("bfr_jours", null)).toBe("—");
    // Un seuil « oui / non » reste une valeur technique, jamais « Non ».
    expect(formaterSeuil("arrieres_fiscaux_sociaux", 0)).toBe("0");
    expect(formaterSeuil("liquidite_generale", 10000)).toBe("1,00");
  });

  it("dit pourquoi un ratio n'est pas calculé", () => {
    const base: RedRatioVue = { valeur: null, statut: "calcule", raison: null, manquants: [] };
    expect(libelleStatutRatio("marge_nette", { ...base, valeur: 150 })).toContain("1,50");
    expect(
      libelleStatutRatio("endettement", { ...base, statut: "sans_objet", raison: "sans_dette" }),
    ).toBe("Sans objet : aucune dette");
    expect(
      libelleStatutRatio("liquidite_generale", {
        ...base,
        statut: "non_calculable",
        raison: "postes_manquants",
        manquants: ["stocks", "creances_clients"],
      }),
    ).toBe("Non calculable : postes à renseigner (Stocks, Créances clients)");
    expect(
      libelleStatutRatio("endettement", {
        ...base,
        statut: "non_significatif",
        raison: "denominateur_non_positif",
      }),
    ).toBe("Non significatif : capitaux propres négatifs ou nuls");
    expect(libelleStatutRatio("marge_brute", { ...base, statut: "sans_objet" })).toBe("Sans objet");
  });

  it("énumère les postes manquants dans la raison", () => {
    expect(libelleRaisonRatio("postes_manquants", ["stocks", "capital"])).toBe(
      "Postes à renseigner : Stocks, Capital",
    );
    expect(libelleRaisonRatio("totaux_absents")).toBe("Totaux du bilan absents");
    expect(libelleRaisonRatio(null)).toBe("");
  });

  it("nomme le motif d'un critère", () => {
    expect(motifCritere("signal_critique")).toBe("Signal critique");
    expect(motifCritere("sans_objet")).toBe("Sans objet");
    expect(motifCritere("non_calculable")).toBe("Non calculable");
    expect(motifCritere("non_renseigne")).toBe("Non renseigné");
    expect(motifCritere(null)).toBe("—");
  });

  it("formate tendances, parts et avancement", () => {
    expect(norm(formaterTendance(1250))).toBe("+12,50 %");
    expect(norm(formaterTendance(-300))).toBe("-3,00 %");
    expect(formaterTendance(null)).toBe("—");
    expect(norm(formaterPart(3333))).toBe("33,33 %");
    expect(norm(libelleAvancement(3333))).toBe("33 %");
    expect(libelleAvancement(null)).toBe("Sans objet");
    expect(largeurBarre(3333)).toBe(33);
    expect(largeurBarre(15000)).toBe(100);
    expect(largeurBarre(-5)).toBe(0);
    expect(largeurBarre(null)).toBe(0);
  });
});

describe("textes du score et de la synthèse", () => {
  it("nomme la source des seuils", () => {
    expect(libelleSourceSeuils("defaut_moteur", null, null)).toBe(
      "Seuils par défaut du moteur (provisoires)",
    );
    expect(libelleSourceSeuils("cabinet", "btp", 2)).toBe(
      "Seuils du cabinet, secteur BTP, version 2",
    );
    expect(libelleSourceSeuils("cabinet", null, 3)).toBe("Seuils du cabinet, version 3");
  });

  it("affiche le score sur 100 ou « Données insuffisantes »", () => {
    expect(norm(libelleScore(42, "modere"))).toBe("42 sur 100");
    expect(libelleScore(null, "insuffisant")).toBe("Données insuffisantes");
    expect(libelleScore(10, "insuffisant")).toBe("Données insuffisantes");
  });

  it("résume la première semaine de tension de la trésorerie", () => {
    expect(libellePremiereTension(null)).toBe("Aucune prévision");
    const t = {
      version: 1,
      date_debut: "2026-11-02",
      semaines_tension: [] as number[],
      premiere_semaine_tension: null,
      solde_minimum: { semaine: 1, montant: 0 },
      besoin_financement: 0,
      derniere_semaine_realisee: null,
    };
    expect(libellePremiereTension(t)).toBe("Aucune semaine de tension sur 13 semaines");
    expect(
      libellePremiereTension({ ...t, semaines_tension: [4], premiere_semaine_tension: 4 }),
    ).toBe("Première semaine de tension : semaine 4");
  });

  it("formate la semaine et l'écart avec la version validée", () => {
    expect(norm(formaterSemaine("2026-11-02", "2026-11-08"))).toBe("2 nov. 2026 au 8 nov. 2026");
    expect(libelleEcartPlan({ ajoutees: [6], retirees: [], modifiees: [2, 3] })).toBe(
      "Écart avec la version validée : 1 ajoutée(s), 0 retirée(s), 2 modifiée(s)",
    );
  });

  it("signale une liste tronquée", () => {
    expect(avertissementTronque(false)).toBeNull();
    expect(avertissementTronque(true)).toContain("trop longue");
  });
});

describe("kanban : propositions d'affichage", () => {
  it("reprend la matrice du moteur : 9 transitions admises sur 25", () => {
    const admises = RED_STATUTS_ACTION.flatMap((de) =>
      TRANSITIONS_SUGGEREES[de].map((vers) => [de, vers]),
    );
    expect(admises).toHaveLength(9);
    expect(TRANSITIONS_SUGGEREES.a_faire).toEqual([
      "en_cours",
      "bloquee",
      "terminee",
      "abandonnee",
    ]);
    expect(TRANSITIONS_SUGGEREES.en_cours).toEqual(["bloquee", "terminee", "abandonnee"]);
    expect(TRANSITIONS_SUGGEREES.bloquee).toEqual(["en_cours", "abandonnee"]);
    expect(TRANSITIONS_SUGGEREES.terminee).toEqual([]);
    expect(TRANSITIONS_SUGGEREES.abandonnee).toEqual([]);
    expect(statutsSuggeres("bloquee")).toEqual([
      { valeur: "en_cours", libelle: "En cours" },
      { valeur: "abandonnee", libelle: "Abandonnée" },
    ]);
  });

  it("demande un motif pour « Bloquée » et « Abandonnée », une date pour « Terminée »", () => {
    expect(exigeMotifAction("bloquee")).toBe(true);
    expect(exigeMotifAction("abandonnee")).toBe(true);
    expect(exigeMotifAction("en_cours")).toBe(false);
    expect(exigeDateFinAction("terminee")).toBe(true);
    expect(exigeDateFinAction("bloquee")).toBe(false);
  });

  it("déplace d'un cran en rendant les rangs strictement croissants", () => {
    const col = [
      { id: "a", rang: 0 },
      { id: "b", rang: 0 },
      { id: "c", rang: 0 },
    ];
    // Rangs égaux (défaut) : l'ordre cible est b, a, c avec des rangs distincts.
    expect(majsRangApresDeplacement(col, "b", "monter")).toEqual([
      { id: "a", rang: 1 },
      { id: "c", rang: 2 },
    ]);
    expect(majsRangApresDeplacement(col, "a", "descendre")).toEqual([
      { id: "a", rang: 1 },
      { id: "c", rang: 2 },
    ]);
  });

  it("n'envoie que les rangs qui changent quand ils sont déjà distincts", () => {
    const col = [
      { id: "a", rang: 1 },
      { id: "b", rang: 5 },
      { id: "c", rang: 9 },
    ];
    expect(majsRangApresDeplacement(col, "b", "monter")).toEqual([{ id: "a", rang: 6 }]);
    expect(majsRangApresDeplacement(col, "b", "descendre")).toEqual([{ id: "b", rang: 10 }]);
  });

  it("ne bouge pas au bord de la colonne ni pour une action inconnue", () => {
    const col = [
      { id: "a", rang: 0 },
      { id: "b", rang: 1 },
    ];
    expect(majsRangApresDeplacement(col, "a", "monter")).toBeNull();
    expect(majsRangApresDeplacement(col, "b", "descendre")).toBeNull();
    expect(majsRangApresDeplacement(col, "z", "monter")).toBeNull();
  });
});

describe("messages d'erreur", () => {
  it("affiche tel quel un refus métier de l'API (400, 403, 404, 409, 429)", () => {
    for (const statut of [400, 403, 404, 409, 429]) {
      expect(messageRedressement(new ErreurApi("RED_X", "Refus de l'API.", statut))).toBe(
        "Refus de l'API.",
      );
    }
  });

  it("garde le message générique de la validation et celui des erreurs réseau", () => {
    expect(
      messageRedressement(new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400)),
    ).toContain("Certaines valeurs ont été refusées");
    expect(messageRedressement(new ErreurApi("RESEAU_INDISPONIBLE", "Réseau.", 0))).toBe("Réseau.");
    expect(messageRedressement(new Error("x"))).toContain("erreur inattendue");
  });

  it("nomme les postes manquants d'une base incomplète", () => {
    expect(messageBaseIncomplete(["stocks", "capital"])).toBe(
      "Il manque des postes dans la correspondance : Stocks, Capital.",
    );
    expect(messageBaseIncomplete([])).toBe("Il manque des postes dans la correspondance.");
    expect(
      messageRedressement(
        new ErreurApi("RED_BASE_INCOMPLETE", "Base incomplète.", 409, { manquants: ["stocks"] }),
      ),
    ).toBe("Il manque des postes dans la correspondance : Stocks.");
  });
});
