import { describe, expect, it } from "vitest";
import {
  FORMAT_MODELE_IA,
  generationCreationSchema,
  generationModificationSchema,
  generationsQuerySchema,
  generationValidationSchema,
  iaParametresModificationSchema,
  iaTestSchema,
  MESSAGE_CHIFFRES_SERVEUR,
  MESSAGE_ESSAI_SANS_MISSION,
  MESSAGE_SOURCE_MOTEUR_SERVEUR,
  promptCreationSchema,
  schemaSortieSchema,
  TACHES_IA,
  coutsQuerySchema,
} from "../index";

describe("socle IA : paramètres (ADR-003)", () => {
  it("formats d'identifiant de modèle : fournisseur/modèle[:variante] seulement", () => {
    for (const ok of [
      "anthropic/claude-sonnet-4.5",
      "google/gemini-2.5-flash",
      "meta-llama/llama-3.1-8b-instruct:free",
    ]) {
      expect(FORMAT_MODELE_IA.test(ok)).toBe(true);
    }
    for (const ko of [
      "claude",
      "Anthropic/Claude",
      "a/b/c",
      "../../etc/passwd",
      "a/b?x=1",
      "a/b c",
      "https://evil.test/x",
    ]) {
      expect(FORMAT_MODELE_IA.test(ko)).toBe(false);
    }
  });

  it("modification : strict, au moins un champ, clé sûre, null retire la clé ou le modèle", () => {
    expect(iaParametresModificationSchema.safeParse({}).success).toBe(false);
    expect(iaParametresModificationSchema.safeParse({ inconnu: 1 }).success).toBe(false);
    expect(iaParametresModificationSchema.safeParse({ ia_activee: false }).success).toBe(true);
    expect(
      iaParametresModificationSchema.safeParse({ cle_api: "sk-or-v1-0123456789abcdef" }).success,
    ).toBe(true);
    expect(iaParametresModificationSchema.safeParse({ cle_api: null }).success).toBe(true);
    expect(iaParametresModificationSchema.safeParse({ cle_api: "courte" }).success).toBe(false);
    expect(
      iaParametresModificationSchema.safeParse({ cle_api: "sk-or-v1-0123456789\r\nX-Inj: 1" })
        .success,
    ).toBe(false);
    expect(iaParametresModificationSchema.safeParse({ modeles: { redaction: null } }).success).toBe(
      true,
    );
    expect(iaParametresModificationSchema.safeParse({ modeles: { inconnue: "a/b" } }).success).toBe(
      false,
    );
    expect(
      iaParametresModificationSchema.safeParse({ plafond_mensuel_micro_usd: -1 }).success,
    ).toBe(false);
    expect(iaTestSchema.parse({})).toEqual({ tache: "classification" });
    expect(TACHES_IA).toContain("embedding");
  });

  it("bloc de reconfirmation : forme de confirmationIdentiteSchema, jamais seul (constat 6)", () => {
    const cle = "sk-or-v1-0123456789abcdef";
    expect(
      iaParametresModificationSchema.safeParse({
        cle_api: cle,
        confirmation: { mot_de_passe: "secret", code: "123 456" },
      }).success,
    ).toBe(true);
    // La confirmation seule n'est pas un champ à modifier.
    expect(
      iaParametresModificationSchema.safeParse({ confirmation: { mot_de_passe: "secret" } })
        .success,
    ).toBe(false);
    // Un seul facteur ; aucun champ inconnu dans le bloc.
    expect(
      iaParametresModificationSchema.safeParse({
        cle_api: cle,
        confirmation: { mot_de_passe: "x", code: "123456", code_secours: "abcd" },
      }).success,
    ).toBe(false);
    expect(
      iaParametresModificationSchema.safeParse({
        cle_api: cle,
        confirmation: { mot_de_passe: "x", jeton: "y" },
      }).success,
    ).toBe(false);
  });
});

