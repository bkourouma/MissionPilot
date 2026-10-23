/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { AppError, requeteInvalide } from "../src/errors.js";
import { lireDocument } from "../src/ingestion/documents.js";
import {
  creerBrouillon,
  deciderExtraction,
  listerExtractions,
  lireExtraction,
  modifierExtraction,
} from "../src/ingestion/extractions.js";
import { NATURES, type NatureExtractionApi } from "../src/ingestion/natures.js";
import { proprietaire } from "./helpers.js";
import { authDe } from "./ia-outils.js";
import {
  demarrerIngestion,
  ingerer,
  pdfLiasse,
  type ContexteIngestion,
} from "./ingestion-outils.js";
import { preparerCabinet, creerMission, type CabinetMissions } from "./missions-outils.js";

/*
 * Service générique des brouillons d'extraction (ADR-009 : « l'IA propose, l'expert dispose »). Les natures
 * réelles (lecture de document, proposition de standard) sont fournies par d'autres lots : le test installe une
 * nature de test et rattache les brouillons à un document d'état financier existant (la table n'impose pas
 * l'usage). Les droits sont contrôlés par les routes appelantes, pas par ce service.
 */

let ctx: ContexteIngestion;
let a: CabinetMissions;
let documentId: string;
/** Membre qui n'est ni l'auteur du document (directeur), ni le correcteur (chef), ni associé. */
let autre: Awaited<ReturnType<CabinetMissions["avecRoles"]>>;
let appliquees = 0;
const originale = NATURES.lecture_document;

const natureTest: NatureExtractionApi = {
  nature: "lecture_document",
  validerContenu(contenu) {
    const c = contenu as { elements?: unknown };
    if (!Array.isArray(c?.elements)) throw requeteInvalide("Éléments attendus.");
    return { elements: c.elements };
  },
  contientNonVerifie(contenu) {
    return (contenu.elements as { verifie?: boolean }[]).some((e) => e.verifie === false);
  },
  async appliquer(_db, _auth, extraction) {
    appliquees += 1;
    return { applique: true, elements: (extraction.contenu.elements as unknown[]).length };
  },
};

beforeAll(async () => {
  ctx = await demarrerIngestion();
  a = await preparerCabinet(ctx, "Extractions");
  ctx.cabinets.push(a.cabinetId);
  await creerMission(a);
  documentId = (
    await ingerer(ctx, a.directeur, a.clientId, "support.pdf", pdfLiasse(), { exercice: 2024 })
  ).id;
  autre = await a.avecRoles(["consultant"]);
  (NATURES as any).lecture_document = natureTest;
}, 240_000);
afterAll(async () => {
  (NATURES as any).lecture_document = originale;
  await ctx?.fermer();
});

function enTenant<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return ctx.db.withTenant(a.cabinetId, fn);
}

