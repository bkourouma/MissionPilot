/**
 * Paramètres de facturation du cabinet (FIN-07) : logique pure, testée dans
 * `parametres-facturation.test.ts`.
 *
 * Deux formulaires, deux droits (miroir de `routes/parametres-facturation.ts`) :
 * - identité légale, coordonnées de paiement (IBAN) et numérotation : « cabinet.gerer » ;
 * - délai de paiement, TVA, retenue et validation des valeurs de départ : « facture.emettre ».
 */
import { aPermission, BASES_RETENUE, type BaseRetenue, type Role } from "@missionpilot/shared";
import { FORMAT_EMAIL, lireNombre, texteOuNull, type Resultat } from "./saisie";

export interface ParametresFacturation {
  raison_sociale: string | null;
  forme_juridique: string | null;
  rccm: string | null;
  compte_contribuable: string | null;
  regime_fiscal: string | null;
  adresse: string | null;
  telephone: string | null;
  email: string | null;
  banque: string | null;
  iban: string | null;
  /**
   * Vrai si l'API a rendu l'IBAN MASQUÉ (pays + 4 derniers caractères) : lecteur sans
   * « facture.emettre ». Absent des anciennes réponses : traité comme faux.
   */
  iban_masque?: boolean;
  autres_coordonnees: string | null;
  /** Vrai si l'API a MASQUÉ les autres coordonnées de paiement (même règle que l'IBAN). */
  autres_coordonnees_masquees?: boolean;
  mentions_complementaires: string | null;
  prefixe_facture: string;
  prefixe_avoir: string;
  chiffres_numero: number;
  delai_paiement_jours: number;
  taux_tva_defaut: number;
  taux_tva_autorises: number[];
  taux_tva_debours: number;
  retenue_active: boolean;
  retenue_taux: number;
  retenue_base: BaseRetenue;
  retenue_libelle: string;
  valeurs_validees: boolean;
  personnalises: boolean;
  modifie_le: string | null;
}

export interface DroitsParametresFacturation {
  identite: boolean;
  operationnel: boolean;
}

export function droitsParametresFacturation(roles: readonly Role[]): DroitsParametresFacturation {
  return {
    identite: aPermission(roles, "cabinet.gerer"),
    operationnel: aPermission(roles, "facture.emettre"),
  };
}

export const BASE_RETENUE_LIBELLES: Record<BaseRetenue, string> = {
  HT: "Montant hors taxes (HT)",
  TTC: "Montant toutes taxes comprises (TTC)",
};

export const OPTIONS_BASES_RETENUE = BASES_RETENUE.map((b) => ({
  valeur: b,
  libelle: BASE_RETENUE_LIBELLES[b],
}));

/** Exemple du prochain numéro (mise en forme, aucun compteur réel). */
export function apercuNumero(prefixe: string, chiffres: number, annee: number): string {
  return `${prefixe}-${annee}-${"1".padStart(Math.max(1, chiffres), "0")}`;
}

// --- Identité, coordonnées et numérotation -------------------------------------------------

export interface SaisieIdentite {
  raison_sociale: string;
  forme_juridique: string;
  rccm: string;
  compte_contribuable: string;
  regime_fiscal: string;
  adresse: string;
  telephone: string;
  email: string;
  banque: string;
  iban: string;
  autres_coordonnees: string;
  mentions_complementaires: string;
  prefixe_facture: string;
  prefixe_avoir: string;
  chiffres_numero: string;
}

export type ChampIdentite = keyof SaisieIdentite;

const LIGNES: readonly [ChampIdentite, number][] = [
  ["raison_sociale", 200],
  ["forme_juridique", 80],
  ["rccm", 80],
  ["compte_contribuable", 80],
  ["regime_fiscal", 120],
  ["telephone", 40],
  ["email", 254],
  ["banque", 120],
];
const BLOCS: readonly [ChampIdentite, number][] = [
  ["adresse", 500],
  ["autres_coordonnees", 500],
  ["mentions_complementaires", 1000],
];

const PREFIXE = /^[A-Z0-9]{1,10}$/;
const IBAN = /^[A-Z]{2}[0-9A-Z]{10,32}$/;

export function saisieIdentite(p: ParametresFacturation): SaisieIdentite {
  const t = (v: string | null) => v ?? "";
  return {
    raison_sociale: t(p.raison_sociale),
    forme_juridique: t(p.forme_juridique),
    rccm: t(p.rccm),
    compte_contribuable: t(p.compte_contribuable),
    regime_fiscal: t(p.regime_fiscal),
    adresse: t(p.adresse),
    telephone: t(p.telephone),
    email: t(p.email),
    banque: t(p.banque),
    iban: t(p.iban),
    autres_coordonnees: t(p.autres_coordonnees),
    mentions_complementaires: t(p.mentions_complementaires),
    prefixe_facture: p.prefixe_facture,
    prefixe_avoir: p.prefixe_avoir,
    chiffres_numero: String(p.chiffres_numero),
  };
}

