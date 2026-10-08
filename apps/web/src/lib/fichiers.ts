/**
 * Fichiers téléversés (SOC-05, FIN-05) : contrôles locaux, libellés et messages d'erreur.
 * Logique pure, testée dans `fichiers.test.ts`.
 *
 * Le contrôle local (extension et taille AVANT l'envoi) donne un retour immédiat et évite de
 * consommer la connexion pour un fichier qui sera refusé ; il ne remplace pas le contrôle de
 * l'API, seule juge (elle détecte le type par le CONTENU, pas par l'extension).
 */
import {
  EXTENSIONS_FICHIER,
  TAILLE_FICHIER_MAX_DEFAUT,
  TYPES_FICHIER,
  TYPES_FICHIER_EN_LIGNE,
  type TypeFichier,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";

/** Métadonnées d'un fichier renvoyées par l'API (jamais le contenu). */
export interface FichierMeta {
  id: string;
  nom: string;
  type_mime: string;
  taille: number;
  sha256: string;
  cree_le: string;
}

/** Réponse de POST /api/fichiers. */
export interface FichierTeleverse extends FichierMeta {
  envoye_par: string;
  doublon_de: string | null;
}

export const TAILLE_MAX_OCTETS = TAILLE_FICHIER_MAX_DEFAUT;

/** Extensions admises, toutes catégories confondues (ordre de la liste blanche). */
export const EXTENSIONS_ADMISES: readonly string[] = TYPES_FICHIER.flatMap(
  (t) => EXTENSIONS_FICHIER[t],
);

/** Types d'un justificatif de débours : photo ou scan. */
export const TYPES_JUSTIFICATIF: readonly TypeFichier[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

/** Valeur de l'attribut `accept` d'un champ fichier pour ces types. */
export function acceptPour(types: readonly TypeFichier[] = TYPES_FICHIER): string {
  return types.flatMap((t) => [t, ...EXTENSIONS_FICHIER[t].map((e) => `.${e}`)]).join(",");
}

/** Extension en minuscules, sans le point ; "" s'il n'y en a pas. */
export function extensionDe(nom: string): string {
  const i = nom.lastIndexOf(".");
  if (i <= 0 || i === nom.length - 1) return "";
  return nom.slice(i + 1).toLowerCase();
}

/** Nom sans son extension (nom proposé pour un document). */
export function nomSansExtension(nom: string): string {
  const i = nom.lastIndexOf(".");
  return (i > 0 ? nom.slice(0, i) : nom).trim();
}

const LIBELLES_TYPES: Record<TypeFichier, string> = {
  "application/pdf": "PDF",
  "image/png": "Image PNG",
  "image/jpeg": "Photo JPEG",
  "image/webp": "Image WebP",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Document Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Classeur Excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "Présentation PowerPoint",
  "text/csv": "Fichier CSV",
  "text/plain": "Texte",
};

/** Libellé français d'un type MIME ; repli sur l'extension du nom. */
export function libelleType(typeMime: string, nom = ""): string {
  const connu = LIBELLES_TYPES[typeMime as TypeFichier];
  if (connu) return connu;
  const ext = extensionDe(nom);
  return ext ? `Fichier ${ext.toUpperCase()}` : "Fichier";
}

const nombreFr = (n: number, decimales: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: decimales }).format(n);

/** Taille lisible : « 820 octets », « 12 Ko », « 1,4 Mo ». */
export function formaterTaille(octets: number): string {
  if (!Number.isFinite(octets) || octets < 0) return "—";
  if (octets < 1024) return `${octets} octet${octets > 1 ? "s" : ""}`;
  if (octets < 1024 * 1024) return `${nombreFr(Math.max(1, Math.round(octets / 1024)), 0)} Ko`;
  return `${nombreFr(octets / (1024 * 1024), 1)} Mo`;
}

const MO_MAX = Math.floor(TAILLE_MAX_OCTETS / (1024 * 1024));

/** Liste des extensions admises lisible : « PDF, PNG, JPG, JPEG ou WebP ». */
export function extensionsLisibles(types: readonly TypeFichier[] = TYPES_FICHIER): string {
  const ext = types
    .flatMap((t) => EXTENSIONS_FICHIER[t])
    .map((e) => (e === "webp" ? "WebP" : e.toUpperCase()));
  if (ext.length <= 1) return ext.join("");
  return `${ext.slice(0, -1).join(", ")} ou ${ext[ext.length - 1]}`;
}

export type ControleFichier = { ok: true } | { ok: false; message: string };

/**
 * Contrôle local d'un fichier choisi : non vide, au plus 15 Mo, extension de la liste blanche
 * (et du sous-ensemble demandé). Le type MIME annoncé par le navigateur n'est pas cru.
 */
export function controlerFichier(
  f: { name: string; size: number },
  types: readonly TypeFichier[] = TYPES_FICHIER,
  tailleMax: number = TAILLE_MAX_OCTETS,
): ControleFichier {
  if (f.size <= 0) return { ok: false, message: "Ce fichier est vide : choisissez-en un autre." };
  if (f.size > tailleMax) {
    return {
      ok: false,
      message: `Fichier trop volumineux (${formaterTaille(f.size)}) : ${MO_MAX} Mo au plus.`,
    };
  }
  const ext = extensionDe(f.name);
  const admises = types.flatMap((t) => EXTENSIONS_FICHIER[t]);
  if (!ext || !admises.includes(ext)) {
    return {
      ok: false,
      message: `Type de fichier non accepté : choisissez un fichier ${extensionsLisibles(types)}.`,
    };
  }
  return { ok: true };
}

/** Le navigateur peut-il afficher ce type dans un onglet (l'API ne sert inline que ceux-là) ? */
export const affichableEnLigne = (typeMime: string) =>
  TYPES_FICHIER_EN_LIGNE.includes(typeMime as TypeFichier);

/** Lien authentifié (même origine, cookie httpOnly) vers un fichier. */
export function hrefFichier(id: string, affichage: "inline" | "attachment" = "attachment"): string {
  return `/api/fichiers/${encodeURIComponent(id)}?affichage=${affichage}`;
}

/** Erreur réseau ou serveur momentanée : le même envoi peut être retenté tel quel. */
export function erreurReprenable(e: unknown): boolean {
  return (
    e instanceof ErreurApi &&
    (e.statut === 0 || e.statut >= 500 || e.code === "DELAI_DEPASSE") &&
    e.code !== "ANNULE"
  );
}

/** Message français pour une erreur de téléversement, selon le code de l'API. */
export function messageTeleversement(e: unknown): string {
  if (!(e instanceof ErreurApi)) return messageErreur(e);
  switch (e.code) {
    case "TYPE_FICHIER_REFUSE":
      return `Le serveur a refusé ce fichier : son contenu ne correspond pas à un type accepté (${extensionsLisibles()}), ou il contient des éléments actifs. ${e.message}`;
    case "MULTIPART_ATTENDU":
      return "Envoi du fichier mal formé. Rechargez la page puis choisissez à nouveau le fichier.";
    case "FICHIER_TROP_VOLUMINEUX":
      return `Fichier trop volumineux : ${MO_MAX} Mo au plus. Réduisez-le (photo moins lourde, PDF compressé) puis réessayez.`;
    case "QUOTA_STOCKAGE_ATTEINT":
      return "L'espace de stockage du cabinet est plein : contactez un associé pour libérer de la place.";
    case "TELEVERSEMENTS_EN_ATTENTE":
      return "Vous avez trop de fichiers envoyés mais pas encore rattachés. Terminez ou annulez vos dépôts en cours, puis réessayez.";
    case "CONTENU_IDENTIQUE":
      return "Ce fichier est identique à la version courante du document : aucune nouvelle version n'a été créée.";
    case "JUSTIFICATIF_PAR_TELEVERSEMENT":
      return "Le justificatif doit être téléversé comme un fichier (photo ou PDF).";
    case "RESEAU_INDISPONIBLE":
    case "DELAI_DEPASSE":
      return "L'envoi a été interrompu (connexion perdue ou trop lente). Vos saisies sont conservées : réessayez quand le réseau revient.";
    default:
      if (e.statut === 413) {
        return `Fichier trop volumineux : ${MO_MAX} Mo au plus.`;
      }
      return messageErreur(e);
  }
}

/** Empreinte SHA-256 (hexadécimal) d'un contenu, ou null si le navigateur ne la calcule pas. */
export async function empreinteSha256(contenu: ArrayBuffer): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const h = new Uint8Array(await subtle.digest("SHA-256", contenu));
    return Array.from(h, (o) => o.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
