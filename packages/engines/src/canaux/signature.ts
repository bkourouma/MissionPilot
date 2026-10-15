/**
 * Signature électronique (CLI-05, lot 3c, SPEC §9.8, ADR-010). Fonctions pures, sans `node:crypto` :
 * le hachage SHA-256 hexadécimal est INJECTÉ (`hacher`). Le niveau est « simple simulée », sans
 * valeur juridique (O-06) ; le journal de preuves est notre table chaînée, vérifiée ici.
 */
import { ErreurCanaux } from "./erreurs";

export const STATUTS_DEMANDE_SIGNATURE = [
  "brouillon",
  "envoyee",
  "partielle",
  "signee",
  "refusee",
  "annulee",
  "expiree",
] as const;
export type StatutDemandeSignature = (typeof STATUTS_DEMANDE_SIGNATURE)[number];

export const STATUTS_SIGNATAIRE = ["en_attente", "invite", "signe", "refuse", "expire"] as const;
export type StatutSignataire = (typeof STATUTS_SIGNATAIRE)[number];

export type OrdreSignature = "parallele" | "sequentiel";

export const TYPES_PREUVE_SIGNATURE = [
  "demande_creee",
  "invitation_envoyee",
  "document_consulte",
  "reconfirmation_identite",
  "signature_apposee",
  "refus",
  "annulation",
  "expiration",
  "scellement",
] as const;
export type TypePreuveSignature = (typeof TYPES_PREUVE_SIGNATURE)[number];

export interface SignataireEtat {
  readonly id: string;
  readonly rang: number;
  readonly statut: StatutSignataire;
}

export interface EntreeStatutDemande {
  readonly signataires: readonly { readonly statut: StatutSignataire }[];
  readonly ordre: OrdreSignature;
  readonly expireLe: Date;
  readonly maintenant: Date;
  readonly annulee: boolean;
}

/**
 * Statut d'une demande ENVOYÉE : `annulee` l'emporte, puis un `refuse` donne `refusee`, tous
 * `signe` donne `signee`, `maintenant > expireLe` sans statut final donne `expiree`, au moins un
 * `signe` donne `partielle`, sinon `envoyee`.
 */
export function statutDemande(
  entree: EntreeStatutDemande,
): Exclude<StatutDemandeSignature, "brouillon"> {
  const { signataires } = entree;
  if (entree.annulee) return "annulee";
  if (signataires.some((s) => s.statut === "refuse")) return "refusee";
  if (signataires.length > 0 && signataires.every((s) => s.statut === "signe")) return "signee";
  if (entree.maintenant.getTime() > entree.expireLe.getTime()) return "expiree";
  if (signataires.some((s) => s.statut === "signe")) return "partielle";
  return "envoyee";
}

export type RefusSignature =
  "DEMANDE_TERMINEE" | "DEMANDE_EXPIREE" | "DEJA_SIGNE" | "NON_INVITE" | "ORDRE_NON_RESPECTE";

export interface EntreePeutSigner {
  readonly demande: {
    readonly statut: StatutDemandeSignature;
    readonly expireLe: Date;
    readonly maintenant: Date;
  };
  readonly signataire: SignataireEtat;
  readonly ordre: OrdreSignature;
  /** TOUS les signataires de la demande (le signataire concerné inclus). */
  readonly signataires: readonly SignataireEtat[];
}

export interface DecisionSignature {
  readonly autorise: boolean;
  readonly refus: RefusSignature | null;
}

const STATUTS_FINAUX: ReadonlySet<StatutDemandeSignature> = new Set([
  "signee",
  "refusee",
  "annulee",
  "expiree",
]);

/**
 * Le signataire peut-il signer maintenant ? Ordre des contrôles : `DEMANDE_TERMINEE`,
 * `DEMANDE_EXPIREE`, `DEJA_SIGNE`, `ORDRE_NON_RESPECTE` (séquentiel : tous les rangs inférieurs
 * `signe`), puis `NON_INVITE` (statut autre qu'`invite`). Ainsi un rang 2 qui devance le rang 1
 * reçoit `ORDRE_NON_RESPECTE`, qu'il soit déjà invité ou encore en attente.
 */
export function peutSigner(entree: EntreePeutSigner): DecisionSignature {
  const refuser = (refus: RefusSignature): DecisionSignature => ({ autorise: false, refus });
  const { demande, signataire } = entree;
  if (STATUTS_FINAUX.has(demande.statut) || demande.statut === "brouillon") {
    return refuser("DEMANDE_TERMINEE");
  }
  if (demande.maintenant.getTime() > demande.expireLe.getTime()) return refuser("DEMANDE_EXPIREE");
  if (signataire.statut === "signe") return refuser("DEJA_SIGNE");
  if (
    entree.ordre === "sequentiel" &&
    entree.signataires.some((s) => s.rang < signataire.rang && s.statut !== "signe")
  ) {
    return refuser("ORDRE_NON_RESPECTE");
  }
  if (signataire.statut !== "invite") return refuser("NON_INVITE");
  return { autorise: true, refus: null };
}

/* ----- Journal de preuves chaîné ----- */

/** Empreinte précédente du rang 1 : 64 zéros. */
export const EMPREINTE_ZERO = "0".repeat(64);
const EMPREINTE = /^[0-9a-f]{64}$/;

export type Hacheur = (texte: string) => string;

