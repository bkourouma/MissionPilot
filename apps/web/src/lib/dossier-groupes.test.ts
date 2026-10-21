import { MOTIF_EXCLUSION_GROUPE_LIBELLES, MOTIFS_EXCLUSION_GROUPE } from "@missionpilot/shared";
import { describe, expect, it } from "vitest";
import {
  aplatirStructure,
  cheminApiGroupe,
  estDateIso,
  estFinDeDetention,
  formaterDateJour,
  formaterFiabiliteGroupe,
  formaterIndicateur,
  formaterPart,
  libelleMotifExclusion,
  libelleNoeud,
  libelleParticipation,
  lignesIndicateurs,
  lireParametresGroupe,
  lirePourcentage,
  participationsActives,
  pointsVersSaisie,
  requeteGroupe,
  saisieParticipationVide,
  validerParticipation,
  type GroupeApi,
  type IndicateursConsolides,
  type NoeudGroupe,
  type ParticipationApi,
} from "./dossier-groupes";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const NBSP = " ";
const NNBSP = " ";

describe("pourcentages", () => {
  it("affiche les points de base avec une virgule", () => {
    expect(formaterPart(6000)).toBe(`60${NBSP}%`);
    expect(formaterPart(3333)).toBe(`33,33${NBSP}%`);
    expect(formaterPart(10000)).toBe(`100${NBSP}%`);
    expect(formaterPart(0)).toBe(`0${NBSP}%`);
    expect(formaterPart(null)).toBe("—");
    expect(pointsVersSaisie(3333)).toBe("33,33");
  });

  it("lit un pourcentage saisi à la française", () => {
    expect(lirePourcentage("33,33")).toEqual({ ok: true, points: 3333 });
    expect(lirePourcentage(" 60 % ")).toEqual({ ok: true, points: 6000 });
    expect(lirePourcentage("0")).toEqual({ ok: true, points: 0 });
    expect(lirePourcentage("100")).toEqual({ ok: true, points: 10000 });
    expect(lirePourcentage("0,29")).toEqual({ ok: true, points: 29 });
  });

  it("refuse vide, illisible, hors bornes et trop précis", () => {
    expect(lirePourcentage("").ok).toBe(false);
    expect(lirePourcentage("abc").ok).toBe(false);
    expect(lirePourcentage("-1").ok).toBe(false);
    expect(lirePourcentage("100,01").ok).toBe(false);
    expect(lirePourcentage("33,333").ok).toBe(false);
  });
});

describe("dates", () => {
  it("affiche JJ/MM/AAAA", () => {
    expect(formaterDateJour("2026-10-20")).toBe("20/10/2026");
    expect(formaterDateJour("2026-10-20T10:00:00.000Z")).toBe("20/10/2026");
    expect(formaterDateJour(null)).toBe("—");
  });
  it("valide un jour calendaire", () => {
    expect(estDateIso("2026-02-29")).toBe(false);
    expect(estDateIso("2028-02-29")).toBe(true);
    expect(estDateIso("20/10/2026")).toBe(false);
  });
});

describe("libellés", () => {
  it("reprend les libellés du paquet partagé pour chaque motif", () => {
    for (const m of MOTIFS_EXCLUSION_GROUPE) {
      expect(libelleMotifExclusion(m)).toBe(MOTIF_EXCLUSION_GROUPE_LIBELLES[m]);
    }
  });
  it("anonymise un noeud non visible", () => {
    expect(libelleNoeud({ visible: false })).toBe("Dossier non visible avec vos droits");
    expect(libelleNoeud({ visible: true, nom: "Alpha" })).toBe("Alpha");
  });
  it("libelle une fin de détention", () => {
    expect(libelleParticipation({ points_base: 0 })).toBe("Fin de détention");
    expect(libelleParticipation({ points_base: 2500 })).toBe(`25${NBSP}%`);
  });
});

