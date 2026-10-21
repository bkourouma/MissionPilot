import { describe, expect, it } from "vitest";
import {
  compterParStatut,
  corpsLiaisonMethode,
  formaterBornesGuichet,
  formaterPrixService,
  intituleParDefaut,
  joindreRestrictions,
  libelleCritere,
  libelleStatut,
  messageListeTronquee,
  messageRapprochementTronque,
  lirePreremplissageService,
  obstacleCreationMission,
  SAISIE_GUICHET_VIDE,
  SAISIE_RAPPROCHEMENT_VIDE,
  saisieDepuisGuichet,
  validerGuichet,
  validerMissionService,
  validerPrix,
  validerRapprochement,
  type Guichet,
  type ServiceCandidat,
} from "./services-candidats";

const CLIENT = "0b6c2d1e-0000-4000-8000-000000000001";
const TYPE = "0b6c2d1e-0000-4000-8000-000000000002";
const VERSION = "0b6c2d1e-0000-4000-8000-000000000003";

function service(surcharge: Partial<ServiceCandidat> = {}): ServiceCandidat {
  return {
    code: "diagnostic_flash",
    libelle: "Diagnostic flash",
    description: null,
    methode: { methode_id: "m", version_id: VERSION, version: 2, libelle: "Flash" },
    coherence: { valide: true, erreurs: [], avertissements: [] },
    type_mission: { id: TYPE, a_valider: true },
    prix: {
      montant: 1_500_000,
      devise: "XOF",
      a_fixer: false,
      personnalise: true,
      commentaire: null,
    },
    a_valider_expert: true,
    ...surcharge,
  };
}

describe("formaterPrixService", () => {
  it("met en forme un montant en unités de la devise", () => {
    expect(formaterPrixService({ ...service().prix })).toBe("1 500 000 FCFA");
    expect(
      formaterPrixService({
        montant: 2500,
        devise: "EUR",
        a_fixer: false,
        personnalise: true,
        commentaire: null,
      }),
    ).toBe("2 500 €");
  });

  it("affiche « Sur devis » sans montant quand le prix n'est pas à fixer", () => {
    expect(
      formaterPrixService({
        montant: null,
        devise: "XOF",
        a_fixer: false,
        personnalise: false,
        commentaire: null,
      }),
    ).toBe("Sur devis");
  });

  it("affiche « À fixer par le cabinet » pour un prix requis non saisi", () => {
    expect(
      formaterPrixService({
        montant: null,
        devise: "XOF",
        a_fixer: true,
        personnalise: false,
        commentaire: null,
      }),
    ).toBe("À fixer par le cabinet");
  });

  it("met en forme les alertes de troncature", () => {
    expect(messageListeTronquee(200)).toBe(
      "La liste est tronquée : seuls les 200 premiers guichets sont affichés.",
    );
    expect(messageRapprochementTronque(500)).toContain("500 premiers guichets");
  });
});

describe("validerPrix", () => {
  it("lit un montant entier et la devise", () => {
    expect(validerPrix("1 500 000", "XOF")).toEqual({
      ok: true,
      charge: { montant: 1_500_000, devise: "XOF", commentaire: null },
    });
  });

  it("accepte un montant vide (sur devis)", () => {
    expect(validerPrix("", "EUR")).toEqual({
      ok: true,
      charge: { montant: null, devise: "EUR", commentaire: null },
    });
  });

  it("refuse décimales, négatif, texte et devise inconnue", () => {
    for (const m of ["12,5", "-3", "abc"]) {
      const r = validerPrix(m, "XOF");
      expect(r.ok).toBe(false);
    }
    const r = validerPrix("100", "GBP");
    expect(r.ok === false && r.erreurs.devise).toBeTruthy();
  });
});

