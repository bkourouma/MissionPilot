import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import { validerCorrection, validerMesure } from "./kpi-saisie";
import { entreesPortail } from "./portail";
import {
  auteurMesure,
  cheminApiCorrectionMesure,
  cheminApiMesuresPortail,
  cheminApiSaisieMesure,
  etatMesurePortail,
  etatSaisieKpi,
  hrefKpiPortail,
  libelleFrequence,
  libelleNature,
  libelleSens,
  mesureCorrigeable,
  messagePortailKpi,
} from "./portail-kpi";

const err = (statut: number, code: string, message = "Message de l'API.") =>
  new ErreurApi(code, message, statut);

describe("chemins", () => {
  it("encodent les identifiants et bornent la page de l'historique", () => {
    expect(hrefKpiPortail("a b")).toBe("/portail/kpi/a%20b");
    expect(cheminApiSaisieMesure("k1")).toBe("/api/portail/kpi/k1/mesures");
    expect(cheminApiCorrectionMesure("m 1")).toBe("/api/portail/kpi/mesures/m%201/corrections");
    expect(cheminApiMesuresPortail("k1")).toBe("/api/portail/kpi/k1/mesures?limite=20");
    expect(cheminApiMesuresPortail("k1", "abc_-")).toBe(
      "/api/portail/kpi/k1/mesures?limite=20&curseur=abc_-",
    );
  });
});

describe("navigation et libellés", () => {
  it("la rubrique KPI n'est ouverte qu'avec portail.kpi.saisir", () => {
    const ids = (r: string) => entreesPortail([r]).map((e) => e.id);
    expect(ids("client_dirigeant")).toContain("kpi");
    expect(ids("client_contributeur")).toContain("kpi");
    expect(ids("client_investisseur")).not.toContain("kpi");
  });

  it("fréquence, nature et sens en termes simples", () => {
    expect(libelleFrequence("mensuelle")).toBe("Chaque mois");
    expect(libelleFrequence("inconnue")).toBe("Fréquence à préciser");
    expect(libelleNature("flux")).toMatch(/s'additionnent/);
    expect(libelleNature("stock")).toMatch(/dernière valeur/);
    expect(libelleSens("plus_bas_mieux")).toMatch(/basse/);
  });
});

describe("état de saisie", () => {
  it("KPI suspendu ou suivi non commencé : saisie fermée avec la raison", () => {
    expect(etatSaisieKpi({ actif: true, debut_suivi: "2026-01-01" }, "2026-05-15")).toEqual({
      saisissable: true,
      raison: null,
    });
    const suspendu = etatSaisieKpi({ actif: false, debut_suivi: "2026-01-01" }, "2026-05-15");
    expect(suspendu.saisissable).toBe(false);
    expect(suspendu.raison).toMatch(/suspendu/);
    const futur = etatSaisieKpi({ actif: true, debut_suivi: "2026-06-01" }, "2026-05-15");
    expect(futur.saisissable).toBe(false);
    expect(futur.raison).toMatch(/pas encore commencé/);
  });

  it("lignes de l'historique : retenue, remplacée, annulation", () => {
    expect(etatMesurePortail({ active: true, annulation: false }).libelle).toBe("Valeur retenue");
    expect(etatMesurePortail({ active: false, annulation: false }).libelle).toBe("Remplacée");
    expect(etatMesurePortail({ active: false, annulation: true }).libelle).toBe("Annulation");
  });

  it("auteur : moi, un collègue ou le cabinet ; seules mes mesures actives se corrigent", () => {
    expect(auteurMesure({ origine: "portail", saisie_par_moi: true })).toBe("Saisie par vous");
    expect(auteurMesure({ origine: "portail", saisie_par_moi: false })).toMatch(/autre membre/);
    expect(auteurMesure({ origine: "cabinet", saisie_par_moi: false })).toBe(
      "Saisie par le cabinet",
    );
    const mienne = { active: true, saisie_par_moi: true, origine: "portail" } as const;
    expect(mesureCorrigeable(mienne, true)).toBe(true);
    expect(mesureCorrigeable(mienne, false)).toBe(false);
    expect(mesureCorrigeable({ ...mienne, active: false }, true)).toBe(false);
    expect(mesureCorrigeable({ ...mienne, saisie_par_moi: false }, true)).toBe(false);
    expect(mesureCorrigeable({ ...mienne, origine: "cabinet" }, true)).toBe(false);
  });
});

describe("validation de la saisie (règles du cabinet reprises)", () => {
  const def = { debut_suivi: "2026-01-01", fin_suivi: null };
  const saisie = {
    date_mesure: "2026-05-15",
    valeur: "1 250,5",
    commentaire: "",
    justificatif: "",
    motif: "",
  };

  it("valeur à la française, date dans le suivi, jamais dans le futur", () => {
    const ok = validerMesure(saisie, def, "2026-05-15");
    expect(ok).toEqual({ ok: true, charge: { date_mesure: "2026-05-15", valeur: 1250.5 } });
    const futur = validerMesure({ ...saisie, date_mesure: "2026-05-16" }, def, "2026-05-15");
    expect(futur.ok).toBe(false);
    const vide = validerMesure({ ...saisie, valeur: "" }, def, "2026-05-15");
    expect(vide).toMatchObject({ ok: false, erreurs: { valeur: "La valeur est obligatoire." } });
    const texte = validerMesure({ ...saisie, valeur: "beaucoup" }, def, "2026-05-15");
    expect(texte.ok).toBe(false);
  });

  it("la correction exige un motif", () => {
    const sans = validerCorrection(saisie, def, "2026-05-15");
    expect(sans).toMatchObject({ ok: false, erreurs: { motif: expect.any(String) } });
    const avec = validerCorrection({ ...saisie, motif: "Erreur de saisie" }, def, "2026-05-15");
    expect(avec.ok).toBe(true);
  });
});

describe("messages d'erreur", () => {
  it("traduit les refus connus en français, laisse le reste au message générique", () => {
    expect(messagePortailKpi(err(409, "KPI_MESURE_EN_DOUBLE"))).toMatch(/corrigez-la/);
    expect(messagePortailKpi(err(404, "INTROUVABLE"))).toMatch(/plus ouvert à votre saisie/);
    expect(messagePortailKpi(err(403, "INTERDIT"))).toMatch(/pas de vous/);
    expect(messagePortailKpi(err(409, "CONFLIT", "La mission de ce KPI est clôturée."))).toBe(
      "La mission de ce KPI est clôturée.",
    );
    expect(messagePortailKpi(err(500, "ERREUR"))).toBeNull();
    expect(messagePortailKpi(new Error("x"))).toBeNull();
  });
});
