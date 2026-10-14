import { describe, expect, it } from "vitest";
import {
  ANALYSES_DD,
  CATEGORIES_ANALYSE_DD,
  CODES_AVERTISSEMENTS_NOTE,
  CODES_BLOQUANTS_NOTE,
  CODES_PARAMETRE_DIMENSIONNEMENT,
  DECISIONS_EXCLUSION,
  ETATS_CONSTAT_SIGNAL,
  FAMILLES_RISQUE_DD,
  METHODES_DIMENSIONNEMENT,
  NIVEAUX_ES,
  NIVEAUX_RISQUE_DD,
  RECOMMANDATIONS_NOTE,
  ROLES,
  SENS_LIEN_DD,
  STATUTS_ACTION_100J,
  THEMES_ES,
  TYPES_OPERATION_DD,
  VARIANTES_NOTE,
  VERDICTS_DD,
  type Role,
} from "@missionpilot/shared";
import { ErreurApi } from "./api";
import {
  aAvisExpert,
  aplatirDossier,
  chargerVersionCouranteListe,
  chargerVersionsListe,
  LIMITE_VERSIONS_LISTE_DD,
  phraseExclusionsAnterieures,
  type PageDd,
  type VersionListeExclusion,
  ANALYSE_DD_LIBELLES,
  CATEGORIE_ANALYSE_DD_LIBELLES,
  CIBLE_AJUSTEMENT_LIBELLES,
  cheminAnalyses,
  cheminCalculDimensionnement,
  cheminConstatSignal,
  cheminDossier,
  cheminDossiers,
  cheminNote,
  cheminRisques,
  cheminSignaux,
  codesManquants,
  construireArbre,
  DECISION_EXCLUSION_LIBELLES,
  droitsDd,
  ECRANS_DOSSIER,
  ECRAN_BLOQUANT,
  ETAT_CONSTAT_SIGNAL_LIBELLES,
  ETAT_HYPOTHESE_LIBELLES,
  ETAT_NOTE_LIBELLES,
  etapesPourCarte,
  etatDdChange,
  etatNote,
  etatVerdict,
  FAMILLE_RISQUE_DD_LIBELLES,
  filtrerAjustements,
  formaterBp,
  formaterValeurParametre,
  hrefAnalyses,
  hrefAssertionRegistre,
  hrefEcranDossier,
  hrefHypothese,
  hrefNote,
  lectureMinimale,
  LIMITE_LISTE_DD,
  libelleCategorie,
  libelleLienPlan,
  libelleParametre,
  libelleRaisonVerdict,
  libelleTaxonomie,
  libelleTheme,
  libellesDossier,
  lireAnalyse,
  lireCibleAjustement,
  lireFiltresRisques,
  lireFiltresSignaux,
  LECTURE_SOLIDITE_DD_LIBELLES,
  messageCoherenceChaine,
  messageDd,
  messageFragilite,
  METHODE_COURTE_LIBELLES,
  METHODE_DIMENSIONNEMENT_LIBELLES,
  NIVEAU_ES_LIBELLES,
  NIVEAU_RISQUE_DD_LIBELLES,
  optionsDe,
  PARAMETRE_DIMENSIONNEMENT_LIBELLES,
  parentsPossibles,
  peutSignerAvisDd,
  peutValiderSansConflit,
  PHASE_PLAN_LIBELLES,
  pointsDeControle,
  profondeurNoeud,
  RECOMMANDATION_NOTE_LIBELLES,
  requeteRisques,
  requeteSignaux,
  resumeOperation,
  risquesParFamille,
  SENS_LIEN_DD_LIBELLES,
  sousPagesDd,
  sousPagesParametresDd,
  STATUT_ACTION_100J_LIBELLES,
  THEME_ES_LIBELLES,
  TONALITE_ETAT_HYPOTHESE,
  TONALITE_LECTURE_DD,
  TONALITE_NIVEAU_RISQUE,
  trierParGravite,
  TYPE_OPERATION_DD_LIBELLES,
  uniteParametre,
  VARIANTE_NOTE_LIBELLES,
  versionValidee,
  VERDICT_DD_LIBELLES,
  type AjustementDd,
  type EtatHypothese,
  type NoeudHypothese,
  type ReponseChaine,
} from "./due-diligence";
import { sousPageActive } from "./navigation";

const NBSP = String.fromCharCode(0xa0);
const MISSION = "11111111-1111-4111-8111-111111111111";
const DOSSIER = "22222222-2222-4222-8222-222222222222";

function libellesComplets(valeurs: readonly string[], libelles: Record<string, string>) {
  expect(Object.keys(libelles).sort()).toEqual([...valeurs].sort());
  for (const v of valeurs) {
    const l = libelles[v]!;
    expect(l.trim().length).toBeGreaterThan(0);
    // Jamais un code brut : ni le code lui-même, ni un snake_case.
    expect(l).not.toBe(v);
    expect(l).not.toMatch(/_/);
  }
}

