import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  actionsFacture,
  designationFacture,
  factureDetailleeVisible,
  factureVisible,
  filtresActifs,
  hrefFactures,
  lireFiltresFactures,
  lireRemise,
  messageFacture,
  requeteFactures,
  validerCreationFacture,
  validerEnTete,
  validerLigne,
  validerMotif,
  type ContexteFacture,
  type Facture,
  type FactureDetaillee,
} from "./factures";

const MOI = "11111111-1111-4111-8111-111111111111";
const AUTRE = "22222222-2222-4222-8222-222222222222";
const UUID = "33333333-3333-4333-8333-333333333333";

const base: Facture = {
  id: "f1",
  nature: "facture",
  facture_origine_id: null,
  mission_id: "m1",
  mission_intitule: "Audit",
  client_id: "c1",
  client_raison_sociale: "Client",
  devise: "XOF",
  statut: "brouillon",
  objet: null,
  motif: null,
  numero: null,
  date_emission: null,
  date_echeance: null,
  delai_paiement_jours: 30,
  remise_globale_type: null,
  remise_globale_valeur: null,
  retenue_active: false,
  retenue_taux: 0,
  retenue_base: "HT",
  retenue_libelle: "Retenue",
  total_brut: 1000,
  total_remises: 0,
  total_ht: 1000,
  total_tva: 180,
  total_ttc: 1180,
  total_retenues: 0,
  net_a_payer: 1180,
  tva: [{ taux: 18, base: 1000, montant: 180 }],
  retenues: [],
  role_approbateur: null,
  motif_rejet: null,
  soumise_par: null,
  soumise_le: null,
  approuvee_par: null,
  approuvee_le: null,
  emise_par: null,
  emise_le: null,
  envoyee_le: null,
  annulee_le: null,
  annulee_par_avoir_id: null,
  cree_par: AUTRE,
  cree_le: "",
  modifie_le: "",
};

const ctx = (roles: ContexteFacture["roles"], directeurId: string | null = null) => ({
  roles,
  utilisateurId: MOI,
  directeurId,
});

