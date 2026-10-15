/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, type Api } from "./api.js";
import { demarrerAvecStockage } from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import {
  attendu,
  creerPointDd,
  dossierPret,
  INCONNU,
  preparerDd,
  type ScenarioDd,
} from "./dd-outils.js";
import { creerPreuve } from "./preuves-outils.js";
import { dezipper, toutLeXml } from "./rapports-outils.js";

/*
 * Rapport de la note au comité (DD-13, R52, R53) en Word (le PDF exige Chromium) : refus avant
 * validation (NOTE_NON_VALIDEE), deux variantes depuis la MÊME base figée (mêmes verdicts), verbatim
 * nominatif masqué, aucune clé FIN-02, niveau « dd » illisible sans dd.lire, suivi qualité ouvert,
 * débit (429), et contraintes de `rapports_mission` qui gardent tous les modèles existants.
 */

let ctx: Contexte & { dossier: string };
let s: ScenarioDd;
let dossierId: string;
let missionId: string;
let noteId: string;
let version: number;

const rapportUrl = (n: string, variante: string, format = "docx", extra = "") =>
  `/api/dd/notes/${n}/rapports?format=${format}&variante=${variante}${extra}`;

async function xmlDe(par: Api, fichierId: string): Promise<string> {
  const r = await par.get(`/api/fichiers/${fichierId}`);
  expect(r.statusCode).toBe(200);
  return toutLeXml(dezipper(r.rawPayload));
}

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  s = await preparerDd(ctx, "DD rapport");
  const pret = await dossierPret(s);
  ({ dossierId, missionId } = pret);
  // Un point sourcé par une preuve NOMINATIVE sans accord : son verbatim ne sort jamais du registre.
  const point = await creerPointDd(s.consultantEquipe, dossierId, {
    enonce: "Le climat des affaires s'améliore.",
  });
  const preuve = await creerPreuve(s.consultantEquipe, missionId, {
    source_precise: "Entretien avec Madame Dupont",
    extrait: "Verbatim secret de Madame Dupont",
    nominatif: true,
    accord_nominatif: false,
  });
  attendu(
    201,
    await s.consultantEquipe.post(`/api/assertions/${point.assertion_id}/liens`, {
      preuve_id: preuve.id,
      sens: "pour",
    }),
  );
  // Deux filtrages E&S sans règle touchée : la note nomme la liste du dernier et compte l'antérieur.
  const liste = attendu(
    201,
    await s.expertMetier.post("/api/dd/listes-exclusion", {
      nom: "Liste du rapport",
      regles: [{ code: "casino", libelle: "Jeux", mots_cles: ["casino"] }],
    }),
  );
  for (const activite of ["Culture de cacao", "Transformation de cacao"]) {
    attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${dossierId}/filtrages`, {
        liste_id: liste.id,
        declarations: { activites: [activite] },
      }),
    );
  }
  const n = attendu(
    201,
    await s.consultantEquipe.post(`/api/dd/dossiers/${dossierId}/notes`, {
      titre: "Note au comité",
      recommandation: "favorable",
      synthese: "Le dossier est solide et les verdicts sont validés.",
      conditions: [],
    }),
  );
  noteId = n.id;
}, 300_000);
afterAll(() => ctx.fermer());

describe("avant validation", () => {
  it("409 NOTE_NON_VALIDEE : brouillon, puis version soumise non validée", async () => {
    const r = await s.consultantEquipe.post(rapportUrl(noteId, "executive"));
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("NOTE_NON_VALIDEE");
    version = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/notes/${noteId}/soumission`, { version: 1 }),
    ).version;
    const r2 = await s.consultantEquipe.post(rapportUrl(noteId, "detaillee"));
    expect(r2.json().erreur.code).toBe("NOTE_NON_VALIDEE");
    expect(
      (
        await s.consultantEquipe.post(
          rapportUrl(noteId, "detaillee", "docx", `&version=${version}`),
        )
      ).json().erreur.code,
    ).toBe("NOTE_NON_VALIDEE");
  });

  it("401, 403 (sans dd.lire), 404 (autre cabinet, inconnu), 400 (format ou variante)", async () => {
    expect((await api(ctx).post(rapportUrl(noteId, "executive"))).statusCode).toBe(401);
    expect((await s.gestionnaire.post(rapportUrl(noteId, "executive"))).statusCode).toBe(403);
    expect((await s.expertExterne.post(rapportUrl(noteId, "executive"))).statusCode).toBe(403);
    expect((await s.b.associe.post(rapportUrl(noteId, "executive"))).statusCode).toBe(404);
    expect((await s.consultantEquipe.post(rapportUrl(INCONNU, "executive"))).statusCode).toBe(404);
    expect(
      (await s.consultantEquipe.post(rapportUrl(noteId, "executive", "pptx"))).statusCode,
    ).toBe(400);
    expect((await s.consultantEquipe.post(rapportUrl(noteId, "complete"))).statusCode).toBe(400);
    expect((await s.gestionnaire.get(`/api/dd/notes/${noteId}/rapports`)).statusCode).toBe(403);
    expect((await s.b.associe.get(`/api/dd/notes/${noteId}/rapports`)).statusCode).toBe(404);
  });
});