/** IBAN saisi « CI93 CI00 … » → « CI93CI00… » (comme l'API). */
export const normaliserIban = (v: string) => v.replace(/\s+/g, "").toUpperCase();

function verifierTextes(s: SaisieIdentite, erreurs: Partial<Record<ChampIdentite, string>>) {
  for (const [champ, max] of LIGNES) {
    const v = s[champ].trim();
    if (/[\r\n]/.test(v)) erreurs[champ] = "Une seule ligne attendue.";
    else if (v.length > max) erreurs[champ] = `${max} caractères au plus.`;
  }
  for (const [champ, max] of BLOCS) {
    if (s[champ].trim().length > max) erreurs[champ] = `${max} caractères au plus.`;
  }
  const email = s.email.trim();
  if (email !== "" && !erreurs.email && !FORMAT_EMAIL.test(email))
    erreurs.email = "Adresse e-mail invalide. Exemple : facturation@cabinet.ci";
  const iban = normaliserIban(s.iban);
  if (iban !== "" && !IBAN.test(iban))
    erreurs.iban = "IBAN invalide : 2 lettres puis 10 à 32 lettres ou chiffres (ex. CI93 CI00 …).";
}

function verifierNumerotation(s: SaisieIdentite, erreurs: Partial<Record<ChampIdentite, string>>) {
  const pf = s.prefixe_facture.trim().toUpperCase();
  const pa = s.prefixe_avoir.trim().toUpperCase();
  if (!PREFIXE.test(pf)) erreurs.prefixe_facture = "Majuscules et chiffres, 10 caractères au plus.";
  if (!PREFIXE.test(pa)) erreurs.prefixe_avoir = "Majuscules et chiffres, 10 caractères au plus.";
  if (!erreurs.prefixe_facture && !erreurs.prefixe_avoir && pf === pa)
    erreurs.prefixe_avoir = "Le préfixe des avoirs doit différer de celui des factures.";
  const c = lireNombre(s.chiffres_numero);
  if (c === null || Number.isNaN(c) || !Number.isInteger(c) || c < 3 || c > 8)
    erreurs.chiffres_numero = "Nombre entier de 3 à 8.";
}

/** IBAN masqué reçu de l'API (à ne jamais renvoyer), ou null s'il est en clair. */
export function ibanMasqueRecu(p: ParametresFacturation): string | null {
  return p.iban_masque && p.iban ? p.iban : null;
}

/** Autres coordonnées masquées reçues de l'API (à ne jamais renvoyer), ou null en clair. */
export function autresCoordonneesMasqueesRecues(p: ParametresFacturation): string | null {
  return p.autres_coordonnees_masquees && p.autres_coordonnees ? p.autres_coordonnees : null;
}

/**
 * `ibanMasque`, `autresMasquees` : valeurs masquées reçues de l'API. Une saisie restée
 * identique est OMISE de la charge (l'API conserve la valeur enregistrée) ; sinon la
 * nouvelle valeur est envoyée (l'IBAN est validé comme un IBAN complet : une valeur
 * masquée modifiée est refusée).
 */
export function validerIdentite(
  s: SaisieIdentite,
  ibanMasque: string | null = null,
  autresMasquees: string | null = null,
): Resultat<Record<string, string | number | null>, ChampIdentite> {
  const erreurs: Partial<Record<ChampIdentite, string>> = {};
  const ibanInchange = ibanMasque !== null && s.iban.trim() === ibanMasque;
  const autresInchangees =
    autresMasquees !== null && s.autres_coordonnees.trim() === autresMasquees.trim();
  verifierTextes(ibanInchange ? { ...s, iban: "" } : s, erreurs);
  verifierNumerotation(s, erreurs);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: Record<string, string | number | null> = {};
  for (const [champ] of [...LIGNES, ...BLOCS]) charge[champ] = texteOuNull(s[champ]);
  if (autresInchangees) delete charge.autres_coordonnees;
  if (!ibanInchange) charge.iban = texteOuNull(normaliserIban(s.iban));
  charge.prefixe_facture = s.prefixe_facture.trim().toUpperCase();
  charge.prefixe_avoir = s.prefixe_avoir.trim().toUpperCase();
  charge.chiffres_numero = lireNombre(s.chiffres_numero) as number;
  return { ok: true, charge };
}

/** Mentions exigées par l'API avant toute émission de facture. */
export function mentionsManquantes(p: ParametresFacturation): string[] {
  const manquantes: string[] = [];
  if (!p.rccm) manquantes.push("numéro RCCM");
  if (!p.compte_contribuable) manquantes.push("compte contribuable");
  if (!p.adresse) manquantes.push("adresse");
  return manquantes;
}

