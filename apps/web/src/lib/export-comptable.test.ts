import { afterEach, describe, expect, it, vi } from "vitest";
import { ErreurApi } from "./api";
import {
  messageExport,
  nomFichierExport,
  telechargerExport,
  validerExport,
  validerPlan,
  type PlanComptable,
  type SaisieExport,
} from "./export-comptable";

const plan: PlanComptable = {
  comptes: [
    { cle: "clients", compte: "411", libelle: "Clients", valeur_de_depart: "411" },
    { cle: "banque", compte: "521", libelle: "Banques", valeur_de_depart: "521" },
  ],
  journaux: [{ cle: "ventes", code: "VE", valeur_de_depart: "VE" }],
  valeurs_validees: false,
  referentiel: "SYSCOHADA révisé",
};

describe("plan comptable", () => {
  it("n'envoie que les valeurs modifiées, en majuscules", () => {
    const r = validerPlan(
      {
        comptes: { clients: "4111", banque: "521" },
        journaux: { ventes: "vt" },
        valeurs_validees: true,
      },
      plan,
    );
    expect(r).toEqual({
      ok: true,
      charge: { comptes: { clients: "4111" }, journaux: { ventes: "VT" }, valeurs_validees: true },
    });
  });

  it("signale une saisie inchangée et refuse un numéro invalide", () => {
    const meme = validerPlan({ comptes: {}, journaux: {}, valeurs_validees: false }, plan);
    expect(meme).toMatchObject({ ok: true, inchange: true });
    const faux = validerPlan(
      { comptes: { clients: "4-1" }, journaux: { ventes: "TROPLONG" }, valeurs_validees: false },
      plan,
    );
    expect(faux.ok).toBe(false);
    if (!faux.ok) expect(Object.keys(faux.erreurs)).toEqual(["compte_clients", "journal_ventes"]);
  });
});

describe("paramètres d'export", () => {
  const s: SaisieExport = {
    du: "2027-01-01",
    au: "2027-03-31",
    separateur: "point_virgule",
    decimale: "virgule",
    bom: true,
    format_date: "jj/mm/aaaa",
  };

  it("ne met dans l'URL que la période et le format", () => {
    expect(validerExport(s)).toEqual({
      ok: true,
      charge:
        "du=2027-01-01&au=2027-03-31&format=csv&separateur=point_virgule&decimale=virgule&bom=oui&format_date=jj%2Fmm%2Faaaa",
    });
  });

  it("refuse une période inversée et la virgule utilisée deux fois", () => {
    const r = validerExport({ ...s, du: "2027-04-01", separateur: "virgule" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.periode).toMatch(/précède/);
      expect(r.erreurs.decimale).toMatch(/point/);
    }
  });

  it("nomme le fichier par sa période", () => {
    expect(nomFichierExport("2027-01-01", "2027-03-31")).toBe(
      "ecritures-2027-01-01-2027-03-31.csv",
    );
  });
});

describe("téléchargement et messages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("télécharge par un appel authentifié et relaie l'erreur d'équilibre de l'API", async () => {
    const appel = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          erreur: { code: "ECRITURES_DESEQUILIBREES", message: "Pièce FA-1 déséquilibrée." },
        }),
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", appel);
    const e = await telechargerExport("du=2027-01-01&au=2027-01-31").catch((x: unknown) => x);
    expect(appel).toHaveBeenCalledWith(
      "/api/finance/export-comptable?du=2027-01-01&au=2027-01-31",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
    expect(e).toBeInstanceOf(ErreurApi);
    expect(messageExport(e)).toMatch(/Pièce FA-1 déséquilibrée\. Aucune écriture/);
  });

  it("rend le fichier CSV quand l'export réussit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("journal;date\r\n")));
    const blob = await telechargerExport("du=2027-01-01&au=2027-01-31");
    expect(await blob.text()).toBe("journal;date\r\n");
  });

  it("affiche les règles de période des schémas partagés", () => {
    const e = new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400, {
      formErrors: ["Période de 731 jours au plus."],
      fieldErrors: {},
    });
    expect(messageExport(e)).toBe("Période de 731 jours au plus.");
  });
});
