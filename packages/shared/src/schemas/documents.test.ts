import { describe, expect, it } from "vitest";
import {
  commentaireCreationSchema,
  commentaireModificationSchema,
  documentDepotSchema,
  documentStatutSchema,
  EXTENSIONS_FICHIER,
  fichierTelechargementQuerySchema,
  tacheCollaborationCreationSchema,
  tacheCollaborationModificationSchema,
  TYPES_FICHIER,
} from "../index";

const ID = "00000000-0000-4000-8000-000000000001";

describe("documents et fichiers (SOC-05, SOC-06)", () => {
  it("dépôt : contrat existant accepté, fichier OU chemin, statut initial brouillon IA seulement", () => {
    expect(documentDepotSchema.safeParse({ type: "livrable", nom: "R" }).success).toBe(true);
    expect(
      documentDepotSchema.safeParse({ type: "livrable", nom: "R", chemin_stockage: "a/b.pdf" })
        .success,
    ).toBe(true);
    expect(
      documentDepotSchema.safeParse({ type: "livrable", nom: "R", fichier_id: ID }).success,
    ).toBe(true);
    expect(
      documentDepotSchema.safeParse({
        type: "livrable",
        nom: "R",
        fichier_id: ID,
        chemin_stockage: "a/b.pdf",
      }).success,
    ).toBe(false);
    expect(
      documentDepotSchema.safeParse({ type: "livrable", nom: "R", statut_contenu: "valide" })
        .success,
    ).toBe(false);
    expect(documentDepotSchema.safeParse({ type: "livrable", nom: "R", inconnu: 1 }).success).toBe(
      false,
    );
    expect(documentStatutSchema.safeParse({ statut: "brouillon_ia" }).success).toBe(false);
  });

  it("chaque type de fichier a au moins une extension ; affichage borné", () => {
    for (const t of TYPES_FICHIER) expect(EXTENSIONS_FICHIER[t].length).toBeGreaterThan(0);
    expect(fichierTelechargementQuerySchema.safeParse({ affichage: "inline" }).success).toBe(true);
    expect(fichierTelechargementQuerySchema.safeParse({ affichage: "x" }).success).toBe(false);
  });
});

describe("commentaires et tâches (SOC-08)", () => {
  const base = { entite_type: "mission", entite_id: ID, texte: "Bonjour" };

  it("commentaire : texte brut borné, mentions dédoublonnées, type d'entité en liste blanche", () => {
    const r = commentaireCreationSchema.parse({ ...base, mentions: [ID, ID] });
    expect(r.mentions).toEqual([ID]);
    expect(commentaireCreationSchema.parse(base).mentions).toEqual([]);
    // Le HTML est du texte : accepté tel quel, jamais interprété.
    expect(commentaireCreationSchema.parse({ ...base, texte: "<script>x</script>" }).texte).toBe(
      "<script>x</script>",
    );
    expect(commentaireCreationSchema.safeParse({ ...base, texte: "  " }).success).toBe(false);
    expect(commentaireCreationSchema.safeParse({ ...base, texte: "a\u0000b" }).success).toBe(false);
    expect(commentaireCreationSchema.safeParse({ ...base, texte: "x".repeat(5001) }).success).toBe(
      false,
    );
    expect(commentaireCreationSchema.safeParse({ ...base, entite_type: "client" }).success).toBe(
      false,
    );
    expect(
      commentaireCreationSchema.safeParse({ ...base, mentions: Array(21).fill(ID) }).success,
    ).toBe(false);
    expect(commentaireModificationSchema.safeParse({ texte: "ok", auteur_id: ID }).success).toBe(
      false,
    );
  });

  it("tâche : échéance bornée, entité liée complète, modification non vide", () => {
    const t = { titre: "Relire", assignee_id: ID };
    expect(tacheCollaborationCreationSchema.parse(t)).toMatchObject({
      description: "",
      echeance: null,
    });
    expect(
      tacheCollaborationCreationSchema.safeParse({ ...t, echeance: "2101-01-01" }).success,
    ).toBe(false);
    expect(
      tacheCollaborationCreationSchema.safeParse({ ...t, entite_type: "mission" }).success,
    ).toBe(false);
    expect(
      tacheCollaborationCreationSchema.safeParse({ ...t, entite_type: "mission", entite_id: ID })
        .success,
    ).toBe(true);
    expect(tacheCollaborationModificationSchema.safeParse({}).success).toBe(false);
    expect(tacheCollaborationModificationSchema.safeParse({ statut: "annulee" }).success).toBe(
      false,
    );
  });
});
