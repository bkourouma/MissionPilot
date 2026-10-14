/* eslint-disable @typescript-eslint/no-explicit-any */
import { THEMES_ES } from "@missionpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Api } from "./api.js";
import { demarrerAvecStockage } from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import {
  assertionHypotheseDd,
  attendu,
  colonnesVersion,
  creerDossierDd,
  creerHypotheseDd,
  dossierPret,
  inserer,
  json,
  missionDd,
  preparerDd,
  sql,
  type ScenarioDd,
} from "./dd-outils.js";
import { creerPreuve } from "./preuves-outils.js";
import { dezipper, toutLeXml } from "./rapports-outils.js";

/*
 * Corrections de la seconde passe d'audit de sécurité du lot 3b (I1 à I4, M1 à M5) : un verdict
 * validé ne survit pas à la modification de son hypothèse ni à celle de ses sources, une note
 * validée ne se rend plus si le dossier a changé, une décision d'exclusion ne vient pas de l'auteur
 * d'un filtrage plus récent, plafonds et tailles bornés, mots-clés significatifs et bornés.
 */

let ctx: Contexte & { dossier: string };
let s: ScenarioDd;

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  s = await preparerDd(ctx, "DD corrections 2");
}, 300_000);
afterAll(() => ctx.fermer());

const PREUVE_A = {
  type_source: "document",
  source_precise: "Rapport annuel de la filière, page 14",
  date_preuve: "2026-09-30",
  fiabilite: "A",
  extrait: "Les volumes exportés progressent chaque année.",
} as const;
const PREUVE_B = {
  type_source: "entretien",
  source_precise: "Entretien avec un exportateur, 12 octobre",
  date_preuve: "2026-10-12",
  fiabilite: "B",
  extrait: "Le marché est porteur depuis trois ans.",
} as const;

/** Source « solide » (document A + entretien B) ; renvoie les identifiants des deux preuves. */
async function sourceSolide(mission: string, assertionId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const corps of [PREUVE_A, PREUVE_B]) {
    const p = await creerPreuve(s.consultantEquipe, mission, corps);
    attendu(
      201,
      await s.consultantEquipe.post(`/api/assertions/${assertionId}/liens`, {
        preuve_id: p.id,
        sens: "pour",
      }),
    );
    ids.push(p.id);
  }
  return ids;
}

