import { describe, expect, it } from "vitest";
import {
  actionsGeneration,
  contributeursDe,
  corpsGeneration,
  delaiInterrogation,
  DELAI_MAX_INTERROGATION_MS,
  estEssai,
  estTerminal,
  libelleDuree,
  libelleVersion,
  lignesTracabilite,
  lireIdGeneration,
  messageEchecGeneration,
  messageSuccesValidation,
  messageValide,
  lireTermesSensibles,
  RAISON_AUTEUR_VERSION,
  RAISON_DEMANDEUR,
  raisonExclusionValidation,
  statutConnu,
  STATUT_CONTENU_IA,
  validerAcquittement,
  validerTexteModifie,
  versionPrecedente,
  type GenerationIa,
  type VersionContenuIa,
} from "./ia-contenu";

const CHEF = "11111111-1111-4111-8111-111111111111";
const DIRECTEUR = "22222222-2222-4222-8222-222222222222";
const ASSOCIE = "33333333-3333-4333-8333-333333333333";

const version = (v: Partial<VersionContenuIa> = {}): VersionContenuIa => ({
  version: 1,
  statut_contenu: "brouillon_ia",
  fournisseur: "openrouter",
  auteur_id: CHEF,
  auteur_nom: "Chef",
  chiffres_non_verifies: false,
  nombres_non_verifies: [],
  chiffres_acquittes: null,
  texte: "Texte.",
  cree_le: "2026-10-06T10:00:00Z",
  ...v,
});

const generation = (g: Partial<GenerationIa> = {}): GenerationIa => ({
  id: "44444444-4444-4444-8444-444444444444",
  tache: "redaction",
  prompt: { id: "p", nom: "resume_neutre", version: 1, exemple: false },
  mission_id: null,
  entite: null,
  demandeur: { id: CHEF, nom: "Chef" },
  statut: "terminee",
  progression: 100,
  erreur: null,
  statut_contenu: "brouillon_ia",
  livrable_client: false,
  version: 1,
  texte: "Texte.",
  gabarit: false,
  chiffres_non_verifies: false,
  nombres_non_verifies: [],
  chiffres_acquittes: null,
  sources: [],
  trace: null,
  cree_le: "2026-10-06T10:00:00Z",
  termine_le: "2026-10-06T10:00:02Z",
  versions: [version()],
  ...g,
});