describe("création de mission depuis un service", () => {
  it("signale ce qui bloque la création", () => {
    expect(obstacleCreationMission(service())).toBeNull();
    expect(obstacleCreationMission(service({ type_mission: null }))).toMatch(/pas activé/);
    expect(obstacleCreationMission(service({ methode: null }))).toMatch(/Aucune méthode/);
    expect(
      obstacleCreationMission(
        service({ coherence: { valide: false, erreurs: ["x"], avertissements: [] } }),
      ),
    ).toMatch(/incohérente/);
  });

  it("propose un intitulé avec le client", () => {
    expect(intituleParDefaut(service(), "Société Alpha")).toBe("Diagnostic flash — Société Alpha");
    expect(intituleParDefaut(service(), "  ")).toBe("Diagnostic flash");
  });

  it("construit le corps de POST /api/missions avec le type du service", () => {
    const r = validerMissionService(
      { client_id: CLIENT, intitule: " Flash Alpha ", date_debut: "2026-11-02", date_fin: "" },
      service(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge).toMatchObject({
        client_id: CLIENT,
        type_mission_id: TYPE,
        intitule: "Flash Alpha",
        date_debut: "2026-11-02",
        date_fin: null,
        devise: "XOF",
      });
    }
  });

  it("reprend la devise du prix du service", () => {
    const r = validerMissionService(
      { client_id: CLIENT, intitule: "BP", date_debut: "", date_fin: "" },
      service({
        prix: {
          montant: null,
          devise: "EUR",
          a_fixer: true,
          personnalise: false,
          commentaire: null,
        },
      }),
    );
    expect(r.ok && r.charge.devise).toBe("EUR");
  });

  it("refuse client absent, intitulé vide et dates inversées", () => {
    const r = validerMissionService(
      { client_id: "", intitule: "", date_debut: "2026-11-10", date_fin: "2026-11-02" },
      service(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.client_id).toBeTruthy();
      expect(r.erreurs.intitule).toBeTruthy();
      expect(r.erreurs.date_fin).toBeTruthy();
    }
  });

  it("lie la version publiée avec un contexte vide", () => {
    expect(corpsLiaisonMethode(service())).toEqual({ version_id: VERSION, contexte: {} });
    expect(corpsLiaisonMethode(service({ methode: null }))).toBeNull();
  });
});

describe("validerGuichet", () => {
  const base = { ...SAISIE_GUICHET_VIDE, nom: " Banque Alpha ", type: "banque" };

  it("construit un corps complet avec listes et bornes", () => {
    const r = validerGuichet({
      ...base,
      pays: "CI, SN; CI",
      objets: ["bfr"],
      devises: ["XOF"],
      montant_min: "5 000 000",
      montant_max: "50000000",
      devise_montant: "XOF",
      date_limite: "2027-03-31",
      url: "https://exemple.org/guichet",
    });
    expect(r).toEqual({
      ok: true,
      charge: {
        nom: "Banque Alpha",
        type: "banque",
        pays: ["CI", "SN"],
        secteurs: [],
        filieres: [],
        tailles: [],
        objets: ["bfr"],
        devises: ["XOF"],
        montant_min: 5_000_000,
        montant_max: 50_000_000,
        devise_montant: "XOF",
        date_limite: "2027-03-31",
        description: null,
        url: "https://exemple.org/guichet",
        actif: true,
      },
    });
  });

  it("exige nom, type, devise des bornes et bornes cohérentes", () => {
    const vide = validerGuichet(SAISIE_GUICHET_VIDE);
    expect(vide.ok === false && Object.keys(vide.erreurs).sort()).toEqual(["nom", "type"]);
    const sansDevise = validerGuichet({ ...base, montant_min: "100" });
    expect(sansDevise.ok === false && sansDevise.erreurs.devise_montant).toBeTruthy();
    const inverse = validerGuichet({
      ...base,
      montant_min: "10",
      montant_max: "5",
      devise_montant: "EUR",
    });
    expect(inverse.ok === false && inverse.erreurs.montant_min).toBeTruthy();
  });

  it("refuse une adresse non http(s)", () => {
    for (const url of ["javascript:alert(1)", "pas une adresse"]) {
      const r = validerGuichet({ ...base, url });
      expect(r.ok === false && r.erreurs.url).toBeTruthy();
    }
  });

  it("relit un guichet existant dans le formulaire", () => {
    const g: Guichet = {
      id: CLIENT,
      nom: "Fonds Beta",
      type: "fonds_investissement",
      pays: ["CI", "SN"],
      secteurs: [],
      filieres: [],
      tailles: [],
      objets: ["croissance"],
      devises: [],
      montant_min: null,
      montant_max: 1000,
      devise_montant: "USD",
      date_limite: null,
      description: null,
      url: null,
      actif: false,
      a_valider: true,
    };
    const s = saisieDepuisGuichet(g);
    expect(s).toMatchObject({ pays: "CI, SN", montant_min: "", montant_max: "1000", actif: false });
    expect(validerGuichet(s).ok).toBe(true);
  });
});

