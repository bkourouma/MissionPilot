import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  ajouterJoursIso,
  alerteDepuisEnregistrement,
  bornesDateArrete,
  candidatsContributeurs,
  candidatsProprietaire,
  cheminExportKpi,
  cheminSerieKpi,
  cheminMesuresKpi,
  cheminTableauKpi,
  descriptionAlerte,
  descriptionTendance,
  droitsKpi,
  estExportKpi,
  estSerieKpi,
  etatLigneMesure,
  formaterValeurKpi,
  hrefKpi,
  hrefTableauKpi,
  kpisParPerspective,
  libellePeriode,
  libellePeriodeCourt,
  libelleStatutKpi,
  lireCurseur,
  lireDateArrete,
  messageAnnulationKpi,
  messageKpi,
  nomFichierExportKpi,
  nomProprietaire,
  raisonSansSaisie,
  rangCorrection,
  STATUT_KPI,
  texteAtteinte,
  texteEcart,
  texteProjection,
  texteSeuilsStatut,
  type KpiTableau,
  type MesureKpi,
} from "./kpi";

const espaces = (t: string) => t.replace(/[\u00a0\u202f]/g, " ");

describe("statuts : libellé toujours écrit, tonalité doublée par le texte", () => {
  it("cinq statuts du moteur, chacun avec un libellé distinct", () => {
    const libelles = Object.values(STATUT_KPI).map((s) => s.libelle);
    expect(new Set(libelles).size).toBe(5);
    expect(STATUT_KPI.vert.tonalite).toBe("succes");
    expect(STATUT_KPI.orange.tonalite).toBe("attention");
    expect(STATUT_KPI.rouge.tonalite).toBe("danger");
    expect(STATUT_KPI.non_mesure.libelle).toBe("Non mesuré");
    expect(STATUT_KPI.sans_cible.libelle).toBe("Sans cible");
  });

  it("statut inconnu : libellé neutre, jamais d'exception", () => {
    expect(libelleStatutKpi("bleu")).toEqual({ libelle: "Statut inconnu", tonalite: "neutre" });
    expect(libelleStatutKpi(null).tonalite).toBe("neutre");
  });

  it("seuils écrits : ceux du KPI ou ceux du moteur (95 % / 80 %)", () => {
    expect(espaces(texteSeuilsStatut({ seuil_vert: null, seuil_orange: null }))).toContain(
      "Vert à partir de 95 % de la cible, orange de 80 % à 95 %",
    );
    expect(espaces(texteSeuilsStatut({ seuil_vert: 0.9, seuil_orange: 0.7 }))).toContain(
      "seuils propres à ce KPI",
    );
  });
});

describe("périodes : clés de l'API en libellés français", () => {
  it.each([
    ["2026-03", "mars 2026", "mars 26"],
    ["2026-W41", "semaine 41 de 2026", "S41 26"],
    ["2026-T1", "1er trimestre 2026", "T1 26"],
    ["2026-T3", "3e trimestre 2026", "T3 26"],
    ["2026-S2", "2e semestre 2026", "S2 26"],
    ["2026", "année 2026", "2026"],
  ])("%s → %s", (cle, long, court) => {
    expect(libellePeriode(cle)).toBe(long);
    expect(libellePeriodeCourt(cle)).toBe(court);
  });

  it("clé inattendue rendue telle quelle, absente en tiret", () => {
    expect(libellePeriode("2026-13")).toBe("2026-13");
    expect(libellePeriode("bizarre")).toBe("bizarre");
    expect(libellePeriode(null)).toBe("—");
  });
});