export interface EvenementPreuve {
  readonly rang: number;
  readonly type: TypePreuveSignature;
  readonly signataireId: string | null;
  readonly horodatage: Date | string;
  readonly empreinteDocument: string;
  readonly donnees: Readonly<Record<string, unknown>>;
}

export interface EvenementChaine extends EvenementPreuve {
  readonly empreintePrecedente: string;
  readonly empreinte: string;
}

/**
 * JSON canonique : clés triées à tous les niveaux, aucun espace. Les valeurs `undefined` d'un objet
 * sont omises ; tout ce qui n'est pas du JSON (date, fonction, nombre non fini…) est refusé.
 */
export function canoniser(valeur: unknown): string {
  if (valeur === null) return "null";
  switch (typeof valeur) {
    case "string":
    case "boolean":
      return JSON.stringify(valeur);
    case "number":
      if (!Number.isFinite(valeur)) throw new ErreurCanaux("EVENEMENT_INVALIDE");
      return JSON.stringify(valeur);
    case "object": {
      if (Array.isArray(valeur)) {
        return `[${valeur.map((v) => canoniser(v === undefined ? null : v)).join(",")}]`;
      }
      const proto = Object.getPrototypeOf(valeur) as unknown;
      if (proto !== Object.prototype && proto !== null)
        throw new ErreurCanaux("EVENEMENT_INVALIDE");
      const objet = valeur as Record<string, unknown>;
      const cles = Object.keys(objet)
        .filter((k) => objet[k] !== undefined)
        .sort();
      return `{${cles.map((k) => `${JSON.stringify(k)}:${canoniser(objet[k])}`).join(",")}}`;
    }
    default:
      throw new ErreurCanaux("EVENEMENT_INVALIDE");
  }
}

function horodatageIso(h: Date | string): string {
  const d = h instanceof Date ? h : new Date(h);
  if (Number.isNaN(d.getTime())) throw new ErreurCanaux("EVENEMENT_INVALIDE");
  return d.toISOString();
}

/** `rang|type|signataire_id ou vide|horodatage ISO UTC (ms)|empreinte_document|donnees canoniques`. */
function canonique(e: EvenementPreuve): string {
  if (!Number.isInteger(e.rang) || e.rang < 1) throw new ErreurCanaux("EVENEMENT_INVALIDE");
  return [
    String(e.rang),
    e.type,
    e.signataireId ?? "",
    horodatageIso(e.horodatage),
    e.empreinteDocument,
    canoniser(e.donnees),
  ].join("|");
}

function empreinteEvenement(precedente: string, e: EvenementPreuve, hacher: Hacheur): string {
  return hacher(`${precedente}\n${canonique(e)}`);
}

/**
 * Calcule la chaîne : `empreinte = SHA-256(empreinte_precedente + "\n" + canonique)`, la
 * précédente du premier événement étant 64 zéros. Les événements sont pris dans l'ordre fourni.
 */
export function chaineProbante(
  evenements: readonly EvenementPreuve[],
  hacher: Hacheur,
): EvenementChaine[] {
  const resultat: EvenementChaine[] = [];
  let precedente = EMPREINTE_ZERO;
  for (const e of evenements) {
    if (!EMPREINTE.test(e.empreinteDocument)) throw new ErreurCanaux("EMPREINTE_INVALIDE");
    const empreinte = empreinteEvenement(precedente, e, hacher);
    resultat.push({ ...e, empreintePrecedente: precedente, empreinte });
    precedente = empreinte;
  }
  return resultat;
}

export type CauseChaineInvalide =
  "EMPREINTE_DIFFERENTE" | "RANG_MANQUANT" | "PRECEDENTE_INCOHERENTE" | "DOCUMENT_DIFFERENT";

export type ResultatVerificationChaine =
  | { readonly valide: true }
  | { readonly valide: false; readonly rang: number; readonly cause: CauseChaineInvalide };

/**
 * Vérifie une chaîne relue en base. Premier défaut rencontré, événement par événement :
 * `RANG_MANQUANT` (rang attendu = position + 1 ; `rang` rend le rang attendu),
 * `DOCUMENT_DIFFERENT` (empreinte du document différente de `options.empreinteDocument`, sinon
 * de celle du premier événement), `PRECEDENTE_INCOHERENTE` (64 zéros pour le premier, sinon
 * l'empreinte stockée du précédent), `EMPREINTE_DIFFERENTE` (recalcul différent de l'empreinte
 * stockée : donnée altérée).
 */
export function verifierChaine(
  evenements: readonly EvenementChaine[],
  hacher: Hacheur,
  options: { readonly empreinteDocument?: string } = {},
): ResultatVerificationChaine {
  let precedente = EMPREINTE_ZERO;
  const documentAttendu = options.empreinteDocument ?? evenements[0]?.empreinteDocument;
  for (const [i, e] of evenements.entries()) {
    const attendu = i + 1;
    if (e.rang !== attendu) return { valide: false, rang: attendu, cause: "RANG_MANQUANT" };
    if (e.empreinteDocument !== documentAttendu) {
      return { valide: false, rang: e.rang, cause: "DOCUMENT_DIFFERENT" };
    }
    if (e.empreintePrecedente !== precedente) {
      return { valide: false, rang: e.rang, cause: "PRECEDENTE_INCOHERENTE" };
    }
    if (empreinteEvenement(e.empreintePrecedente, e, hacher) !== e.empreinte) {
      return { valide: false, rang: e.rang, cause: "EMPREINTE_DIFFERENTE" };
    }
    precedente = e.empreinte;
  }
  return { valide: true };
}