describe("indicateurs", () => {
  const valeurs: IndicateursConsolides = {
    actif: 1500000,
    passif: null,
    charges: 123450,
    produits: 200000,
    resultat: -5000,
    marge_nette_bps: 1250,
  };
  it("formate montants et marge, tiret si absent", () => {
    expect(formaterIndicateur("actif", valeurs, "XOF")).toBe(`1${NNBSP}500${NNBSP}000${NBSP}FCFA`);
    expect(formaterIndicateur("charges", valeurs, "EUR")).toBe(`1${NNBSP}234,50${NBSP}€`);
    expect(formaterIndicateur("passif", valeurs, "XOF")).toBe("—");
    expect(formaterIndicateur("actif", valeurs, null)).toBe("—");
    expect(formaterIndicateur("marge_nette", valeurs, "XOF")).toBe(`12,5${NBSP}%`);
  });
  it("produit six lignes dans l'ordre", () => {
    const lignes = lignesIndicateurs(valeurs, "XOF", {
      actif: "Total de l'actif",
      passif: "Total du passif",
      charges: "Total des charges",
      produits: "Total des produits",
      resultat: "Résultat",
      marge_nette: "Marge nette",
    });
    expect(lignes.map((l) => l.cle)).toEqual([
      "actif",
      "passif",
      "charges",
      "produits",
      "resultat",
      "marge_nette",
    ]);
  });
  it("formate la fiabilité", () => {
    expect(formaterFiabiliteGroupe(null)).toBe("—");
    expect(formaterFiabiliteGroupe(640)).toContain("640 sur 1");
  });
});

const noeud = (p: Partial<NoeudGroupe> & { niveau: number }): NoeudGroupe => ({
  visible: true,
  part_cumulee_bps: 10000,
  ...p,
});

function groupe(vue: "client" | "tete"): GroupeApi {
  return {
    date: "2026-10-20",
    vue,
    exercice: 2025,
    client: { id: A, nom: "Alpha" },
    avertissement: "x",
    regles: {
      seuil_controle_points: 5000,
      base_points: 10000,
      profondeur_max: 8,
      ponderation_fiabilite: "part_cumulee",
      conversion_devise: false,
      textes: [],
    },
    indicateurs: {
      actif: "a",
      passif: "p",
      charges: "c",
      produits: "pr",
      resultat: "r",
      marge_nette: "m",
    },
    structure: {
      racine: noeud({ id: A, nom: "Alpha", niveau: 0 }),
      tete: noeud({ id: B, nom: "Tête", niveau: 1, part_cumulee_bps: 6000 }),
      detenteurs: [noeud({ id: B, nom: "Tête", niveau: 1, part_cumulee_bps: 6000 })],
      filiales: [
        noeud({ visible: false, niveau: 2, part_cumulee_bps: 1000 }),
        noeud({ id: "f1", nom: "Filiale 1", niveau: 1, part_cumulee_bps: 5000 }),
      ],
      arbre_tete: [
        noeud({ visible: false, niveau: 2, part_cumulee_bps: 300 }),
        noeud({ id: A, nom: "Alpha", niveau: 1, part_cumulee_bps: 6000 }),
      ],
      liens: [],
    },
    consolidation: {
      devise: "XOF",
      exercice: 2025,
      partielle: false,
      perimetre: { inclus: [], exclus: [] },
      integrale: {} as IndicateursConsolides,
      proportionnelle: {} as IndicateursConsolides,
      fiabilite: { moyenne_ponderee: null, ponderation: "part_cumulee" },
    },
  };
}

describe("aplatirStructure", () => {
  it("vue client : détenteurs, dossier, filiales triées par niveau puis part", () => {
    const blocs = aplatirStructure(groupe("client"));
    expect(blocs.map((b) => b.id)).toEqual(["detenteurs", "dossier", "filiales"]);
    expect(blocs[1]?.lignes[0]?.estDossier).toBe(true);
    const fil = blocs[2]?.lignes ?? [];
    expect(fil.map((l) => l.libelle)).toEqual(["Filiale 1", "Dossier non visible avec vos droits"]);
    expect(fil.map((l) => l.profondeur)).toEqual([0, 1]);
  });
  it("vue tête : un seul bloc commençant par la société de tête, dossier repéré", () => {
    const blocs = aplatirStructure(groupe("tete"));
    expect(blocs).toHaveLength(1);
    const l = blocs[0]?.lignes ?? [];
    expect(l.map((x) => x.libelle)).toEqual([
      "Tête",
      "Alpha",
      "Dossier non visible avec vos droits",
    ]);
    expect(l.map((x) => x.profondeur)).toEqual([0, 1, 2]);
    expect(l.map((x) => x.estDossier)).toEqual([false, true, false]);
  });
  it("n'expose aucun nom ni identifiant pour un noeud anonyme", () => {
    const anon = (aplatirStructure(groupe("tete"))[0]?.lignes ?? []).find((l) => !l.noeud.visible);
    expect(anon?.noeud.id).toBeUndefined();
    expect(anon?.noeud.nom).toBeUndefined();
  });
});

