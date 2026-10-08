import { describe, expect, it } from "vitest";
import { convertirCout } from "../src/ia/couts.js";
import {
  produireGabarit,
  formaterNombre,
  choixParMotsCles,
  ENTETE_GABARIT,
} from "../src/ia/gabarits.js";
import {
  anneesDe,
  contexteGarde,
  extraireNombres,
  suspectsRestants,
  verifierChiffres,
} from "../src/ia/garde-chiffres.js";
import { creerMasque, CROCHET_NEUTRE, sansJetons } from "../src/ia/masquage.js";
import { coutMicroUsd, modeleAutorise, TARIF_INCONNU, tarifDe } from "../src/ia/modeles.js";
import {
  echapperVariable,
  extraireVariables,
  rendreGabarit,
  validerSortie,
} from "../src/ia/prompts.js";

describe("masquage des données identifiantes (PRD, confidentialité IA)", () => {
  it("masque e-mails, téléphones, IBAN, RCCM, compte contribuable et termes sensibles", () => {
    const m = creerMasque([
      "Awa Koné",
      { valeur: "Société Ivoirienne de Test", categorie: "organisation" },
    ]);
    const texte =
      "Contact : awa.kone@exemple.ci, tél. +225 07 07 12 34 56 ou 07 07 12 34 56. " +
      "Awa Koné dirige la Société Ivoirienne de Test (RCCM CI-ABJ-2019-B-12345, CC n° 1234567 A). " +
      "IBAN CI93 CI00 8011 1301 1342 9120 0589. AWA KONÉ signe.";
    const masque = m.masquer(texte);
    for (const secret of [
      "awa.kone@exemple.ci",
      "07 07 12 34 56",
      "Awa Koné",
      "AWA KONÉ",
      "Société Ivoirienne de Test",
      "CI-ABJ-2019-B-12345",
      "1234567 A",
      "CI93 CI00 8011",
    ]) {
      expect(masque).not.toContain(secret);
    }
    expect(masque).toContain("[PERSONNE_1]");
    expect(masque).toContain("[ORGANISATION_1]");
    expect(masque).toContain("[EMAIL_1]");
    expect(masque).toContain("[TELEPHONE_1]");
    expect(masque).toContain("[IBAN_1]");
    expect(masque).toContain("[RCCM_1]");
    expect(masque).toContain("[CONTRIBUABLE_1]");
    // Même valeur (casse comprise) → même jeton.
    expect(masque.match(/\[PERSONNE_1\]/g)).toHaveLength(2);
    expect(m.compte()).toMatchObject({ PERSONNE: 1, EMAIL: 1, IBAN: 1 });
    // Démasquage local de la réponse.
    expect(m.demasquer("Merci [PERSONNE_1] ([EMAIL_1]), [INCONNU_9] reste.")).toBe(
      "Merci Awa Koné (awa.kone@exemple.ci), [INCONNU_9] reste.",
    );
    expect(m.demasquerValeur({ a: ["[PERSONNE_1]"], b: 3 })).toEqual({ a: ["Awa Koné"], b: 3 });
  });

  it("ne masque pas les montants groupés par milliers ni un nom absent de la liste (limite)", () => {
    const m = creerMasque([]);
    const texte = "Budget : 1 500 000 000 FCFA, 25 000 000 000 FCFA. Moussa Diallo valide.";
    expect(m.masquer(texte)).toBe(texte);
  });

  it("mot entier seulement : « Ali » ne masque pas « Alimentation »", () => {
    const m = creerMasque(["Ali"]);
    expect(m.masquer("Ali gère Alimentation Plus.")).toBe("[PERSONNE_1] gère Alimentation Plus.");
    // Seuls les jetons CONNUS du masque sont retirés ; un jeton forgé reste (et sera signalé).
    expect(sansJetons("[PERSONNE_1] a 3 dossiers", m)).toBe("  a 3 dossiers");
    expect(sansJetons("[PERSONNE_7] a 3 dossiers", m)).toBe("[PERSONNE_7] a 3 dossiers");
    expect(sansJetons("[PERSONNE_1] a 3 dossiers")).toBe("[PERSONNE_1] a 3 dossiers");
  });

  it("constat 8 : termes sans casse ni accents (NFKC), séparateurs souples, sigles pointés", () => {
    const m = creerMasque(["Awa Koné", { valeur: "SOTRA", categorie: "organisation" }]);
    const masque = m.masquer(
      "AWA KONE, Awa  Koné, awa\nkoné et Ａｗａ Ｋｏｎé ; la S.O.T.R.A. et la sotra.",
    );
    expect(masque).toBe(
      "[PERSONNE_1], [PERSONNE_1], [PERSONNE_1] et [PERSONNE_1] ; la [ORGANISATION_1]. et la [ORGANISATION_1].",
    );
    // Terme fourni avec des points ou des espaces doubles (le plus long d'abord).
    const m2 = creerMasque(["S.O.T.R.A.", "Awa   Koné"]);
    expect(m2.masquer("SOTRA et Awa Kone")).toBe("[PERSONNE_2] et [PERSONNE_1]");
  });

  it("constat 8 : e-mail masqué EN ENTIER avant les termes (même s'il contient un terme)", () => {
    const m = creerMasque(["Koné", "Awa"]);
    const masque = m.masquer("Écrire à awa.kone@exemple.ci ou à koné@exemple.ci, dit Awa Koné.");
    expect(masque).toBe("Écrire à [EMAIL_1] ou à [EMAIL_2], dit [PERSONNE_2] [PERSONNE_1].");
    expect(m.demasquer(masque)).toContain("awa.kone@exemple.ci");
  });

  it("constat 8 : IBAN en minuscules ou à tirets, téléphone à indicatif sans + ni 00, contribuable sans « compte »", () => {
    const m = creerMasque([]);
    const masque = m.masquer(
      "IBAN ci93-ci00-8011-1301-1342-9120-0589 ou ci93 ci00 8011 1301 1342 9120 0589. " +
        "Tél. 225 07 07 12 34 56 ou 2250707123456 ou 221 77 123 45 67. " +
        "Contribuable n° 1234567A ; n° contribuable : 7654321 B.",
    );
    for (const secret of [
      "ci93",
      "8011",
      "225 07 07",
      "2250707123456",
      "221 77",
      "1234567A",
      "7654321",
    ]) {
      expect(masque).not.toContain(secret);
    }
    // Même identifiant, quelle que soit la mise en forme : un seul jeton (IBAN ; 225 07 07… = 2250707…).
    expect(m.compte()).toMatchObject({ IBAN: 1, TELEPHONE: 2, CONTRIBUABLE: 2 });
    expect(masque).toContain(" ou ");
    // Les montants groupés par milliers ne sont pas des téléphones.
    expect(m.masquer("Budget : 225 000 000 FCFA, 1 500 000 000 FCFA.")).toBe(
      "Budget : 225 000 000 FCFA, 1 500 000 000 FCFA.",
    );
  });

  it("constat 8 : un jeton déjà présent dans l'entrée est neutralisé (jamais démasqué)", () => {
    const m = creerMasque(["Awa Koné"]);
    const masque = m.masquer("Awa Koné cite [PERSONNE_1], [personne_2] et ［EMAIL_1].");
    expect(masque).toBe(
      `[PERSONNE_1] cite ${CROCHET_NEUTRE}PERSONNE_1], ${CROCHET_NEUTRE}personne_2] et ${CROCHET_NEUTRE}EMAIL_1].`,
    );
    // Le modèle recopie le jeton neutralisé : il n'est pas remplacé par la valeur d'un vrai jeton.
    expect(m.demasquer(`${CROCHET_NEUTRE}PERSONNE_1] et [PERSONNE_1]`)).toBe(
      `${CROCHET_NEUTRE}PERSONNE_1] et Awa Koné`,
    );
  });
});

