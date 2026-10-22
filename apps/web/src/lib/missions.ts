/**
 * Missions (MIS-07, MIS-09, MIS-10, MIS-12) : logique pure, testée dans `missions.test.ts`.
 * Les règles d'actions reproduisent celles de l'API pour n'afficher que ce qui sera accepté ;
 * l'API reste seule juge (elle refuse toute action non autorisée).
 *
 * Sous-modules ré-exportés ici : `missions-types` (contrat et libellés), `missions-filtres`,
 * `missions-droits`, `missions-saisie` (formulaire mission) et `missions-signature`.
 */
import { cheminStockageSur, TYPES_DOCUMENT, type TypeDocument } from "@missionpilot/shared";
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
): Resultat<{ intitule: string; client_id?: string }, "intitule" | "client_id"> {
  const i = intitule.trim();
  const erreurs: Partial<Record<"intitule" | "client_id", string>> = {};
  if (i === "") erreurs.intitule = "Saisissez l'intitulé de la copie.";
  else if (i.length > 200) erreurs.intitule = "200 caractères au plus.";
  if (clientId !== "" && !UUID.test(clientId)) erreurs.client_id = "Choisissez dans la liste.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { intitule: i, ...(clientId ? { client_id: clientId } : {}) } };
}

const CODE = /^[a-z0-9_]{1,40}$/;

export function validerModele(
  code: string,
  libelle: string,
): Resultat<{ code: string; libelle: string }, "code" | "libelle"> {
  const c = code.trim();
  const l = libelle.trim();
  const erreurs: Partial<Record<"code" | "libelle", string>> = {};
  if (!CODE.test(c))
    erreurs.code = "Minuscules, chiffres et tiret bas, 40 caractères au plus (ex. audit_agences).";
  if (l === "") erreurs.libelle = "Saisissez le libellé du type de mission.";
  else if (l.length > 160) erreurs.libelle = "160 caractères au plus.";
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
): Resultat<
  { type: TypeDocument; nom: string; chemin_stockage: string | null },
  keyof SaisieDocument
> {
  const erreurs: Partial<Record<keyof SaisieDocument, string>> = {};
  if (!(typesPermis as readonly string[]).includes(s.type))
    erreurs.type = "Choisissez le type de document.";
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = "Saisissez le nom du document.";
  else if (nom.length > 200) erreurs.nom = "200 caractères au plus.";
  const chemin = s.chemin_stockage.trim();
  if (chemin.length > 500) erreurs.chemin_stockage = "500 caractères au plus.";
  else if (chemin !== "" && !cheminStockageSur(chemin))
    erreurs.chemin_stockage =
      "Chemin relatif uniquement (ex. livrables/rapport-v2.pdf), sans « .. », barre oblique inverse ni adresse web.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: { type: s.type as TypeDocument, nom, chemin_stockage: texteOuNull(chemin) },
  };
}

/** Date du jour au format AAAA-MM-JJ, dans le fuseau d'Abidjan (UTC). */
export const aujourdhuiIso = (maintenant: Date = new Date()) =>
  maintenant.toISOString().slice(0, 10);