describe("mise en forme des chiffres du moteur (aucun calcul)", () => {
  it("valeur avec unité, six décimales au plus, séparateurs insécables", () => {
    expect(espaces(formaterValeurKpi(1250.5, "kFCFA"))).toBe("1 250,5 kFCFA");
    expect(espaces(formaterValeurKpi(0.123456, "%"))).toBe("0,123456 %");
    expect(formaterValeurKpi(null, "jours")).toBe("—");
  });

  it("écart signé, relatif, favorable ou défavorable selon le sens (écart orienté)", () => {
    const e = { ecart: -300, ecart_exact: "-300", ecart_relatif: -0.25, ecart_oriente: -300 };
    expect(espaces(texteEcart({ ...e, cible_atteinte: false }, "kFCFA"))).toMatch(
      /^-300 kFCFA \(-25 %\), défavorable$/,
    );
    // Plus bas = mieux : 40 jours pour une cible de 45 (écart -5, orienté +5).
    expect(
      espaces(
        texteEcart(
          {
            ecart: -5,
            ecart_exact: "-5",
            ecart_relatif: null,
            ecart_oriente: 5,
            cible_atteinte: true,
          },
          "jours",
        ),
      ),
    ).toBe("-5 jours, favorable");
    expect(texteEcart(null, "u")).toBe("—");
  });

  it("atteinte : relative (bornée signalée) ou binaire (cible nulle)", () => {
    const a = { taux_exact: "7/12", taux_brut_exact: "7/12", borne: null } as const;
    expect(espaces(texteAtteinte({ ...a, taux: 0.5833, mode: "relatif" }))).toBe(
      "58,3 % de la cible",
    );
    expect(texteAtteinte({ ...a, taux: 1, mode: "binaire" })).toBe("Cible nulle respectée (100 %)");
    expect(texteAtteinte({ ...a, taux: 0, mode: "binaire" })).toBe(
      "Cible nulle non respectée (0 %)",
    );
    expect(espaces(texteAtteinte({ ...a, taux: 1, mode: "relatif", borne: "plafond" }))).toBe(
      "100 % de la cible (plafonné)",
    );
  });

  it("tendance : flèche ET texte, amélioration selon le sens de lecture", () => {
    const t = { pente: 1, variation: 3, variation_relative: 0.1, points: 4 };
    expect(descriptionTendance({ ...t, direction: "hausse", evolution: "amelioration" })).toEqual({
      fleche: "↑",
      texte: "En hausse : amélioration, sur 4 périodes mesurées",
      tonalite: "succes",
    });
    expect(descriptionTendance({ ...t, direction: "hausse", evolution: "degradation" }).texte).toBe(
      "En hausse : dégradation, sur 4 périodes mesurées",
    );
    expect(descriptionTendance({ ...t, direction: "stable", evolution: "stable" }).fleche).toBe(
      "→",
    );
    expect(
      descriptionTendance({ ...t, points: 1, direction: "indeterminee", evolution: "indeterminee" })
        .texte,
    ).toMatch(/indéterminée/);
  });

  it("projection : valeur, méthode et jours écoulés ; indisponible sans mesure", () => {
    expect(
      espaces(
        texteProjection(
          {
            valeur_projetee: 620,
            valeur_exacte: "620",
            methode: "prorata",
            jours_ecoules: 15,
            jours_total: 31,
          },
          "kFCFA",
        ),
      ),
    ).toBe(
      "620 kFCFA en fin de période (prorata temporel du cumul de la période, 15 jours écoulés sur 31)",
    );
    expect(texteProjection(null, "u")).toMatch(/indisponible/);
  });
});

describe("alertes : titre et phrase française pour chaque code du moteur", () => {
  it("dégradation, retard, seuils, variation", () => {
    expect(
      descriptionAlerte(
        { code: "DEGRADATION_CONSECUTIVE", periode: "2026-04", periodes: 3, seuil: 3 },
        "kFCFA",
      ),
    ).toMatchObject({ titre: "Dégradation continue", tonalite: "danger" });
    const retard = descriptionAlerte(
      {
        code: "MESURE_EN_RETARD",
        periode: "2026-04",
        periode_attendue: "2026-04",
        echeance: "2026-05-05",
        jours_de_retard: 10,
        periodes_manquantes: 2,
        derniere_periode_due: "2026-05",
      },
      "jours",
    );
    expect(retard.titre).toBe("Mesure en retard");
    expect(retard.texte).toContain("avril 2026");
    expect(retard.texte).toContain("10 jours de retard");
    expect(retard.texte).toContain("2 périodes sont sans mesure, jusqu'à mai 2026");
    expect(
      espaces(
        descriptionAlerte(
          { code: "SEUIL_HAUT", periode: "2026-03", valeur: 62, seuil: 60 },
          "jours",
        ).texte,
      ),
    ).toBe("Mars 2026 : 62 jours, au-dessus du seuil de 60 jours.");
    expect(
      espaces(
        descriptionAlerte(
          {
            code: "VARIATION",
            periode: "2026-03",
            valeur: 130,
            precedente: 100,
            variation_relative: 0.3,
            seuil: 0.2,
          },
          "",
        ).texte,
      ),
    ).toContain("(+30 %), au-delà de la variation admise de 20 %");
    expect(descriptionAlerte({ code: "INCONNU", periode: "2026" }, "").titre).toBe("Alerte");
  });

  it("alerte enregistrée : détails relus sans planter sur un champ manquant", () => {
    const a = alerteDepuisEnregistrement({
      id: "x",
      code: "SEUIL_BAS",
      periode: "2026-02",
      details: { valeur: 3 },
      detectee_le: "2026-03-01T00:00:00Z",
    });
    expect(espaces(descriptionAlerte(a, "u").texte)).toBe(
      "Février 2026 : 3 u, en dessous du seuil de —.",
    );
    expect(
      alerteDepuisEnregistrement({
        id: "y",
        code: "SEUIL_BAS",
        periode: "2026-02",
        details: null,
        detectee_le: "",
      }).code,
    ).toBe("SEUIL_BAS");
  });
});

