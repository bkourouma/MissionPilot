import { describe, expect, it } from "vitest";
import {
  bitsFormat,
  bitsVersion,
  cheminSvg,
  choisirVersion,
  codesDonnees,
  correctionReedSolomon,
  entrelacer,
  genererQrCode,
  motsDeDonnees,
  multiplierGf,
  penalite,
} from "./qrcode";

const binaire = (n: number, longueur: number) => n.toString(2).padStart(longueur, "0");

describe("arithmétique et tables", () => {
  it("multiplie dans GF(256)", () => {
    expect(multiplierGf(0, 7)).toBe(0);
    expect(multiplierGf(1, 0x53)).toBe(0x53);
    expect(multiplierGf(2, 0x80)).toBe(0x1d);
    expect(multiplierGf(0x53, 0xca)).toBe(multiplierGf(0xca, 0x53));
  });

  it("calcule la correction Reed-Solomon de l'exemple de référence (1-M « HELLO WORLD »)", () => {
    const donnees = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(correctionReedSolomon(donnees, 10)).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it("produit les informations de format de la table de la norme", () => {
    expect(binaire(bitsFormat("L", 0), 15)).toBe("111011111000100");
    expect(binaire(bitsFormat("L", 4), 15)).toBe("110011000101111");
    expect(binaire(bitsFormat("M", 0), 15)).toBe("101010000010010");
    expect(binaire(bitsFormat("M", 5), 15)).toBe("100000011001110");
    expect(binaire(bitsFormat("M", 7), 15)).toBe("100101010100000");
  });

  it("produit l'information de version 7 de la norme", () => {
    expect(binaire(bitsVersion(7), 18)).toBe("000111110010010100");
  });

  it("connaît les capacités des versions (mots de données)", () => {
    expect(codesDonnees(1, "M")).toBe(16);
    expect(codesDonnees(1, "L")).toBe(19);
    expect(codesDonnees(7, "M")).toBe(124);
    expect(codesDonnees(10, "M")).toBe(216);
  });

  it("choisit la plus petite version possible", () => {
    expect(choisirVersion(14, "M")).toBe(1);
    expect(choisirVersion(15, "M")).toBe(2);
    expect(choisirVersion(122, "M")).toBe(7);
    expect(choisirVersion(123, "M")).toBe(8);
    expect(choisirVersion(214, "M")).toBeNull();
  });
});

describe("encodage des données", () => {
  it("encode en mode octet avec compteur, terminateur et bourrage alterné", () => {
    const mots = motsDeDonnees(new TextEncoder().encode("A"), 1, "M");
    expect(mots).toHaveLength(16);
    // 0100 | 00000001 | 01000001 | 0000 → 0x40 0x14 0x10, puis 0xEC 0x11…
    expect(mots.slice(0, 5)).toEqual([0x40, 0x14, 0x10, 0xec, 0x11]);
  });

  it("entrelace les blocs sans perdre de mot de code", () => {
    const donnees = Array.from({ length: codesDonnees(7, "M") }, (_, i) => i % 256);
    const sortie = entrelacer(donnees, 7, "M");
    expect(sortie).toHaveLength(196);
    // Les premiers mots de chaque bloc (4 blocs de 31) arrivent en tête.
    expect(sortie.slice(0, 4)).toEqual([0, 31, 62, 93]);
  });
});

/** Relit les mots de code d'une matrice (même parcours en zigzag que la norme). */
function relire(modules: boolean[][], fonction: (x: number, y: number) => boolean): number[] {
  const t = modules.length;
  const bits: number[] = [];
  for (let droite = t - 1; droite >= 1; droite -= 2) {
    if (droite === 6) droite = 5;
    for (let vert = 0; vert < t; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = droite - j;
        const y = ((droite + 1) & 2) === 0 ? t - 1 - vert : vert;
        if (!fonction(x, y)) bits.push(modules[y]![x] ? 1 : 0);
      }
    }
  }
  const mots: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    mots.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  return mots;
}

describe("genererQrCode", () => {
  const uri =
    "otpauth://totp/MissionPilot:associe%40demo.missionpilot.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=MissionPilot&algorithm=SHA1&digits=6&period=30";

  it("dessine une matrice carrée de la bonne version avec ses motifs fixes", () => {
    const qr = genererQrCode(uri);
    expect(qr.version).toBe(choisirVersion(new TextEncoder().encode(uri).length, "M"));
    expect(qr.taille).toBe(qr.version * 4 + 17);
    expect(qr.modules).toHaveLength(qr.taille);
    // Motifs de repérage : coin sombre, anneau clair, cœur sombre.
    for (const [x, y] of [
      [0, 0],
      [qr.taille - 1, 0],
      [0, qr.taille - 1],
    ] as const) {
      expect(qr.modules[y]![x]).toBe(true);
    }
    expect(qr.modules[1]![1]).toBe(false);
    expect(qr.modules[3]![3]).toBe(true);
    // Module toujours sombre et ligne de synchronisation.
    expect(qr.modules[qr.taille - 8]![8]).toBe(true);
    expect(qr.modules[6]![8]).toBe(true);
    expect(qr.modules[6]![9]).toBe(false);
  });

  it("écrit une information de format cohérente dans ses deux copies", () => {
    const qr = genererQrCode(uri);
    const t = qr.taille;
    const lu = (x: number, y: number) => (qr.modules[y]![x] ? 1 : 0);
    let copie2 = 0;
    for (let i = 0; i < 8; i++) copie2 |= lu(t - 1 - i, 8) << i;
    for (let i = 8; i < 15; i++) copie2 |= lu(8, t - 15 + i) << i;
    let copie1 = 0;
    for (let i = 0; i <= 5; i++) copie1 |= lu(8, i) << i;
    copie1 |= lu(8, 7) << 6;
    copie1 |= lu(8, 8) << 7;
    copie1 |= lu(7, 8) << 8;
    for (let i = 9; i < 15; i++) copie1 |= lu(14 - i, 8) << i;
    expect(copie1).toBe(copie2);
    const masque = [0, 1, 2, 3, 4, 5, 6, 7].find((m) => bitsFormat("M", m) === copie1);
    expect(masque).toBeDefined();
  });

  it("se relit : démasquage, correction Reed-Solomon nulle et texte d'origine (7-M)", () => {
    const court =
      "otpauth://totp/MP:a%40b.ci?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=MP&algorithm=SHA1&digits=6&period=30";
    const qr = genererQrCode(court);
    expect(qr.version).toBe(7);
    const t = qr.taille;
    const alignements = [6, 22, 38];
    // Zones de fonction de la version 7, décrites indépendamment du générateur.
    const estFonction = (x: number, y: number) => {
      if ((x < 9 && y < 9) || (x >= t - 8 && y < 9) || (x < 9 && y >= t - 8)) return true;
      if (x === 6 || y === 6) return true;
      if ((x >= t - 11 && x < t - 8 && y < 6) || (y >= t - 11 && y < t - 8 && x < 6)) return true;
      for (const ay of alignements) {
        for (const ax of alignements) {
          const coin = (ax === 6 && ay === 6) || (ax === 6 && ay === 38) || (ax === 38 && ay === 6);
          if (!coin && Math.abs(x - ax) <= 2 && Math.abs(y - ay) <= 2) return true;
        }
      }
      return false;
    };
    let format = 0;
    for (let i = 0; i < 8; i++) format |= (qr.modules[8]![t - 1 - i] ? 1 : 0) << i;
    for (let i = 8; i < 15; i++) format |= (qr.modules[t - 15 + i]![8] ? 1 : 0) << i;
    const masque = [0, 1, 2, 3, 4, 5, 6, 7].find((m) => bitsFormat("M", m) === format)!;
    const formules = [
      (x: number, y: number) => (x + y) % 2 === 0,
      (_x: number, y: number) => y % 2 === 0,
      (x: number) => x % 3 === 0,
      (x: number, y: number) => (x + y) % 3 === 0,
      (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const demasque = qr.modules.map((ligne, y) =>
      ligne.map((v, x) => (estFonction(x, y) ? v : v !== formules[masque]!(x, y))),
    );
    const mots = relire(demasque, estFonction);
    expect(mots).toHaveLength(196);
    // Version 7-M : 4 blocs de 31 données + 18 de correction, entrelacés.
    const blocs: number[][] = [[], [], [], []];
    for (let i = 0; i < 31 * 4; i++) blocs[i % 4]!.push(mots[i]!);
    for (let i = 0; i < 18 * 4; i++) blocs[i % 4]!.push(mots[124 + i]!);
    for (const bloc of blocs) {
      expect(correctionReedSolomon(bloc.slice(0, 31), 18)).toEqual(bloc.slice(31));
    }
    const bits = blocs
      .flatMap((b) => b.slice(0, 31))
      .map((m) => m.toString(2).padStart(8, "0"))
      .join("");
    expect(bits.slice(0, 4)).toBe("0100");
    const longueur = Number.parseInt(bits.slice(4, 12), 2);
    const octets = Array.from({ length: longueur }, (_, i) =>
      Number.parseInt(bits.slice(12 + i * 8, 20 + i * 8), 2),
    );
    expect(new TextDecoder().decode(new Uint8Array(octets))).toBe(court);
  });

  it("tient une URI réelle (adresse longue comprise) en version 10 au plus", () => {
    expect(genererQrCode(uri).version).toBeLessThanOrEqual(10);
  });

  it("passe en correction L quand le texte ne tient pas en M", () => {
    expect(genererQrCode("x".repeat(250)).version).toBe(10);
    expect(() => genererQrCode("x".repeat(250), "M")).toThrow(/trop long/);
  });

  it("refuse un texte trop long", () => {
    expect(() => genererQrCode("x".repeat(300))).toThrow(/trop long/);
  });

  it("donne un tracé SVG avec la marge et une pénalité finie", () => {
    const qr = genererQrCode("MissionPilot");
    expect(cheminSvg(qr)).toMatch(/^M4,4h1v1h-1z/);
    expect(Number.isFinite(penalite(qr.modules))).toBe(true);
  });
});
