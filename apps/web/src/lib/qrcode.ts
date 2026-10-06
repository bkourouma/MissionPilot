/**
 * Générateur de QR code minimal en TypeScript pur (ISO/IEC 18004), sans dépendance : mode
 * octet, versions 1 à 10, correction d'erreur L ou M. Il sert à afficher l'URI `otpauth://`
 * de la double authentification (≈ 130 octets, version 7 en correction M).
 *
 * Choix documenté : une dépendance de génération de QR aurait ajouté du code tiers à une page
 * qui manipule un secret ; ce générateur tient en un fichier testé (`qrcode.test.ts`). Le
 * secret reste aussi affiché en clair pour une saisie manuelle si le scan échoue.
 *
 * Algorithme suivi : celui de la bibliothèque de référence de Project Nayuki (domaine public
 * de l'algorithme, réécrit ici).
 */

export type NiveauCorrection = "L" | "M";

/** Bits du niveau dans l'information de format (L = 01, M = 00). */
const BITS_NIVEAU: Record<NiveauCorrection, number> = { L: 1, M: 0 };

/** Index 1 à 10 : codes de correction par bloc et nombre de blocs (table ISO). */
const CORRECTION_PAR_BLOC: Record<NiveauCorrection, readonly number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
};
const NOMBRE_BLOCS: Record<NiveauCorrection, readonly number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
};

export const VERSION_MAX = 10;

export interface QrCode {
  version: number;
  taille: number;
  /** `modules[y][x]` : vrai = module sombre. */
  modules: boolean[][];
}

// --- Corps de Galois GF(256), polynôme 0x11D ------------------------------------------

export function multiplierGf(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function diviseurReedSolomon(degre: number): number[] {
  const resultat = new Array<number>(degre).fill(0);
  resultat[degre - 1] = 1;
  let racine = 1;
  for (let i = 0; i < degre; i++) {
    for (let j = 0; j < resultat.length; j++) {
      resultat[j] = multiplierGf(resultat[j]!, racine);
      if (j + 1 < resultat.length) resultat[j] = resultat[j]! ^ resultat[j + 1]!;
    }
    racine = multiplierGf(racine, 0x02);
  }
  return resultat;
}

/** Codes de correction Reed-Solomon d'un bloc de données. */
export function correctionReedSolomon(donnees: readonly number[], degre: number): number[] {
  const diviseur = diviseurReedSolomon(degre);
  const reste = new Array<number>(degre).fill(0);
  for (const octet of donnees) {
    const facteur = octet ^ reste.shift()!;
    reste.push(0);
    diviseur.forEach((coef, i) => {
      reste[i] = reste[i]! ^ multiplierGf(coef, facteur);
    });
  }
  return reste;
}

// --- Capacités ---------------------------------------------------------------------------

function modulesDonneesBruts(version: number): number {
  let r = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const nbAlignement = Math.floor(version / 7) + 2;
    r -= (25 * nbAlignement - 10) * nbAlignement - 55;
    if (version >= 7) r -= 36;
  }
  return r;
}

export function codesDonnees(version: number, niveau: NiveauCorrection): number {
  return (
    Math.floor(modulesDonneesBruts(version) / 8) -
    CORRECTION_PAR_BLOC[niveau][version]! * NOMBRE_BLOCS[niveau][version]!
  );
}

const bitsCompteur = (version: number) => (version <= 9 ? 8 : 16);

/** Plus petite version qui contient `longueur` octets, ou `null` si trop long. */
export function choisirVersion(longueur: number, niveau: NiveauCorrection): number | null {
  for (let v = 1; v <= VERSION_MAX; v++) {
    if (4 + bitsCompteur(v) + 8 * longueur <= codesDonnees(v, niveau) * 8) return v;
  }
  return null;
}

// --- Encodage des données --------------------------------------------------------------

function ajouterBits(bits: number[], valeur: number, longueur: number): void {
  for (let i = longueur - 1; i >= 0; i--) bits.push((valeur >>> i) & 1);
}

/** Mots de code de données (mode octet, terminateur, bourrage 0xEC/0x11). */
export function motsDeDonnees(
  octets: Uint8Array,
  version: number,
  niveau: NiveauCorrection,
): number[] {
  const capaciteBits = codesDonnees(version, niveau) * 8;
  const bits: number[] = [];
  ajouterBits(bits, 0b0100, 4);
  ajouterBits(bits, octets.length, bitsCompteur(version));
  for (const o of octets) ajouterBits(bits, o, 8);
  ajouterBits(bits, 0, Math.min(4, capaciteBits - bits.length));
  ajouterBits(bits, 0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capaciteBits; pad ^= 0xec ^ 0x11) ajouterBits(bits, pad, 8);
  const mots: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    mots.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }
  return mots;
}