describe("chemins et liens", () => {
  it("chemins de l'API encodés, date d'arrêté facultative", () => {
    expect(cheminTableauKpi("m 1", null)).toBe("/api/missions/m%201/kpi/tableau-de-bord");
    expect(cheminTableauKpi("m1", "2026-05-15")).toBe(
      "/api/missions/m1/kpi/tableau-de-bord?date=2026-05-15",
    );
    expect(cheminExportKpi("m1", null)).toBe("/api/missions/m1/kpi/export");
    expect(cheminSerieKpi("m1", null)).toBe("/api/missions/m1/kpi/series");
    expect(cheminSerieKpi("m1", "2026-05-15")).toBe("/api/missions/m1/kpi/series?date=2026-05-15");
    expect(cheminMesuresKpi("k1", { limite: 20, curseur: "a b" })).toBe(
      "/api/kpi/k1/mesures?limite=20&curseur=a+b",
    );
    expect(hrefTableauKpi("m1")).toBe("/missions/m1/kpi");
    expect(hrefKpi("m1", "k1", { cree: "1", curseur: null })).toBe("/missions/m1/kpi/k1?cree=1");
  });

  it("curseur d'URL : premier, non vide, borné", () => {
    expect(lireCurseur(["a", "b"])).toBe("a");
    expect(lireCurseur("")).toBeNull();
    expect(lireCurseur("x".repeat(501))).toBeNull();
    expect(lireCurseur(undefined)).toBeNull();
  });
});

