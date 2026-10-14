import {
  calculerPointMort,
  ErreurRedressement,
  evaluerUrgence,
  projeterTresorerie,
  validerCorrespondance,
  type CodeErreurRedressement,
} from "@missionpilot/engines";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { traduireErreurRedressement } from "../src/redressement/erreurs.js";

/*
 * Traduction des erreurs du redressement : les onze SQLSTATE MPZ, 23514, 23505, 23503, chaque code du
 * moteur ; aucune fuite de montant ni de nom dans les messages ; une erreur inconnue est relancée
 * telle quelle (jamais avalée).
 */

const traduit = (e: unknown) => traduireErreurRedressement(e) as AppError;

describe("SQLSTATE MPZ01 à MPZ11", () => {
  const attendu: Record<string, [number, string]> = {
    MPZ01: [409, "RED_HISTORIQUE_IMMUABLE"],
    MPZ02: [400, "RED_RATTACHEMENT_INCOHERENT"],
    MPZ03: [409, "RED_MISSION_CLOTUREE"],
    MPZ04: [409, "RED_CHAMP_FIGE"],
    MPZ05: [409, "RED_VERSION_NON_CONSECUTIVE"],
    MPZ06: [409, "RED_TRANSITION_INVALIDE"],
    MPZ07: [403, "SEPARATION_DES_TACHES"],
    MPZ08: [409, "RED_REALISE_INCOHERENT"],
    MPZ09: [409, "RED_NEGOCIATION_INCOHERENTE"],
    MPZ10: [409, "RED_PLAFOND_ATTEINT"],
    MPZ11: [409, "RED_TROP_DE_CORRECTIONS"],
  };
  for (const [code, [statut, codeApi]] of Object.entries(attendu)) {
    it(`${code} → ${statut} ${codeApi}`, () => {
      const e = traduit({ code, message: "détail interne avec 123456789 et Banque Secrète" });
      expect(e).toBeInstanceOf(AppError);
      expect([e.statut, e.code]).toEqual([statut, codeApi]);
      expect(e.message).not.toMatch(/\d{4}|Banque|Secrète/);
    });
  }

  it("les codes MPZ21 à MPZ32, réservés au lot due diligence, ne sont pas traduits ici", () => {
    for (let n = 21; n <= 32; n += 1) {
      const brut = { code: `MPZ${n}` };
      expect(traduireErreurRedressement(brut)).toBe(brut);
    }
  });
});

describe("contraintes PostgreSQL", () => {
  it("23514 → 400 REQUETE_INVALIDE sans recopier la valeur", () => {
    const e = traduit({
      code: "23514",
      message: "new row violates check constraint avec 987654321",
    });
    expect([e.statut, e.code]).toEqual([400, "REQUETE_INVALIDE"]);
    expect(e.message).not.toContain("987654321");
  });

  it("23505 : dossier déjà ouvert, créancier en double, numérotation concurrente", () => {
    expect([
      traduit({ code: "23505", table: "red_dossiers" }).statut,
      traduit({ code: "23505", table: "red_dossiers" }).code,
    ]).toEqual([409, "RED_EXISTE"]);
    expect(traduit({ code: "23505", table: "red_creanciers" }).code).toBe(
      "RED_CREANCIER_EN_DOUBLE",
    );
    for (const table of [
      "red_actions",
      "red_plan_versions",
      "red_tresorerie_realises",
      "red_echeances",
    ]) {
      const e = traduit({ code: "23505", table });
      expect([e.statut, e.code]).toEqual([409, "CONFLIT"]);
    }
  });

  it("23503 → 400 ; une erreur inconnue est relancée telle quelle", () => {
    const e = traduit({ code: "23503", detail: "Key (cabinet_id)=(…) is not present" });
    expect([e.statut, e.code]).toEqual([400, "REQUETE_INVALIDE"]);
    expect(e.message).not.toContain("cabinet_id");
    const inconnue = new Error("panne");
    expect(traduireErreurRedressement(inconnue)).toBe(inconnue);
    const autre = { code: "42P01" };
    expect(traduireErreurRedressement(autre)).toBe(autre);
  });
});

describe("erreurs du moteur", () => {
  const CODES: CodeErreurRedressement[] = [
    "MONTANT_INVALIDE",
    "SOMME_HORS_LIMITES",
    "ENTREE_INVALIDE",
    "DATE_INVALIDE",
    "POSTE_INCONNU",
    "CORRESPONDANCE_INVALIDE",
    "ETAT_INVALIDE",
    "QUESTION_INCONNUE",
    "REPONSE_INVALIDE",
    "SEUILS_INVALIDES",
    "SEMAINE_INVALIDE",
    "TRESORERIE_INVALIDE",
    "REALISE_NON_CONTIGU",
    "ECHEANCIER_INVALIDE",
    "ACCORD_SUPERIEUR_CREANCE",
    "PAIEMENT_EXCESSIF",
    "ACCORD_ROMPU",
    "PLAN_INVALIDE",
    "LEVIER_INCONNU",
    "PARAMETRES_LEVIER_INVALIDES",
    "BASE_INCOMPLETE",
  ];
  const CONFLITS = new Set([
    "PAIEMENT_EXCESSIF",
    "ACCORD_ROMPU",
    "BASE_INCOMPLETE",
    "REALISE_NON_CONTIGU",
  ]);

  for (const code of CODES) {
    it(`${code} → ${CONFLITS.has(code) ? 409 : 400} RED_${code}`, () => {
      const e = traduit(new ErreurRedressement(code, "Message du moteur.", ["chiffre_affaires"]));
      expect(e.statut).toBe(CONFLITS.has(code) ? 409 : 400);
      expect(e.code).toBe(`RED_${code}`);
      expect(e.details).toEqual({ manquants: ["chiffre_affaires"] });
    });
  }

  it("sans manquants, aucun détail ; la liste blanche de l'enveloppe ne transmet que `manquants`", () => {
    expect(traduit(new ErreurRedressement("DATE_INVALIDE", "x")).details).toBeUndefined();
  });

  it("aucune fuite de montant ni de nom dans les messages du moteur", () => {
    const secret = 123_456_789;
    const essais: (() => unknown)[] = [
      () => calculerPointMort({ chiffreAffaires: -secret, chargesVariables: 1, chargesFixes: 1 }),
      () =>
        calculerPointMort({
          chiffreAffaires: secret,
          chargesVariables: 1,
          chargesFixes: 1,
          periodeJours: 9999,
        }),
      () =>
        projeterTresorerie({
          dateDebut: "2026-10-13",
          soldeInitial: secret,
          seuilTension: 0,
          lignes: [],
          realises: [],
        }),
      () =>
        projeterTresorerie({
          dateDebut: "2026-10-12",
          soldeInitial: secret,
          seuilTension: 0,
          lignes: [
            { semaine: 1, sens: "encaissement", categorie: "Banque Secrète", montant: secret },
          ],
          realises: [],
        }),
      () => validerCorrespondance({ stocks: { codes: ["Banque Secrète"], sansObjet: false } }),
      () => evaluerUrgence({ Z9: "oui" } as never),
    ];
    for (const essai of essais) {
      let erreur: unknown;
      try {
        essai();
      } catch (e) {
        erreur = e;
      }
      expect(erreur).toBeInstanceOf(ErreurRedressement);
      const traduite = traduit(erreur);
      expect(traduite.message).not.toContain(String(secret));
      expect(traduite.message).not.toContain("Banque");
      expect(traduite.statut).toBeLessThan(500);
    }
  });
});