/** Découpe en blocs, ajoute la correction et entrelace (ordre de placement final). */
export function entrelacer(
  donnees: readonly number[],
  version: number,
  niveau: NiveauCorrection,
): number[] {
  const nbBlocs = NOMBRE_BLOCS[niveau][version]!;
  const degre = CORRECTION_PAR_BLOC[niveau][version]!;
  const total = Math.floor(modulesDonneesBruts(version) / 8);
  const nbCourts = nbBlocs - (total % nbBlocs);
  const longueurCourte = Math.floor(total / nbBlocs);
  const blocs: number[][] = [];
  for (let i = 0, k = 0; i < nbBlocs; i++) {
    const bloc = donnees.slice(k, k + longueurCourte - degre + (i < nbCourts ? 0 : 1));
    k += bloc.length;
    const correction = correctionReedSolomon(bloc, degre);
    if (i < nbCourts) bloc.push(0);
    blocs.push([...bloc, ...correction]);
  }
  const resultat: number[] = [];
  for (let i = 0; i < blocs[0]!.length; i++) {
    blocs.forEach((bloc, j) => {
      if (i !== longueurCourte - degre || j >= nbCourts) resultat.push(bloc[i]!);
    });
  }
  return resultat;
}

// --- Matrice -------------------------------------------------------------------------------

/** 15 bits d'information de format (niveau, masque, BCH, masque 0x5412). */
export function bitsFormat(niveau: NiveauCorrection, masque: number): number {
  const donnee = (BITS_NIVEAU[niveau] << 3) | masque;
  let reste = donnee;
  for (let i = 0; i < 10; i++) reste = (reste << 1) ^ ((reste >>> 9) * 0x537);
  return ((donnee << 10) | (reste & 0x3ff)) ^ 0x5412;
}

/** 18 bits d'information de version (versions 7 et plus). */
export function bitsVersion(version: number): number {
  let reste = version;
  for (let i = 0; i < 12; i++) reste = (reste << 1) ^ ((reste >>> 11) * 0x1f25);
  return (version << 12) | (reste & 0xfff);
}

