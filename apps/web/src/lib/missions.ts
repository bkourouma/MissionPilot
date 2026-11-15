/**
 * Missions (MIS-07, MIS-09, MIS-10, MIS-12) : logique pure, testée dans `missions.test.ts`.
 * Les règles d'actions reproduisent celles de l'API pour n'afficher que ce qui sera accepté ;
 * l'API reste seule juge (elle refuse toute action non autorisée).
 *
 * Sous-modules ré-exportés ici : `missions-types` (contrat et libellés), `missions-filtres`,
 * `missions-droits`, `missions-saisie` (formulaire mission) et `missions-signature`.
 */
import {
  cheminStockageSur,
  creerTraduire,
  TYPES_DOCUMENT,
  type Langue,
  type TypeDocument,
} from "@missionpilot/shared";
import { UUID } from "./missions-motifs";
import { texteOuNull, type Resultat } from "./saisie";

export * from "./missions-types";
export * from "./missions-filtres";
export * from "./missions-droits";
export * from "./missions-saisie";
export * from "./missions-signature";

// --- Duplication, modèle, documents, équipe ----------------------------------------------

export function validerDuplication(
  intitule: string,
  clientId: string,
  langue: Langue = "fr",
): Resultat<{ intitule: string; client_id?: string }, "intitule" | "client_id"> {
  const t = creerTraduire(langue);
  const i = intitule.trim();
  const erreurs: Partial<Record<"intitule" | "client_id", string>> = {};
  if (i === "")
    erreurs.intitule = t("Saisissez l'intitulé de la copie.", "Enter the title of the copy.");
  else if (i.length > 200)
    erreurs.intitule = t("200 caractères au plus.", "200 characters at most.");
  if (clientId !== "" && !UUID.test(clientId))
    erreurs.client_id = t("Choisissez dans la liste.", "Choose from the list.");
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { intitule: i, ...(clientId ? { client_id: clientId } : {}) } };
}

const CODE = /^[a-z0-9_]{1,40}$/;

export function validerModele(
  code: string,
  libelle: string,
  langue: Langue = "fr",
): Resultat<{ code: string; libelle: string }, "code" | "libelle"> {
  const t = creerTraduire(langue);
  const c = code.trim();
  const l = libelle.trim();
  const erreurs: Partial<Record<"code" | "libelle", string>> = {};
  if (!CODE.test(c))
    erreurs.code = t(
      "Minuscules, chiffres et tiret bas, 40 caractères au plus (ex. audit_agences).",
      "Lowercase letters, digits and underscores, 40 characters at most (e.g. audit_agences).",
    );
  if (l === "")
    erreurs.libelle = t(
      "Saisissez le libellé du type de mission.",
      "Enter the engagement type label.",
    );
  else if (l.length > 160)
    erreurs.libelle = t("160 caractères au plus.", "160 characters at most.");
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { code: c, libelle: l } };
}

/** Code proposé pour enregistrer une mission comme modèle : « Audit des agences » → « audit_des_agences ». */
export function codeDepuisLibelle(libelle: string): string {
  return (
    libelle
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40)
      .replace(/_+$/g, "") || "modele"
  );
}

export interface SaisieDocument {
  type: string;
  nom: string;
  chemin_stockage: string;
}

export function validerDocument(
  s: SaisieDocument,
  typesPermis: readonly TypeDocument[] = TYPES_DOCUMENT,
  langue: Langue = "fr",
): Resultat<
  { type: TypeDocument; nom: string; chemin_stockage: string | null },
  keyof SaisieDocument
> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<keyof SaisieDocument, string>> = {};
  if (!(typesPermis as readonly string[]).includes(s.type))
    erreurs.type = t("Choisissez le type de document.", "Choose the document type.");
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = t("Saisissez le nom du document.", "Enter the document name.");
  else if (nom.length > 200) erreurs.nom = t("200 caractères au plus.", "200 characters at most.");
  const chemin = s.chemin_stockage.trim();
  if (chemin.length > 500)
    erreurs.chemin_stockage = t("500 caractères au plus.", "500 characters at most.");
  else if (chemin !== "" && !cheminStockageSur(chemin))
    erreurs.chemin_stockage = t(
      "Chemin relatif uniquement (ex. livrables/rapport-v2.pdf), sans « .. », barre oblique inverse ni adresse web.",
      "Relative path only (e.g. livrables/rapport-v2.pdf), with no \u201c..\u201d, backslash or web address.",
    );
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: { type: s.type as TypeDocument, nom, chemin_stockage: texteOuNull(chemin) },
  };
}

/** Date du jour au format AAAA-MM-JJ, dans le fuseau d'Abidjan (UTC). */
export const aujourdhuiIso = (maintenant: Date = new Date()) =>
  maintenant.toISOString().slice(0, 10);