describe("date d'arrêté bornée comme l'API (2000-01-01 à aujourd'hui + 366 jours)", () => {
  const AUJ = "2026-10-06";

  it("bornes du sélecteur", () => {
    expect(bornesDateArrete(AUJ)).toEqual({ min: "2000-01-01", max: "2027-10-07" });
    expect(ajouterJoursIso("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("absente : arrêté à aujourd'hui par l'API ; valide : conservée", () => {
    expect(lireDateArrete(undefined, AUJ)).toEqual({ date: null, erreur: null });
    expect(lireDateArrete("", AUJ)).toEqual({ date: null, erreur: null });
    expect(lireDateArrete("2026-05-15", AUJ)).toEqual({ date: "2026-05-15", erreur: null });
    expect(lireDateArrete("2027-10-07", AUJ).date).toBe("2027-10-07");
    expect(lireDateArrete("2000-01-01", AUJ).date).toBe("2000-01-01");
  });

  it("illisible ou hors bornes : écartée avec un message (jamais envoyée à l'API)", () => {
    for (const d of ["2026-13-01", "2026-02-30", "abc", "1999-12-31", "2027-10-08", "9999-12-31"]) {
      const r = lireDateArrete(d, AUJ);
      expect(r.date, d).toBeNull();
      expect(r.erreur, d).toMatch(/aujourd'hui/);
    }
  });
});

describe("droits d'affichage (miroir de kpi/acces.ts)", () => {
  const mission = {
    statut: "en_cours" as const,
    directeur_id: "dir",
    chef_id: "chef",
    equipe: [{ utilisateur_id: "membre", nom: "Awa" }],
  };

  it("chef de mission : gère et saisit ; mission clôturée : rien", () => {
    expect(droitsKpi(["chef_mission"], "chef", mission)).toEqual({
      gerer: true,
      saisir: true,
      parametres: false,
    });
    expect(droitsKpi(["chef_mission"], "chef", { ...mission, statut: "cloturee" })).toEqual({
      gerer: false,
      saisir: false,
      parametres: false,
    });
  });

  it("consultant : saisit s'il est de l'équipe ou propriétaire, ne gère jamais", () => {
    expect(droitsKpi(["consultant"], "membre", mission).saisir).toBe(true);
    expect(droitsKpi(["consultant"], "membre", mission).gerer).toBe(false);
    expect(droitsKpi(["consultant"], "autre", mission).saisir).toBe(false);
    expect(
      droitsKpi(["consultant"], "autre", mission, { proprietaire_id: "autre", actif: true }).saisir,
    ).toBe(true);
  });

  it("KPI désactivé : plus de saisie ; lire toutes les missions ne suffit pas", () => {
    expect(
      droitsKpi(["chef_mission"], "chef", mission, { proprietaire_id: null, actif: false }).saisir,
    ).toBe(false);
    expect(droitsKpi(["expert_metier"], "membre", mission).saisir).toBe(false);
    // Directeur d'une autre mission : modifie toutes les missions → gère.
    expect(droitsKpi(["directeur_mission"], "x", mission).gerer).toBe(true);
    expect(droitsKpi(["associe"], "x", mission).parametres).toBe(true);
  });

  it("raison affichée sans saisie", () => {
    expect(raisonSansSaisie({ statut: "cloturee" }, { actif: true }, ["chef_mission"])).toMatch(
      /clôturée/,
    );
    expect(raisonSansSaisie({ statut: "en_cours" }, { actif: false }, ["chef_mission"])).toMatch(
      /désactivé/,
    );
    expect(raisonSansSaisie({ statut: "en_cours" }, { actif: true }, ["expert_metier"])).toMatch(
      /consulter/,
    );
  });
});

describe("personnes : propriétaire et contributeurs", () => {
  it("propriétaires : directeur, chef puis équipe triée, sans doublon", () => {
    const noms = new Map([
      ["dir", "Kouassi"],
      ["chef", "Diallo"],
    ]);
    const options = candidatsProprietaire(
      {
        directeur_id: "dir",
        chef_id: "chef",
        equipe: [
          { utilisateur_id: "z", nom: "Zoé" },
          { utilisateur_id: "chef", nom: "Diallo" },
          { utilisateur_id: "a", nom: "Awa" },
        ],
      },
      noms,
    );
    expect(options.map((o) => o.valeur)).toEqual(["dir", "chef", "a", "z"]);
    expect(options[0]?.libelle).toBe("Kouassi (directeur de mission)");
    expect(nomProprietaire(null, options, noms)).toBe("Aucun propriétaire désigné");
    expect(nomProprietaire("a", options, noms)).toBe("Awa (équipe)");
    expect(nomProprietaire("q", options, noms)).toBe("Collaborateur hors de l'équipe actuelle");
  });

  it("contributeurs : dirigeants et contributeurs du portail, jamais l'investisseur", () => {
    const c = candidatsContributeurs(
      [
        { id: "1", nom: "Binta", email: "b@x.ci", roles: ["client_contributeur"], statut: "actif" },
        { id: "2", nom: "Ali", email: "a@x.ci", roles: ["client_dirigeant"], statut: "desactive" },
        { id: "3", nom: "Inv", email: "i@x.ci", roles: ["client_investisseur"], statut: "actif" },
      ],
      [{ id: "9", nom: "Ancien", email: "o@x.ci" }],
    );
    expect(c.map((x) => x.id)).toEqual(["2", "9", "1"]);
    expect(c[0]).toMatchObject({ role: "Dirigeant client", desactive: true });
  });
});

const mesure = (m: Partial<MesureKpi> & { id: string }): MesureKpi => ({
  kpi_id: "k",
  date_mesure: "2026-03-31",
  periode: "2026-03",
  valeur: 1,
  annulation: false,
  remplace_id: null,
  active: false,
  motif: null,
  commentaire: null,
  justificatif: null,
  origine: "cabinet",
  saisie_par: { id: "u", nom: "U" },
  saisie_le: "2026-04-01T00:00:00Z",
  ...m,
});

describe("historique des mesures en ajout seul", () => {
  const m1 = mesure({ id: "m1" });
  const m2 = mesure({ id: "m2", remplace_id: "m1" });
  const m3 = mesure({ id: "m3", remplace_id: "m2", active: true });
  const a1 = mesure({ id: "a1", valeur: null, annulation: true, remplace_id: "x" });
  const x = mesure({ id: "x" });

  it("état de chaque ligne : active, corrigée, annulée, ligne d'annulation", () => {
    const lignes = [m3, m2, m1, a1, x];
    expect(etatLigneMesure(m3, lignes).libelle).toBe("Active (correction)");
    expect(etatLigneMesure(m1, lignes).libelle).toBe("Corrigée");
    expect(etatLigneMesure(x, lignes).libelle).toBe("Annulée");
    expect(etatLigneMesure(a1, lignes).libelle).toBe("Annulation");
    expect(etatLigneMesure(mesure({ id: "seule" }), []).libelle).toBe("Corrigée ou annulée");
    expect(etatLigneMesure(mesure({ id: "ok", active: true }), []).libelle).toBe("Active");
  });

  it("rang de correction suivi dans les lignes chargées (cycle ignoré)", () => {
    expect(rangCorrection(m3, [m1, m2, m3])).toBe(2);
    expect(rangCorrection(m1, [m1, m2, m3])).toBe(0);
    const boucle = mesure({ id: "b", remplace_id: "b" });
    expect(rangCorrection(boucle, [boucle])).toBe(1);
  });
});

describe("regroupement par perspective", () => {
  it("ordre du tableau de bord prospectif, sans perspective en dernier, groupes vides omis", () => {
    const k = (id: string, perspective: KpiTableau["perspective"]) =>
      ({ id, perspective }) as KpiTableau;
    const g = kpisParPerspective([k("a", null), k("b", "clients"), k("c", "finances")]);
    expect(g.map((x) => [x.libelle, x.kpis.map((y) => y.id)])).toEqual([
      ["Finances", ["c"]],
      ["Clients", ["b"]],
      ["Sans perspective", ["a"]],
    ]);
  });
});

describe("messages d'erreur", () => {
  const err = (statut: number, code: string, message = "Message de l'API.") =>
    new ErreurApi(code, message, statut);

  it("codes KPI : messages explicites (20 corrections, début trop ancien, doublon…)", () => {
    expect(messageKpi(err(409, "KPI_TROP_DE_CORRECTIONS"))).toMatch(/20 fois.*annulez-la/);
    expect(messageKpi(err(400, "KPI_DEBUT_SUIVI_TROP_ANCIEN"))).toMatch(/10 ans/);
    expect(messageKpi(err(409, "KPI_MESURE_EN_DOUBLE"))).toMatch(/corrigez-la/);
    expect(messageKpi(err(400, "KPI_HORS_PERIODE"))).toMatch(/début du suivi/);
    expect(messageKpi(err(409, "KPI_INACTIF"))).toMatch(/désactivé/);
    expect(messageKpi(err(400, "KPI_INCOHERENT"))).toMatch(/portail de ce client/);
  });

  it("messages de l'API gardés quand ils sont explicites, génériques sinon", () => {
    expect(messageKpi(err(400, "KPI_TROP_DE_PERIODES", "Trop de périodes."))).toBe(
      "Trop de périodes.",
    );
    expect(messageKpi(err(409, "CONFLIT", "La mission est clôturée."))).toBe(
      "La mission est clôturée.",
    );
    expect(messageKpi(err(400, "REQUETE_INVALIDE", "Le propriétaire d'un KPI est…"))).toBe(
      "Le propriétaire d'un KPI est…",
    );
    expect(messageKpi(err(400, "REQUETE_INVALIDE", "Données invalides."))).toMatch(
      /Certaines valeurs/,
    );
    expect(messageKpi(err(404, "INTROUVABLE"))).toMatch(/rechargez la page/);
    expect(messageKpi(err(403, "INTERDIT"))).toMatch(/Votre rôle/);
    expect(messageKpi(new Error("x"))).toMatch(/inattendue/);
  });

  it("annulation d'une mesure du portail refusée : réservée aux responsables", () => {
    expect(messageAnnulationKpi(err(403, "INTERDIT"), "portail")).toMatch(/responsable/);
    expect(messageAnnulationKpi(err(403, "INTERDIT"), "cabinet")).toMatch(/Votre rôle/);
  });
});

describe("export JSON versionné", () => {
  it("format reconnu seulement s'il est missionpilot.kpi.v1", () => {
    expect(estExportKpi({ format: "missionpilot.kpi.v1", kpis: [] })).toBe(true);
    expect(estExportKpi({ format: "missionpilot.kpi.v2", kpis: [] })).toBe(false);
    expect(estExportKpi(null)).toBe(false);
    expect(estSerieKpi({ mission_id: "m1", kpis: [] })).toBe(true);
    expect(estSerieKpi({ kpis: [] })).toBe(false);
    expect(estSerieKpi(null)).toBe(false);
  });

  it("nom de fichier ASCII", () => {
    expect(nomFichierExportKpi("Pilotage de la performance — Côte d'Ivoire", "2026-05-15")).toBe(
      "kpi-pilotage-de-la-performance-cote-d-ivoire-2026-05-15.json",
    );
    expect(nomFichierExportKpi(null, "2026-05-15")).toBe("kpi-mission-2026-05-15.json");
    expect(nomFichierExportKpi("€€€", "2026-05-15")).toBe("kpi-mission-2026-05-15.json");
  });
});
