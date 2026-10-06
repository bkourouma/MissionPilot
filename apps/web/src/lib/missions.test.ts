import { describe, expect, it } from "vitest";
import {
  codeDepuisLibelle,
  droitsMission,
  filtrerParDirecteur,
  hrefMissions,
  lireFiltresMissions,
  naturesSupplementaires,
  requeteMissions,
  SAISIE_MISSION_VIDE,
  validerCreationMission,
  validerDepuisProposition,
  validerDocument,
  validerDuplication,
  validerModele,
  validerModificationMission,
  validerSignature,
  deviseFlottante,
} from "./missions";

const U = "0b6c2d1e-0000-4000-8000-0000000000aa";
const AUTRE = "0b6c2d1e-0000-4000-8000-0000000000bb";
const CLIENT = "0b6c2d1e-0000-4000-8000-000000000001";
const TYPE = "0b6c2d1e-0000-4000-8000-000000000002";

const mission = (
  statut: Parameters<typeof droitsMission>[0]["statut"],
  chef: string | null = null,
) => ({
  statut,
  directeur_id: null,
  chef_id: chef,
});

describe("droits sur une mission", () => {
  const avecDirecteur = (statut: Parameters<typeof mission>[0], directeur: string) => ({
    statut,
    directeur_id: directeur,
    chef_id: null,
  });

  it("réserve la signature au directeur désigné de la mission ou à un associé", () => {
    const d = (dir: string, roles: Parameters<typeof droitsMission>[1]) =>
      droitsMission(avecDirecteur("proposition", dir), roles, U).signer;
    expect(d(U, ["directeur_mission"])).toBe(true);
    expect(d(AUTRE, ["directeur_mission"])).toBe(false);
    expect(d(AUTRE, ["associe"])).toBe(true);
    expect(droitsMission(mission("en_cours"), ["associe"], U).signer).toBe(false);
  });

  it("ne laisse qu'un associé changer le directeur ; modifier_toutes réaffecte le chef", () => {
    const d = droitsMission(mission("proposition"), ["directeur_mission"], U);
    expect(d).toMatchObject({ modifier: true, reaffecter: true, designerDirecteur: false });
    expect(droitsMission(mission("proposition"), ["associe"], U).designerDirecteur).toBe(true);
  });

  it("limite le chef de mission aux missions dont il est chef, sans signature", () => {
    expect(droitsMission(mission("proposition", U), ["chef_mission"], U)).toMatchObject({
      modifier: true,
      planifier: true,
      budgeterJours: true,
      signer: false,
      reaffecter: false,
    });
    expect(droitsMission(mission("en_cours", AUTRE), ["chef_mission"], U)).toMatchObject({
      modifier: false,
      planifier: false,
      transitions: [],
    });
  });

  it("ne donne pas la modification à qui lit seulement toutes les missions", () => {
    expect(droitsMission(mission("en_cours"), ["ressources"], U)).toMatchObject({
      responsable: false,
      planifier: false,
    });
    expect(droitsMission(mission("en_cours"), ["gestionnaire"], U).responsable).toBe(false);
  });

  it("laisse le consultant déposer ses livrables, pas la lettre de mission", () => {
    const d = droitsMission(mission("en_cours", AUTRE), ["consultant"], U);
    expect(d).toMatchObject({ modifier: false, planifier: false, lireBudget: true });
    expect(d.dupliquer).toBe(false);
    expect(d.typesDocument).toEqual(["livrable", "autre"]);
    const chef = droitsMission(mission("en_cours", U), ["chef_mission"], U);
    expect(chef.typesDocument).toEqual(["proposition", "livrable", "autre"]);
    const associe = droitsMission(mission("en_cours"), ["associe"], U);
    expect(associe.typesDocument).toContain("lettre_de_mission");
  });

  it("propose les transitions simples selon le statut", () => {
    const t = (s: Parameters<typeof mission>[0]) =>
      droitsMission(mission(s), ["associe"], U).transitions.map((x) => x.cible);
    expect(t("signee")).toEqual(["en_cours"]);
    expect(t("en_cours")).toEqual(["a_cloturer"]);
    expect(t("a_cloturer")).toEqual(["en_cours"]);
    expect(t("proposition")).toEqual([]);
  });

  it("n'autorise la clôture qu'« à clôturer » et plus rien ensuite", () => {
    expect(droitsMission(mission("a_cloturer"), ["associe"], U).cloturer).toBe(true);
    const close = droitsMission(mission("cloturee"), ["associe"], U);
    expect(close).toMatchObject({ modifier: false, planifier: false, cloturer: false });
    expect(close.deposerDocument).toBe(false);
    expect(close.typesDocument).toEqual([]);
    expect(close.dupliquer).toBe(true);
  });

  it("n'ouvre l'enregistrement en modèle qu'avec catalogue.ecrire", () => {
    expect(droitsMission(mission("en_cours"), ["expert_metier"], U).enregistrerModele).toBe(true);
    const d = droitsMission(mission("en_cours"), ["directeur_mission"], U);
    expect(d.enregistrerModele).toBe(false);
  });
});