describe("brouillons : création, correction, décision", () => {
  it("parcours complet : brouillon, correction, séparation des tâches, acquittement, validation appliquée", async () => {
    const correcteur = await authDe(ctx, a.cabinetId, a.chef.utilisateurId);
    const associe = await authDe(ctx, a.cabinetId, a.associeId);

    const id = await enTenant(async (db) => {
      const doc = await lireDocument(db, documentId);
      const cree = await creerBrouillon(db, doc!, {
        nature: "lecture_document",
        contenu: { elements: [{ page: 1, verifie: false }] },
        iaDemandeId: null,
        chiffresNonVerifies: true,
      });
      // Un seul brouillon ouvert par document.
      await expect(
        creerBrouillon(db, doc!, {
          nature: "lecture_document",
          contenu: { elements: [] },
          iaDemandeId: null,
          chiffresNonVerifies: false,
        }),
      ).rejects.toMatchObject({ statut: 409, code: "EXTRACTION_OUVERTE" });
      return cree;
    });
    const brut = await enTenant((db) => lireExtraction(db, id));
    expect(brut).toMatchObject({
      statut: "brouillon_ia",
      cree_par: a.directeur.utilisateurId,
      // Demandeur lu dans la table : à défaut de relance, l'auteur du téléversement.
      demande_par: a.directeur.utilisateurId,
      modifie_par: null,
    });

    // Valider un brouillon à éléments non vérifiés sans acquittement : refusé.
    await enTenant(async (db) => {
      await expect(
        deciderExtraction(db, associe, id, { decision: "validee" }),
      ).rejects.toMatchObject({ statut: 409, code: "CHIFFRES_A_ACQUITTER" });
    });

    // Correction : contenu relu par la nature (invalide : 400), drapeau recalculé.
    await enTenant(async (db) => {
      await expect(
        modifierExtraction(db, correcteur, id, { elements: "non" }),
      ).rejects.toBeInstanceOf(AppError);
      const vue = await modifierExtraction(db, correcteur, id, {
        elements: [{ page: 1, verifie: true }],
      });
      expect(vue).toMatchObject({
        statut: "modifie",
        chiffres_non_verifies: false,
        modifie_par: { id: a.chef.utilisateurId },
      });
    });

    await enTenant(async (db) => {
      // Le dernier modificateur ne valide pas sa propre correction (sauf associé) : 403.
      await expect(
        deciderExtraction(db, correcteur, id, { decision: "validee" }),
      ).rejects.toMatchObject({ statut: 403, code: "VALIDATION_REQUISE" });
    });
    // Rien n'a été appliqué ni tranché par le refus.
    expect((await enTenant((db) => lireExtraction(db, id))).statut).toBe("modifie");

    // L'auteur du téléversement (directeur) ne valide pas non plus : 403 avant tout appliquer.
    const auteur = await authDe(ctx, a.cabinetId, a.directeur.utilisateurId);
    const avantAppliquer = appliquees;
    await enTenant(async (db) => {
      await expect(
        deciderExtraction(db, auteur, id, { decision: "validee" }),
      ).rejects.toMatchObject({ statut: 403, code: "VALIDATION_REQUISE" });
    });
    expect(appliquees).toBe(avantAppliquer);

    // Un autre valideur peut valider : la nature s'applique, son résultat est enregistré.
    const valideur = await authDe(ctx, a.cabinetId, autre.utilisateurId);
    const vue = await enTenant((db) =>
      deciderExtraction(db, valideur, id, { decision: "validee" }),
    );
    expect(vue).toMatchObject({
      statut: "valide",
      valide_par: { id: autre.utilisateurId },
      resultat: { applique: true, elements: 1 },
      motif_rejet: null,
    });
    expect(Object.keys(vue).sort()).toEqual(
      [
        "chiffres_non_verifies",
        "contenu",
        "cree_le",
        "document_id",
        "id",
        "modifie_le",
        "modifie_par",
        "motif_rejet",
        "nature",
        "resultat",
        "statut",
        "valide_le",
        "valide_par",
      ].sort(),
    );

    // Tranchée : plus de correction ni de décision (409).
    await enTenant(async (db) => {
      await expect(modifierExtraction(db, correcteur, id, { elements: [] })).rejects.toMatchObject({
        statut: 409,
      });
      await expect(
        deciderExtraction(db, associe, id, { decision: "validee" }),
      ).rejects.toMatchObject({
        statut: 409,
        code: "EXTRACTION_TRANCHEE",
      });
    });
  });

  it("l'associé peut valider sa propre correction ; le rejet est motivé et ne s'applique pas", async () => {
    const associe = await authDe(ctx, a.cabinetId, a.associeId);
    const id = await enTenant(async (db) =>
      creerBrouillon(db, (await lireDocument(db, documentId))!, {
        nature: "lecture_document",
        contenu: { elements: [] },
        iaDemandeId: null,
        chiffresNonVerifies: false,
      }),
    );
    await enTenant(async (db) => {
      await modifierExtraction(db, associe, id, { elements: [{ page: 2, verifie: true }] });
      const vue = await deciderExtraction(db, associe, id, { decision: "validee" });
      expect(vue.statut).toBe("valide");
    });
    const rejete = await enTenant(async (db) => {
      const id2 = await creerBrouillon(db, (await lireDocument(db, documentId))!, {
        nature: "lecture_document",
        contenu: { elements: [] },
        iaDemandeId: null,
        chiffresNonVerifies: false,
      });
      return deciderExtraction(db, associe, id2, { decision: "rejetee", motif: "Hors sujet." });
    });
    expect(rejete).toMatchObject({ statut: "rejete", motif_rejet: "Hors sujet.", resultat: null });
  });

  it("le déclencheur MQG02 est traduit en 403 VALIDATION_REQUISE et le détail du document liste les extractions", async () => {
    const correcteur = await authDe(ctx, a.cabinetId, a.chef.utilisateurId);
    const id = await enTenant(async (db) =>
      creerBrouillon(db, (await lireDocument(db, documentId))!, {
        nature: "lecture_document",
        contenu: { elements: [] },
        iaDemandeId: null,
        chiffresNonVerifies: false,
      }),
    );
    await enTenant((db) => modifierExtraction(db, correcteur, id, { elements: [] }));
    // Contrôle du service contourné par un contexte qui se dit associé : la base (MQG02) refuse quand même,
    // car l'utilisateur réel n'est pas associé.
    const sansModificateur = { ...correcteur, roles: ["associe"] as never };
    await enTenant(async (db) => {
      await expect(
        deciderExtraction(db, sansModificateur, id, { decision: "validee" }),
      ).rejects.toMatchObject({ statut: 403, code: "VALIDATION_REQUISE" });
    });
    const liste = await enTenant((db) => listerExtractions(db, documentId));
    expect(liste.length).toBeGreaterThanOrEqual(3);
    const detail = (
      await a.directeur.get(`/api/dossiers/${a.clientId}/ingestions/${documentId}`)
    ).json();
    expect(detail.extractions.map((e: any) => e.id)).toEqual(liste.map((e) => e.id));
    // Le journal ne contient pas le contenu des brouillons.
    const journal = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT details::text AS d FROM journal_audit WHERE cabinet_id = $1 AND entite = 'ingestion_extraction'",
            [a.cabinetId],
          )
        ).rows,
    );
    expect(journal.length).toBeGreaterThan(3);
    expect(JSON.stringify(journal)).not.toContain("elements");
  });
});

