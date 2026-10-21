import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RedCausesVersionVue } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import {
  acquittementRequis,
  BANDEAU_CAUSES_IA,
  cartographieModifiable,
  cheminActivationChecklist,
  cheminArchivageChecklist,
  cheminCartographie,
  cheminCauses,
  cheminChecklist,
  cheminChecklistsDossier,
  cheminGenerationCauses,
  cheminModelesChecklists,
  cheminPublicationChecklist,
  cheminReponsesChecklist,
  cheminValidationCauses,
  cheminVersionsModele,
  corpsValidationCauses,
  formaterTaux,
  libelleConfianceCause,
  libelleRangHistorique,
  messageDiagnostic,
  MENTION_CHECKLIST_A_VALIDER,
  raisonValidationBloquee,
  tousLesTextesDiagnostic,
  validationProposee,
} from "./redressement-diagnostic";
import { MOTS_INTERDITS } from "./redressement";

const version = (p: Partial<RedCausesVersionVue> = {}) => ({
  statut: "brouillon" as const,
  chiffres_non_verifies: false,
  chiffres_acquittes: false,
  ...p,
});

describe("chemins d'API du diagnostic", () => {
  it("compose les routes des check-lists", () => {
    expect(cheminModelesChecklists()).toBe("/api/redressement/checklists/modeles");
    expect(cheminModelesChecklists("commerce")).toBe(
      "/api/redressement/checklists/modeles?secteur=commerce",
    );
    expect(cheminVersionsModele("m 1")).toBe("/api/redressement/checklists/modeles/m%201/versions");
    expect(cheminPublicationChecklist("v1")).toBe(
      "/api/redressement/checklists/versions/v1/publication",
    );
    expect(cheminChecklistsDossier("d1")).toBe(
      "/api/redressement/dossiers/d1/checklists?statut=active",
    );
    expect(cheminChecklistsDossier("d1", "toutes")).toContain("statut=toutes");
    expect(cheminActivationChecklist("d1")).toBe("/api/redressement/dossiers/d1/checklists");
    expect(cheminChecklist("c1")).toBe("/api/redressement/checklists/c1");
    expect(cheminReponsesChecklist("c1")).toBe("/api/redressement/checklists/c1/reponses");
    expect(cheminArchivageChecklist("c1")).toBe("/api/redressement/checklists/c1/archivage");
  });

  it("compose les routes des causes", () => {
    expect(cheminCauses("d1")).toBe("/api/redressement/dossiers/d1/causes");
    expect(cheminGenerationCauses("d1")).toBe("/api/redressement/dossiers/d1/causes/generation");
    expect(cheminCartographie("k1")).toBe("/api/redressement/causes/k1");
    expect(cheminValidationCauses("k1")).toBe("/api/redressement/causes/k1/validation");
  });
});

describe("mise en forme", () => {
  it("met en forme des points de base sans rien calculer", () => {
    expect(formaterTaux(7500).replace(/\s/g, " ")).toBe("75,00 %");
    expect(formaterTaux(0).replace(/\s/g, " ")).toBe("0,00 %");
    expect(formaterTaux(null)).toBe("—");
  });

  it("libelle la confiance par un texte fixe", () => {
    expect(libelleConfianceCause("eleve")).toBe("Confiance élevée");
    expect(libelleConfianceCause(null)).toBe("Confiance non indiquée");
  });

  it("décrit un rang de l'historique", () => {
    expect(
      libelleRangHistorique({ rang: 2, statut_contenu: "modifie", auteur: { nom: "Awa" } }),
    ).toBe("Rang 2 : Modifié, par Awa");
  });
});

describe("règles d'affichage des causes", () => {
  it("une cartographie validée est en lecture seule", () => {
    expect(cartographieModifiable(version(), true)).toBe(true);
    expect(cartographieModifiable(version(), false)).toBe(false);
    expect(cartographieModifiable(version({ statut: "valide" }), true)).toBe(false);
    expect(validationProposee(version(), true)).toBe(true);
    expect(validationProposee(version({ statut: "valide" }), true)).toBe(false);
    expect(validationProposee(version(), false)).toBe(false);
  });

  it("exige l'acquittement des nombres non vérifiés avant validation", () => {
    const v = version({ chiffres_non_verifies: true });
    expect(acquittementRequis(v)).toBe(true);
    expect(raisonValidationBloquee(v, false)).toContain("Cochez");
    expect(raisonValidationBloquee(v, true)).toBeNull();
    expect(corpsValidationCauses(v, true)).toEqual({ acquitte_chiffres: true });
    expect(corpsValidationCauses(v, false)).toEqual({});
    expect(corpsValidationCauses(version(), true)).toEqual({});
    const acquitte = version({ chiffres_non_verifies: true, chiffres_acquittes: true });
    expect(acquittementRequis(acquitte)).toBe(false);
    expect(raisonValidationBloquee(acquitte, true)).toBeNull();
  });
});

describe("messages d'erreur", () => {
  it("rend la séparation des tâches en français lisible", () => {
    const m = messageDiagnostic(new ErreurApi("APPROBATION_REQUISE", "Refusé.", 403));
    expect(m).toContain("autre consultant");
    expect(messageDiagnostic(new ErreurApi("CHIFFRES_NON_VERIFIES", "x", 409))).toContain(
      "attestation",
    );
    expect(messageDiagnostic(new ErreurApi("GENERATION_IA_ECHEC", "x", 502))).toContain("IA");
  });

  it("garde le message français d'un refus métier inconnu", () => {
    expect(messageDiagnostic(new ErreurApi("AUTRE_REFUS", "Refus précis.", 409))).toBe(
      "Refus précis.",
    );
  });
});

describe("vocabulaire", () => {
  it("reprend les textes fixes demandés", () => {
    expect(BANDEAU_CAUSES_IA).toBe(
      "Proposition de l'IA, à valider par un consultant : aucun chiffre ne vient du modèle.",
    );
    expect(MENTION_CHECKLIST_A_VALIDER).toContain("à valider par un expert");
  });

  it("n'emploie aucune qualification juridique, dans les textes comme dans les sources", () => {
    for (const t of tousLesTextesDiagnostic()) {
      for (const mot of MOTS_INTERDITS) expect(t.toLowerCase()).not.toContain(mot);
    }
    const racine = join(__dirname, "..");
    const fichiers: string[] = [];
    const parcourir = (d: string) => {
      for (const nom of readdirSync(d)) {
        const chemin = join(d, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/^(Checklist|Causes).*\.tsx$/.test(nom) || nom === "diagnostic.css") {
          fichiers.push(chemin);
        }
      }
    };
    parcourir(join(racine, "components", "redressement"));
    for (const n of ["", "-saisie", "-serveur"]) {
      fichiers.push(join(racine, "lib", `redressement-diagnostic${n}.ts`));
    }
    expect(fichiers.length).toBeGreaterThan(10);
    for (const f of fichiers) {
      const texte = readFileSync(f, "utf8").toLowerCase();
      expect(texte.split("\n").length, f).toBeLessThan(400);
      for (const mot of MOTS_INTERDITS) expect(texte, `${f} : ${mot}`).not.toContain(mot);
    }
  });
});