describe("participations en vigueur", () => {
  const p = (
    id: string,
    points: number,
    date: string,
    creeLe: string,
    visible = true,
  ): ParticipationApi => ({
    id,
    detenteur: { visible: true, id: A, nom: "Alpha" },
    filiale: visible ? { visible: true, id: B, nom: "Bravo" } : { visible: false },
    points_base: points,
    date_effet: date,
    fin_de_detention: points === 0,
    motif: null,
    cree_par: { id: "u", nom: "Moi" },
    cree_le: creeLe,
  });
  it("retient le dernier enregistrement de la paire à la date", () => {
    const h = [
      p("3", 7000, "2026-06-01", "2026-06-02T00:00:00Z"),
      p("2", 5000, "2026-01-01", "2026-01-02T00:00:00Z"),
      p("4", 9000, "2027-01-01", "2026-07-01T00:00:00Z"),
    ];
    expect(participationsActives(h, "2026-10-20").map((x) => x.id)).toEqual(["3"]);
  });
  it("écarte les fins de détention et les parties non visibles", () => {
    expect(
      participationsActives(
        [p("2", 0, "2026-06-01", "b"), p("1", 5000, "2026-01-01", "a")],
        "2026-10-20",
      ),
    ).toEqual([]);
    expect(participationsActives([p("1", 5000, "2026-01-01", "a", false)], "2026-10-20")).toEqual(
      [],
    );
  });
});

describe("paramètres et chemins", () => {
  it("lit des paramètres sûrs", () => {
    expect(lireParametresGroupe({})).toEqual({ vue: "tete" });
    expect(lireParametresGroupe({ vue: "client", exercice: "2025", date: "2026-10-20" })).toEqual({
      vue: "client",
      exercice: 2025,
      date: "2026-10-20",
    });
    expect(lireParametresGroupe({ vue: "x", exercice: "abc", date: "2026-13-01" })).toEqual({
      vue: "tete",
    });
    expect(lireParametresGroupe({ exercice: "1800" })).toEqual({ vue: "tete" });
  });
  it("construit la requête", () => {
    expect(requeteGroupe({ vue: "client", exercice: 2025 })).toBe("vue=client&exercice=2025");
    expect(cheminApiGroupe("id", { vue: "tete", date: "2026-01-01" })).toBe(
      "/api/dossiers/id/groupe?vue=tete&date=2026-01-01",
    );
  });
});

describe("validerParticipation", () => {
  const base = { ...saisieParticipationVide("2026-10-20"), autre_id: B, pourcentage: "60" };
  it("construit le corps selon le sens", () => {
    expect(validerParticipation(A, base)).toEqual({
      ok: true,
      charge: { detenteur_id: A, filiale_id: B, points_base: 6000, date_effet: "2026-10-20" },
    });
    expect(validerParticipation(A, { ...base, sens: "detenu", motif: " Rachat " })).toEqual({
      ok: true,
      charge: {
        detenteur_id: B,
        filiale_id: A,
        points_base: 6000,
        date_effet: "2026-10-20",
        motif: "Rachat",
      },
    });
  });
  it("exige le motif à 0 % (fin de détention)", () => {
    const fin = { ...base, pourcentage: "0" };
    expect(estFinDeDetention(fin)).toBe(true);
    expect(estFinDeDetention(base)).toBe(false);
    const r = validerParticipation(A, fin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.motif).toMatch(/obligatoire/);
    expect(validerParticipation(A, { ...fin, motif: "Cession" }).ok).toBe(true);
  });
  it("signale chaque champ invalide", () => {
    const r = validerParticipation(A, {
      sens: "detient",
      autre_id: "",
      pourcentage: "101",
      date_effet: "",
      motif: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual(["autre_id", "date_effet", "pourcentage"]);
    }
  });
  it("refuse de se détenir soi-même, un motif trop long et une date hors bornes", () => {
    expect(validerParticipation(A, { ...base, autre_id: A }).ok).toBe(false);
    expect(validerParticipation(A, { ...base, motif: "x".repeat(501) }).ok).toBe(false);
    expect(validerParticipation(A, { ...base, date_effet: "1999-01-01" }).ok).toBe(false);
  });
});