describe("libellés français : aucun code brut affiché", () => {
  it("couvre chaque valeur de chaque vocabulaire", () => {
    libellesComplets(TYPES_OPERATION_DD, TYPE_OPERATION_DD_LIBELLES);
    libellesComplets(ANALYSES_DD, ANALYSE_DD_LIBELLES);
    libellesComplets(FAMILLES_RISQUE_DD, FAMILLE_RISQUE_DD_LIBELLES);
    libellesComplets(NIVEAUX_RISQUE_DD, NIVEAU_RISQUE_DD_LIBELLES);
    libellesComplets(VERDICTS_DD, VERDICT_DD_LIBELLES);
    libellesComplets(SENS_LIEN_DD, SENS_LIEN_DD_LIBELLES);
    libellesComplets(METHODES_DIMENSIONNEMENT, METHODE_DIMENSIONNEMENT_LIBELLES);
    libellesComplets(METHODES_DIMENSIONNEMENT, METHODE_COURTE_LIBELLES);
    libellesComplets(RECOMMANDATIONS_NOTE, RECOMMANDATION_NOTE_LIBELLES);
    libellesComplets(VARIANTES_NOTE, VARIANTE_NOTE_LIBELLES);
    libellesComplets(STATUTS_ACTION_100J, STATUT_ACTION_100J_LIBELLES);
    libellesComplets(ETATS_CONSTAT_SIGNAL, ETAT_CONSTAT_SIGNAL_LIBELLES);
    libellesComplets(DECISIONS_EXCLUSION, DECISION_EXCLUSION_LIBELLES);
    libellesComplets(NIVEAUX_ES, NIVEAU_ES_LIBELLES);
    libellesComplets(THEMES_ES, THEME_ES_LIBELLES);
    libellesComplets(CODES_PARAMETRE_DIMENSIONNEMENT, PARAMETRE_DIMENSIONNEMENT_LIBELLES);
    libellesComplets(Object.values(CATEGORIES_ANALYSE_DD).flat(), CATEGORIE_ANALYSE_DD_LIBELLES);
    libellesComplets(
      ["confirmee", "infirmee", "non_concluante", "en_attente", "ouverte"],
      ETAT_HYPOTHESE_LIBELLES,
    );
    libellesComplets(["brouillon", "soumise", "validee", "rejetee"], ETAT_NOTE_LIBELLES);
    libellesComplets(["solide", "etayee", "fragile"], LECTURE_SOLIDITE_DD_LIBELLES);
    libellesComplets(["jours_0_30", "jours_31_60", "jours_61_100"], PHASE_PLAN_LIBELLES);
    libellesComplets(["verdict", "risque", "dimensionnement"], CIBLE_AJUSTEMENT_LIBELLES);
  });

  it("donne un libellé à chaque point de contrôle de la note (bloquants et avertissements)", () => {
    const controle = {
      bloquants: [...CODES_BLOQUANTS_NOTE],
      avertissements: [...CODES_AVERTISSEMENTS_NOTE],
      soumissible: false,
    };
    const points = pointsDeControle(controle);
    expect(points).toHaveLength(CODES_BLOQUANTS_NOTE.length + CODES_AVERTISSEMENTS_NOTE.length);
    for (const p of points) {
      expect(p.libelle).toMatch(/\s/);
      expect(p.libelle).not.toMatch(/[A-Z]+_[A-Z]+/);
      expect(ECRANS_DOSSIER).toContain(p.ecran);
    }
    expect(Object.keys(ECRAN_BLOQUANT).sort()).toEqual(
      [...CODES_BLOQUANTS_NOTE, ...CODES_AVERTISSEMENTS_NOTE].sort(),
    );
  });

  it("donne un libellé et une tonalité à chaque lecture, niveau et état", () => {
    expect(TONALITE_LECTURE_DD).toEqual({
      solide: "succes",
      etayee: "attention",
      fragile: "danger",
    });
    expect(TONALITE_NIVEAU_RISQUE.critique).toBe("danger");
    expect(TONALITE_ETAT_HYPOTHESE.confirmee).toBe("succes");
    expect(TONALITE_ETAT_HYPOTHESE.infirmee).toBe("danger");
    expect(libelleParametre("marche_total")).toBe("Marché total");
    expect(libelleParametre("inconnu")).toBe("Paramètre");
    expect(libelleCategorie("pouvoir_clients")).toBe("Pouvoir de négociation des clients");
    expect(libelleCategorie("inconnue")).toBe("Catégorie");
    expect(libelleTheme("biodiversite")).toBe("Biodiversité");
    expect(libelleTheme("inconnu")).toBe("Thème");
    expect(libelleRaisonVerdict("CONFLIT_SOLIDE")).toMatch(/arbitrage/);
    expect(libelleRaisonVerdict("INCONNUE")).toBe("Indication du moteur.");
  });

  it("construit des listes de choix", () => {
    expect(optionsDe(["pays", "change"] as const, FAMILLE_RISQUE_DD_LIBELLES)).toEqual([
      { valeur: "pays", libelle: "Risque pays" },
      { valeur: "change", libelle: "Risque de change" },
    ]);
  });
});