function positionsAlignement(version: number, taille: number): number[] {
  if (version === 1) return [];
  const nb = Math.floor(version / 7) + 2;
  const pas = Math.ceil((version * 4 + 4) / (nb * 2 - 2)) * 2;
  const r = [6];
  for (let pos = taille - 7; r.length < nb; pos -= pas) r.splice(1, 0, pos);
  return r;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

class Matrice {
  readonly taille: number;
  readonly modules: boolean[][];
  readonly fonction: boolean[][];
  constructor(readonly version: number) {
    this.taille = version * 4 + 17;
    this.modules = Array.from({ length: this.taille }, () =>
      new Array<boolean>(this.taille).fill(false),
    );
    this.fonction = Array.from({ length: this.taille }, () =>
      new Array<boolean>(this.taille).fill(false),
    );
  }

  poser(x: number, y: number, sombre: boolean): void {
    this.modules[y]![x] = sombre;
    this.fonction[y]![x] = true;
  }

  motifsFonction(niveau: NiveauCorrection): void {
    const t = this.taille;
    for (let i = 0; i < t; i++) {
      this.poser(6, i, i % 2 === 0);
      this.poser(i, 6, i % 2 === 0);
    }
    this.chercheur(3, 3);
    this.chercheur(t - 4, 3);
    this.chercheur(3, t - 4);
    const pos = positionsAlignement(this.version, t);
    const n = pos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.alignement(pos[i]!, pos[j]!);
      }
    }
    this.format(niveau, 0);
    this.infoVersion();
  }

  private chercheur(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.taille && yy >= 0 && yy < this.taille) {
          this.poser(xx, yy, d !== 2 && d !== 4);
        }
      }
    }
  }

  private alignement(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.poser(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  format(niveau: NiveauCorrection, masque: number): void {
    const b = bitsFormat(niveau, masque);
    const t = this.taille;
    for (let i = 0; i <= 5; i++) this.poser(8, i, bit(b, i));
    this.poser(8, 7, bit(b, 6));
    this.poser(8, 8, bit(b, 7));
    this.poser(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) this.poser(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) this.poser(t - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) this.poser(8, t - 15 + i, bit(b, i));
    this.poser(8, t - 8, true);
  }

  private infoVersion(): void {
    if (this.version < 7) return;
    const b = bitsVersion(this.version);
    for (let i = 0; i < 18; i++) {
      const a = this.taille - 11 + (i % 3);
      const c = Math.floor(i / 3);
      this.poser(a, c, bit(b, i));
      this.poser(c, a, bit(b, i));
    }
  }

  placer(mots: readonly number[]): void {
    const t = this.taille;
    let i = 0;
    for (let droite = t - 1; droite >= 1; droite -= 2) {
      if (droite === 6) droite = 5;
      for (let vert = 0; vert < t; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = droite - j;
          const montant = ((droite + 1) & 2) === 0;
          const y = montant ? t - 1 - vert : vert;
          if (!this.fonction[y]![x] && i < mots.length * 8) {
            this.modules[y]![x] = bit(mots[i >>> 3]!, 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  masquer(masque: number): void {
    for (let y = 0; y < this.taille; y++) {
      for (let x = 0; x < this.taille; x++) {
        if (this.fonction[y]![x]) continue;
        if (inverse(masque, x, y)) this.modules[y]![x] = !this.modules[y]![x];
      }
    }
  }
}

function inverse(masque: number, x: number, y: number): boolean {
  switch (masque) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

// --- Pénalités (choix du masque le plus lisible) --------------------------------------------

function penaliteLigne(ligne: readonly boolean[]): number {
  let p = 0;
  let suite = 1;
  for (let i = 1; i <= ligne.length; i++) {
    if (i < ligne.length && ligne[i] === ligne[i - 1]) suite++;
    else {
      if (suite >= 5) p += 3 + (suite - 5);
      suite = 1;
    }
  }
  const texte = ligne.map((b) => (b ? "1" : "0")).join("");
  for (const motif of ["10111010000", "00001011101"]) {
    for (let i = texte.indexOf(motif); i !== -1; i = texte.indexOf(motif, i + 1)) p += 40;
  }
  return p;
}

export function penalite(modules: readonly (readonly boolean[])[]): number {
  const t = modules.length;
  let p = 0;
  let sombres = 0;
  for (let y = 0; y < t; y++) {
    p += penaliteLigne(modules[y]!);
    p += penaliteLigne(modules.map((ligne) => ligne[y]!));
    for (let x = 0; x < t; x++) {
      if (modules[y]![x]) sombres++;
      if (x + 1 < t && y + 1 < t) {
        const c = modules[y]![x];
        if (c === modules[y]![x + 1] && c === modules[y + 1]![x] && c === modules[y + 1]![x + 1])
          p += 3;
      }
    }
  }
  const ecart = Math.abs((sombres * 100) / (t * t) - 50);
  return p + Math.floor(ecart / 5) * 10;
}

/**
 * QR code d'un texte (UTF-8). Lève une erreur si le texte dépasse la capacité de la
 * version 10 (≈ 213 octets en correction M).
 */
export function genererQrCode(texte: string, niveauVoulu?: NiveauCorrection): QrCode {
  const octets = new TextEncoder().encode(texte);
  // Correction M de préférence ; L si le texte (adresse e-mail longue) ne tient pas en M.
  const niveaux: NiveauCorrection[] = niveauVoulu ? [niveauVoulu] : ["M", "L"];
  const niveau = niveaux.find((n) => choisirVersion(octets.length, n) !== null);
  const version = niveau ? choisirVersion(octets.length, niveau) : null;
  if (niveau === undefined || version === null) throw new Error("Texte trop long pour le QR code.");
  const mots = entrelacer(motsDeDonnees(octets, version, niveau), version, niveau);
  const m = new Matrice(version);
  m.motifsFonction(niveau);
  m.placer(mots);
  let meilleur = 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (let masque = 0; masque < 8; masque++) {
    m.masquer(masque);
    m.format(niveau, masque);
    const p = penalite(m.modules);
    if (p < minimum) {
      minimum = p;
      meilleur = masque;
    }
    m.masquer(masque);
  }
  m.masquer(meilleur);
  m.format(niveau, meilleur);
  return { version, taille: m.taille, modules: m.modules };
}

/** Tracé SVG (chemin unique) des modules sombres, marge de 4 modules comprise. */
export function cheminSvg(qr: QrCode, marge = 4): string {
  const segments: string[] = [];
  qr.modules.forEach((ligne, y) => {
    ligne.forEach((sombre, x) => {
      if (sombre) segments.push(`M${x + marge},${y + marge}h1v1h-1z`);
    });
  });
  return segments.join("");
}
