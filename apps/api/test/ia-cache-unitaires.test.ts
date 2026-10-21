import { describe, expect, it } from "vitest";
import { creerTrousseau } from "../src/auth/chiffrement.js";
import {
  canonique,
  cleCacheIa,
  contientDonneeIdentifiante,
  DUREE_CACHE_IA_MS,
  materiauCleCache,
  motifSansCache,
  PROMPTS_SANS_CACHE,
  type MateriauCleCache,
} from "../src/ia/cache.js";
import { creerMasque } from "../src/ia/masquage.js";
import { MAX_TOKENS_SORTIE, MODELES_RECOMMANDES, ROUTAGE_TACHES } from "../src/ia/modeles.js";
import { vueRoutage } from "../src/ia/parametres.js";
import { TACHES_IA } from "@missionpilot/shared";

/*
 * Cache des réponses IA (AGT-06), fonctions PURES : clé (empreinte HMAC du prompt versionné, du
 * modèle et des entrées masquées canonisées), règles d'exclusion (données identifiantes, contenu
 * client, prompts d'entretien), routage par tâche documenté.
 */

const trousseau = creerTrousseau({ 7: "secret-maitre-de-test-cache-ia-0001" }, 7);

const base: MateriauCleCache = {
  cabinetId: "00000000-0000-4000-8000-000000000001",
  prompt: {
    nom: "synthese_mission",
    version: 1,
    tache: "redaction",
    gabaritSysteme: "Tu rédiges une synthèse.",
    gabaritUtilisateur: "TEXTE :\n{{texte}}",
    schemaSortie: { type: "texte" },
  },
  modele: "anthropic/claude-sonnet-4.5",
  maxTokens: 4000,
  formatJson: false,
  entrees: { texte: "[PERSONNE_1] présente le projet.", chiffres: "" },
};

const cle = (m: MateriauCleCache) => cleCacheIa(trousseau, m).cle;