describe("onglets et chemins de pages", () => {
  it("liste les onglets d'un dossier, de la synthèse aux ajustements", () => {
    const pages = sousPagesDd(MISSION, DOSSIER);
    expect(pages.map((p) => p.id)).toEqual([
      "synthese",
      "cadrage",
      "analyses",
      "chaine",
      "risques",
      "hypotheses",
      "marche",
      "environnement-social",
      "plan-100-jours",
      "note",
      "ajustements",
    ]);
    expect(pages[0]!.href).toBe(`/missions/${MISSION}/due-diligence/${DOSSIER}`);
    expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length);
    expect(pages.map((p) => p.libelle)).toContain("Chaîne de valeur");
    expect(pages.map((p) => p.libelle)).toContain("Plan des 100 jours");
  });

  it("choisit l'onglet actif par le plus long préfixe (une hypothèse reste sous « Hypothèses »)", () => {
    const pages = sousPagesDd(MISSION, DOSSIER);
    expect(sousPageActive(pages, hrefHypothese(MISSION, DOSSIER, "abc"))).toBe("hypotheses");
    expect(sousPageActive(pages, hrefNote(MISSION, DOSSIER, "n1"))).toBe("note");
    expect(sousPageActive(pages, `/missions/${MISSION}/due-diligence/${DOSSIER}`)).toBe("synthese");
    expect(sousPageActive(pages, hrefEcranDossier(MISSION, DOSSIER, "plan-100-jours"))).toBe(
      "plan-100-jours",
    );
  });

  it("liste les onglets des paramètres", () => {
    expect(sousPagesParametresDd().map((p) => [p.id, p.href])).toEqual([
      ["signaux", "/parametres/due-diligence/signaux"],
      ["exclusions", "/parametres/due-diligence/exclusions"],
    ]);
  });

  it("renvoie vers la fiche de l'assertion du registre pour ajouter une source", () => {
    expect(hrefAssertionRegistre(MISSION, "a1")).toBe(`/missions/${MISSION}/preuves/assertions/a1`);
    expect(hrefAnalyses(MISSION, DOSSIER, "swot")).toBe(
      `/missions/${MISSION}/due-diligence/${DOSSIER}/analyses?analyse=swot`,
    );
  });
});

describe("droits d'affichage (confort : l'API reste juge)", () => {
  const attendu: Record<Role, [boolean, boolean, boolean, boolean]> = {
    associe: [true, true, true, true],
    directeur_mission: [true, true, true, true],
    chef_mission: [true, true, true, false],
    consultant: [true, true, false, false],
    expert_metier: [true, false, true, true],
    ressources: [false, false, false, false],
    gestionnaire: [false, false, false, false],
    expert_externe: [false, false, false, false],
    client_dirigeant: [false, false, false, false],
    client_contributeur: [false, false, false, false],
    client_investisseur: [false, false, false, false],
  };

  it("suit la matrice de la spécification pour chaque rôle", () => {
    for (const role of Object.keys(attendu) as Role[]) {
      const d = droitsDd([role]);
      expect([d.lire, d.ecrire, d.valider, d.gererReferentiel], role).toEqual(attendu[role]);
    }
  });

  it("couvre tous les rôles connus", () => {
    expect(Object.keys(attendu).sort()).toEqual(
      [...ROLES, "client_dirigeant", "client_contributeur", "client_investisseur"].sort(),
    );
  });

  it("retire l'écriture et la validation d'une mission clôturée", () => {
    const d = droitsDd(["associe"], { statut: "cloturee" });
    expect(d.lire).toBe(true);
    expect(d.ecrire).toBe(false);
    expect(d.valider).toBe(false);
    expect(droitsDd(["associe"], { statut: "en_cours" }).ecrire).toBe(true);
  });

  it("réserve la signature d'un avis d'expert à l'expert métier et à l'associé", () => {
    expect(peutSignerAvisDd(["expert_metier"])).toBe(true);
    expect(peutSignerAvisDd(["associe"])).toBe(true);
    expect(peutSignerAvisDd(["consultant"])).toBe(false);
  });

  it("n'affiche pas la validation à l'auteur, sauf associé (séparation des tâches)", () => {
    expect(peutValiderSansConflit(["expert_metier"], "u1", ["u2"])).toBe(true);
    expect(peutValiderSansConflit(["expert_metier"], "u1", ["u2", "u1"])).toBe(false);
    expect(peutValiderSansConflit(["associe"], "u1", ["u1"])).toBe(true);
    // Sans dd.valider : jamais.
    expect(peutValiderSansConflit(["consultant"], "u1", ["u2"])).toBe(false);
    expect(peutValiderSansConflit(["expert_metier"], "u1", [null, undefined])).toBe(true);
  });
});

describe("chemins d'API : toujours /api/*", () => {
  it("construit les chemins du dossier", () => {
    expect(cheminDossiers(MISSION)).toBe(`/api/missions/${MISSION}/dd/dossiers`);
    expect(cheminDossier(DOSSIER)).toBe(`/api/dd/dossiers/${DOSSIER}`);
    expect(cheminCalculDimensionnement()).toBe("/api/dd/dimensionnements/calculer");
    expect(cheminConstatSignal(DOSSIER, "s1")).toBe(
      `/api/dd/dossiers/${DOSSIER}/signaux/s1/constats`,
    );
  });

  it("construit la requête des analyses et des risques", () => {
    expect(cheminAnalyses(DOSSIER)).toBe(`/api/dd/dossiers/${DOSSIER}/analyses`);
    expect(cheminAnalyses(DOSSIER, "pestel")).toBe(
      `/api/dd/dossiers/${DOSSIER}/analyses?analyse=pestel`,
    );
    expect(cheminRisques(DOSSIER)).toBe(`/api/dd/dossiers/${DOSSIER}/risques`);
    expect(cheminRisques(DOSSIER, "famille=pays&niveau=critique")).toBe(
      `/api/dd/dossiers/${DOSSIER}/risques?famille=pays&niveau=critique`,
    );
  });

  it("construit le chemin d'une note, avec ou sans version", () => {
    expect(cheminNote("n1")).toBe("/api/dd/notes/n1");
    expect(cheminNote("n1", 3)).toBe("/api/dd/notes/n1?version=3");
  });

  it("borne les listes paginées au plafond de leurs routes (100)", () => {
    expect(LIMITE_LISTE_DD).toBe(100);
    expect(requeteSignaux({})).toBe("limite=100");
    expect(requeteSignaux({ famille: "pays", q: "taux" }, "abc")).toBe(
      "famille=pays&q=taux&limite=100&curseur=abc",
    );
    expect(cheminSignaux("limite=100")).toBe("/api/dd/signaux?limite=100");
  });
});