/** Hypothèse de consultantEquipe à deux assertions solides ; verdict proposé (et validé si demandé). */
async function hypotheseEtVerdict(dossier: string, mission: string, valider: boolean) {
  const h = await creerHypotheseDd(s.consultantEquipe, dossier);
  const assertions: string[] = [];
  const preuves: string[][] = [];
  for (let i = 0; i < 2; i += 1) {
    const a = await assertionHypotheseDd(s.consultantEquipe, h.id, { enonce: `Source ${i}.` });
    preuves.push(await sourceSolide(mission, a.assertion_id));
    assertions.push(a.assertion_id);
  }
  const v = attendu(
    201,
    await s.consultantEquipe.post(`/api/dd/hypotheses/${h.id}/verdicts`, {
      hypothese_version: 1,
      verdict: "confirmee",
      motif: "Sources solides et concordantes.",
      assertions_citees: assertions,
    }),
  );
  if (valider) {
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/verdicts/${v.id}/validation`, { decision: "valide" }),
    );
  }
  return { h: h.id, assertions, preuves, verdict: v.id as string };
}

async function nouveauDossier() {
  const m = await missionDd(s);
  const d = (await creerDossierDd(s.consultantEquipe, m)).id;
  return { m, d };
}

/* ------------------------------------------------------------------------------------------- */

describe("I1 : un verdict validé ne reste pas en vigueur quand son hypothèse change", () => {
  it("libellé, description et critère ne se modifient plus tant qu'un verdict validé existe (409 HYPOTHESE_AVEC_VERDICT)", async () => {
    const { m, d } = await nouveauDossier();
    const x = await hypotheseEtVerdict(d, m, true);
    for (const corps of [
      { libelle: "Un autre libellé" },
      { description: "Une description ajoutée" },
      { critere: "Un autre critère" },
    ]) {
      const r = await s.consultantEquipe.post(`/api/dd/hypotheses/${x.h}/versions`, {
        version_courante: 1,
        motif: "Reformulation.",
        ...corps,
      });
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().erreur.code).toBe("HYPOTHESE_AVEC_VERDICT");
    }
    const l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/hypotheses`));
    const noeud = l.noeuds.find((n: any) => n.id === x.h);
    expect(noeud.version).toBe(1);
    expect(noeud.etat).toBe("confirmee");
  });

  it("une hypothèse sans verdict validé reste modifiable (verdict en attente compris)", async () => {
    const { m, d } = await nouveauDossier();
    const x = await hypotheseEtVerdict(d, m, false);
    attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/hypotheses/${x.h}/versions`, {
        version_courante: 1,
        motif: "Reformulation.",
        libelle: "Libellé précisé",
      }),
    );
    const libre = await creerHypotheseDd(s.consultantEquipe, d);
    attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/hypotheses/${libre.id}/versions`, {
        version_courante: 1,
        motif: "Reformulation.",
        critere: "Critère précisé",
      }),
    );
  });

  it("un verdict validé sur une version périmée (hypothèse changée hors API) n'est plus en vigueur : ouverte, et la note est bloquée", async () => {
    const { m, d } = await nouveauDossier();
    const x = await hypotheseEtVerdict(d, m, true);
    await inserer("dd_element_versions", {
      cabinet_id: s.a.cabinetId,
      element_id: x.h,
      type: "hypothese",
      version: 2,
      auteur_id: s.consultant2.utilisateurId,
      motif: "Hypothèse modifiée hors API.",
      retire: false,
      ...colonnesVersion("hypothese", { libelle: "Hypothèse réécrite après le verdict" }),
    });
    const l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/hypotheses`));
    const noeud = l.noeuds.find((n: any) => n.id === x.h);
    expect(noeud.version).toBe(2);
    expect(noeud.verdict_en_vigueur).toBeNull();
    expect(noeud.etat).toBe("ouverte");
    const syn = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/synthese`));
    expect(syn.controle_note.bloquants).toContain("HYPOTHESE_SANS_VERDICT_VALIDE");
  });
});

/* ------------------------------------------------------------------------------------------- */

