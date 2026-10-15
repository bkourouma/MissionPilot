import { describe, expect, it } from "vitest";
import {
  canoniser,
  chaineProbante,
  EMPREINTE_ZERO,
  ErreurCanaux,
  type EvenementChaine,
  type EvenementPreuve,
  peutSigner,
  type SignataireEtat,
  type StatutSignataire,
  statutDemande,
  verifierChaine,
} from "./index";

/* SHA-256 de référence écrit pour le test (le moteur n'importe pas node:crypto : le hachage est
   injecté). Les empreintes de la SPEC §18.2 servent de vecteurs de contrôle. */
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const rotd = (x: number, n: number) => (x >>> n) | (x << (32 - n));

function sha256(texte: string): string {
  const octets = [...new TextEncoder().encode(texte)];
  const bits = octets.length * 8;
  octets.push(0x80);
  while (octets.length % 64 !== 56) octets.push(0);
  for (let i = 7; i >= 0; i--) octets.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 0xff);
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  for (let bloc = 0; bloc < octets.length; bloc += 64) {
    const w = new Array<number>(64).fill(0);
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((octets[bloc + i * 4] as number) << 24) |
        ((octets[bloc + i * 4 + 1] as number) << 16) |
        ((octets[bloc + i * 4 + 2] as number) << 8) |
        (octets[bloc + i * 4 + 3] as number);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      const s0 = rotd(w15, 7) ^ rotd(w15, 18) ^ (w15 >>> 3);
      const s1 = rotd(w2, 17) ^ rotd(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const S1 = rotd(e, 6) ^ rotd(e, 11) ^ rotd(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[i] as number) + (w[i] as number)) | 0;
      const S0 = rotd(a, 2) ^ rotd(a, 13) ^ rotd(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => {
      h[i] = ((h[i] as number) + v) | 0;
    });
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

const EMPREINTE_DOC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"; // SHA-256("abc")

describe("SHA-256 du test (vecteurs connus)", () => {
  it("abc et la chaîne vide", () => {
    expect(sha256("abc")).toBe(EMPREINTE_DOC);
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

const sig = (id: string, rang: number, statut: StatutSignataire): SignataireEtat => ({
  id,
  rang,
  statut,
});
const AVANT = new Date("2026-10-20T00:00:00.000Z");
const APRES = new Date("2026-11-20T00:00:00.000Z");
const EXPIRE = new Date("2026-11-01T00:00:00.000Z");

describe("statutDemande (SPEC §18.2)", () => {
  const base = { ordre: "parallele" as const, expireLe: EXPIRE, maintenant: AVANT, annulee: false };
  const statuts = (...s: StatutSignataire[]) => s.map((statut) => ({ statut }));

  it("trois signataires en parallèle : deux signent, partielle ; trois, signee", () => {
    expect(statutDemande({ ...base, signataires: statuts("signe", "signe", "invite") })).toBe(
      "partielle",
    );
    expect(statutDemande({ ...base, signataires: statuts("signe", "signe", "signe") })).toBe(
      "signee",
    );
  });

  it("personne n'a signé : envoyee", () => {
    expect(statutDemande({ ...base, signataires: statuts("invite", "invite") })).toBe("envoyee");
    expect(statutDemande({ ...base, signataires: [] })).toBe("envoyee");
  });

  it("un refus : refusee ; l'annulation l'emporte sur tout", () => {
    expect(statutDemande({ ...base, signataires: statuts("signe", "refuse", "invite") })).toBe(
      "refusee",
    );
    expect(
      statutDemande({ ...base, annulee: true, signataires: statuts("signe", "refuse", "signe") }),
    ).toBe("annulee");
  });

  it("échéance dépassée sans statut final : expiree, même avec un seul signataire", () => {
    expect(
      statutDemande({ ...base, maintenant: APRES, signataires: statuts("signe", "invite") }),
    ).toBe("expiree");
    // L'échéance exacte n'est pas dépassée.
    expect(
      statutDemande({ ...base, maintenant: EXPIRE, signataires: statuts("signe", "invite") }),
    ).toBe("partielle");
    // Tous ont signé avant l'échéance dépassée : la demande reste signée.
    expect(
      statutDemande({ ...base, maintenant: APRES, signataires: statuts("signe", "signe") }),
    ).toBe("signee");
  });
});

describe("peutSigner (SPEC §18.2)", () => {
  const s1 = sig("s1", 1, "invite");
  const s2 = sig("s2", 2, "invite");
  const entree = (ecart: Partial<Parameters<typeof peutSigner>[0]> = {}) => ({
    demande: { statut: "envoyee" as const, expireLe: EXPIRE, maintenant: AVANT },
    signataire: s1,
    ordre: "parallele" as const,
    signataires: [s1, s2],
    ...ecart,
  });

  it("autorise un signataire invité d'une demande ouverte", () => {
    expect(peutSigner(entree())).toEqual({ autorise: true, refus: null });
    expect(peutSigner(entree({ signataire: s2 })).autorise).toBe(true); // parallèle : pas d'ordre
  });

  it("séquentiel : le rang 2 qui signe avant le rang 1 est refusé", () => {
    expect(peutSigner(entree({ ordre: "sequentiel", signataire: s2 }))).toEqual({
      autorise: false,
      refus: "ORDRE_NON_RESPECTE",
    });
    // Même quand le rang 2 n'a pas encore été invité.
    const attente = sig("s2", 2, "en_attente");
    expect(
      peutSigner(entree({ ordre: "sequentiel", signataire: attente, signataires: [s1, attente] })),
    ).toEqual({ autorise: false, refus: "ORDRE_NON_RESPECTE" });
    // Le rang 1 signe, puis le rang 2 est invité et peut signer.
    const fait = sig("s1", 1, "signe");
    expect(
      peutSigner(entree({ ordre: "sequentiel", signataire: s2, signataires: [fait, s2] })).autorise,
    ).toBe(true);
    expect(peutSigner(entree({ ordre: "sequentiel", signataire: s1 })).autorise).toBe(true);
  });

  it("déjà signé : DEJA_SIGNE", () => {
    const fait = sig("s1", 1, "signe");
    expect(peutSigner(entree({ signataire: fait, signataires: [fait, s2] })).refus).toBe(
      "DEJA_SIGNE",
    );
  });

  it("demande terminée, brouillon ou expirée", () => {
    for (const statut of ["signee", "refusee", "annulee", "expiree", "brouillon"] as const) {
      expect(
        peutSigner(entree({ demande: { statut, expireLe: EXPIRE, maintenant: AVANT } })).refus,
        statut,
      ).toBe("DEMANDE_TERMINEE");
    }
    expect(
      peutSigner(entree({ demande: { statut: "partielle", expireLe: EXPIRE, maintenant: APRES } }))
        .refus,
    ).toBe("DEMANDE_EXPIREE");
    // L'échéance exacte n'est pas dépassée.
    expect(
      peutSigner(entree({ demande: { statut: "envoyee", expireLe: EXPIRE, maintenant: EXPIRE } }))
        .autorise,
    ).toBe(true);
  });

  it("non invité (en attente en parallèle, refusé, expiré)", () => {
    for (const statut of ["en_attente", "refuse", "expire"] as const) {
      const autre = sig("s1", 1, statut);
      expect(
        peutSigner(entree({ signataire: autre, signataires: [autre, s2] })).refus,
        statut,
      ).toBe("NON_INVITE");
    }
  });
});

describe("canoniser", () => {
  it("clés triées à tous les niveaux, sans espace", () => {
    expect(canoniser({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
    expect(canoniser({})).toBe("{}");
    expect(canoniser([])).toBe("[]");
    expect(canoniser('a"b')).toBe('"a\\"b"');
    expect(canoniser(true)).toBe("true");
    expect(canoniser(null)).toBe("null");
  });

  it("omet les valeurs indéfinies d'un objet, remplace celles d'un tableau par null", () => {
    expect(canoniser({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canoniser([undefined, 1])).toBe("[null,1]");
  });

  it("refuse ce qui n'est pas du JSON", () => {
    for (const mauvais of [
      Number.NaN,
      Infinity,
      () => 1,
      new Date(),
      10n,
      undefined,
      Symbol("x"),
    ]) {
      expect(() => canoniser(mauvais)).toThrowError(ErreurCanaux);
    }
    expect(() => canoniser(Object.create({ herite: 1 }))).toThrowError(ErreurCanaux);
    // Un objet sans prototype est admis.
    expect(canoniser(Object.assign(Object.create(null), { a: 1 }))).toBe('{"a":1}');
  });
});

describe("chaîne probante (SPEC §18.2 : SHA-256 réel injecté)", () => {
  const e1: EvenementPreuve = {
    rang: 1,
    type: "demande_creee",
    signataireId: null,
    horodatage: new Date("2026-10-12T08:00:00.000Z"),
    empreinteDocument: EMPREINTE_DOC,
    donnees: {},
  };
  const e2: EvenementPreuve = {
    rang: 2,
    type: "invitation_envoyee",
    signataireId: "sig-1",
    horodatage: "2026-10-12T08:00:01.000Z",
    empreinteDocument: EMPREINTE_DOC,
    donnees: { canal: "application" },
  };

  it("empreintes de la spécification", () => {
    const chaine = chaineProbante([e1, e2], sha256);
    expect(chaine[0]).toMatchObject({
      rang: 1,
      empreintePrecedente: EMPREINTE_ZERO,
      empreinte: "0955156d09a1ed45ccf7268432fbb04411dba94fc01785526fd75fe3d430fbe8",
    });
    expect(chaine[1]).toMatchObject({
      rang: 2,
      empreintePrecedente: "0955156d09a1ed45ccf7268432fbb04411dba94fc01785526fd75fe3d430fbe8",
      empreinte: "f4718e857cdffaf442e5a5e01da638f752d2938478b43e733cbb57bfb17e295d",
    });
    expect(EMPREINTE_ZERO).toBe("0".repeat(64));
  });

  it("le texte haché est exactement `précédente \\n rang|type|signataire|horodatage|document|données`", () => {
    const vus: string[] = [];
    chaineProbante([e1, e2], (t) => {
      vus.push(t);
      return sha256(t);
    });
    expect(vus[0]).toBe(
      `${"0".repeat(64)}\n1|demande_creee||2026-10-12T08:00:00.000Z|${EMPREINTE_DOC}|{}`,
    );
    expect(vus[1]?.split("\n")[1]).toBe(
      `2|invitation_envoyee|sig-1|2026-10-12T08:00:01.000Z|${EMPREINTE_DOC}|{"canal":"application"}`,
    );
  });

  it("vérification : chaîne valide, vide valide", () => {
    const chaine = chaineProbante([e1, e2], sha256);
    expect(verifierChaine(chaine, sha256)).toEqual({ valide: true });
    expect(verifierChaine(chaine, sha256, { empreinteDocument: EMPREINTE_DOC })).toEqual({
      valide: true,
    });
    expect(verifierChaine([], sha256)).toEqual({ valide: true });
  });

  it("donnée de l'événement 2 modifiée : EMPREINTE_DIFFERENTE au rang 2", () => {
    const [c1, c2] = chaineProbante([e1, e2], sha256) as [EvenementChaine, EvenementChaine];
    const altere = { ...c2, donnees: { canal: "autre" } };
    expect(verifierChaine([c1, altere], sha256)).toEqual({
      valide: false,
      rang: 2,
      cause: "EMPREINTE_DIFFERENTE",
    });
    // Une horodatage modifié ou un signataire modifié sont aussi détectés.
    expect(
      verifierChaine([c1, { ...c2, horodatage: "2026-10-12T08:00:02.000Z" }], sha256),
    ).toMatchObject({ cause: "EMPREINTE_DIFFERENTE" });
    expect(verifierChaine([c1, { ...c2, signataireId: "sig-2" }], sha256)).toMatchObject({
      cause: "EMPREINTE_DIFFERENTE",
    });
  });

  it("événement 1 retiré : RANG_MANQUANT", () => {
    const [, c2] = chaineProbante([e1, e2], sha256) as [EvenementChaine, EvenementChaine];
    expect(verifierChaine([c2], sha256)).toEqual({
      valide: false,
      rang: 1,
      cause: "RANG_MANQUANT",
    });
  });

  it("empreinte du document différente : DOCUMENT_DIFFERENT", () => {
    const [c1, c2] = chaineProbante([e1, e2], sha256) as [EvenementChaine, EvenementChaine];
    const autreDoc = sha256("autre");
    expect(verifierChaine([c1, { ...c2, empreinteDocument: autreDoc }], sha256)).toEqual({
      valide: false,
      rang: 2,
      cause: "DOCUMENT_DIFFERENT",
    });
    // Comparée à l'empreinte de la demande quand elle est fournie.
    expect(verifierChaine([c1, c2], sha256, { empreinteDocument: autreDoc })).toMatchObject({
      rang: 1,
      cause: "DOCUMENT_DIFFERENT",
    });
  });

  it("précédente incohérente : PRECEDENTE_INCOHERENTE", () => {
    const [c1, c2] = chaineProbante([e1, e2], sha256) as [EvenementChaine, EvenementChaine];
    expect(verifierChaine([c1, { ...c2, empreintePrecedente: "f".repeat(64) }], sha256)).toEqual({
      valide: false,
      rang: 2,
      cause: "PRECEDENTE_INCOHERENTE",
    });
    expect(
      verifierChaine([{ ...c1, empreintePrecedente: "1".repeat(64) }, c2], sha256),
    ).toMatchObject({ rang: 1, cause: "PRECEDENTE_INCOHERENTE" });
  });

  it("événements mal formés : refus de calcul", () => {
    expect(() => chaineProbante([{ ...e1, rang: 0 }], sha256)).toThrowError(ErreurCanaux);
    expect(() => chaineProbante([{ ...e1, rang: 1.5 }], sha256)).toThrowError(ErreurCanaux);
    expect(() => chaineProbante([{ ...e1, horodatage: "pas une date" }], sha256)).toThrowError(
      ErreurCanaux,
    );
    expect(() => chaineProbante([{ ...e1, empreinteDocument: "xyz" }], sha256)).toThrowError(
      ErreurCanaux,
    );
    expect(() => chaineProbante([{ ...e1, donnees: { a: Number.NaN } }], sha256)).toThrowError(
      ErreurCanaux,
    );
  });
});
