import { describe, expect, it, vi } from "vitest";
import { ErreurApi } from "./api";
import {
  AVERTISSEMENT_EFFICACITE,
  cheminContributions,
  cheminDossierRevue,
  enRetard,
  libelleMotifQualite,
  libelleNiveauQualite,
  messagePilotage,
  texteContribution,
  texteEfficaciteDetail,
  texteFavorable,
  texteScoreQualite,
  texteVerdict,
  validerAction,
  validerArbre,
  validerDecision,
  validerNoeud,
  validerRevue,
  validerStatutAction,
  validerStatutDecision,
  validerCompteRendu,
  validerOrdreDuJour,
  avertissementTronque,
  dateEffetExigeCommentaire,
  DELAI_DATE_EFFET_SANS_MOTIF_JOURS,
  nomFichierDossierRevue,
  telechargerDossierRevue,
  type EfficaciteVue,
} from "./kpi-pilotage";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("chemins", () => {
  it("encode les identifiants et les dates", () => {
    expect(cheminContributions(UUID, "2026-03-15", "2026-05-15")).toBe(
      `/api/kpi/arbres/${UUID}/contributions?avant=2026-03-15&apres=2026-05-15`,
    );
    expect(cheminDossierRevue(UUID, "pptx")).toBe(`/api/kpi/revues/${UUID}/dossier?format=pptx`);
  });
});

describe("mise en forme", () => {
  it("score et niveau de qualité, motifs", () => {
    expect(texteScoreQualite(79)).toBe("79 / 100");
    expect(texteScoreQualite(null)).toBe("—");
    expect(libelleNiveauQualite("moyen")).toBe("Moyenne");
    expect(libelleNiveauQualite(null)).toBe("Non évaluable");
    expect(libelleMotifQualite("MESURE_EN_RETARD")).toBe("Mesure en retard");
    expect(libelleMotifQualite("INCONNU")).toBe("INCONNU");
  });

  it("contribution signée et verdict écrit en toutes lettres", () => {
    expect(texteContribution(400, "kFCFA")).toBe("+400 kFCFA");
    expect(texteContribution(-200)).toBe("-200");
    expect(texteContribution(0)).toBe("0");
    expect(texteContribution(null)).toBe("—");
    expect(texteFavorable(true)).toBe("Favorable");
    expect(texteFavorable(false)).toBe("Défavorable");
    expect(texteFavorable(null)).toBe("Sans effet");
    expect(texteVerdict(null)).toMatch(/Pas encore mesurable/);
    expect(texteVerdict({ verdict: "inefficace" })).toMatch(/Sans effet favorable/);
    expect(AVERTISSEMENT_EFFICACITE).toMatch(/corrélation/);
  });

  it("détail d'efficacité : chiffres du moteur ou périodes manquantes", () => {
    const base: EfficaciteVue = {
      date_effet: "2026-03-01",
      verdict: "inefficace",
      periode_effet: null,
      moyenne_avant: 950,
      moyenne_apres: 750,
      variation: -200,
      variation_relative: -0.2105,
      variation_orientee: -200,
      nombre_avant: 2,
      nombre_apres: 2,
      manquant_avant: 0,
      manquant_apres: 0,
      periodes_avant: [],
      periodes_apres: [],
    };
    const t = texteEfficaciteDetail(base, "kFCFA");
    expect(t).toContain("variation -200");
    expect(t).toContain("21,1");
    expect(
      texteEfficaciteDetail(
        { ...base, verdict: "indeterminee", manquant_avant: 1, manquant_apres: 2 },
        "",
      ),
    ).toBe(
      "Il manque 1 période(s) avant et 2 période(s) après mesurée(s) et close(s) pour conclure.",
    );
    expect(
      texteEfficaciteDetail({ ...base, verdict: "efficace", variation_relative: null }, ""),
    ).not.toContain("%");
  });

  it("une action n'est en retard que tant qu'elle est ouverte", () => {
    expect(enRetard("2026-04-30", "en_cours", "2026-05-15")).toBe(true);
    expect(enRetard("2026-04-30", "terminee", "2026-05-15")).toBe(false);
    expect(enRetard("2026-05-15", "a_faire", "2026-05-15")).toBe(false);
  });
});