describe("I2 : les routes génériques du registre ne contournent pas la garde ASSERTION_CITEE", () => {
  const corpsVersion = (h: string, extra: Record<string, unknown>) => ({
    enonce: "Source 0.",
    classe_risque: "R2",
    statut: "retenue",
    rattachement_type: "hypothese",
    rattachement_code: h,
    livrable: "Note au comité — due diligence",
    motif: "Correction.",
    ...extra,
  });

  it("assertion citée par un verdict retenu : ni abandon, ni nouvel énoncé, ni retrait ou changement de sens d'une preuve", async () => {
    const { m, d } = await nouveauDossier();
    const x = await hypotheseEtVerdict(d, m, true);
    const a = x.assertions[0] as string;
    const url = `/api/assertions/${a}/versions`;
    const abandon = await s.consultantEquipe.post(url, corpsVersion(x.h, { statut: "abandonnee" }));
    expect(abandon.statusCode, abandon.body).toBe(409);
    expect(abandon.json().erreur.code).toBe("ASSERTION_CITEE");
    const enonce = await s.consultantEquipe.post(
      url,
      corpsVersion(x.h, { enonce: "Autre énoncé." }),
    );
    expect(enonce.json().erreur.code).toBe("ASSERTION_CITEE");
    const retrait = await s.consultantEquipe.delete(
      `/api/assertions/${a}/liens/${x.preuves[0]?.[0]}`,
    );
    expect(retrait.statusCode, retrait.body).toBe(409);
    expect(retrait.json().erreur.code).toBe("ASSERTION_CITEE");
    const sens = await s.consultantEquipe.post(`/api/assertions/${a}/liens`, {
      preuve_id: x.preuves[0]?.[0],
      sens: "contre",
    });
    expect(sens.statusCode, sens.body).toBe(409);
    expect(sens.json().erreur.code).toBe("ASSERTION_CITEE");
    // Compatibilité du registre : une correction qui ne touche ni l'énoncé ni le statut, et
    // l'ajout d'une preuve de plus, restent permis.
    attendu(201, await s.consultantEquipe.post(url, corpsVersion(x.h, { classe_risque: "R3" })));
    const autre = await creerPreuve(s.consultantEquipe, m, PREUVE_A);
    attendu(
      201,
      await s.consultantEquipe.post(`/api/assertions/${a}/liens`, {
        preuve_id: autre.id,
        sens: "pour",
      }),
    );
  });

  it("une assertion non citée garde le comportement du registre", async () => {
    const { m, d } = await nouveauDossier();
    const h = await creerHypotheseDd(s.consultantEquipe, d);
    const a = await assertionHypotheseDd(s.consultantEquipe, h.id, { enonce: "Libre." });
    const [preuve] = await sourceSolide(m, a.assertion_id);
    attendu(
      200,
      await s.consultantEquipe.delete(`/api/assertions/${a.assertion_id}/liens/${preuve}`),
    );
    attendu(
      201,
      await s.consultantEquipe.post(
        `/api/assertions/${a.assertion_id}/versions`,
        corpsVersion(h.id, { enonce: "Libre, reformulée.", statut: "abandonnee" }),
      ),
    );
  });

  it("la solidité d'une source citée a changé depuis la proposition : la validation est refusée (VERDICT_PERIME)", async () => {
    const { m, d } = await nouveauDossier();
    const x = await hypotheseEtVerdict(d, m, false);
    // Une preuve contraire (nouveau lien : permis) divise l'indice par deux.
    const contre = await creerPreuve(s.consultantEquipe, m, PREUVE_B);
    attendu(
      201,
      await s.consultantEquipe.post(`/api/assertions/${x.assertions[0]}/liens`, {
        preuve_id: contre.id,
        sens: "contre",
      }),
    );
    const r = await s.expertMetier.post(`/api/dd/verdicts/${x.verdict}/validation`, {
      decision: "valide",
    });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().erreur.code).toBe("VERDICT_PERIME");
    // Un verdict périmé reste rejetable.
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/verdicts/${x.verdict}/validation`, {
        decision: "rejete",
        motif: "La solidité d'une source a changé.",
      }),
    );
  });

  it("une source d'un verdict validé qui se dégrade ensuite ne laisse pas le verdict en vigueur", async () => {
    const { m, d } = await nouveauDossier();
    const x = await hypotheseEtVerdict(d, m, true);
    const contre = await creerPreuve(s.consultantEquipe, m, PREUVE_B);
    attendu(
      201,
      await s.consultantEquipe.post(`/api/assertions/${x.assertions[0]}/liens`, {
        preuve_id: contre.id,
        sens: "contre",
      }),
    );
    const l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/hypotheses`));
    const noeud = l.noeuds.find((n: any) => n.id === x.h);
    expect(noeud.verdict_en_vigueur).toBeNull();
    expect(noeud.etat).toBe("ouverte");
  });
});

/* ------------------------------------------------------------------------------------------- */