describe("clé du cache (AGT-06)", () => {
  it("même prompt, même modèle, mêmes entrées masquées → même clé, quel que soit l'ordre", () => {
    const inverse: MateriauCleCache = {
      ...base,
      entrees: { chiffres: "", texte: "[PERSONNE_1] présente le projet." },
    };
    expect(cle(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(cle(inverse)).toBe(cle(base));
    expect(canonique({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });

  it("version de prompt, contenu, modèle, entrée, plafond de jetons ou cabinet différents → autre clé", () => {
    const variantes: MateriauCleCache[] = [
      { ...base, prompt: { ...base.prompt, version: 2 } },
      { ...base, prompt: { ...base.prompt, nom: "synthese_autre" } },
      { ...base, prompt: { ...base.prompt, gabaritSysteme: "Tu rédiges un résumé." } },
      { ...base, prompt: { ...base.prompt, schemaSortie: { type: "texte", longueur_max: 10 } } },
      { ...base, modele: "anthropic/claude-haiku-4.5" },
      { ...base, maxTokens: 2000 },
      { ...base, formatJson: true },
      { ...base, entrees: { ...base.entrees, texte: "[PERSONNE_1] présente le budget." } },
      { ...base, cabinetId: "00000000-0000-4000-8000-000000000002" },
    ];
    const cles = new Set([cle(base), ...variantes.map(cle)]);
    expect(cles.size).toBe(variantes.length + 1);
  });

  it("clé à secret : le matériau seul (sans clé du serveur) ne la reproduit pas ; autre secret → autre clé", () => {
    const autre = creerTrousseau({ 9: "autre-secret-maitre-de-test-cache-02" }, 9);
    expect(cleCacheIa(autre, base).cle).not.toBe(cle(base));
    expect(cleCacheIa(trousseau, base).version).toBe(7);
    // Le matériau est séparé de l'empreinte des entrées de demande par un préfixe versionné.
    expect(materiauCleCache(base).startsWith("ia_cache/v1\u0000")).toBe(true);
  });

  it("deux noms différents masqués de la même façon partagent la clé (le modèle n'a vu que le jeton)", () => {
    const a = creerMasque(["Awa Koné"]).masquer("Awa Koné présente le projet.");
    const b = creerMasque(["Jean Dupont"]).masquer("Jean Dupont présente le projet.");
    expect(a).toBe(b);
    expect(cle({ ...base, entrees: { texte: a } })).toBe(cle({ ...base, entrees: { texte: b } }));
  });

  it("durée de vie bornée à 24 heures (même plafond en base)", () => {
    expect(DUREE_CACHE_IA_MS).toBe(86_400_000);
  });
});

describe("exclusions du cache : jamais de nominatif non masqué (AGT-06)", () => {
  const termes = ["Awa Koné", { valeur: "Société Test", categorie: "organisation" as const }];

  it("donnée identifiante en clair repérée ; jetons du masque ignorés", () => {
    expect(contientDonneeIdentifiante("[PERSONNE_1] dirige [ORGANISATION_1].", termes)).toBe(false);
    expect(contientDonneeIdentifiante("Synthèse neutre, sans nom.", termes)).toBe(false);
    for (const enClair of [
      "Contact : awa.kone@exemple.ci",
      "Appeler le +225 07 07 12 34 56",
      "AWA KONE signe le rapport.",
      "La Société Test progresse.",
      "Awa​ Koné signe.",
      "IBAN CI93 CI00 8011 1301 1342 9120 0589",
    ]) {
      expect(contientDonneeIdentifiante(enClair, termes), enClair).toBe(true);
    }
  });

  it("motifs : désactivé, prompt d'entretien ou copilote, contenu client, donnée identifiante", () => {
    const ok = {
      actif: true,
      promptNom: "synthese_mission",
      variablesNonFiables: [] as string[],
      textesMasques: ["[PERSONNE_1] présente le projet."],
      termesSensibles: termes,
    };
    expect(motifSansCache(ok)).toBeNull();
    expect(motifSansCache({ ...ok, actif: false })).toBe("desactive");
    for (const nom of ["compte_rendu_entretien", "copilote_routage", "transcription_resume"]) {
      expect(PROMPTS_SANS_CACHE.test(nom)).toBe(true);
      expect(motifSansCache({ ...ok, promptNom: nom })).toBe("prompt_exclu");
    }
    expect(motifSansCache({ ...ok, variablesNonFiables: ["document"] })).toBe("contenu_client");
    expect(motifSansCache({ ...ok, textesMasques: ["Écrire à awa@exemple.ci"] })).toBe(
      "donnee_identifiante",
    );
  });
});

describe("routage des modèles par tâche (AGT-06)", () => {
  it("chaque tâche a un modèle recommandé, un critère, un motif et le plafond de jetons de sa tâche", () => {
    for (const tache of TACHES_IA) {
      const r = ROUTAGE_TACHES[tache];
      expect(r.modele).toBe(MODELES_RECOMMANDES[tache]);
      expect(["qualite", "cout", "latence"]).toContain(r.critere);
      expect(r.motif.length).toBeGreaterThan(10);
      expect(r.plafondJetonsSortie).toBe(
        tache === "embedding" ? null : MAX_TOKENS_SORTIE[tache as keyof typeof MAX_TOKENS_SORTIE],
      );
    }
  });

  it("vue : modèle appliqué = choix du cabinet, sinon recommandé", () => {
    const vue = vueRoutage({ modeles: { redaction: "anthropic/claude-haiku-4.5" } });
    expect(vue.map((v) => v.tache)).toEqual([...TACHES_IA]);
    expect(vue.find((v) => v.tache === "redaction")).toMatchObject({
      modele_applique: "anthropic/claude-haiku-4.5",
      modele_recommande: MODELES_RECOMMANDES.redaction,
      personnalise: true,
      critere: "qualite",
    });
    expect(vue.find((v) => v.tache === "classification")).toMatchObject({
      modele_applique: MODELES_RECOMMANDES.classification,
      personnalise: false,
      critere: "latence",
    });
  });
});
