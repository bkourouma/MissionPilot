import { describe, expect, it } from "vitest";
import { montant } from "@missionpilot/engines";
import { conversionSeuils, roleSelonSeuils } from "../src/facturation/outils.js";
import type { MissionAcces } from "../src/missions/acces.js";

const mission = (m: Partial<MissionAcces>): MissionAcces => ({
  id: "00000000-0000-4000-8000-000000000001",
  statut: "signee",
  devise: "XOF",
  directeur_id: null,
  chef_id: null,
  client_id: "00000000-0000-4000-8000-000000000002",
  date_debut: null,
  date_signature: "2026-10-01",
  taux_change: "1",
  devise_reference: "XOF",
  proposition_id: null,
  ...m,
});

describe("seuils d'approbation des factures selon la devise (FIN-15, FIN-04)", () => {
  it("FCFA : comparaison directe (XOF et XAF, parité 1:1)", () => {
    expect(roleSelonSeuils("facture", montant(5_000_000, "XOF"), mission({}))).toBe("chef_mission");
    expect(roleSelonSeuils("facture", montant(5_000_001, "XOF"), mission({}))).toBe(
      "directeur_mission",
    );
    expect(roleSelonSeuils("facture", montant(30_000_000, "XAF"), mission({ devise: "XAF" }))).toBe(
      "associe",
    );
  });

  it("EUR : parité fixe légale 655,957 (10 000,00 € → 6 559 570 FCFA → directeur)", () => {
    const m = mission({ devise: "EUR", taux_change: "655.957" });
    expect(roleSelonSeuils("facture", montant(1_000_000, "EUR"), m)).toBe("directeur_mission");
    // Même pour un cabinet en EUR (taux mission EUR → EUR = 1).
    const cabinetEur = mission({ devise: "EUR", taux_change: "1", devise_reference: "EUR" });
    expect(roleSelonSeuils("facture", montant(1_000_000, "EUR"), cabinetEur)).toBe(
      "directeur_mission",
    );
  });

  it("USD : taux figé de la mission vers le FCFA, ou vers l'EUR puis parité fixe", () => {
    const versFcfa = mission({ devise: "USD", taux_change: "600", devise_reference: "XOF" });
    // 5 000,00 $ × 600 = 3 000 000 FCFA → chef de mission.
    expect(roleSelonSeuils("facture", montant(500_000, "USD"), versFcfa)).toBe("chef_mission");
    const versEur = mission({ devise: "USD", taux_change: "0.9", devise_reference: "EUR" });
    // 10 000,00 $ × 0,9 = 9 000,00 € × 655,957 = 5 903 613 FCFA → directeur.
    expect(roleSelonSeuils("facture", montant(1_000_000, "USD"), versEur)).toBe(
      "directeur_mission",
    );
  });

  it("aucun taux connu (USD non signé) : comportement sûr, un associé approuve", () => {
    const sansTaux = mission({ devise: "USD", date_signature: null, taux_change: null });
    expect(conversionSeuils("USD", sansTaux)).toBeNull();
    expect(roleSelonSeuils("facture", montant(100, "USD"), sansTaux)).toBe("associe");
  });

  it("valeur absolue pour un avoir (moteur)", () => {
    expect(roleSelonSeuils("facture", montant(-6_000_000, "XOF"), mission({}))).toBe(
      "directeur_mission",
    );
  });
});
