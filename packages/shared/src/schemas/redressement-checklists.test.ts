import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import {
  RED_CHECKLIST_AIDE_MAX,
  RED_CHECKLIST_COMMENTAIRE_MAX,
  RED_CHECKLIST_ITEMS_MAX,
  RED_CHECKLIST_LIBELLE_MAX,
  RED_CHECKLIST_MENTION_A_VALIDER,
  RED_CHECKLIST_ORIGINES,
  RED_CHECKLIST_ORIGINE_LIBELLES,
  RED_CHECKLIST_PLAFONDS,
  RED_CHECKLIST_REPONSES,
  RED_CHECKLIST_REPONSE_LIBELLES,
  RED_CHECKLIST_STATUTS,
  RED_CHECKLIST_STATUTS_VERSION,
  RED_CHECKLIST_STATUT_LIBELLES,
  RED_CHECKLIST_STATUT_VERSION_LIBELLES,
  libellesChecklists,
  redChecklistActivationSchema,
  redChecklistArchivageSchema,
  redChecklistItemSchema,
  redChecklistModeleCreationSchema,
  redChecklistModelesQuerySchema,
  redChecklistPublicationSchema,
  redChecklistReponsesLotSchema,
  redChecklistVersionCreationSchema,
  redChecklistsQuerySchema,
} from "./redressement-checklists";

const ok = (schema: ZodTypeAny, valeur: unknown): boolean => schema.safeParse(valeur).success;
const UUID = "6f0c1f0e-2b1a-4c3d-9e4f-0a1b2c3d4e5f";

const item = (extra: Record<string, unknown> = {}) => ({
  id: "t1",
  domaine: "tresorerie",
  libelle: "Le prévisionnel est-il à jour ?",
  ...extra,
});
const modele = (extra: Record<string, unknown> = {}) => ({
  code: "mon-modele",
  intitule: "Mon modèle",
  secteur: "industrie",
  items: [item()],
  ...extra,
});

describe("constantes et libellés des check-lists", () => {
  it("chaque valeur a un libellé français non vide, sans terme juridique", () => {
    for (const [valeurs, libelles] of [
      [RED_CHECKLIST_REPONSES, RED_CHECKLIST_REPONSE_LIBELLES],
      [RED_CHECKLIST_ORIGINES, RED_CHECKLIST_ORIGINE_LIBELLES],
      [RED_CHECKLIST_STATUTS_VERSION, RED_CHECKLIST_STATUT_VERSION_LIBELLES],
      [RED_CHECKLIST_STATUTS, RED_CHECKLIST_STATUT_LIBELLES],
    ] as const) {
      expect(Object.keys(libelles).sort()).toEqual([...valeurs].sort());
      for (const l of Object.values(libelles)) expect(l.length).toBeGreaterThan(0);
    }
    const tous = libellesChecklists();
    expect(tous).toContain(RED_CHECKLIST_MENTION_A_VALIDER);
    expect(RED_CHECKLIST_MENTION_A_VALIDER).toContain("à valider par un expert");
    for (const l of tous) {
      for (const mot of ["cessation des paiements", "faillite", "défaillance", "en difficulté"]) {
        expect(l.toLowerCase()).not.toContain(mot);
      }
    }
  });

  it("plafonds cohérents", () => {
    expect(RED_CHECKLIST_PLAFONDS).toEqual({
      modeles_par_cabinet: 100,
      versions_par_modele: 30,
      checklists_par_dossier: 30,
      reponses_par_checklist: 2000,
      reponses_par_lot: RED_CHECKLIST_ITEMS_MAX,
    });
  });
});