describe("actionsFacture", () => {
  it("laisse le gestionnaire préparer, soumettre et supprimer un brouillon", () => {
    const a = actionsFacture(base, ctx(["gestionnaire"]));
    expect(a).toMatchObject({ modifier: true, soumettre: true, supprimer: true, approuver: false });
    expect(a.raisonRefusApprobation).toBeNull();
  });

  it("ne donne au chef de mission que la lecture", () => {
    for (const statut of ["brouillon", "a_approuver", "approuvee", "emise"] as const) {
      const a = actionsFacture({ ...base, statut }, ctx(["chef_mission"]));
      expect(Object.entries(a).filter(([k, v]) => k !== "raisonRefusApprobation" && v)).toEqual([]);
    }
  });

  it("n'autorise pas la modification d'un avoir en brouillon, mais sa soumission", () => {
    const a = actionsFacture({ ...base, nature: "avoir" }, ctx(["gestionnaire"]));
    expect(a.modifier).toBe(false);
    expect(a.soumettre).toBe(true);
  });

  it("fait approuver par le directeur désigné quand le palier le permet", () => {
    const f = {
      ...base,
      statut: "a_approuver" as const,
      role_approbateur: "directeur_mission" as const,
    };
    expect(actionsFacture(f, ctx(["directeur_mission"], MOI)).approuver).toBe(true);
    const autre = actionsFacture(f, ctx(["directeur_mission"], AUTRE));
    expect(autre.approuver).toBe(false);
    expect(autre.rejeter).toBe(false);
    expect(autre.raisonRefusApprobation).toMatch(/directeur de la mission ou un associé/);
  });

  it("exige un associé au palier le plus haut", () => {
    const f = { ...base, statut: "a_approuver" as const, role_approbateur: "associe" as const };
    const d = actionsFacture(f, ctx(["directeur_mission"], MOI));
    expect(d.approuver).toBe(false);
    expect(d.rejeter).toBe(true);
    expect(d.raisonRefusApprobation).toMatch(/un associé/);
    expect(actionsFacture(f, ctx(["associe"])).approuver).toBe(true);
  });

  it("n'approuve jamais sa propre facture, sauf associé", () => {
    const f = {
      ...base,
      statut: "a_approuver" as const,
      role_approbateur: "chef_mission" as const,
      soumise_par: MOI,
    };
    const d = actionsFacture(f, ctx(["directeur_mission"], MOI));
    expect(d.approuver).toBe(false);
    expect(d.raisonRefusApprobation).toMatch(/préparé ou soumis/);
    expect(actionsFacture({ ...f, cree_par: MOI }, ctx(["associe"])).approuver).toBe(true);
  });

  it("refuse l'approbation à qui a modifié le brouillon", () => {
    const f = {
      ...base,
      statut: "a_approuver" as const,
      role_approbateur: "chef_mission" as const,
      modifie_par: [MOI],
    };
    expect(actionsFacture(f, ctx(["directeur_mission"], MOI)).approuver).toBe(false);
    expect(
      actionsFacture({ ...f, modifie_par: null }, ctx(["directeur_mission"], MOI)).approuver,
    ).toBe(true);
  });

  it("refuse l'approbation sans facture.valider (gestionnaire)", () => {
    const f = { ...base, statut: "a_approuver" as const };
    const g = actionsFacture(f, ctx(["gestionnaire"]));
    expect(g.approuver).toBe(false);
    expect(g.rejeter).toBe(false);
    expect(g.raisonRefusApprobation).toMatch(/ne permet pas/);
  });

  it("émet une facture approuvée, puis propose avoir et envoi", () => {
    expect(actionsFacture({ ...base, statut: "approuvee" }, ctx(["gestionnaire"])).emettre).toBe(
      true,
    );
    const emise = actionsFacture({ ...base, statut: "emise" }, ctx(["gestionnaire"]));
    expect(emise).toMatchObject({ emettre: false, avoir: true, marquerEnvoyee: true });
    const envoyee = actionsFacture(
      { ...base, statut: "emise", envoyee_le: "2026-10-06T10:00:00Z" },
      ctx(["gestionnaire"]),
    );
    expect(envoyee.marquerEnvoyee).toBe(false);
    expect(
      actionsFacture({ ...base, statut: "emise", nature: "avoir" }, ctx(["gestionnaire"])).avoir,
    ).toBe(false);
    expect(
      actionsFacture({ ...base, statut: "annulee", annulee_par_avoir_id: "a" }, ctx(["associe"]))
        .avoir,
    ).toBe(false);
  });
});

describe("masquage et désignation", () => {
  it("ne garde que les champs de facturation connus", () => {
    const fuite = { ...base, cout_interne: 999, marge: 1 } as unknown as Facture;
    const v = factureVisible(fuite) as unknown as Record<string, unknown>;
    expect(v.cout_interne).toBeUndefined();
    expect(v.marge).toBeUndefined();
    expect(v.net_a_payer).toBe(1180);
  });

  it("filtre aussi les lignes", () => {
    const d = factureDetailleeVisible({
      ...base,
      lignes: [{ id: "l", cout: 5, montant_ht: 1000 } as never],
    } as FactureDetaillee);
    expect(d.lignes[0]).not.toHaveProperty("cout");
    expect(d.lignes[0]?.montant_ht).toBe(1000);
  });

  it("désigne une facture par son numéro définitif", () => {
    expect(designationFacture({ ...base, numero: "FA-2026-00001" })).toBe("Facture FA-2026-00001");
    expect(designationFacture(base)).toBe("Facture (sans numéro)");
    expect(designationFacture({ ...base, nature: "avoir" })).toBe("Avoir (sans numéro)");
  });
});