describe("libellés", () => {
  it("chaque statut de contenu a un texte et une icône propres", () => {
    expect(STATUT_CONTENU_IA.brouillon_ia.libelle).toBe("Brouillon IA");
    const icones = Object.values(STATUT_CONTENU_IA).map((s) => s.icone);
    expect(new Set(icones).size).toBe(3);
  });

  it("statuts terminaux et statut inconnu", () => {
    expect(estTerminal("terminee")).toBe(true);
    expect(estTerminal("echec")).toBe(true);
    expect(estTerminal("annulee")).toBe(true);
    expect(estTerminal("en_file")).toBe(false);
    expect(statutConnu("en_cours")).toBe("en_cours");
    expect(statutConnu("nouveau_statut")).toBe("en_cours");
  });

  it("durée et version", () => {
    expect(libelleDuree(850)).toBe("850\u00a0ms");
    expect(libelleDuree(1234)).toBe("1,2\u00a0s");
    expect(libelleDuree(null)).toBe("—");
    expect(libelleVersion(version())).toMatch(/^Version 1 · Brouillon IA · par IA · /);
    expect(libelleVersion(version({ fournisseur: "gabarit" }))).toContain("par gabarit");
    expect(
      libelleVersion(
        version({
          version: 2,
          statut_contenu: "modifie",
          fournisseur: "humain",
          auteur_nom: "Awa",
        }),
      ),
    ).toMatch(/^Version 2 · Modifié · par Awa · /);
  });

  it("contenu validé : livrable au client sauf un essai (prompt « exemple »)", () => {
    const service = { id: "p", nom: "synthese", version: 1, exemple: false };
    const essai = { ...service, exemple: true };
    expect(
      messageValide({ livrable_client: true, chiffres_acquittes: null, prompt: service }),
    ).toBe("Validé par un humain : contenu définitif. Il peut être transmis au client.");
    // Essai validé : l'API garde livrable_client à faux.
    expect(
      messageValide({ livrable_client: false, chiffres_acquittes: true, prompt: essai }),
    ).toMatch(/Contenu d'essai : il n'est jamais transmis au client\. Les nombres signalés/);
    // L'écran ne déduit jamais « livrable » : sans le drapeau de l'API, pas d'envoi annoncé.
    expect(
      messageValide({ livrable_client: false, chiffres_acquittes: null, prompt: service }),
    ).toMatch(/n'est pas marqué livrable au client\.$/);
    expect(messageSuccesValidation({ livrable_client: false, prompt: essai })).toBe(
      "Contenu validé : il est définitif. Contenu d'essai : il n'est jamais transmis au client.",
    );
    expect(messageSuccesValidation({ livrable_client: true, prompt: service })).toBe(
      "Contenu validé : il est définitif. Il peut être transmis au client.",
    );
    expect(estEssai({ prompt: essai })).toBe(true);
    expect(estEssai({ prompt: service })).toBe(false);
  });

  it("échec : message de l'API et conduite à tenir selon le code", () => {
    const e = (code: string, message = "Message de l'API.") => ({ code, message });
    expect(messageEchecGeneration(e("DELAI_DEPASSE"))).toBe(
      "Message de l'API. Relancez la génération ; l'appel a pu être facturé et reste compté.",
    );
    for (const code of ["REPONSE_INVALIDE", "REPONSE_TROP_GRANDE"]) {
      expect(messageEchecGeneration(e(code))).toMatch(/l'appel a pu être facturé/);
    }
    expect(messageEchecGeneration(e("GENERATIONS_SIMULTANEES"))).toMatch(/dans un instant\.$/);
    expect(messageEchecGeneration(e("PLAFOND_IA_ATTEINT"))).toMatch(/en acceptant le gabarit/);
    expect(messageEchecGeneration(e("ERREUR_INTERNE"))).toMatch(/prévenez le support\.$/);
    expect(messageEchecGeneration(e("CLE_REFUSEE"))).toBe("Message de l'API.");
    expect(messageEchecGeneration(e("ERREUR_INTERNE", " "))).toMatch(/^Échec de la génération\./);
    expect(messageEchecGeneration(null)).toBe("Échec de la génération.");
  });

  it("traçabilité : sans finance.lire, ni modèle, ni jetons, ni coût (aucune ligne, jamais un zéro)", () => {
    const sansFinance = lignesTracabilite(
      generation({ trace: { fournisseur: "openrouter", duree_ms: 850 } }),
    );
    expect(sansFinance.map(([dt]) => dt)).toEqual(["Prompt", "Production", "Durée", "Terminée le"]);
    expect(sansFinance[1]).toEqual(["Production", "Fournisseur openrouter"]);
    const avecFinance = lignesTracabilite(
      generation({
        trace: {
          fournisseur: "openrouter",
          duree_ms: 1234,
          modele: "anthropic/claude-sonnet-4.5",
          tokens_entree: 1200,
          tokens_sortie: 300,
          cout_micro_usd: 8100,
        },
      }),
    );
    expect(Object.fromEntries(avecFinance)).toMatchObject({
      Modèle: "anthropic/claude-sonnet-4.5",
      Jetons: "1 200 en entrée, 300 en sortie",
      "Coût estimé": "0,0081 $US",
    });
    expect(
      lignesTracabilite(generation({ gabarit: true, trace: { fournisseur: "gabarit" } }))[1],
    ).toEqual(["Production", "Gabarit déterministe (aucun appel à un modèle)"]);
  });

  it("version précédente dans l'historique", () => {
    const vs = [version(), version({ version: 3 }), version({ version: 2 })];
    expect(versionPrecedente(vs, 3)?.version).toBe(2);
    expect(versionPrecedente(vs, 1)).toBeNull();
  });
});

describe("droits d'action affichés", () => {
  const chef = { id: CHEF, roles: ["chef_mission" as const] };
  const directeur = { id: DIRECTEUR, roles: ["directeur_mission" as const] };
  const associe = { id: ASSOCIE, roles: ["associe" as const] };

  it("brouillon : modifiable ; le demandeur ne valide pas, un autre responsable oui", () => {
    const g = generation();
    expect(actionsGeneration(g, chef)).toEqual({
      modifier: true,
      valider: false,
      raisonValidation: RAISON_DEMANDEUR,
      annuler: false,
    });
    expect(actionsGeneration(g, directeur)).toMatchObject({
      valider: true,
      raisonValidation: null,
    });
  });

  it("A/B/A : l'auteur de N'IMPORTE QUELLE version est exclu, pas seulement le dernier ; associé jamais", () => {
    // A (chef) demande, B (directeur) modifie, A modifie de nouveau : B n'est plus le dernier auteur.
    const g = generation({
      versions: [
        version(),
        version({ version: 2, statut_contenu: "modifie", auteur_id: DIRECTEUR }),
        version({ version: 3, statut_contenu: "modifie", auteur_id: CHEF }),
      ],
      statut_contenu: "modifie",
      version: 3,
    });
    expect(contributeursDe(g)).toEqual(new Set([CHEF, DIRECTEUR]));
    expect(actionsGeneration(g, directeur)).toMatchObject({
      valider: false,
      raisonValidation: RAISON_AUTEUR_VERSION,
    });
    expect(actionsGeneration(g, chef)).toMatchObject({
      valider: false,
      raisonValidation: RAISON_DEMANDEUR,
    });
    // Un associé valide même ce qu'il a demandé ou modifié.
    const g2 = generation({
      demandeur: { id: ASSOCIE, nom: "A" },
      versions: [version({ auteur_id: ASSOCIE })],
    });
    expect(actionsGeneration(g2, associe)).toMatchObject({ valider: true, raisonValidation: null });
    expect(raisonExclusionValidation(g, undefined)).toBeNull();
  });

  it("refus APPROBATION_REQUISE déjà reçu (droits sur la mission) : « Valider » masqué, message de l'API", () => {
    const g = generation({ mission_id: "m" });
    const refus =
      "Un contenu lié à une mission est validé par son chef, son directeur ou un associé.";
    expect(actionsGeneration(g, directeur, refus)).toMatchObject({
      modifier: true,
      valider: false,
      raisonValidation: refus,
    });
    // La raison propre à l'écran (demandeur) prime sur le refus mémorisé.
    expect(actionsGeneration(g, chef, refus).raisonValidation).toBe(RAISON_DEMANDEUR);
  });

  it("contenu validé, en échec ou absent : aucune action de relecture", () => {
    for (const g of [
      generation({ statut_contenu: "valide", livrable_client: true }),
      generation({ statut: "echec", statut_contenu: null, version: null }),
    ]) {
      expect(actionsGeneration(g, directeur)).toMatchObject({ modifier: false, valider: false });
    }
  });

  it("annulation : en file ou en cours, par le demandeur ou ia.configurer", () => {
    const g = generation({ statut: "en_file", statut_contenu: null, version: null });
    expect(actionsGeneration(g, chef).annuler).toBe(true);
    expect(actionsGeneration(g, directeur).annuler).toBe(false);
    expect(actionsGeneration(g, associe).annuler).toBe(true);
    expect(actionsGeneration(g).annuler).toBe(true);
  });
});

describe("saisies", () => {
  it("texte modifié : non vide, borné, différent", () => {
    expect(validerTexteModifie("  Nouveau.  ", "Ancien.")).toEqual({
      ok: true,
      charge: { texte: "Nouveau." },
    });
    expect(validerTexteModifie("   ", "x").ok).toBe(false);
    expect(validerTexteModifie("Texte.", "Texte. ").ok).toBe(false);
    expect(validerTexteModifie("a".repeat(100_001), "x").ok).toBe(false);
  });

  it("acquittement exigé seulement pour des chiffres non vérifiés", () => {
    expect(validerAcquittement({ chiffres_non_verifies: false }, false)).toEqual({
      ok: true,
      charge: {},
    });
    expect(validerAcquittement({ chiffres_non_verifies: true }, false).ok).toBe(false);
    expect(validerAcquittement({ chiffres_non_verifies: true }, true)).toEqual({
      ok: true,
      charge: { acquitte_chiffres: true },
    });
  });

  it("corps de génération : jamais de chiffres fournis ni de source « moteur »", () => {
    const corps = corpsGeneration({
      prompt_nom: "resume_neutre",
      variables: { texte: "x" },
      sources: [
        { type: "moteur", id: "finance.budget", libelle: "Budget" },
        { type: "mission", id: "m1", libelle: "Mission" },
      ],
      ...({
        contexte_chiffres: [{ libelle: "Honoraires", valeur: 1 }],
        mission_id: "11111111-1111-4111-8111-111111111111",
      } as object),
    });
    expect(corps).toEqual({
      prompt_nom: "resume_neutre",
      variables: { texte: "x" },
      mode: "file",
      sources: [{ type: "mission", id: "m1", libelle: "Mission" }],
    });
    // Refusés en 400 par l'API : jamais envoyés, même si l'appelant les glisse dans la demande.
    expect(corps).not.toHaveProperty("contexte_chiffres");
    expect(corps).not.toHaveProperty("mission_id");
    expect(corpsGeneration({ prompt_nom: "p", repli_si_plafond: true, mode: "immediat" })).toEqual({
      prompt_nom: "p",
      variables: {},
      mode: "immediat",
      repli_si_plafond: true,
    });
  });

  it("termes sensibles : un par ligne, sans doublon, bornés", () => {
    expect(lireTermesSensibles("Awa Koné\n\n  Kora SA \nAwa Koné")).toEqual({
      ok: true,
      charge: ["Awa Koné", "Kora SA"],
    });
    expect(lireTermesSensibles("x".repeat(201)).ok).toBe(false);
    expect(lireTermesSensibles(Array.from({ length: 201 }, (_, i) => `t${i}`).join("\n")).ok).toBe(
      false,
    );
  });

  it("identifiant de génération lu dans l'URL", () => {
    expect(lireIdGeneration("44444444-4444-4444-8444-444444444444")).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
    expect(lireIdGeneration("../../x")).toBeNull();
    expect(lireIdGeneration(["a"])).toBeNull();
  });
});

describe("suivi d'une génération en file", () => {
  it("intervalles espacés, plafonnés, allongés par les erreurs réseau", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 50].map((t) => delaiInterrogation(t))).toEqual([
      1_000, 2_000, 3_000, 5_000, 8_000, 10_000, 10_000, 10_000,
    ]);
    expect(delaiInterrogation(0, 1)).toBe(2_000);
    expect(delaiInterrogation(5, 3)).toBe(DELAI_MAX_INTERROGATION_MS);
    expect(delaiInterrogation(-3, -1)).toBe(1_000);
  });
});