describe("modèles et versions", () => {
  it("item : valide ; identifiant, domaine, libellé et aide bornés ; champ inconnu refusé", () => {
    expect(ok(redChecklistItemSchema, item())).toBe(true);
    expect(redChecklistItemSchema.parse(item({ aide: "  " })).aide).toBeNull();
    expect(ok(redChecklistItemSchema, item({ aide: "Voir le classeur" }))).toBe(true);
    for (const id of ["", "A", "-a", "a b", "é", "x".repeat(41)]) {
      expect(ok(redChecklistItemSchema, item({ id })), id).toBe(false);
    }
    expect(ok(redChecklistItemSchema, item({ domaine: "juridique" }))).toBe(false);
    expect(ok(redChecklistItemSchema, item({ libelle: "  " }))).toBe(false);
    expect(
      ok(redChecklistItemSchema, item({ libelle: "x".repeat(RED_CHECKLIST_LIBELLE_MAX + 1) })),
    ).toBe(false);
    expect(ok(redChecklistItemSchema, item({ aide: "x".repeat(RED_CHECKLIST_AIDE_MAX + 1) }))).toBe(
      false,
    );
    expect(ok(redChecklistItemSchema, item({ poids: 2 }))).toBe(false);
  });

  it("création de modèle : valide, code, secteur, items bornés et uniques, corps strict", () => {
    expect(ok(redChecklistModeleCreationSchema, modele())).toBe(true);
    expect(ok(redChecklistModeleCreationSchema, modele({ motif: "Première version" }))).toBe(true);
    for (const code of ["", "a", "A-b", "-ab", "a b", "x".repeat(41)]) {
      expect(ok(redChecklistModeleCreationSchema, modele({ code })), code).toBe(false);
    }
    expect(ok(redChecklistModeleCreationSchema, modele({ secteur: "mines" }))).toBe(false);
    expect(ok(redChecklistModeleCreationSchema, modele({ intitule: " " }))).toBe(false);
    expect(ok(redChecklistModeleCreationSchema, modele({ items: [] }))).toBe(false);
    const quarante = Array.from({ length: RED_CHECKLIST_ITEMS_MAX }, (_, i) =>
      item({ id: `i${i}` }),
    );
    expect(ok(redChecklistModeleCreationSchema, modele({ items: quarante }))).toBe(true);
    expect(
      ok(
        redChecklistModeleCreationSchema,
        modele({ items: [...quarante, item({ id: "de-trop" })] }),
      ),
    ).toBe(false);
    expect(ok(redChecklistModeleCreationSchema, modele({ items: [item(), item()] }))).toBe(false);
    expect(ok(redChecklistModeleCreationSchema, modele({ extra: 1 }))).toBe(false);
  });

  it("nouvelle version : items et motif ; publication et filtres stricts", () => {
    expect(ok(redChecklistVersionCreationSchema, { items: [item()] })).toBe(true);
    expect(ok(redChecklistVersionCreationSchema, { items: [item()], motif: "x".repeat(501) })).toBe(
      false,
    );
    expect(ok(redChecklistVersionCreationSchema, { items: [item()], code: "x" })).toBe(false);
    expect(ok(redChecklistPublicationSchema, {})).toBe(true);
    expect(ok(redChecklistPublicationSchema, { exces: 1 })).toBe(false);
    expect(ok(redChecklistModelesQuerySchema, {})).toBe(true);
    expect(ok(redChecklistModelesQuerySchema, { secteur: "services" })).toBe(true);
    expect(ok(redChecklistModelesQuerySchema, { secteur: "mines" })).toBe(false);
    expect(ok(redChecklistModelesQuerySchema, { x: 1 })).toBe(false);
  });
});

describe("activation, réponses, archivage", () => {
  it("activation : départ par code, modèle par identifiant ; origine inconnue ou champ en trop refusés", () => {
    expect(ok(redChecklistActivationSchema, { origine: "depart", code: "depart_industrie" })).toBe(
      true,
    );
    expect(ok(redChecklistActivationSchema, { origine: "modele", modele_id: UUID })).toBe(true);
    expect(ok(redChecklistActivationSchema, { origine: "modele", modele_id: "x" })).toBe(false);
    expect(ok(redChecklistActivationSchema, { origine: "modele", code: "x" })).toBe(false);
    expect(ok(redChecklistActivationSchema, { origine: "depart" })).toBe(false);
    expect(ok(redChecklistActivationSchema, { origine: "autre" })).toBe(false);
    expect(
      ok(redChecklistActivationSchema, { origine: "depart", code: "depart_industrie", x: 1 }),
    ).toBe(false);
  });

  it("lot de réponses : 1 à 40, un item une fois, réponses connues, commentaire borné", () => {
    const r = (item_id: string, reponse = "oui", extra: Record<string, unknown> = {}) => ({
      item_id,
      reponse,
      ...extra,
    });
    expect(ok(redChecklistReponsesLotSchema, { reponses: [r("a"), r("b", "sans_objet")] })).toBe(
      true,
    );
    expect(
      redChecklistReponsesLotSchema.parse({ reponses: [r("a", "non", { commentaire: " " })] })
        .reponses[0]?.commentaire,
    ).toBeNull();
    expect(ok(redChecklistReponsesLotSchema, { reponses: [] })).toBe(false);
    expect(ok(redChecklistReponsesLotSchema, { reponses: [r("a"), r("a", "non")] })).toBe(false);
    expect(ok(redChecklistReponsesLotSchema, { reponses: [r("a", "peut-etre")] })).toBe(false);
    expect(ok(redChecklistReponsesLotSchema, { reponses: [r("")] })).toBe(false);
    expect(
      ok(redChecklistReponsesLotSchema, {
        reponses: [r("a", "oui", { commentaire: "x".repeat(RED_CHECKLIST_COMMENTAIRE_MAX + 1) })],
      }),
    ).toBe(false);
    expect(ok(redChecklistReponsesLotSchema, { reponses: [r("a", "oui", { poids: 1 })] })).toBe(
      false,
    );
    const quarante = Array.from({ length: 40 }, (_, i) => r(`i${i}`));
    expect(ok(redChecklistReponsesLotSchema, { reponses: quarante })).toBe(true);
    expect(ok(redChecklistReponsesLotSchema, { reponses: [...quarante, r("de-trop")] })).toBe(
      false,
    );
    expect(ok(redChecklistReponsesLotSchema, { reponses: [r("a")], extra: 1 })).toBe(false);
  });

  it("archivage et liste : motif facultatif borné, filtre de statut", () => {
    expect(ok(redChecklistArchivageSchema, {})).toBe(true);
    expect(ok(redChecklistArchivageSchema, { motif: "Activée par erreur" })).toBe(true);
    expect(ok(redChecklistArchivageSchema, { motif: "x".repeat(501) })).toBe(false);
    expect(ok(redChecklistArchivageSchema, { exces: 1 })).toBe(false);
    expect(redChecklistsQuerySchema.parse({}).statut).toBe("active");
    expect(redChecklistsQuerySchema.parse({ statut: "toutes" }).statut).toBe("toutes");
    expect(ok(redChecklistsQuerySchema, { statut: "supprimee" })).toBe(false);
  });
});
