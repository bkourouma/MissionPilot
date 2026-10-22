import { createHash } from "node:crypto";
import {
  chaineProbante,
  verifierChaine,
  type EvenementChaine,
  type EvenementPreuve,
  type ResultatVerificationChaine,
  type TypePreuveSignature,
} from "@missionpilot/engines";
import type { Db } from "../db/pool.js";

/*
 * Journal de preuves d'une demande de signature (SPEC-3c §6.7, §7.7) : ajout seul (MPH10), chaîné
 * (empreinte = SHA-256(empreinte précédente + "\n" + forme canonique), calculée ICI et vérifiée par le
 * moteur `verifierChaine` à chaque lecture). L'horodatage est celui de la BASE (`base_locale`) :
 * ce n'est PAS un horodatage qualifié (O-06). L'adresse IP n'est pas retenue (celle que voit l'API est
 * celle du relais) ; la session n'apparaît qu'en empreinte HMAC.
 */

/** Hachage SHA-256 hexadécimal injecté dans le moteur (qui n'importe pas `node:crypto`). */
export const sha256Hex = (texte: string): string =>
  createHash("sha256").update(texte, "utf8").digest("hex");

export interface NouvellePreuve {
  cabinetId: string;
  demandeId: string;
  empreinteDocument: string;
  type: TypePreuveSignature;
  signataireId?: string | null;
  authentification?: "mot_de_passe" | "mot_de_passe_et_2fa" | null;
  sessionEmpreinte?: string | null;
  donnees?: Record<string, unknown>;
}

interface LignePreuve {
  rang: number;
  type_evenement: TypePreuveSignature;
  signataire_id: string | null;
  horodatage: Date;
  empreinte_document: string;
  donnees: Record<string, unknown>;
  empreinte_precedente: string;
  empreinte: string;
  authentification: "mot_de_passe" | "mot_de_passe_et_2fa" | null;
}

const COLONNES = `rang::int AS rang, type_evenement, signataire_id, horodatage, empreinte_document,
  donnees, empreinte_precedente, empreinte, authentification`;

const versEvenement = (l: LignePreuve): EvenementPreuve => ({
  rang: l.rang,
  type: l.type_evenement,
  signataireId: l.signataire_id,
  horodatage: l.horodatage,
  empreinteDocument: l.empreinte_document,
  donnees: l.donnees,
});

/** Nombre d'essais d'écriture quand le déclencheur 0547 juge l'horodatage trop ancien. */
const ESSAIS_HORODATAGE = 3;

/**
 * Le déclencheur 0547 (MPH10) refuse un horodatage éloigné de plus de 5 s de l'horloge de la base.
 * L'horodatage entre dans l'empreinte, calculée ICI : il ne peut donc pas être pris dans la requête
 * d'écriture elle-même. Si le processus est retardé (CPU, ramasse-miettes) entre la lecture de
 * l'horloge et l'INSERT, ce refus-là, et seulement lui, est rejoué avec une horloge relue.
 */
const horodatageRefuse = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (e as { code?: unknown }).code === "MPH10" &&
  /horodatage/i.test(String((e as { message?: unknown }).message ?? ""));

/**
 * Ajoute une preuve à la chaîne de la demande. La demande est verrouillée (`FOR UPDATE`) par
 * l'appelant : le rang et l'empreinte précédente ne peuvent être pris que par une écriture à la fois.
 * L'horodatage est lu sur l'horloge de la base (milliseconde) juste avant l'écriture ; l'INSERT est
 * protégé par un point de sauvegarde pour que la transaction de l'appelant survive à un refus
 * d'horodatage et que l'écriture puisse être rejouée avec une horloge relue.
 */
export async function ajouterPreuve(db: Db, p: NouvellePreuve): Promise<void> {
  const precedentes = await db.query(
    `SELECT ${COLONNES} FROM signatures_preuves WHERE demande_id = $1 ORDER BY rang`,
    [p.demandeId],
  );
  const lignes = precedentes.rows as LignePreuve[];
  for (let essai = 1; ; essai++) {
    const h = await db.query("SELECT date_trunc('milliseconds', clock_timestamp()) AS h");
    const horodatage = h.rows[0].h as Date;
    const nouveau: EvenementPreuve = {
      rang: lignes.length + 1,
      type: p.type,
      signataireId: p.signataireId ?? null,
      horodatage,
      empreinteDocument: p.empreinteDocument,
      donnees: p.donnees ?? {},
    };
    const chaine = chaineProbante([...lignes.map(versEvenement), nouveau], sha256Hex);
    const dernier = chaine[chaine.length - 1] as EvenementChaine;
    await db.query("SAVEPOINT preuve_ajout");
    try {
      await db.query(
        `INSERT INTO signatures_preuves
           (cabinet_id, demande_id, rang, type_evenement, signataire_id, horodatage, empreinte_document,
            authentification, session_empreinte, donnees, empreinte_precedente, empreinte)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          p.cabinetId,
          p.demandeId,
          nouveau.rang,
          p.type,
          p.signataireId ?? null,
          horodatage,
          p.empreinteDocument,
          p.authentification ?? null,
          p.sessionEmpreinte ?? null,
          JSON.stringify(nouveau.donnees),
          lignes.length > 0 ? (lignes[lignes.length - 1] as LignePreuve).empreinte : "0".repeat(64),
          dernier.empreinte,
        ],
      );
      await db.query("RELEASE SAVEPOINT preuve_ajout");
      return;
    } catch (e) {
      await db.query("ROLLBACK TO SAVEPOINT preuve_ajout");
      if (!horodatageRefuse(e) || essai >= ESSAIS_HORODATAGE) throw e;
    }
  }
}

/** Preuves de la demande et résultat de la vérification de la chaîne (moteur, SHA-256 réel). */
export async function lireDossierPreuves(
  db: Db,
  demandeId: string,
  empreinteDocument: string,
): Promise<{ preuves: LignePreuve[]; verification: ResultatVerificationChaine }> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM signatures_preuves WHERE demande_id = $1 ORDER BY rang`,
    [demandeId],
  );
  const preuves = r.rows as LignePreuve[];
  const chaine: EvenementChaine[] = preuves.map((l) => ({
    ...versEvenement(l),
    empreintePrecedente: l.empreinte_precedente,
    empreinte: l.empreinte,
  }));
  return { preuves, verification: verifierChaine(chaine, sha256Hex, { empreinteDocument }) };
}

export type { LignePreuve };