describe("paramètres d'URL : une valeur inconnue est écartée, jamais transmise", () => {
  it("lit l'analyse (la première par défaut)", () => {
    expect(lireAnalyse({}, ANALYSES_DD)).toBe("pestel");
    expect(lireAnalyse({ analyse: "swot" }, ANALYSES_DD)).toBe("swot");
    expect(lireAnalyse({ analyse: "n_importe_quoi" }, ANALYSES_DD)).toBe("pestel");
    expect(lireAnalyse({ analyse: ["operationnelle", "swot"] }, ANALYSES_DD)).toBe(
      "operationnelle",
    );
  });

  it("lit et sérialise les filtres de risques", () => {
    const f = lireFiltresRisques(
      { famille: "change", niveau: "critique", etape_id: "33333333-3333-4333-8333-333333333333" },
      FAMILLES_RISQUE_DD,
      NIVEAUX_RISQUE_DD,
    );
    expect(requeteRisques(f)).toBe(
      "famille=change&niveau=critique&etape_id=33333333-3333-4333-8333-333333333333",
    );
    const vide = lireFiltresRisques(
      { famille: "x", niveau: "y", etape_id: "pas-un-uuid" },
      FAMILLES_RISQUE_DD,
      NIVEAUX_RISQUE_DD,
    );
    expect(vide).toEqual({});
    expect(requeteRisques(vide)).toBe("");
  });

  it("lit les filtres de signaux", () => {
    const f = lireFiltresSignaux(
      { famille: "pays", secteur_code: "citi_a", pays_code: "ci", actif: "false", q: " taux " },
      FAMILLES_RISQUE_DD,
    );
    expect(f).toEqual({
      famille: "pays",
      secteur_code: "citi_a",
      pays_code: "ci",
      actif: "false",
      q: "taux",
    });
    expect(
      lireFiltresSignaux(
        { famille: "x", secteur_code: "Pas Un Code", actif: "peut-etre" },
        FAMILLES_RISQUE_DD,
      ),
    ).toEqual({});
  });

  it("lit la cible des ajustements et filtre la liste", () => {
    const base = {
      champ: "c",
      valeur_avant: "a",
      valeur_apres: "b",
      motif: "m",
      auteur_id: "u",
      cree_le: "",
    };
    const liste: AjustementDd[] = [
      { ...base, id: "1", numero: 3, cible_type: "verdict", cible_id: "v" },
      { ...base, id: "2", numero: 2, cible_type: "risque", cible_id: "r" },
    ];
    expect(lireCibleAjustement({ cible: "risque" })).toBe("risque");
    expect(lireCibleAjustement({ cible: "autre" })).toBeUndefined();
    expect(filtrerAjustements(liste, "risque").map((a) => a.id)).toEqual(["2"]);
    expect(filtrerAjustements(liste, undefined)).toHaveLength(2);
  });
});