describe("séparation des tâches : auteur, demandeur, modificateur (MQG02)", () => {
  /** Tranche tout brouillon ouvert du document (rejet par l'associé, SQL propriétaire). */
  async function viderOuverts(): Promise<void> {
    await proprietaire((c) =>
      c.query(
        `UPDATE ingestion_extractions SET statut = 'rejete', valide_par = $2, valide_le = now(),
           motif_rejet = 'ménage de test' WHERE document_id = $1 AND statut IN ('brouillon_ia', 'modifie')`,
        [documentId, a.associeId],
      ),
    );
  }

  /** Brouillon inséré en SQL avec un demandeur (≠ auteur) : ce que produit une relance par ce demandeur. */
  async function brouillonDemande(demandeur: string): Promise<string> {
    await viderOuverts();
    const r = await proprietaire((c) =>
      c.query(
        `INSERT INTO ingestion_extractions (cabinet_id, document_id, nature, contenu, cree_par, demande_par)
         VALUES ($1, $2, 'lecture_document', '{"elements": []}', $3, $4) RETURNING id`,
        [a.cabinetId, documentId, a.directeur.utilisateurId, demandeur],
      ),
    );
    return r.rows[0].id as string;
  }

  it("le demandeur de la lecture ne valide pas, avant tout appliquer ; ni l'auteur ; un tiers valide", async () => {
    const id = await brouillonDemande(autre.utilisateurId);
    const demandeur = await authDe(ctx, a.cabinetId, autre.utilisateurId);
    const auteur = await authDe(ctx, a.cabinetId, a.directeur.utilisateurId);
    const tiers = await authDe(ctx, a.cabinetId, a.chef.utilisateurId);
    const avant = appliquees;
    await enTenant(async (db) => {
      for (const acteur of [demandeur, auteur]) {
        await expect(
          deciderExtraction(db, acteur, id, { decision: "validee" }),
        ).rejects.toMatchObject({ statut: 403, code: "VALIDATION_REQUISE" });
      }
    });
    expect(appliquees).toBe(avant);
    expect((await enTenant((db) => lireExtraction(db, id))).statut).toBe("brouillon_ia");
    // Le rejet n'est pas concerné par la séparation des tâches.
    const vue = await enTenant((db) =>
      deciderExtraction(db, demandeur, id, { decision: "rejetee", motif: "Hors sujet." }),
    );
    expect(vue.statut).toBe("rejete");
    const id2 = await brouillonDemande(autre.utilisateurId);
    const valide = await enTenant((db) =>
      deciderExtraction(db, tiers, id2, { decision: "validee" }),
    );
    expect(valide.statut).toBe("valide");
    expect(appliquees).toBe(avant + 1);
  });

  it("l'associé (demandeur ou auteur) peut valider", async () => {
    const id = await brouillonDemande(a.associeId);
    const associe = await authDe(ctx, a.cabinetId, a.associeId);
    const vue = await enTenant((db) => deciderExtraction(db, associe, id, { decision: "validee" }));
    expect(vue).toMatchObject({ statut: "valide", valide_par: { id: a.associeId } });
  });

  it("contournement par SQL direct : la base refuse (MQG02) l'auteur, le demandeur et le modificateur ; l'associé passe", async () => {
    const id = await brouillonDemande(autre.utilisateurId);
    // Le chef corrige (modificateur).
    const chef = await authDe(ctx, a.cabinetId, a.chef.utilisateurId);
    await enTenant((db) => modifierExtraction(db, chef, id, { elements: [] }));
    const valider = (par: string) =>
      proprietaire((c) =>
        c.query(
          "UPDATE ingestion_extractions SET statut = 'valide', valide_par = $2, valide_le = now() WHERE id = $1",
          [id, par],
        ),
      );
    for (const interdit of [a.directeur.utilisateurId, autre.utilisateurId, a.chef.utilisateurId]) {
      await expect(valider(interdit)).rejects.toMatchObject({ code: "MQG02" });
    }
    expect((await enTenant((db) => lireExtraction(db, id))).statut).toBe("modifie");
    // Un associé passe (même règle que l'API).
    await valider(a.associeId);
    expect((await enTenant((db) => lireExtraction(db, id))).statut).toBe("valide");
  });
});