describe("I3 : le rapport d'une note revérifie l'état du dossier et la version", () => {
  const rapport = (note: string, extra = "") =>
    `/api/dd/notes/${note}/rapports?format=docx&variante=executive${extra}`;

  async function noteValidee() {
    const { dossierId, missionId } = await dossierPret(s);
    const n = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${dossierId}/notes`, {
        titre: "Note",
        recommandation: "favorable",
        synthese: "Dossier solide.",
        conditions: [],
      }),
    );
    const version = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/notes/${n.id}/soumission`, { version: 1 }),
    ).version;
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/notes/${n.id}/validation`, {
        version,
        decision: "valide",
      }),
    );
    return { dossierId, missionId, noteId: n.id as string, version: version as number };
  }

  it("un bloquant réapparu depuis la validation interdit le rapport (409 NOTE_BLOQUEE)", async () => {
    const { dossierId, noteId } = await noteValidee();
    const liste = attendu(
      201,
      await s.expertMetier.post("/api/dd/listes-exclusion", {
        nom: `Après validation ${dossierId}`,
        regles: [{ code: "casino", libelle: "Jeux", mots_cles: ["casino"] }],
      }),
    );
    attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${dossierId}/filtrages`, {
        liste_id: liste.id,
        declarations: { activites: ["Casino"] },
      }),
    );
    const r = await s.consultantEquipe.post(rapport(noteId));
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().erreur.code).toBe("NOTE_BLOQUEE");
    expect(r.json().erreur.details.manquants).toContain("EXCLUSION_NON_LEVEE_FAVORABLE");
  });

  it("une version soumise plus récente, rejetée ou en attente, périme la version validée (409 NOTE_PERIMEE)", async () => {
    const { noteId, version } = await noteValidee();
    attendu(201, await s.consultantEquipe.post(rapport(noteId)));
    const brouillon = (courante: number) =>
      s.consultantEquipe.post(`/api/dd/notes/${noteId}/versions`, {
        recommandation: "favorable",
        synthese: "Nouvelle rédaction.",
        conditions: [],
        version_courante: courante,
        motif: "Révision.",
      });
    const v3 = attendu(201, await brouillon(version)).version;
    const v4 = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/notes/${noteId}/soumission`, { version: v3 }),
    ).version;
    // En attente.
    for (const extra of ["", `&version=${version}`]) {
      const r = await s.consultantEquipe.post(rapport(noteId, extra));
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json().erreur.code).toBe("NOTE_PERIMEE");
    }
    // Rejetée : la version validée plus ancienne reste périmée.
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/notes/${noteId}/validation`, {
        version: v4,
        decision: "rejete",
        motif: "Révision refusée.",
      }),
    );
    const r = await s.consultantEquipe.post(rapport(noteId, `&version=${version}`));
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().erreur.code).toBe("NOTE_PERIMEE");
  });

  it("le rapport porte la mention « Base figée le … » dans la section recommandation", async () => {
    const { noteId } = await noteValidee();
    const r = attendu(201, await s.consultantEquipe.post(rapport(noteId)));
    const fichier = await s.consultantEquipe.get(`/api/fichiers/${r.fichier.id}`);
    const xml = toutLeXml(dezipper(fichier.rawPayload));
    expect(xml).toMatch(/Base figée le \d{2}\/\d{2}\/\d{4}/);
  });
});

/* ------------------------------------------------------------------------------------------- */