describe("validerGuichet : bornes alignées sur la base", () => {
  const base = { ...SAISIE_GUICHET_VIDE, nom: "Banque Alpha", type: "banque" };
  const erreur = (surcharge: Partial<typeof base>, champ: string) => {
    const r = validerGuichet({ ...base, ...surcharge });
    return r.ok === false ? (r.erreurs as Record<string, string | undefined>)[champ] : undefined;
  };
  const noms = (n: number, long = 2) =>
    Array.from({ length: n }, (_, i) => String(i).padStart(long, "0")).join(", ");

  it("limite pays, secteurs, filières et tailles en entrées", () => {
    expect(erreur({ pays: noms(61) }, "pays")).toBeTruthy();
    expect(erreur({ pays: noms(60) }, "pays")).toBeUndefined();
    expect(erreur({ secteurs: noms(51) }, "secteurs")).toBeTruthy();
    expect(erreur({ filieres: noms(51) }, "filieres")).toBeTruthy();
    expect(erreur({ tailles: noms(11) }, "tailles")).toBeTruthy();
  });

  it("limite la longueur totale des listes (valeurs jointes par une virgule)", () => {
    const long = (n: number) => Array.from({ length: n }, (_, i) => `p${i}${"x".repeat(18)}`);
    // 60 entrées de 21 à 22 caractères : plus de 600 caractères au total.
    expect(erreur({ pays: long(40).join(",") }, "pays")).toBeTruthy();
    expect(erreur({ pays: long(20).join(",") }, "pays")).toBeUndefined();
    const dixTailles = Array.from({ length: 10 }, (_, i) => `t${i}${"y".repeat(19)}`).join(",");
    expect(erreur({ tailles: dixTailles }, "tailles")).toBeTruthy();
  });

  it("limite objets (10) et devises (4), sans doublon", () => {
    expect(erreur({ devises: ["XOF", "XAF", "EUR", "USD", "GBP"] }, "devises")).toBeTruthy();
    expect(erreur({ devises: ["XOF", "XOF", "EUR"] }, "devises")).toBeUndefined();
    const r = validerGuichet({ ...base, objets: ["bfr", "bfr"] });
    expect(r.ok && r.charge.objets).toEqual(["bfr"]);
  });

  it("refuse un nom avec caractère de contrôle", () => {
    expect(erreur({ nom: "BanqueAlpha" }, "nom")).toBeTruthy();
    expect(erreur({ nom: "Banque Alpha" }, "nom")).toBeUndefined();
  });

  it("exige une adresse http(s)://… sans espace", () => {
    expect(erreur({ url: "https://exemple.org/a b" }, "url")).toBeTruthy();
    expect(erreur({ url: "http:exemple.org" }, "url")).toBeTruthy();
    expect(erreur({ url: "http://exemple.org/x" }, "url")).toBeUndefined();
  });
});

describe("validerPrix : mention", () => {
  it("transmet la mention, ou null si vide", () => {
    expect(validerPrix("100", "XOF", " DÉMONSTRATION ")).toEqual({
      ok: true,
      charge: { montant: 100, devise: "XOF", commentaire: "DÉMONSTRATION" },
    });
    expect(validerPrix("", "XOF")).toEqual({
      ok: true,
      charge: { montant: null, devise: "XOF", commentaire: null },
    });
  });

  it("refuse une mention de plus de 200 caractères", () => {
    const r = validerPrix("100", "XOF", "x".repeat(201));
    expect(r.ok === false && r.erreurs.commentaire).toBeTruthy();
  });
});