describe("filtres de la liste", () => {
  it("lit les filtres connus et ignore le reste", () => {
    const f = lireFiltresFactures({
      statut: "emise",
      nature: "x",
      client_id: UUID,
      mission_id: "pas-un-uuid",
      curseur: "abc_DEF-1",
    });
    expect(f).toEqual({
      statut: "emise",
      nature: "",
      client_id: UUID,
      mission_id: "",
      curseur: "abc_DEF-1",
    });
    expect(lireFiltresFactures({ curseur: "a b" }).curseur).toBe("");
    expect(filtresActifs(f)).toBe(true);
    expect(filtresActifs(lireFiltresFactures({}))).toBe(false);
  });

  it("construit la requête de l'API et les liens de page", () => {
    const f = lireFiltresFactures({ statut: "brouillon", curseur: "c1" });
    expect(requeteFactures(f)).toBe("statut=brouillon&curseur=c1&limite=30");
    expect(hrefFactures(f, "c2")).toBe("/facturation?statut=brouillon&curseur=c2");
    expect(hrefFactures(lireFiltresFactures({}))).toBe("/facturation");
  });
});

describe("saisies", () => {
  it("lit une remise en pourcentage ou en montant", () => {
    expect(lireRemise({ type: "", valeur: "" }, "XOF")).toBeNull();
    expect(lireRemise({ type: "pourcentage", valeur: "12,5" }, "XOF")).toEqual({
      type: "pourcentage",
      valeur: 12.5,
    });
    expect(lireRemise({ type: "pourcentage", valeur: "120" }, "XOF")).toBeUndefined();
    expect(lireRemise({ type: "montant", valeur: "1 500,50" }, "EUR")).toEqual({
      type: "montant",
      valeur: 150050,
    });
    expect(lireRemise({ type: "montant", valeur: "10,5" }, "XOF")).toBeUndefined();
  });

  it("valide l'en-tête d'un brouillon", () => {
    expect(
      validerEnTete(
        {
          objet: " Honoraires ",
          remise: { type: "", valeur: "" },
          retenue_active: true,
          delai_paiement_jours: "45",
        },
        "XOF",
      ),
    ).toEqual({
      ok: true,
      charge: {
        objet: "Honoraires",
        remise_globale: null,
        retenue_active: true,
        delai_paiement_jours: 45,
      },
    });
    const r = validerEnTete(
      {
        objet: "",
        remise: { type: "pourcentage", valeur: "x" },
        retenue_active: false,
        delai_paiement_jours: "400",
      },
      "XOF",
    );
    expect(r.ok ? [] : Object.keys(r.erreurs)).toEqual(["remise", "delai_paiement_jours"]);
  });

  it("valide une ligne avec un taux autorisé", () => {
    expect(
      validerLigne(
        { libelle: "Acompte", taux_tva: "18", remise: { type: "", valeur: "" } },
        "XOF",
        [0, 18],
      ),
    ).toEqual({ ok: true, charge: { libelle: "Acompte", taux_tva: 18, remise: null } });
    const r = validerLigne(
      { libelle: "", taux_tva: "9", remise: { type: "", valeur: "" } },
      "XOF",
      [0, 18],
    );
    expect(r.ok ? [] : Object.keys(r.erreurs)).toEqual(["libelle", "taux_tva"]);
  });

  it("valide un motif", () => {
    expect(validerMotif("  ").ok).toBe(false);
    expect(validerMotif("x".repeat(501)).ok).toBe(false);
    expect(validerMotif(" Erreur de client ")).toEqual({
      ok: true,
      charge: { motif: "Erreur de client" },
    });
  });

  it("exige au moins un élément pour créer un brouillon", () => {
    expect(validerCreationFacture({ echeance_ids: [], debours_ids: [], objet: "" }).ok).toBe(false);
    expect(
      validerCreationFacture({ echeance_ids: ["e", "e"], debours_ids: ["d"], objet: "" }),
    ).toEqual({ ok: true, charge: { echeance_ids: ["e"], debours_ids: ["d"], objet: null } });
  });
});

describe("messageFacture", () => {
  it("rend les refus métier actionnables", () => {
    expect(
      messageFacture(new ErreurApi("MENTIONS_INCOMPLETES", "Mentions à compléter : rccm.", 409)),
    ).toMatch(/Paramètres > Facturation/);
    expect(messageFacture(new ErreurApi("APPROBATION_REQUISE", "Par un associé.", 403))).toBe(
      "Par un associé.",
    );
    expect(messageFacture(new ErreurApi("INTERDIT", "x", 403))).toBeNull();
    expect(messageFacture(new Error("x"))).toBeNull();
  });
});