describe("garde-chiffres (les chiffres ne viennent jamais du modèle)", () => {
  it("lit les formats français : « 1 500 000 », « 12,5 % », « 3 j », « 1,5 million »", () => {
    const lus = extraireNombres(
      "1 500 000 FCFA, 1\u202f500\u202f000, 12,5 %, 3 j, 1,5 million, 1.500.000",
    );
    expect(lus.map((n) => n.valeur)).toEqual([1_500_000, 1_500_000, 12.5, 3, 1_500_000, 1_500_000]);
    expect(lus[2]!.pourcentage).toBe(true);
  });

  it("nombre inventé détecté ; nombre fourni accepté, y compris arrondi d'affichage", () => {
    const liste = [1_500_000, 0.125, 3, 1_523_400];
    expect(verifierChiffres("Honoraires de 1 500 000 FCFA, marge 12,5 %, 3 j.", liste)).toEqual({
      chiffresNonVerifies: false,
      nombresNonVerifies: [],
    });
    expect(
      verifierChiffres("Environ 1,5 million de chiffre d'affaires.", [1_523_400])
        .chiffresNonVerifies,
    ).toBe(false);
    const r = verifierChiffres("La marge atteindra 18 % et 2 400 000 FCFA.", liste);
    expect(r.chiffresNonVerifies).toBe(true);
    expect(r.nombresNonVerifies).toEqual(["18 %", "2 400 000 FCFA"]);
    // « 1 523 000 » n'est pas 1 523 400 (entier exact).
    expect(verifierChiffres("1 523 000", [1_523_400]).chiffresNonVerifies).toBe(true);
  });

  it("ignore numérotation consécutive, années et dates des entrées, jetons du masque, identifiants courts", () => {
    const contexte = contexteGarde([
      "Plan stratégique 2027-2031, bilan du 06/10/2026",
      "exercice 2026",
    ]);
    const m = creerMasque(["Awa Koné"]);
    m.masquer("Awa Koné");
    const sortie =
      "1. Contexte de [PERSONNE_1]\n2) Axe 1 : croissance\n3. Étape 1 puis étape 2 du plan 2027-2031, " +
      "bilan au 06/10/2026 (2026-10-06), T1 et COVID-19, 1er trimestre 2026.";
    expect(verifierChiffres(sortie, [], contexte, m)).toEqual({
      chiffresNonVerifies: false,
      nombresNonVerifies: [],
    });
    // Une année absente du contexte est signalée.
    expect(verifierChiffres("Objectif 2035.", [], contexte).nombresNonVerifies).toEqual(["2035"]);
    expect(anneesDe(["exercice 2026"]).has(2026)).toBe(true);
  });

  describe("constat 3 : formats qui contournaient la garde (un test par format)", () => {
    const signale = (sortie: string, liste: number[] = [], entrees: string[] = []) =>
      verifierChiffres(sortie, liste, contexteGarde(entrees)).nombresNonVerifies;

    it("nombre négatif : signe écrit comparé (-350000000, -42 %)", () => {
      expect(signale("Perte de -350000000 FCFA.", [350_000_000])).toEqual(["-350000000 FCFA"]);
      expect(signale("Perte de -350000000 FCFA.", [-350_000_000])).toEqual([]);
      expect(signale("Recul de -42 %.", [0.42])).toEqual(["-42 %"]);
      expect(signale("Recul de −42 %.", [-0.42])).toEqual([]);
      // Signe « + » écrit pour une valeur négative ; signe non écrit : libre.
      expect(signale("Hausse de +5 %.", [-0.05])).toEqual(["+5 %"]);
      expect(signale("Baisse de 5 %.", [-0.05])).toEqual([]);
    });

    it("fourchette « 10-15 % » : les deux bornes sont lues", () => {
      expect(signale("Marge de 10-15 %.", [0.1])).toEqual(["15 %"]);
      expect(signale("Marge de 10-15 %.", [0.1, 0.15])).toEqual([]);
    });

    it("nombre collé à une abréviation ou à une devise : « env.4500 », « USD350000 »", () => {
      expect(signale("Coût env.4500 FCFA.")).toEqual(["4500 FCFA"]);
      expect(signale("Prix USD350000.")).toEqual(["USD350000"]);
      expect(signale("Prix USD350000.", [350_000])).toEqual([]);
      expect(signale("Norme ISO9001, réf. x350000.")).toEqual(["9001", "350000"]);
    });

    it("chiffres non ASCII : arabes « ٣٥٠٠٠٠ », pleine chasse « ３５０ »", () => {
      expect(signale("Prix ٣٥٠٠٠٠ FCFA.")).toEqual(["350000 FCFA"]);
      expect(signale("Prix ٣٥٠٠٠٠ FCFA.", [350_000])).toEqual([]);
      expect(signale("Prix ３５０ FCFA.")).toEqual(["350 FCFA"]);
    });

    it("multiplicateur après un point : « 850. millions »", () => {
      expect(signale("Chiffre d'affaires de 850. millions.", [850])).toEqual(["850. millions"]);
      expect(signale("Chiffre d'affaires de 850. millions.", [850_000_000])).toEqual([]);
    });

    it("numérotation non consécutive : « Phase 45 », « n° 49 », liste « 45. »", () => {
      expect(signale("Phase 45 du plan.")).toEqual(["45"]);
      expect(signale("Voir le n° 49.")).toEqual(["49"]);
      expect(signale("Phase 1, phase 2 puis phase 3.")).toEqual([]);
      expect(signale("Phase 1 puis phase 3.")).toEqual(["3"]);
      expect(signale("1. A\n2. B\n45. C")).toEqual(["45"]);
    });

    it("date absente des entrées : « 25.12.2027 » signalée, exemptée si fournie", () => {
      expect(signale("Échéance au 25.12.2027.")).toEqual(["25.12.2027"]);
      expect(signale("Échéance au 25.12.2027.", [], ["Livraison le 25/12/2027"])).toEqual([]);
    });

    it("jeton forgé « [TERME_99999] » : signalé (absent du masque)", () => {
      expect(signale("Voir [TERME_99999].")).toEqual(["[TERME_99999]"]);
      const m = creerMasque([{ valeur: "Projet Lagune", categorie: "autre" }]);
      m.masquer("Projet Lagune");
      expect(verifierChiffres("[TERME_1] et [TERME_99999]", [], {}, m).nombresNonVerifies).toEqual([
        "[TERME_99999]",
      ]);
    });

    it("arrondi au-delà de 5 % d'écart relatif : « 2 milliards » pour 1,6 milliard", () => {
      expect(signale("CA de 2 milliards.", [1_600_000_000])).toEqual(["2 milliards"]);
      expect(signale("CA de 2 milliards.", [1_980_000_000])).toEqual([]);
      expect(signale("Environ 1,5 million.", [1_523_400])).toEqual([]);
    });
  });

  it("après modification humaine, seuls les nombres signalés encore présents restent à acquitter", () => {
    expect(suspectsRestants("La marge atteindra 18 %.", ["18 %", "2 400 000 FCFA"])).toEqual([
      "18 %",
    ]);
    expect(suspectsRestants("Texte corrigé, 20 % ajouté par l'expert.", ["18 %"])).toEqual([]);
    expect(suspectsRestants("rien", [])).toEqual([]);
  });
});

