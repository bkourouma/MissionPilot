import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { FichierAbsent, verifierCle, type StockageFichiers } from "./stockage.js";

/**
 * Stockage sur disque local : `<racine>/<cabinet>/<2 premiers caractères>/<clé>`.
 * Dossiers en 0700, fichiers en 0600 ; écriture dans un fichier temporaire
 * exclusif puis renommage (un objet n'est jamais lu à moitié écrit). Le
 * chemin final est recalculé et vérifié sous la racine (défense en profondeur).
 */
export class StockageDisque implements StockageFichiers {
  private readonly racine: string;

  constructor(racine: string) {
    this.racine = path.resolve(racine);
  }

  private chemin(cabinetId: string, cle: string): string {
    verifierCle(cabinetId, cle);
    const cabinet = cabinetId.toLowerCase();
    const complet = path.join(this.racine, cabinet, cle.slice(0, 2), cle);
    const relatif = path.relative(this.racine, complet);
    if (relatif.startsWith("..") || path.isAbsolute(relatif)) {
      throw new Error("Chemin de stockage hors de la racine.");
    }
    return complet;
  }

  async ecrire(cabinetId: string, contenu: Buffer): Promise<string> {
    const cle = randomBytes(16).toString("hex");
    const final = this.chemin(cabinetId, cle);
    await mkdir(path.dirname(final), { recursive: true, mode: 0o700 });
    const temporaire = `${final}.${randomBytes(6).toString("hex")}.part`;
    const f = await open(temporaire, "wx", 0o600);
    try {
      await f.writeFile(contenu);
      await f.sync();
    } finally {
      await f.close();
    }
    try {
      await rename(temporaire, final);
    } catch (error) {
      await rm(temporaire, { force: true });
      throw error;
    }
    return cle;
  }

  async lire(cabinetId: string, cle: string): Promise<Readable> {
    const chemin = this.chemin(cabinetId, cle);
    try {
      const s = await stat(chemin);
      if (!s.isFile()) throw new FichierAbsent();
    } catch (error) {
      if (error instanceof FichierAbsent) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new FichierAbsent();
      throw error;
    }
    return createReadStream(chemin);
  }

  async supprimer(cabinetId: string, cle: string): Promise<void> {
    await rm(this.chemin(cabinetId, cle), { force: true });
  }
}