describe("I4 et M1 : décisions d'exclusion et exclusions antérieures", () => {
  async function listeJeux(nom: string) {
    return attendu(
      201,
      await s.expertMetier.post("/api/dd/listes-exclusion", {
        nom,
        regles: [{ code: "casino", libelle: "Jeux d'argent", mots_cles: ["casino"] }],
      }),
    ).id as string;
  }
  const filtrage = (d: string, liste: string, activites: string[], par: Api = s.consultantEquipe) =>
    par.post(`/api/dd/dossiers/${d}/filtrages`, { liste_id: liste, declarations: { activites } });
  const ecartee = {
    regle_code: "casino",
    decision: "ecartee",
    motif: "Faux positif prétendu, sans tiers.",
  };

  it("I4 : seul le dernier filtrage reçoit une décision (409 FILTRAGE_PERIME) ; l'auteur du dernier ne lève pas l'exclusion d'un filtrage antérieur", async () => {
    const { d } = await nouveauDossier();
    const liste = await listeJeux(`I4 ${d}`);
    const f1 = attendu(201, await filtrage(d, liste, ["Casino"])).id;
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/filtrages/${f1}/decisions`, {
        regle_code: "casino",
        decision: "confirmee",
        motif: "Exclusion confirmée par l'expert.",
      }),
    );
    // Le chef (non associé) fait le filtrage suivant, puis tente d'écarter l'exclusion du premier.
    const f2 = attendu(201, await filtrage(d, liste, ["Culture de cacao"], s.a.chef)).id;
    const r = await s.a.chef.post(`/api/dd/filtrages/${f1}/decisions`, ecartee);
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().erreur.code).toBe("FILTRAGE_PERIME");
    // Même un tiers ne décide que sur le dernier filtrage.
    const tiers = await s.expertMetier.post(`/api/dd/filtrages/${f1}/decisions`, {
      ...ecartee,
      motif: "Faux positif constaté par un tiers.",
    });
    expect(tiers.statusCode, tiers.body).toBe(409);
    expect(tiers.json().erreur.code).toBe("FILTRAGE_PERIME");
    const l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/filtrages`));
    expect(l.synthese.bloquant).toBe(true);
    expect(l.exclusions_anterieures_non_levees).toEqual([
      { regle: "casino", libelle: "Jeux d'argent" },
    ]);
    // Sur le dernier filtrage : refus de son auteur, décision d'un tiers admise.
    const propre = await s.a.chef.post(`/api/dd/filtrages/${f2}/decisions`, ecartee);
    expect(propre.statusCode).toBe(403);
    expect(propre.json().erreur.code).toBe("SEPARATION_DES_TACHES");
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/filtrages/${f2}/decisions`, {
        ...ecartee,
        motif: "Faux positif constaté par un tiers.",
      }),
    );
    expect(
      attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/filtrages`)).synthese.bloquant,
    ).toBe(false);
  });

  it("I4 (base, MPZ28) : l'auteur d'un filtrage plus récent ne décide pas sur un filtrage antérieur", async () => {
    const { d } = await nouveauDossier();
    const liste = await listeJeux(`I4 base ${d}`);
    const f1 = attendu(201, await filtrage(d, liste, ["Casino"])).id;
    attendu(201, await filtrage(d, liste, ["Culture de cacao"], s.a.chef));
    const base = {
      cabinet_id: s.a.cabinetId,
      filtrage_id: f1,
      regle_code: "casino",
      decision: "ecartee",
      motif: "Faux positif prétendu, sans tiers.",
    };
    await expect(
      inserer("dd_filtrage_decisions", { ...base, decideur_id: s.a.chef.utilisateurId }),
    ).rejects.toMatchObject({ code: "MPZ28" });
    // Un tiers, et un associé, restent admis.
    expect(
      (
        await inserer("dd_filtrage_decisions", {
          ...base,
          decideur_id: s.expertMetier.utilisateurId,
        })
      ).decision,
    ).toBe("ecartee");
    expect(
      (await inserer("dd_filtrage_decisions", { ...base, decideur_id: s.a.associeId })).decision,
    ).toBe("ecartee");
  });

  it("M1 : une exclusion touchée et non décidée d'un filtrage antérieur survit à un nouveau filtrage", async () => {
    const { d } = await nouveauDossier();
    const liste = await listeJeux(`M1 ${d}`);
    attendu(201, await filtrage(d, liste, ["Casino"]));
    const f2 = attendu(201, await filtrage(d, liste, ["Culture de cacao"])).id;
    let l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/filtrages`));
    expect(l.exclusions_anterieures_non_levees).toEqual([
      { regle: "casino", libelle: "Jeux d'argent" },
    ]);
    expect(l.synthese).toMatchObject({ bloquant: true, touches_bloquantes: 1 });
    // Un tiers la lève dans le dernier filtrage : plus de blocage.
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/filtrages/${f2}/decisions`, {
        ...ecartee,
        motif: "Faux positif constaté par un tiers.",
      }),
    );
    l = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d}/filtrages`));
    expect(l.exclusions_anterieures_non_levees).toEqual([]);
    expect(l.synthese.bloquant).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------- */

describe("M2 : plafonds et tailles bornées", () => {
  it("événements de liens par hypothèse : 409 PLAFOND_ATTEINT", async () => {
    const { d } = await nouveauDossier();
    const h = await creerHypotheseDd(s.consultantEquipe, d);
    const a = await assertionHypotheseDd(s.consultantEquipe, h.id, {
      enonce: "Source du journal.",
    });
    // Le journal compte déjà 1 événement (le lien de la création) : 199 autres, en alternance.
    await proprietaire(async (c) => {
      for (let i = 2; i <= 200; i += 1) {
        const lier = i % 2 === 1;
        await c.query(
          `INSERT INTO dd_hypothese_liens (cabinet_id, dossier_id, hypothese_id, assertion_id,
             action, sens, cree_par) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            s.a.cabinetId,
            d,
            h.id,
            a.assertion_id,
            lier ? "lier" : "delier",
            lier ? "soutient" : null,
            s.consultantEquipe.utilisateurId,
          ],
        );
      }
    });
    const r = await s.consultantEquipe.post(`/api/dd/hypotheses/${h.id}/liens`, {
      assertion_id: a.assertion_id,
      action: "lier",
      sens: "soutient",
    });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().erreur.code).toBe("PLAFOND_ATTEINT");
    const r2 = await s.consultantEquipe.post(`/api/dd/hypotheses/${h.id}/assertions`, {
      sens: "soutient",
      enonce: "Une de plus.",
      classe_risque: "R2",
    });
    expect(r2.json().erreur.code).toBe("PLAFOND_ATTEINT");
  });

  it("décisions par filtrage : 409 PLAFOND_ATTEINT", async () => {
    const { d } = await nouveauDossier();
    const liste = attendu(
      201,
      await s.expertMetier.post("/api/dd/listes-exclusion", {
        nom: `Plafond des décisions ${d}`,
        regles: [{ code: "casino", libelle: "Jeux", mots_cles: ["casino"] }],
      }),
    ).id;
    const f = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${d}/filtrages`, {
        liste_id: liste,
        declarations: { activites: ["Casino"] },
      }),
    ).id;
    await proprietaire(async (c) => {
      for (let i = 0; i < 200; i += 1) {
        await c.query(
          `INSERT INTO dd_filtrage_decisions (cabinet_id, filtrage_id, regle_code, decision, motif,
             decideur_id) VALUES ($1, $2, 'casino', $3, 'Décision répétée du journal.', $4)`,
          [s.a.cabinetId, f, i % 2 === 0 ? "confirmee" : "ecartee", s.expertMetier.utilisateurId],
        );
      }
    });
    const r = await s.expertMetier.post(`/api/dd/filtrages/${f}/decisions`, {
      regle_code: "casino",
      decision: "confirmee",
      motif: "Une décision de trop.",
    });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().erreur.code).toBe("PLAFOND_ATTEINT");
  });

  it("déclarations et thèmes d'un filtrage : au-delà de 20 000 octets, 400 qui nomme le champ", async () => {
    const { d } = await nouveauDossier();
    const liste = attendu(
      201,
      await s.expertMetier.post("/api/dd/listes-exclusion", {
        nom: `Octets du filtrage ${d}`,
        regles: [{ code: "casino", libelle: "Jeux", mots_cles: ["casino"] }],
      }),
    ).id;
    const lourdes = await s.consultantEquipe.post(`/api/dd/dossiers/${d}/filtrages`, {
      liste_id: liste,
      declarations: { activites: Array.from({ length: 30 }, () => "あ".repeat(300)) },
    });
    expect(lourdes.statusCode, lourdes.body).toBe(400);
    expect(lourdes.json().erreur.message).toMatch(/déclarations/i);
    const themes = await s.consultantEquipe.post(`/api/dd/dossiers/${d}/filtrages`, {
      liste_id: liste,
      declarations: { activites: ["Culture de cacao"] },
      themes: THEMES_ES.map((code) => ({
        code,
        niveau: "modere",
        justification: "あ".repeat(1000),
      })),
    });
    expect(themes.statusCode, themes.body).toBe(400);
    expect(themes.json().erreur.message).toMatch(/thèmes/i);
  });

  it("assertions citées d'un verdict : au-delà de 20 000 octets, la base refuse", async () => {
    const { m, d } = await nouveauDossier();
    const x = await hypotheseEtVerdict(d, m, true);
    await expect(
      inserer("dd_verdicts", {
        cabinet_id: s.a.cabinetId,
        dossier_id: d,
        hypothese_id: x.h,
        hypothese_version: 1,
        verdict: "non_concluante",
        indication_moteur: "non_concluante",
        motif: "Motif suffisant pour la base de données.",
        assertions_citees: json([
          {
            assertion_id: x.assertions[0],
            version: 1,
            sens: "soutient",
            indice_num: 1,
            indice_den: 1,
            lecture: "solide",
            remplissage: "x".repeat(25_000),
          },
        ]),
        proposee_par: s.consultantEquipe.utilisateurId,
      }),
    ).rejects.toMatchObject({ code: "23514", constraint: "dd_verdicts_citees_octets" });
  });

  it("règles d'une liste : le plafond de la base suit celui du schéma (100 règles au maximum admises) ; au-delà de 700 000 octets, 400 qui nomme les règles", async () => {
    const regle = (i: number, mot: string, libelle: string) => ({
      code: `r${i}`,
      libelle,
      mots_cles: Array.from({ length: 10 }, (_, j) => `${j}${mot}`.slice(0, 60).padEnd(60, mot)),
      secteur_codes: Array.from({ length: 20 }, (_, j) => `s${i}-${j}`.padEnd(120, "x")),
      pays_codes: Array.from({ length: 20 }, (_, j) => `p${i}-${j}`.padEnd(120, "x")),
    });
    const maximum = await s.expertMetier.post("/api/dd/listes-exclusion", {
      nom: "Règles au maximum du schéma",
      regles: Array.from({ length: 100 }, (_, i) => regle(i, "m", "L".repeat(200))),
    });
    expect(maximum.statusCode, maximum.body.slice(0, 300)).toBe(201);
    const trop = await s.expertMetier.post("/api/dd/listes-exclusion", {
      nom: "Règles trop lourdes",
      regles: Array.from({ length: 100 }, (_, i) => regle(i, "あ", "あ".repeat(200))),
    });
    expect(trop.statusCode, trop.body.slice(0, 300)).toBe(400);
    expect(trop.json().erreur.message).toMatch(/règles/i);
    // Alignement SQL / schéma : 101 règles (valides par ailleurs) sont refusées par la base.
    const liste = attendu(
      201,
      await s.expertMetier.post("/api/dd/listes-exclusion", {
        nom: "Alignement des plafonds",
        regles: [{ code: "a", libelle: "A", mots_cles: ["a"] }],
      }),
    ).id;
    await expect(
      sql(
        `INSERT INTO dd_exclusion_liste_versions (cabinet_id, liste_id, version, regles, motif, cree_par)
         SELECT cabinet_id, id, 2, $2::jsonb, 'Alignement.', cree_par FROM dd_exclusion_listes
         WHERE id = $1`,
        [
          liste,
          JSON.stringify(
            Array.from({ length: 101 }, (_, i) => ({
              code: `r${i}`,
              libelle: "Règle",
              mots_cles: ["a"],
              secteur_codes: [],
              pays_codes: [],
            })),
          ),
        ],
      ),
    ).rejects.toBeTruthy();
  });
});

/* ------------------------------------------------------------------------------------------- */

describe("M3 et M4 : mots-clés significatifs et bornés", () => {
  const liste = (mots: string[], nom: string) =>
    s.expertMetier.post("/api/dd/listes-exclusion", {
      nom,
      regles: [{ code: "r", libelle: "Règle", mots_cles: mots }],
    });

  it("M3 : un mot-clé sans lettre ni chiffre est refusé (400), par le schéma et par la base", async () => {
    expect((await liste(["---"], "Mot-clé vide 1")).statusCode).toBe(400);
    expect((await liste(["casino", "!!!"], "Mot-clé vide 2")).statusCode).toBe(400);
    attendu(201, await liste(["c++", "Café 24"], "Mots-clés significatifs"));
    const id = attendu(201, await liste(["casino"], "Mot-clé vide, base")).id;
    await expect(
      sql(
        `INSERT INTO dd_exclusion_liste_versions (cabinet_id, liste_id, version, regles, motif, cree_par)
         SELECT cabinet_id, id, 2, $2::jsonb, 'Mot-clé sans lettre.', cree_par
         FROM dd_exclusion_listes WHERE id = $1`,
        [
          id,
          JSON.stringify([
            { code: "r", libelle: "Règle", mots_cles: ["--"], secteur_codes: [], pays_codes: [] },
          ]),
        ],
      ),
    ).rejects.toMatchObject({ code: "MPZ22" });
  });

  it("M4 : au plus 5 mots par mot-clé et 60 mots par activité déclarée (400)", async () => {
    expect((await liste(["un deux trois quatre cinq six"], "Six mots")).statusCode).toBe(400);
    const ok = attendu(201, await liste(["un deux trois quatre cinq"], "Cinq mots")).id;
    const d = (await nouveauDossier()).d;
    const filtrer = (activite: string) =>
      s.consultantEquipe.post(`/api/dd/dossiers/${d}/filtrages`, {
        liste_id: ok,
        declarations: { activites: [activite] },
      });
    expect((await filtrer(Array.from({ length: 61 }, () => "mot").join(" "))).statusCode).toBe(400);
    expect((await filtrer(Array.from({ length: 60 }, () => "mot").join(" "))).statusCode).toBe(201);
  });
});

/* ------------------------------------------------------------------------------------------- */

describe("M5 : compteurs antérieurs absents d'une note déjà figée", () => {
  it("une base figée sans filtrages_anterieurs ni exclusions_anterieures_non_levees se rend (valeur 0)", async () => {
    const { dossierId } = await dossierPret(s);
    const n = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/dossiers/${dossierId}/notes`, {
        titre: "Note ancienne",
        recommandation: "favorable",
        synthese: "Dossier solide.",
        conditions: [],
      }),
    );
    const v = attendu(
      201,
      await s.consultantEquipe.post(`/api/dd/notes/${n.id}/soumission`, { version: 1 }),
    ).version;
    const base = attendu(
      200,
      await s.expertMetier.get(`/api/dd/notes/${n.id}?version=${v}`),
    ).base_figee;
    delete base.filtrage_es.filtrages_anterieurs;
    delete base.filtrage_es.exclusions_anterieures_non_levees;
    // Une note figée avant l'ajout des deux compteurs : nouvelle version soumise, sans eux.
    await inserer("dd_note_versions", {
      cabinet_id: s.a.cabinetId,
      note_id: n.id,
      version: v + 1,
      etat: "soumise",
      recommandation: "favorable",
      synthese: "Dossier solide.",
      conditions: [],
      base_figee: json(base),
      soumise_le: new Date(),
      motif: "Base ancienne.",
      cree_par: s.consultantEquipe.utilisateurId,
    });
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/notes/${n.id}/validation`, {
        version: v + 1,
        decision: "valide",
      }),
    );
    const r = await s.consultantEquipe.post(
      `/api/dd/notes/${n.id}/rapports?format=docx&variante=detaillee`,
    );
    expect(r.statusCode, r.body).toBe(201);
  });
});