describe("affichage des guichets", () => {
  it("formate les bornes", () => {
    expect(
      formaterBornesGuichet({ montant_min: 1000, montant_max: 5000, devise_montant: "EUR" }),
    ).toBe("1 000 – 5 000 €");
    expect(
      formaterBornesGuichet({ montant_min: 1000, montant_max: null, devise_montant: "XOF" }),
    ).toBe("À partir de 1 000 FCFA");
    expect(
      formaterBornesGuichet({ montant_min: null, montant_max: null, devise_montant: null }),
    ).toBe("Non borné");
  });

  it("dit « aucune restriction » pour une liste vide", () => {
    expect(joindreRestrictions([])).toBe("Aucune restriction");
    expect(joindreRestrictions(["CI", "SN"])).toBe("CI, SN");
  });
});

describe("rapprochement", () => {
  it("n'envoie que les surcharges renseignées", () => {
    const r = validerRapprochement({
      ...SAISIE_RAPPROCHEMENT_VIDE,
      client_id: CLIENT,
      pays: " CI ",
      filieres: "cacao, café",
      objet: "bfr",
      montant: "20 000 000",
      devise: "XOF",
    });
    expect(r).toEqual({
      ok: true,
      charge: {
        client_id: CLIENT,
        profil: {
          pays: "CI",
          filieres: ["cacao", "café"],
          objet: "bfr",
          montant: 20_000_000,
          devise: "XOF",
        },
      },
    });
  });

  it("accepte un client seul, sans profil", () => {
    expect(validerRapprochement({ ...SAISIE_RAPPROCHEMENT_VIDE, client_id: CLIENT })).toEqual({
      ok: true,
      charge: { client_id: CLIENT },
    });
  });

  it("exige un client ou un critère, et la devise d'un montant", () => {
    const vide = validerRapprochement(SAISIE_RAPPROCHEMENT_VIDE);
    expect(vide.ok === false && vide.erreurs.client_id).toBeTruthy();
    const sansDevise = validerRapprochement({ ...SAISIE_RAPPROCHEMENT_VIDE, montant: "100" });
    expect(sansDevise.ok === false && sansDevise.erreurs.devise).toBeTruthy();
  });
});

describe("libellés et décompte", () => {
  it("traduit les statuts et critères", () => {
    expect(libelleStatut("compatible")).toBe("Compatible");
    expect(libelleStatut("partiel")).toBe("Partiel");
    expect(libelleStatut("exclu")).toBe("Exclu");
    expect(libelleCritere("filiere")).toBe("Filière");
    expect(libelleCritere("inconnu_x")).toBe("inconnu_x");
  });

  it("compte les résultats par statut", () => {
    expect(
      compterParStatut([{ statut: "compatible" }, { statut: "exclu" }, { statut: "compatible" }]),
    ).toEqual({ compatible: 2, partiel: 0, exclu: 1 });
  });
});

describe("lirePreremplissageService", () => {
  const id = "3f2b8a52-6c1d-4e0a-9d57-1a2b3c4d5e6f";
  it("lit un service connu et un client valide", () => {
    expect(
      lirePreremplissageService({ service: "diagnostic_flash", client: id.toUpperCase() }),
    ).toEqual({
      service: "diagnostic_flash",
      client: id,
    });
    expect(lirePreremplissageService({ service: "business_plan_bancable" })).toEqual({
      service: "business_plan_bancable",
      client: null,
    });
  });
  it("ignore les valeurs absentes, invalides ou répétées", () => {
    expect(lirePreremplissageService({})).toEqual({ service: null, client: null });
    expect(lirePreremplissageService({ service: "inconnu", client: "pas-un-uuid" })).toEqual({
      service: null,
      client: null,
    });
    expect(lirePreremplissageService({ service: ["diagnostic_flash"], client: [id] })).toEqual({
      service: null,
      client: null,
    });
  });
});