describe("après validation", () => {
  let executive: any;
  let detaillee: any;

  beforeAll(async () => {
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/notes/${noteId}/validation`, {
        version,
        decision: "valide",
      }),
    );
    executive = attendu(201, await s.consultantEquipe.post(rapportUrl(noteId, "executive")));
    detaillee = attendu(
      201,
      await s.consultantEquipe.post(rapportUrl(noteId, "detaillee", "docx", `&version=${version}`)),
    );
  });

  it("enregistre le rapport : modèle, niveau « dd », variante, version source, confidentiel", async () => {
    expect(executive.rapport).toMatchObject({
      modele: "note_comite",
      niveau: "dd",
      variante: "executive",
      version_source: version,
      dd_note_id: noteId,
      statut: "valide",
      format: "docx",
    });
    expect(detaillee.rapport).toMatchObject({ variante: "detaillee", version_source: version });
    const ligne = await proprietaire((c) =>
      c.query("SELECT genere_par FROM rapports_mission WHERE id = $1", [executive.rapport.id]),
    );
    expect(ligne.rows[0].genere_par).toBe(s.consultantEquipe.utilisateurId);
  });

  it("les deux variantes viennent de la MÊME base : mêmes verdicts ; la détaillée ajoute les sections", async () => {
    const exec = await xmlDe(s.consultantEquipe, executive.fichier.id);
    const det = await xmlDe(s.consultantEquipe, detaillee.fichier.id);
    for (const xml of [exec, det]) {
      expect(xml).toContain("Le marché croît de 8 % par an");
      expect(xml).toContain("Confirmée");
      expect(xml).toContain("Le dossier est solide et les verdicts sont validés.");
      expect(xml).toContain("Favorable");
      expect(xml).toContain("Recommandation");
    }
    for (const xml of [exec, det]) {
      expect(xml).toContain("Liste du rapport");
      expect(xml).toContain("Le dossier compte 1 filtrage(s) antérieur(s).");
      expect(xml).not.toContain("confirmée(s) dans un filtrage antérieur");
    }
    expect(det).toContain("Cadrage");
    expect(det).toContain("Sources");
    expect(det).toContain("Analyses");
    expect(exec).not.toContain("Cadrage");
    expect(exec).not.toContain("Sources");
  });

  it("verbatim nominatif masqué pour tous ; aucune donnée FIN-02", async () => {
    for (const r of [executive, detaillee]) {
      const xml = await xmlDe(s.consultantEquipe, r.fichier.id);
      expect(xml).not.toContain("Madame Dupont");
      expect(xml).not.toContain("Verbatim secret");
      expect(xml).not.toMatch(/cout_jour|taux_horaire|honoraire|marge de la mission/i);
    }
    expect(await xmlDe(s.a.associe, detaillee.fichier.id)).not.toContain("Verbatim secret");
    expect(await xmlDe(s.consultantEquipe, detaillee.fichier.id)).toContain(
      "Source nominative masquée",
    );
  });

  it("niveau « dd » : illisible sans dd.lire à chaque lecture (404, comme tout fichier inaccessible), lisible avec", async () => {
    expect((await s.gestionnaire.get(`/api/fichiers/${executive.fichier.id}`)).statusCode).toBe(
      404,
    );
    expect((await s.ressources.get(`/api/fichiers/${executive.fichier.id}`)).statusCode).toBe(404);
    expect((await s.expertExterne.get(`/api/fichiers/${executive.fichier.id}`)).statusCode).toBe(
      404,
    );
    expect((await s.b.associe.get(`/api/fichiers/${executive.fichier.id}`)).statusCode).toBe(404);
    expect((await s.expertMetier.get(`/api/fichiers/${executive.fichier.id}`)).statusCode).toBe(
      200,
    );
    expect((await s.consultantHors.get(`/api/fichiers/${executive.fichier.id}`)).statusCode).toBe(
      404,
    );
  });

  it("R53 : liste des rapports de la note ; filtrés par niveau lisible ; apparaît dans la liste de la mission", async () => {
    const l = attendu(200, await s.expertMetier.get(`/api/dd/notes/${noteId}/rapports`));
    expect(l.elements.map((r: any) => r.id).sort()).toEqual(
      [executive.rapport.id, detaillee.rapport.id].sort(),
    );
    expect(l.elements[0]).toMatchObject({
      modele: "note_comite",
      niveau: "dd",
      dd_note_id: noteId,
    });
    expect(JSON.stringify(l)).not.toMatch(/cle_stockage/);
    const mission = attendu(200, await s.gestionnaire.get(`/api/missions/${missionId}/rapports`));
    expect(mission.elements.some((r: any) => r.niveau === "dd")).toBe(false);
    const parChef = attendu(200, await s.a.chef.get(`/api/missions/${missionId}/rapports`));
    expect(parChef.elements.some((r: any) => r.niveau === "dd")).toBe(true);
  });

  it("le suivi qualité du rapport est ouvert (classe minimale R2) avec ses chiffres « moteur »", async () => {
    const suivi = await proprietaire((c) =>
      c.query(
        "SELECT id, type_livrable, classe_minimale FROM qualite_suivis WHERE livrable_id = $1",
        [executive.rapport.id],
      ),
    );
    expect(suivi.rows).toHaveLength(1);
    expect(suivi.rows[0]).toMatchObject({ type_livrable: "rapport", classe_minimale: "R2" });
    const elements = await proprietaire((c) =>
      c.query(
        "SELECT count(*)::int AS n FROM qualite_revue_elements WHERE suivi_id = $1 AND kind = 'chiffre'",
        [suivi.rows[0].id],
      ),
    );
    expect(elements.rows[0].n).toBeGreaterThan(0);
  });

  it("le journal trace la génération sans contenu", async () => {
    const j = await proprietaire((c) =>
      c.query(
        "SELECT details FROM journal_audit WHERE action = 'generation_rapport' AND entite_id = $1 ORDER BY cree_le DESC LIMIT 1",
        [missionId],
      ),
    );
    expect(j.rows[0].details).toMatchObject({
      modele: "note_comite",
      niveau: "dd",
      note_id: noteId,
    });
    expect(JSON.stringify(j.rows[0].details)).not.toMatch(/Dupont|Verbatim/);
  });

  it("429 TROP_DE_RAPPORTS au-delà de 10 générations par utilisateur sur 10 minutes", async () => {
    let dernier = 201;
    let refus: any = null;
    for (let i = 0; i < 12 && dernier === 201; i += 1) {
      const r = await s.a.chef.post(rapportUrl(noteId, "executive"));
      dernier = r.statusCode;
      if (r.statusCode === 429) refus = r.json();
    }
    expect(dernier).toBe(429);
    expect(refus.erreur.code).toBe("TROP_DE_RAPPORTS");
  });
});

describe("contraintes de rapports_mission : aucune valeur existante perdue", () => {
  it("modèles et niveaux de 0424 conservés, ceux de la note ajoutés", async () => {
    const r = await proprietaire((c) =>
      c.query(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conrelid = 'rapports_mission'::regclass AND conname LIKE 'rapports_mission_%_check'`,
      ),
    );
    const def = (nom: string) => r.rows.find((x) => x.conname === nom)?.def as string;
    for (const modele of [
      "etat_avancement",
      "notation",
      "plan_strategique",
      "dossier_bancaire",
      "note_comite",
    ]) {
      expect(def("rapports_mission_modele_check")).toContain(`'${modele}'`);
      expect(def("rapports_mission_source_check")).toContain(`'${modele}'`);
    }
    for (const niveau of ["base", "jours", "finance", "notation", "plan", "dd"]) {
      expect(def("rapports_mission_niveau_check")).toContain(`'${niveau}'`);
    }
  });

  it("un état d'avancement et un rapport de plan se génèrent toujours", async () => {
    attendu(201, await s.a.associe.post(`/api/missions/${s.mission2Id}/rapports?format=docx`));
    const plan = attendu(
      201,
      await s.a.chef.post(`/api/missions/${s.mission2Id}/plans`, { titre: "Plan pour le rapport" }),
    ).id;
    await s.a.chef.post(`/api/plans/${plan}/elements`, {
      type: "axe",
      donnees: { titre: "Croissance" },
    });
    attendu(201, await s.a.associe.post(`/api/plans/${plan}/rapports?format=docx`));
  });
});