describe("messages d'erreur par code (le code sert au test, le texte à l'écran)", () => {
  const erreur = (code: string, statut = 409, details?: unknown) =>
    new ErreurApi(code, "Message de l'API", statut, details);

  it("explique la séparation des tâches, malgré le statut 403", () => {
    const m = messageDd(erreur("SEPARATION_DES_TACHES", 403));
    expect(m).toMatch(/autre personne que l'auteur/);
    expect(m).toMatch(/associé/);
  });

  it("explique chaque refus propre au module", () => {
    expect(messageDd(erreur("VERDICT_EN_ATTENTE"))).toMatch(/attend déjà sa validation/);
    expect(messageDd(erreur("VERDICT_SANS_SOURCE"))).toMatch(/soutient/);
    expect(messageDd(erreur("VERDICT_PERIME"))).toMatch(/Rechargez/);
    expect(messageDd(erreur("PARAMETRE_SANS_SOURCE"))).toMatch(
      /preuve de la mission ou un avis d'expert/,
    );
    expect(messageDd(erreur("MOTIF_ECART_REQUIS"))).toMatch(/motif de l'écart/);
    expect(messageDd(erreur("MOTIF_DETAILLE_REQUIS"))).toMatch(/20 caractères/);
    expect(messageDd(erreur("MISSION_CLOTUREE"))).toMatch(/clôturée/);
    expect(messageDd(erreur("VERSION_PERIMEE", 409))).toMatch(/Rechargez/);
    expect(messageDd(erreur("NOTE_NON_VALIDEE"))).toMatch(/validation d'un tiers/);
    expect(messageDd(erreur("NOTE_PERIMEE"))).toMatch(/dernière soumise/);
    expect(messageDd(erreur("ARBRE_TROP_PROFOND", 400))).toMatch(/quatre niveaux/);
    expect(messageDd(erreur("SIGNAL_EXISTANT"))).toMatch(/même code|ce code/);
    expect(messageDd(erreur("INTERDIT", 403))).toMatch(/rôle/);
  });

  it("liste les points bloquants d'une note refusée (details.manquants)", () => {
    const e = erreur("NOTE_BLOQUEE", 409, {
      manquants: ["SANS_HYPOTHESE", "INCONNU", "SOURCES_MANQUANTES"],
    });
    expect(codesManquants(e)).toEqual(["SANS_HYPOTHESE", "SOURCES_MANQUANTES"]);
    const m = messageDd(e);
    expect(m).toMatch(/ne peut pas être soumise/);
    expect(m).toMatch(/Aucune hypothèse n'est posée/);
    expect(m).toMatch(/n'ont aucune source/);
    expect(codesManquants(new Error("x"))).toEqual([]);
    expect(codesManquants(erreur("NOTE_BLOQUEE", 409))).toEqual([]);
    expect(messageDd(erreur("NOTE_BLOQUEE", 409))).toMatch(/points bloquants/);
  });

  it("reprend le message des rapports pour le débit et le rendu", () => {
    expect(messageDd(erreur("TROP_DE_RAPPORTS", 429))).toMatch(/10 rapports/);
    expect(messageDd(erreur("RENDU_PDF_INDISPONIBLE", 503))).toMatch(/PDF/);
  });

  it("garde un repli français pour tout le reste", () => {
    expect(messageDd(erreur("AUTRE", 404))).toMatch(/n'existe plus/);
    expect(messageDd(erreur("AUTRE", 409))).toBe("Message de l'API");
    expect(messageDd(new Error("technique"))).toMatch(/inattendue/);
  });

  it("signale un écran probablement périmé après un 404 ou un 409, pas après un plafond", () => {
    expect(etatDdChange(erreur("VERSION_PERIMEE", 409))).toBe(true);
    expect(etatDdChange(erreur("INTROUVABLE", 404))).toBe(true);
    expect(etatDdChange(erreur("PLAFOND_ATTEINT", 409))).toBe(false);
    expect(etatDdChange(new Error("x"))).toBe(false);
  });
});

describe("formats d'affichage (aucun calcul métier : valeurs déjà calculées)", () => {
  it("formate les points de base en pourcentage français", () => {
    expect(formaterBp(4000)).toBe(`40${NBSP}%`);
    expect(formaterBp(2550)).toBe(`25,5${NBSP}%`);
    expect(formaterBp(5)).toBe(`0,05${NBSP}%`);
    expect(formaterBp(0)).toBe(`0${NBSP}%`);
    expect(formaterBp(10_000)).toBe(`100${NBSP}%`);
    expect(formaterBp(null)).toBe("—");
  });

  it("formate la valeur d'un paramètre selon son unité", () => {
    expect(uniteParametre("marche_total")).toBe("montant");
    expect(uniteParametre("part_segment")).toBe("pourcentage_bp");
    expect(uniteParametre("clients_cibles")).toBe("nombre");
    expect(formaterValeurParametre("part_segment", 4000, "XOF")).toBe(`40${NBSP}%`);
    expect(formaterValeurParametre("clients_cibles", 2000, "XOF")).toMatch(/^2.000$/);
    expect(formaterValeurParametre("prix_unitaire", 250_000, "XOF")).toContain("FCFA");
    expect(formaterValeurParametre("prix_unitaire", 123_450, "EUR")).toContain("1");
  });

  it("résout les libellés de taxonomie sans jamais afficher un code", () => {
    const secteurs = [{ code: "citi_a", libelle: "Agriculture" }];
    expect(libelleTaxonomie(secteurs, "citi_a")).toBe("Agriculture");
    expect(libelleTaxonomie(secteurs, "citi_z")).toBe("Libellé indisponible");
    expect(libelleTaxonomie(secteurs, null)).toBe("—");
    const d = {
      secteur_code: "citi_a",
      pays_code: "ci",
      secteur_libelle: null,
      pays_libelle: "Côte d'Ivoire",
    };
    expect(libellesDossier(d, secteurs, [])).toEqual({
      secteur: "Agriculture",
      pays: "Côte d'Ivoire",
    });
  });

  it("résume l'opération d'un dossier", () => {
    expect(
      resumeOperation({ type_operation: "acquisition", cible_nom: "Cacao SA", devise: "XOF" }),
    ).toBe("Acquisition · Cacao SA");
    expect(resumeOperation({ type_operation: "partenariat", cible_nom: null, devise: "EUR" })).toBe(
      "Partenariat",
    );
  });

  it("libelle un lien de plan ou d'indicateur masqué sans rien révéler", () => {
    expect(libelleLienPlan(null)).toBe("Aucun");
    expect(libelleLienPlan({ id: null, masque: true })).toBe("Lien non visible");
    expect(libelleLienPlan({ id: "x", libelle: "Initiative 1" })).toBe("Initiative 1");
    expect(libelleLienPlan({ id: "x" })).toBe("Élément lié");
  });

  it("signale la fragilité d'un point en texte", () => {
    expect(messageFragilite({ nb_pour: 0, avis_expert: false })).toBe("Aucune source");
    expect(messageFragilite({ nb_pour: 0, avis_expert: true })).toBe("Avis d'expert, sans source");
    expect(messageFragilite({ nb_pour: 1, avis_expert: false })).toBe("Source unique");
    expect(messageFragilite({ nb_pour: 3, avis_expert: false })).toBeNull();
    expect(aAvisExpert(true)).toBe(true);
    expect(aAvisExpert(null)).toBe(false);
    expect(aAvisExpert({ signe: false })).toBe(true);
    expect(aAvisExpert(undefined)).toBe(false);
  });
});

const indication = {
  indication: "non_concluante" as const,
  raison: "AUCUNE_ASSERTION",
  conflit: false,
  soutien: { solide: 0, etayee: 0, fragile: 0 },
  contre: { solide: 0, etayee: 0, fragile: 0 },
};

function noeud(
  id: string,
  parent: string | null = null,
  extra: Partial<NoeudHypothese> = {},
): NoeudHypothese {
  return {
    id,
    parent_id: parent,
    version: 1,
    libelle: `Hypothèse ${id}`,
    description: null,
    critere: null,
    liens: [],
    indication,
    verdict_en_vigueur: null,
    verdict_en_attente: null,
    ...extra,
  };
}

describe("hypothèses : état dérivé d'un nœud et arbre d'affichage", () => {
  it("dérive l'état du verdict en vigueur, du verdict en attente, sinon ouverte", () => {
    expect(etatVerdict(noeud("a"))).toBe("ouverte");
    expect(
      etatVerdict(noeud("a", null, { verdict_en_attente: { id: "v", verdict: "confirmee" } })),
    ).toBe("en_attente");
    expect(
      etatVerdict(noeud("a", null, { verdict_en_vigueur: { id: "v", verdict: "infirmee" } })),
    ).toBe("infirmee");
    // L'état reçu de l'API prime.
    const recu: EtatHypothese = "non_concluante";
    expect(etatVerdict(noeud("a", null, { etat: recu }))).toBe("non_concluante");
  });

  it("construit l'arbre dans l'ordre de l'API et mesure la profondeur", () => {
    const noeuds = [noeud("r"), noeud("a", "r"), noeud("b", "r"), noeud("c", "a"), noeud("d", "c")];
    const arbre = construireArbre(noeuds);
    expect(arbre).toHaveLength(1);
    expect(arbre[0]!.noeud.id).toBe("r");
    expect(arbre[0]!.enfants.map((e) => e.noeud.id)).toEqual(["a", "b"]);
    expect(arbre[0]!.enfants[0]!.enfants[0]!.enfants[0]!.profondeur).toBe(4);
    expect(profondeurNoeud("d", noeuds)).toBe(4);
    expect(profondeurNoeud("r", noeuds)).toBe(1);
  });

  it("ne propose pas de parent au dernier niveau (profondeur 4 au plus)", () => {
    const noeuds = [noeud("r"), noeud("a", "r"), noeud("c", "a"), noeud("d", "c")];
    expect(parentsPossibles(noeuds).map((n) => n.id)).toEqual(["r", "a", "c"]);
  });

  it("résiste à un parent inconnu et à une boucle", () => {
    const orphelin = construireArbre([noeud("x", "inconnu")]);
    expect(orphelin.map((n) => n.noeud.id)).toEqual(["x"]);
    const boucle = [noeud("a", "b"), noeud("b", "a")];
    expect(construireArbre(boucle)).toEqual([]);
    expect(profondeurNoeud("a", boucle)).toBeLessThanOrEqual(2);
  });

  it("retient la lecture la plus prudente des assertions liées", () => {
    expect(lectureMinimale([])).toBeNull();
    expect(lectureMinimale([{ solidite: null }, {}])).toBeNull();
    expect(
      lectureMinimale([{ solidite: { lecture: "solide" } }, { solidite: { lecture: "etayee" } }]),
    ).toBe("etayee");
    expect(
      lectureMinimale([{ solidite: { lecture: "solide" } }, { solidite: { lecture: "fragile" } }]),
    ).toBe("fragile");
    expect(lectureMinimale([{ solidite: { lecture: "solide" } }])).toBe("solide");
  });
});

describe("carte de la chaîne de valeur : objets simples, triés, sérialisables", () => {
  const chaine: ReponseChaine = {
    etapes: [
      {
        id: "e2",
        version: 1,
        libelle: "Transformation",
        description: null,
        ordre: 2,
        part_cout_bp: 2500,
        part_marge_bp: 5000,
        part_cout_affichee: "25 %",
        part_marge_affichee: "50 %",
        acteurs: ["Usine"],
        contraintes: null,
        rang_marge: 1,
        risques: [
          {
            id: "r1",
            libelle: "Panne",
            famille: "operationnel",
            niveau: "eleve",
            lecture: "fragile",
          },
        ],
      },
      {
        id: "e1",
        version: 1,
        libelle: "Collecte",
        description: null,
        ordre: 1,
        part_cout_bp: null,
        part_marge_bp: null,
        part_cout_affichee: null,
        part_marge_affichee: null,
        acteurs: [],
        contraintes: null,
        rang_marge: null,
        risques: [],
      },
    ],
    synthese: {
      total_cout_bp: 2500,
      total_marge_bp: 5000,
      coherence_cout: "incomplete",
      coherence_marge: "incomplete",
      etape_marge_max: "e2",
    },
  };

  it("trie par ordre, signale la plus forte marge et regroupe les risques de chaque étape", () => {
    const etapes = etapesPourCarte(chaine);
    expect(etapes.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(etapes[1]).toMatchObject({
      partCoutAffichee: "25 %",
      partMargeAffichee: "50 %",
      margeMax: true,
      acteurs: ["Usine"],
    });
    expect(etapes[1]!.risques.map((r) => r.id)).toEqual(["r1"]);
    expect(etapes[0]).toMatchObject({ partCoutAffichee: "—", margeMax: false });
    // Sérialisable : aucune fonction ne traverse la frontière serveur / client.
    expect(JSON.parse(JSON.stringify(etapes))).toEqual(etapes);
  });

  it("dit si les parts sont incomplètes ou incohérentes", () => {
    expect(messageCoherenceChaine(chaine.synthese)).toMatch(/parts de coût sont incomplètes/);
    expect(messageCoherenceChaine(chaine.synthese)).toMatch(/parts de marge sont incomplètes/);
    expect(
      messageCoherenceChaine({
        ...chaine.synthese,
        coherence_cout: "incoherente",
        coherence_marge: "coherente",
      }),
    ).toMatch(/incohérentes/);
    expect(
      messageCoherenceChaine({
        ...chaine.synthese,
        coherence_cout: "coherente",
        coherence_marge: "coherente",
      }),
    ).toBeNull();
    expect(messageCoherenceChaine(null)).toBeNull();
  });
});

describe("risques : regroupement par famille et tri par gravité", () => {
  const risques = [
    { id: "a", famille: "pays" as const, niveau: "faible" as const },
    { id: "b", famille: "change" as const, niveau: "critique" as const },
    { id: "c", famille: "pays" as const, niveau: "eleve" as const },
  ];

  it("garde l'ordre canonique des familles, y compris vides", () => {
    const g = risquesParFamille(risques, FAMILLES_RISQUE_DD);
    expect(g.map((x) => x.famille)).toEqual(["pays", "change", "operationnel", "reglementaire"]);
    expect(g[0]!.risques.map((r) => r.id)).toEqual(["a", "c"]);
    expect(g[2]!.risques).toEqual([]);
  });

  it("trie du plus grave au moins grave sans modifier la liste d'origine", () => {
    expect(trierParGravite(risques).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(risques.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("contrôle de la note : phrases et écrans à corriger", () => {
  it("place les bloquants avant les avertissements, chacun avec son écran", () => {
    const points = pointsDeControle({
      bloquants: ["SANS_HYPOTHESE", "EXCLUSION_NON_LEVEE_FAVORABLE"],
      avertissements: ["AUCUN_DIMENSIONNEMENT"],
      soumissible: false,
    });
    expect(points.map((p) => [p.code, p.gravite, p.ecran])).toEqual([
      ["SANS_HYPOTHESE", "bloquant", "hypotheses"],
      ["EXCLUSION_NON_LEVEE_FAVORABLE", "bloquant", "environnement-social"],
      ["AUCUN_DIMENSIONNEMENT", "avertissement", "marche"],
    ]);
    expect(pointsDeControle(null)).toEqual([]);
    expect(pointsDeControle({ bloquants: [], avertissements: [], soumissible: true })).toEqual([]);
  });
});

describe("état d'une note et version validée", () => {
  const meta = (version: number, etat: "brouillon" | "soumise") => ({
    version,
    etat,
    recommandation: "reservee" as const,
    soumise_le: null,
    motif: null,
    cree_le: "2026-10-11T10:00:00Z",
  });
  const decision = (version: number, d: "valide" | "rejete") => ({
    version,
    decision: d,
    motif: null,
    valide_par: "u",
    valide_le: "2026-10-12T10:00:00Z",
  });

  it("dérive l'état de la dernière version et de sa décision", () => {
    expect(etatNote({ versions: [meta(1, "brouillon")], validations: [] })).toBe("brouillon");
    expect(
      etatNote({ versions: [meta(2, "soumise"), meta(1, "brouillon")], validations: [] }),
    ).toBe("soumise");
    expect(etatNote({ versions: [meta(2, "soumise")], validations: [decision(2, "valide")] })).toBe(
      "validee",
    );
    expect(etatNote({ versions: [meta(2, "soumise")], validations: [decision(2, "rejete")] })).toBe(
      "rejetee",
    );
    expect(etatNote({ versions: [], validations: [] })).toBe("brouillon");
    // L'état reçu de l'API prime.
    expect(etatNote({ etat: "validee", versions: [], validations: [] })).toBe("validee");
  });

  it("retient la dernière version validée", () => {
    expect(versionValidee({ validations: [] })).toBeNull();
    expect(
      versionValidee({
        validations: [decision(1, "valide"), decision(3, "valide"), decision(2, "rejete")],
      }),
    ).toBe(3);
    expect(versionValidee({ validee_version: 5, validations: [] })).toBe(5);
  });
});

describe("dossier : cadrage imbriqué de R03", () => {
  it("remonte le cadrage courant au niveau du dossier", () => {
    const d = aplatirDossier({
      id: "d1",
      numero: 1,
      cree_par: "u",
      cree_le: "2026-10-11",
      version_cadrage: 2,
      secteur_libelle: "Agriculture",
      filiere_libelle: null,
      pays_libelle: "Côte d'Ivoire",
      mission: { id: "m1", intitule: "Mission", statut: "en_cours" },
      cadrage: {
        titre: "Acquisition",
        secteur_code: "citi_a",
        filiere_code: null,
        pays_code: "ci",
        cible_nom: "Cacao SA",
        type_operation: "acquisition",
        devise: "XOF",
        date_operation: null,
        question_investissement: null,
        perimetre: null,
      },
    } as unknown as Parameters<typeof aplatirDossier>[0]);
    expect(d).toMatchObject({
      id: "d1",
      titre: "Acquisition",
      devise: "XOF",
      cible_nom: "Cacao SA",
    });
    expect(d.mission.id).toBe("m1");
  });

  it("lit aussi une forme déjà plate", () => {
    const d = aplatirDossier({ id: "d1", titre: "Plat", devise: "EUR" } as unknown as Parameters<
      typeof aplatirDossier
    >[0]);
    expect(d).toMatchObject({ titre: "Plat", devise: "EUR" });
  });
});

describe("R38 : versions d'une liste d'exclusion paginées", () => {
  const version = (n: number): VersionListeExclusion => ({
    version: n,
    regles: [],
    reference_cadre: null,
    motif: null,
    cree_le: "2026-10-12T10:00:00.000Z",
  });
  /** API simulée : 25 versions, plus récente d'abord, `limite` au plus 20 (sinon 400). */
  function apiSimulee(total = 25) {
    const appels: string[] = [];
    const lire = async <T>(chemin: string): Promise<PageDd<T>> => {
      appels.push(chemin);
      const url = new URL(chemin, "http://api.test");
      const limite = Number(url.searchParams.get("limite") ?? 10);
      if (limite > LIMITE_VERSIONS_LISTE_DD) {
        throw new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400);
      }
      const apres = url.searchParams.get("curseur");
      const sup = apres === null ? total + 1 : Number(apres);
      const restantes = Array.from({ length: total }, (_, i) => total - i).filter((n) => n < sup);
      const page = restantes.slice(0, limite);
      const suivant = restantes.length > limite ? String(page[page.length - 1]) : null;
      return { elements: page.map(version) as T[], curseur_suivant: suivant };
    };
    return { appels, lire };
  }

  it("boucle sur les pages avec limite=20 (plafond de la route) et rend toutes les versions", async () => {
    const { appels, lire } = apiSimulee();
    const r = await chargerVersionsListe("l/1", lire);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.donnees.tronquee).toBe(false);
    expect(r.donnees.elements.map((v) => v.version)).toEqual(
      Array.from({ length: 25 }, (_, i) => 25 - i),
    );
    expect(appels).toHaveLength(2);
    expect(appels[0]).toBe("/api/dd/listes-exclusion/l%2F1/versions?limite=20");
    expect(appels[1]).toContain("limite=20");
    expect(appels[1]).toContain("curseur=6");
  });

  it("une seule page quand la liste tient dans la page ; liste vide acceptée", async () => {
    const un = apiSimulee(3);
    const r = await chargerVersionsListe("l1", un.lire);
    expect(r.ok && r.donnees.elements.length).toBe(3);
    expect(un.appels).toHaveLength(1);
    const vide = await chargerVersionsListe("l1", apiSimulee(0).lire);
    expect(vide).toMatchObject({ ok: true, donnees: { elements: [], tronquee: false } });
  });

  it("une erreur de l'API est rendue avec son message français et son statut", async () => {
    const r = await chargerVersionsListe("l1", async () => {
      throw new ErreurApi("INTROUVABLE", "Liste d'exclusion introuvable.", 404);
    });
    expect(r).toMatchObject({ ok: false, statut: 404 });
    const inattendue = await chargerVersionsListe("l1", async () => {
      throw new Error("réseau");
    });
    expect(inattendue).toMatchObject({ ok: false, statut: 0 });
  });

  it("la version courante se lit sur une page d'un seul élément", async () => {
    const { appels, lire } = apiSimulee();
    const v = await chargerVersionCouranteListe("l1", lire);
    expect(v?.version).toBe(25);
    expect(appels).toEqual(["/api/dd/listes-exclusion/l1/versions?limite=1"]);
    expect(await chargerVersionCouranteListe("l1", apiSimulee(0).lire)).toBeNull();
  });
});

describe("exclusions antérieures non levées (R39)", () => {
  it("phrase au singulier, au pluriel ; rien sans exclusion", () => {
    expect(phraseExclusionsAnterieures(0)).toBeNull();
    expect(phraseExclusionsAnterieures(1)).toMatch(/^1 exclusion confirmée .* reste bloquante.$/);
    expect(phraseExclusionsAnterieures(3)).toMatch(
      /^3 exclusions confirmées .* restent bloquantes.$/,
    );
  });
});