describe("saisies", () => {
  it("arbre", () => {
    expect(validerArbre({ kpi_racine_id: "", libelle: " " })).toEqual({
      ok: false,
      erreurs: {
        kpi_racine_id: "Choisissez le KPI à décomposer.",
        libelle: "Le libellé de l'arbre est obligatoire.",
      },
    });
    expect(validerArbre({ kpi_racine_id: UUID, libelle: " CA " })).toEqual({
      ok: true,
      charge: { kpi_racine_id: UUID, libelle: "CA" },
    });
    expect(validerArbre({ kpi_racine_id: UUID, libelle: "x".repeat(201) }).ok).toBe(false);
  });

  it("nœud : coefficient à la française, rang entier, KPI facultatif", () => {
    const base = {
      parent_id: UUID,
      kpi_id: "",
      libelle: "Coûts",
      relation: "somme" as const,
      coefficient: "-1,5",
      rang: "2",
    };
    expect(validerNoeud(base)).toEqual({
      ok: true,
      charge: {
        parent_id: UUID,
        kpi_id: null,
        libelle: "Coûts",
        relation: "somme",
        coefficient: -1.5,
        rang: 2,
      },
    });
    expect(validerNoeud({ ...base, coefficient: "", rang: "" })).toMatchObject({
      ok: true,
      charge: { coefficient: 1, rang: 0 },
    });
    expect(validerNoeud({ ...base, kpi_id: UUID })).toMatchObject({ charge: { kpi_id: UUID } });
    const r = validerNoeud({
      parent_id: "",
      kpi_id: "",
      libelle: "",
      relation: "produit",
      coefficient: "abc",
      rang: "1,5",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual([
        "coefficient",
        "libelle",
        "parent_id",
        "rang",
      ]);
    }
    expect(validerNoeud({ ...base, coefficient: "1,23456" }).ok).toBe(false);
    expect(validerNoeud({ ...base, coefficient: "5000" }).ok).toBe(false);
  });

  it("action : champs obligatoires, charge sans valeurs vides", () => {
    const s = {
      kpi_id: UUID,
      alerte_id: "",
      titre: " Relancer ",
      description: "",
      responsable_id: UUID,
      echeance: "2026-06-30",
    };
    expect(validerAction(s)).toEqual({
      ok: true,
      charge: { kpi_id: UUID, titre: "Relancer", responsable_id: UUID, echeance: "2026-06-30" },
    });
    expect(validerAction({ ...s, alerte_id: UUID, description: "Détail" })).toMatchObject({
      charge: { alerte_id: UUID, description: "Détail" },
    });
    const r = validerAction({
      ...s,
      kpi_id: "",
      titre: "",
      responsable_id: "",
      echeance: "2026-02-30",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual([
        "echeance",
        "kpi_id",
        "responsable_id",
        "titre",
      ]);
    }
    expect(validerAction({ ...s, echeance: "" }).ok).toBe(false);
    expect(validerAction({ ...s, description: "x".repeat(2001) }).ok).toBe(false);
  });

  it("statut d'action : motif pour l'abandon, date d'effet passée pour la clôture", () => {
    const jour = "2026-05-15";
    const sans = { date_effet: "", motif: "", commentaire: "" };
    expect(validerStatutAction({ statut: "en_cours", ...sans }, jour)).toEqual({
      ok: true,
      charge: { statut: "en_cours" },
    });
    expect(validerStatutAction({ statut: "abandonnee", ...sans, motif: " " }, jour).ok).toBe(false);
    expect(
      validerStatutAction({ statut: "abandonnee", ...sans, motif: "Remplacée" }, jour),
    ).toEqual({ ok: true, charge: { statut: "abandonnee", motif: "Remplacée" } });
    expect(validerStatutAction({ statut: "terminee", ...sans }, jour)).toEqual({
      ok: true,
      charge: { statut: "terminee" },
    });
    // Dans les 31 jours : aucune justification ; au-delà : un commentaire est exigé.
    expect(
      validerStatutAction({ statut: "terminee", ...sans, date_effet: "2026-04-20" }, jour),
    ).toMatchObject({ ok: true, charge: { date_effet: "2026-04-20" } });
    const recul = { statut: "terminee", ...sans, date_effet: "2026-03-01" } as const;
    const refus = validerStatutAction(recul, jour);
    expect(refus).toMatchObject({ ok: false });
    expect(refus.ok ? null : refus.erreurs.commentaire).toMatch(/31 jours/);
    expect(validerStatutAction({ ...recul, commentaire: "  " }, jour).ok).toBe(false);
    expect(validerStatutAction({ ...recul, commentaire: "Déployée en mars" }, jour)).toEqual({
      ok: true,
      charge: { statut: "terminee", date_effet: "2026-03-01", commentaire: "Déployée en mars" },
    });
    expect(
      validerStatutAction({ statut: "terminee", ...sans, date_effet: "2026-06-01" }, jour).ok,
    ).toBe(false);
    expect(
      validerStatutAction({ statut: "terminee", ...sans, date_effet: "pas une date" }, jour).ok,
    ).toBe(false);
    expect(
      validerStatutAction({ statut: "abandonnee", ...sans, motif: "x".repeat(501) }, jour).ok,
    ).toBe(false);
  });

  it("date d'effet : le recul se compte en jours calendaires", () => {
    expect(DELAI_DATE_EFFET_SANS_MOTIF_JOURS).toBe(31);
    expect(dateEffetExigeCommentaire("2026-04-14", "2026-05-15")).toBe(false);
    expect(dateEffetExigeCommentaire("2026-04-13", "2026-05-15")).toBe(true);
    expect(dateEffetExigeCommentaire("2026-05-15", "2026-05-15")).toBe(false);
    expect(dateEffetExigeCommentaire("invalide", "2026-05-15")).toBe(false);
  });

  it("revue et décision", () => {
    expect(
      validerRevue({ titre: "", date_prevue: "", date_reference: "", animateur_id: "" }).ok,
    ).toBe(false);
    expect(
      validerRevue({
        titre: "Revue de mai",
        date_prevue: "2026-05-20",
        date_reference: "2026-05-15",
        animateur_id: UUID,
      }),
    ).toEqual({
      ok: true,
      charge: {
        titre: "Revue de mai",
        date_prevue: "2026-05-20",
        date_reference: "2026-05-15",
        animateur_id: UUID,
      },
    });
    expect(
      validerRevue({ titre: "R", date_prevue: "2026-05-20", date_reference: "", animateur_id: "" }),
    ).toEqual({ ok: true, charge: { titre: "R", date_prevue: "2026-05-20" } });
    expect(
      validerRevue({
        titre: "R",
        date_prevue: "2026-05-20",
        date_reference: "2026-99-99",
        animateur_id: "",
      }).ok,
    ).toBe(false);
    expect(
      validerRevue({
        titre: "x".repeat(201),
        date_prevue: "2026-05-20",
        date_reference: "",
        animateur_id: "",
      }).ok,
    ).toBe(false);
    expect(validerDecision({ libelle: "", kpi_id: "", responsable_id: "", echeance: "" }).ok).toBe(
      false,
    );
    expect(
      validerDecision({
        libelle: "Réviser",
        kpi_id: "",
        responsable_id: UUID,
        echeance: "2026-06-30",
      }),
    ).toEqual({
      ok: true,
      charge: { libelle: "Réviser", responsable_id: UUID, echeance: "2026-06-30" },
    });
    expect(
      validerDecision({ libelle: "R", kpi_id: UUID, responsable_id: "", echeance: "bientôt" }).ok,
    ).toBe(false);
    expect(
      validerDecision({ libelle: "x".repeat(501), kpi_id: "", responsable_id: "", echeance: "" })
        .ok,
    ).toBe(false);
    // « Exécutée » se justifie : un commentaire (ce qui a été fait) est obligatoire.
    expect(validerStatutDecision("executee", "").ok).toBe(false);
    expect(validerStatutDecision("executee", "   ").ok).toBe(false);
    expect(validerStatutDecision("executee", "x".repeat(1001)).ok).toBe(false);
    expect(validerStatutDecision("executee", "Courrier envoyé")).toEqual({
      ok: true,
      charge: { statut: "executee", commentaire: "Courrier envoyé" },
    });
    expect(validerStatutDecision("en_cours", "")).toEqual({
      ok: true,
      charge: { statut: "en_cours" },
    });
    expect(validerStatutDecision("abandonnee", "").ok).toBe(false);
    expect(validerStatutDecision("abandonnee", "x".repeat(501)).ok).toBe(false);
    expect(validerStatutDecision("abandonnee", "Hors périmètre")).toEqual({
      ok: true,
      charge: { statut: "abandonnee", motif: "Hors périmètre" },
    });
  });
});

describe("revue : compte rendu, ordre du jour saisi, dossier", () => {
  it("compte rendu : facultatif, 8 000 caractères au plus, retours à la ligne conservés", () => {
    expect(validerCompteRendu("")).toEqual({ ok: true, charge: {} });
    expect(validerCompteRendu("  Point 1\nPoint 2  ")).toEqual({
      ok: true,
      charge: { compte_rendu: "Point 1\nPoint 2" },
    });
    expect(validerCompteRendu("x".repeat(8001)).ok).toBe(false);
  });

  it("ordre du jour : une ligne par point, durée par défaut 10 minutes", () => {
    expect(validerOrdreDuJour("Ouverture | 5\r\nTour de table\n\n  Décisions | 20  ")).toEqual({
      ok: true,
      charge: {
        points: [
          { libelle: "Ouverture", duree_minutes: 5 },
          { libelle: "Tour de table", duree_minutes: 10 },
          { libelle: "Décisions", duree_minutes: 20 },
        ],
      },
    });
    expect(validerOrdreDuJour(" \n ").ok).toBe(false);
    expect(validerOrdreDuJour("Point | 0").ok).toBe(false);
    expect(validerOrdreDuJour("Point | 241").ok).toBe(false);
    expect(validerOrdreDuJour("Point | 1.5").ok).toBe(false);
    expect(validerOrdreDuJour("Point | dix").ok).toBe(false);
    expect(validerOrdreDuJour(" | 10").ok).toBe(false);
    expect(validerOrdreDuJour("x".repeat(301)).ok).toBe(false);
    const quarante = Array.from({ length: 40 }, (_, i) => `Point ${i}`).join("\n");
    expect(validerOrdreDuJour(quarante).ok).toBe(true);
    expect(validerOrdreDuJour(`${quarante}\nUn de trop`).ok).toBe(false);
    const refus = validerOrdreDuJour("Bon\nMauvais | 0");
    expect(refus.ok ? null : refus.erreurs.points).toMatch(/Ligne 2/);
  });

  it("mention d'une liste plafonnée et nom du fichier du dossier", () => {
    expect(avertissementTronque(false, "arbres")).toBeNull();
    expect(avertissementTronque(undefined, "arbres")).toBeNull();
    expect(avertissementTronque(true, "décisions")).toMatch(/500 premières/);
    expect(nomFichierDossierRevue(3, "docx")).toBe("revue-kpi-3.docx");
    expect(nomFichierDossierRevue(12, "pptx")).toBe("revue-kpi-12.pptx");
  });

  it("téléchargement du dossier : un refus de l'API devient une erreur française, jamais un JSON brut", async () => {
    const enveloppe = {
      erreur: { code: "TROP_DE_DOSSIERS_REVUE", message: "Au plus 10 dossiers par 10 minutes." },
    };
    const fetchSimule = vi.fn(
      async () =>
        new Response(JSON.stringify(enveloppe), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSimule);
    try {
      const e = await telechargerDossierRevue(UUID, "docx").catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErreurApi);
      expect(e).toMatchObject({ code: "TROP_DE_DOSSIERS_REVUE", statut: 429 });
      expect(messagePilotage(e)).toMatch(/Trop de dossiers/);
      expect(fetchSimule).toHaveBeenCalledWith(
        `/api/kpi/revues/${UUID}/dossier?format=docx`,
        expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
      );
      // Succès : le contenu est rendu tel quel.
      fetchSimule.mockResolvedValueOnce(new Response("PK", { status: 200 }));
      expect(await (await telechargerDossierRevue(UUID, "pptx")).text()).toBe("PK");
      // Réseau coupé : message de connexion, pas une exception brute.
      fetchSimule.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(telechargerDossierRevue(UUID, "pdf")).rejects.toMatchObject({
        code: "RESEAU_INDISPONIBLE",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("messages", () => {
  it("message propre pour les refus du pilotage, sinon celui des KPI", () => {
    expect(messagePilotage(new ErreurApi("KPI_REVUE_OUVERTE", "x", 409))).toMatch(/clôturer/);
    expect(messagePilotage(new ErreurApi("RENDU_PDF_INDISPONIBLE", "x", 503))).toMatch(
      /Word ou PowerPoint/,
    );
    expect(messagePilotage(new ErreurApi("CONFLIT", "Mission clôturée.", 409))).toBe(
      "Mission clôturée.",
    );
  });
});