describe("socle IA : prompts et schéma de sortie", () => {
  it("sortie : texte ou objet typé, sans champ « nombre », défaut parmi les valeurs", () => {
    expect(schemaSortieSchema.safeParse({ type: "texte" }).success).toBe(true);
    expect(
      schemaSortieSchema.safeParse({
        type: "objet",
        champs: { tonalite: { type: "choix", valeurs: ["a", "b"], defaut: "a" } },
      }).success,
    ).toBe(true);
    expect(
      schemaSortieSchema.safeParse({ type: "objet", champs: { n: { type: "nombre" } } }).success,
    ).toBe(false);
    expect(
      schemaSortieSchema.safeParse({
        type: "objet",
        champs: { t: { type: "choix", valeurs: ["a"], defaut: "z" } },
      }).success,
    ).toBe(false);
    expect(schemaSortieSchema.safeParse({ type: "objet", champs: {} }).success).toBe(false);
    expect(
      schemaSortieSchema.safeParse({
        type: "objet",
        champs: { "Mauvais-Nom": { type: "booleen" } },
      }).success,
    ).toBe(false);
  });

  it("création de prompt : nom technique, tâche générative, strict", () => {
    const base = {
      nom: "synthese_entretien",
      tache: "redaction",
      gabarit_utilisateur: "Résume : {{texte}}",
      schema_sortie: { type: "texte" },
    };
    const p = promptCreationSchema.parse(base);
    expect(p).toMatchObject({ exemple: false, activer: true, gabarit_systeme: "" });
    expect(promptCreationSchema.safeParse({ ...base, nom: "Synthèse" }).success).toBe(false);
    expect(promptCreationSchema.safeParse({ ...base, tache: "embedding" }).success).toBe(false);
    expect(promptCreationSchema.safeParse({ ...base, extra: true }).success).toBe(false);
  });
});

describe("socle IA : générations", () => {
  it("création : variable « chiffres » réservée, termes sensibles, sources vérifiables, mode", () => {
    const g = generationCreationSchema.parse({ prompt_nom: "resume_neutre" });
    expect(g).toMatchObject({ mode: "file", repli_si_plafond: false, variables: {} });
    expect(
      generationCreationSchema.safeParse({
        prompt_nom: "resume_neutre",
        variables: { chiffres: "1" },
      }).success,
    ).toBe(false);
    expect(
      generationCreationSchema.safeParse({
        prompt_nom: "resume_neutre",
        termes_sensibles: ["Awa Koné", { valeur: "SOTRA", categorie: "organisation" }],
        sources: [
          {
            type: "mission",
            id: "00000000-0000-4000-8000-000000000000",
            libelle: "Mission",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      generationCreationSchema.safeParse({
        prompt_nom: "resume_neutre",
        sources: [{ type: "url", id: "x", libelle: "y" }],
      }).success,
    ).toBe(false);
  });

  it("route de test : chiffres de contexte, source « moteur » et mission refusés (constat 4)", () => {
    const refus = (corps: Record<string, unknown>) => {
      const r = generationCreationSchema.safeParse({ prompt_nom: "resume_neutre", ...corps });
      expect(r.success).toBe(false);
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    expect(refus({ contexte_chiffres: [] })).toContain(MESSAGE_CHIFFRES_SERVEUR);
    expect(
      refus({ contexte_chiffres: [{ libelle: "Honoraires", valeur: 1_500_000, unite: "FCFA" }] }),
    ).toContain(MESSAGE_CHIFFRES_SERVEUR);
    expect(
      refus({ sources: [{ type: "moteur", id: "finance.budget", libelle: "Budget figé" }] }),
    ).toContain(MESSAGE_SOURCE_MOTEUR_SERVEUR);
    expect(refus({ mission_id: "00000000-0000-4000-8000-000000000000" })).toContain(
      MESSAGE_ESSAI_SANS_MISSION,
    );
  });

  it("modification, validation, liste et coûts : schémas stricts", () => {
    expect(generationModificationSchema.safeParse({ texte: "  " }).success).toBe(false);
    expect(generationValidationSchema.parse({})).toEqual({});
    expect(generationValidationSchema.safeParse({ acquitte_chiffres: "oui" }).success).toBe(false);
    expect(generationsQuerySchema.parse({ limite: "10" }).limite).toBe(10);
    expect(generationsQuerySchema.safeParse({ statut_contenu: "publie" }).success).toBe(false);
    expect(coutsQuerySchema.safeParse({ mois: "2026-13" }).success).toBe(false);
    expect(coutsQuerySchema.safeParse({ mois: "2026-10" }).success).toBe(true);
  });
});