describe("gabarits déterministes et prompts", () => {
  it("gabarit texte : chiffres des moteurs repris tels quels, extrait du texte, même entrée → même sortie", () => {
    const entree = {
      tache: "redaction" as const,
      schema: { type: "texte" as const },
      variables: { texte: "Première phrase. Deuxième ! Troisième ? Quatrième." },
      chiffres: [
        { libelle: "Honoraires", valeur: 2_825_000, unite: "FCFA" },
        { libelle: "Taux de marge", valeur: 12.5, unite: "%" },
      ],
    };
    const a = produireGabarit(entree);
    expect(a).toEqual(produireGabarit(entree));
    expect(a.texte).toContain(ENTETE_GABARIT);
    expect(a.texte).toContain("- Honoraires : 2\u202f825\u202f000 FCFA");
    expect(a.texte).toContain("- Taux de marge : 12,5\u202f%");
    expect(a.texte).toContain("Première phrase. Deuxième ! Troisième ?");
    expect(a.texte).not.toContain("Quatrième");
    // Le gabarit ne crée aucun nombre : la garde le confirme.
    expect(verifierChiffres(a.texte, [2_825_000, 12.5]).chiffresNonVerifies).toBe(false);
    expect(formaterNombre(-1234.5)).toBe("-1\u202f234,5");
  });

  it("gabarit objet : champs typés, choix par mots-clés sinon défaut", () => {
    const schema = {
      type: "objet" as const,
      champs: {
        tonalite: {
          type: "choix" as const,
          valeurs: ["positif", "neutre", "negatif"],
          defaut: "neutre",
        },
        justification: { type: "texte" as const },
        points: { type: "liste_texte" as const },
        urgent: { type: "booleen" as const },
      },
    };
    const r = produireGabarit({
      tache: "classification",
      schema,
      variables: { texte: "Retour très positif" },
      chiffres: [],
    });
    expect(r.donnees).toMatchObject({ tonalite: "positif", points: [], urgent: false });
    expect(validerSortie(schema, r.texte)).not.toBeNull();
    expect(choixParMotsCles(schema.champs.tonalite, "Sans avis")).toBe("neutre");
    expect(choixParMotsCles({ type: "choix", valeurs: ["a_classer", "b"] }, "rien")).toBe(
      "a_classer",
    );
  });

  it("rendu : remplacement nommé en une passe, valeurs échappées, accolades parasites refusées", () => {
    expect(extraireVariables("{{texte}} et {{chiffres}} {{texte}}")).toEqual(["texte", "chiffres"]);
    expect(() => extraireVariables("{{Texte}}")).toThrow(/variables/);
    expect(() => extraireVariables("{{ texte }}")).toThrow();
    expect(() => extraireVariables("{{#if x}}")).toThrow();
    // Une valeur qui contient un gabarit n'est jamais réinterprétée.
    expect(rendreGabarit("A {{a}} B {{b}}", { a: "{{b}}", b: "x" })).toBe("A { {b} } B x");
    expect(() => rendreGabarit("{{a}}", {})).toThrow(/manquante/);
    expect(echapperVariable("a\u0000b\nc")).toBe("a b\nc");
  });

  it("validation de la sortie : texte borné, objet JSON strict (balises tolérées)", () => {
    expect(validerSortie({ type: "texte", longueur_max: 5 }, "trop long")).toBeNull();
    expect(validerSortie({ type: "texte" }, "  ")).toBeNull();
    const schema = { type: "objet" as const, champs: { ok: { type: "booleen" as const } } };
    expect(validerSortie(schema, '```json\n{"ok": true}\n```')?.donnees).toEqual({ ok: true });
    expect(validerSortie(schema, '{"ok": true, "extra": 1}')).toBeNull();
    expect(validerSortie(schema, "pas du json")).toBeNull();
  });
});