describe("filtres de la liste", () => {
  it("lit les filtres et ignore les valeurs invalides", () => {
    expect(
      lireFiltresMissions({
        statut: "en_cours",
        client_id: CLIENT,
        directeur_id: "x",
        q: " audit ",
      }),
    ).toEqual({
      statut: "en_cours",
      client_id: CLIENT,
      directeur_id: "",
      q: "audit",
    });
  });

  it("n'envoie pas le directeur à l'API et filtre dans la page", () => {
    const f = { statut: "" as const, client_id: "", directeur_id: U, q: "" };
    expect(requeteMissions(f)).toBe("");
    expect(hrefMissions(f)).toBe(`/missions?directeur_id=${U}`);
    expect(filtrerParDirecteur([{ directeur_id: U }, { directeur_id: AUTRE }], U)).toHaveLength(1);
    expect(filtrerParDirecteur([{ directeur_id: U }], "")).toHaveLength(1);
  });
});

describe("formulaire mission", () => {
  const base = { ...SAISIE_MISSION_VIDE, intitule: "Audit", client_id: CLIENT };

  it("exige le mode de facturation sans type, pas avec un type", () => {
    const sans = validerCreationMission(base);
    expect(sans.ok).toBe(false);
    if (!sans.ok) expect(sans.erreurs.mode_facturation).toMatch(/mode de facturation/);
    const avec = validerCreationMission({ ...base, type_mission_id: TYPE });
    expect(avec.ok).toBe(true);
    if (avec.ok) expect("mode_facturation" in avec.charge).toBe(false);
  });

  it("refuse une fin avant le début", () => {
    const r = validerCreationMission({
      ...base,
      mode_facturation: "forfait",
      date_debut: "2027-02-01",
      date_fin: "2027-01-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.date_fin).toMatch(/précède/);
  });

  it("n'envoie ni devise ni mode après signature, ni responsables sans droit", () => {
    const r = validerModificationMission(
      { ...base, mode_facturation: "regie", directeur_id: U },
      { signee: true, reaffecter: false, designerDirecteur: false },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("devise" in r.charge).toBe(false);
      expect("mode_facturation" in r.charge).toBe(false);
      expect("directeur_id" in r.charge).toBe(false);
      expect("chef_id" in r.charge).toBe(false);
    }
    const r2 = validerModificationMission(
      { ...base, mode_facturation: "regie", directeur_id: U },
      { signee: false, reaffecter: true, designerDirecteur: true },
    );
    expect(r2.ok && r2.charge).toMatchObject({ devise: "XOF", directeur_id: U, chef_id: null });
  });

  it("ne transmet que les champs renseignés depuis une proposition", () => {
    expect(
      validerDepuisProposition({
        intitule: "",
        directeur_id: U,
        chef_id: "",
        date_debut: "",
        date_fin: "",
      }),
    ).toEqual({ ok: true, charge: { directeur_id: U } });
  });
});

describe("signature de la lettre de mission", () => {
  const sansLigne = (date: string, taux: string) => ({
    date_signature: date,
    taux_change: taux,
    lignes: [],
  });

  it("n'envoie aucun taux pour une parité fixe (FCFA, euro)", () => {
    expect(validerSignature(sansLigne("2026-10-06", "650"), "EUR", ["debours"])).toEqual({
      ok: true,
      charge: { date_signature: "2026-10-06", lignes_supplementaires: [] },
    });
  });

  it("exige un taux borné pour le dollar et convertit les débours", () => {
    expect(deviseFlottante("USD")).toBe(true);
    expect(deviseFlottante("XOF")).toBe(false);
    expect(validerSignature(sansLigne("2026-10-06", ""), "USD", []).ok).toBe(false);
    const r = validerSignature(
      {
        date_signature: "2026-10-06",
        taux_change: "605,25",
        lignes: [
          {
            nature: "debours",
            libelle: "Billets d'avion",
            montant: "1 200,50",
            refacturable: true,
          },
        ],
      },
      "USD",
      ["debours"],
    );
    expect(r.ok && r.charge).toEqual({
      date_signature: "2026-10-06",
      taux_change: 605.25,
      lignes_supplementaires: [
        { nature: "debours", libelle: "Billets d'avion", montant: 120_050, refacturable: true },
      ],
    });
  });

  it("refuse une ligne de sous-traitance sans finance.lire", () => {
    expect(naturesSupplementaires(["directeur_mission"])).toEqual(["debours"]);
    expect(naturesSupplementaires(["associe"])).toEqual(["debours", "sous_traitance"]);
    expect(naturesSupplementaires(["consultant"])).toEqual([]);
    const r = validerSignature(
      {
        date_signature: "2026-10-06",
        taux_change: "",
        lignes: [
          { nature: "sous_traitance", libelle: "Expert", montant: "100", refacturable: false },
        ],
      },
      "XOF",
      naturesSupplementaires(["directeur_mission"]),
    );
    expect(r.ok).toBe(false);
  });

  it("exige la date et un taux positif", () => {
    const r = validerSignature(sansLigne("", "-2"), "USD", []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["date_signature", "taux_change"]);
  });
});

describe("duplication, modèle et documents", () => {
  it("valide la duplication", () => {
    expect(validerDuplication(" Copie ", "")).toEqual({ ok: true, charge: { intitule: "Copie" } });
    expect(validerDuplication("", "").ok).toBe(false);
  });

  it("propose un code de modèle valide", () => {
    expect(codeDepuisLibelle("Audit des agences — Côte d'Ivoire")).toBe(
      "audit_des_agences_cote_d_ivoire",
    );
    expect(codeDepuisLibelle("!!!")).toBe("modele");
    expect(validerModele(codeDepuisLibelle("Audit"), "Audit").ok).toBe(true);
    expect(validerModele("Audit", "").ok).toBe(false);
  });

  it("valide un document", () => {
    expect(validerDocument({ type: "livrable", nom: " Rapport ", chemin_stockage: "" })).toEqual({
      ok: true,
      charge: { type: "livrable", nom: "Rapport", chemin_stockage: null },
    });
    expect(validerDocument({ type: "x", nom: "", chemin_stockage: "" }).ok).toBe(false);
    for (const chemin of ["../secret", "/etc/passwd", "https://exemple.com/a", "a\\b"]) {
      expect(validerDocument({ type: "livrable", nom: "R", chemin_stockage: chemin }).ok).toBe(
        false,
      );
    }
    const ok = validerDocument({ type: "livrable", nom: "R", chemin_stockage: "livrables/r.pdf" });
    expect(ok.ok).toBe(true);
    const lettre = { type: "lettre_de_mission", nom: "L", chemin_stockage: "" };
    expect(validerDocument(lettre, ["livrable"]).ok).toBe(false);
  });
});