// --- TVA, retenue et délai -----------------------------------------------------------------

export interface SaisieOperationnelle {
  delai_paiement_jours: string;
  taux_tva_defaut: string;
  taux_tva_autorises: string;
  taux_tva_debours: string;
  retenue_active: boolean;
  retenue_taux: string;
  retenue_base: string;
  retenue_libelle: string;
  valeurs_validees: boolean;
}

export type ChampOperationnel = keyof SaisieOperationnelle;

const virgule = (n: number) => String(n).replace(".", ",");

export function saisieOperationnelle(p: ParametresFacturation): SaisieOperationnelle {
  return {
    delai_paiement_jours: String(p.delai_paiement_jours),
    taux_tva_defaut: virgule(p.taux_tva_defaut),
    taux_tva_autorises: p.taux_tva_autorises.map(virgule).join(" ; "),
    taux_tva_debours: virgule(p.taux_tva_debours),
    retenue_active: p.retenue_active,
    retenue_taux: virgule(p.retenue_taux),
    retenue_base: p.retenue_base,
    retenue_libelle: p.retenue_libelle,
    valeurs_validees: p.valeurs_validees,
  };
}

/** Pourcentage en points (18 pour 18 %) avec au plus `decimales` décimales, 0 à 100. */
export function lirePourcentage(v: string, decimales: number): number | null {
  const n = lireNombre(v);
  if (n === null || Number.isNaN(n) || n < 0 || n > 100) return null;
  const f = 10 ** decimales;
  return Math.abs(n * f - Math.round(n * f)) < 1e-6 ? n : null;
}

/** « 0 ; 9 ; 18 » → [0, 9, 18] trié, sans doublon ; `null` si une valeur est illisible. */
export function lireTauxAutorises(v: string): number[] | null {
  const morceaux = v
    .split(/[;\n]|,(?=\s)|\s{2,}/)
    .map((m) => m.trim())
    .filter((m) => m !== "");
  if (morceaux.length === 0 || morceaux.length > 10) return null;
  const taux = morceaux.map((m) => lirePourcentage(m, 2));
  if (taux.some((t) => t === null)) return null;
  return [...new Set(taux as number[])].sort((a, b) => a - b);
}

export function validerOperationnel(
  s: SaisieOperationnelle,
): Resultat<Record<string, unknown>, ChampOperationnel> {
  const erreurs: Partial<Record<ChampOperationnel, string>> = {};
  const delai = lireNombre(s.delai_paiement_jours);
  if (delai === null || Number.isNaN(delai) || !Number.isInteger(delai) || delai < 0 || delai > 365)
    erreurs.delai_paiement_jours = "Nombre entier de jours, de 0 à 365.";
  const autorises = lireTauxAutorises(s.taux_tva_autorises);
  if (!autorises)
    erreurs.taux_tva_autorises = "De 1 à 10 taux entre 0 et 100, séparés par « ; » (ex. 0 ; 18).";
  const defaut = lirePourcentage(s.taux_tva_defaut, 2);
  if (defaut === null) erreurs.taux_tva_defaut = "Taux entre 0 et 100, deux décimales au plus.";
  else if (autorises && !autorises.includes(defaut))
    erreurs.taux_tva_defaut = "Le taux par défaut doit figurer parmi les taux autorisés.";
  const debours = lirePourcentage(s.taux_tva_debours, 2);
  if (debours === null) erreurs.taux_tva_debours = "Taux entre 0 et 100, deux décimales au plus.";
  else if (autorises && !autorises.includes(debours))
    erreurs.taux_tva_debours = "Le taux des débours doit figurer parmi les taux autorisés.";
  const retenue = lirePourcentage(s.retenue_taux, 4);
  if (retenue === null) erreurs.retenue_taux = "Taux entre 0 et 100, quatre décimales au plus.";
  if (!(BASES_RETENUE as readonly string[]).includes(s.retenue_base))
    erreurs.retenue_base = "Choisissez l'assiette de la retenue.";
  const libelle = s.retenue_libelle.trim();
  if (libelle === "") erreurs.retenue_libelle = "Saisissez le libellé de la retenue.";
  else if (libelle.length > 120 || /[\r\n]/.test(libelle))
    erreurs.retenue_libelle = "Une seule ligne de 120 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      delai_paiement_jours: delai,
      taux_tva_defaut: defaut,
      taux_tva_autorises: autorises,
      taux_tva_debours: debours,
      retenue_active: s.retenue_active,
      retenue_taux: retenue,
      retenue_base: s.retenue_base,
      retenue_libelle: libelle,
      valeurs_validees: s.valeurs_validees,
    },
  };
}