describe("coûts estimés (tarifs à valider)", () => {
  it("coût en micro-dollars arrondi au-dessus, tarif prudent pour un modèle inconnu", () => {
    // 1 000 jetons × 3 000 n$ + 500 × 15 000 n$ = 10 500 000 n$ = 10 500 µ$.
    expect(coutMicroUsd("anthropic/claude-sonnet-4.5", 1000, 500)).toEqual({
      cout: 10_500,
      connu: true,
    });
    expect(coutMicroUsd("openai/gpt-4o-mini", 1, 0)).toEqual({ cout: 1, connu: true });
    expect(tarifDe("inconnu/modele").connu).toBe(false);
    expect(tarifDe("google/gemini-2.5-flash:nitro").connu).toBe(true);
    // Constat 9 : tarif inconnu très prudent (200 et 600 USD par million de jetons).
    expect(TARIF_INCONNU).toEqual({ entree: 200_000, sortie: 600_000 });
    expect(coutMicroUsd("inconnu/modele", 1000, 1000).cout).toBe(800_000);
  });

  it("constat 9 : seuls les modèles de la table des tarifs se choisissent (sans variante)", () => {
    expect(modeleAutorise("anthropic/claude-sonnet-4.5")).toBe(true);
    expect(modeleAutorise("openai/gpt-4o-mini")).toBe(true);
    expect(modeleAutorise("inconnu/modele")).toBe(false);
    expect(modeleAutorise("anthropic/claude-sonnet-4.5:online")).toBe(false);
    expect(modeleAutorise("constructor")).toBe(false);
  });

  it("conversion vers la devise de la mission par les fonctions exactes du moteur", () => {
    // 1 USD = 1 000 000 µ$ = 100 centimes → 600 FCFA au taux de départ.
    expect(convertirCout(1_000_000, "XOF")).toEqual({ valeur: 600, devise: "XOF" });
    expect(convertirCout(1_000_000, "USD")).toEqual({ valeur: 100, devise: "USD" });
    expect(convertirCout(1_000_000, "EUR")).toEqual({ valeur: 92, devise: "EUR" });
  });
});
