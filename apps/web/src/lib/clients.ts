/** Fiches clients et contacts (SOC-03) : logique pure, testée dans `clients.test.ts`. */
import {
  TAILLES_CLIENT,
  type ClientCreation,
  type ContactCreation,
  type TailleClient,
} from "@missionpilot/shared";
import { FORMAT_EMAIL, texteOuNull, type Resultat } from "./saisie";

export interface Contact {
  id: string;
  client_id: string;
  nom: string;
  fonction: string | null;
  email: string | null;
  telephone: string | null;
  principal: boolean;
}

export interface Client {
  id: string;
  raison_sociale: string;
  forme_juridique: string | null;
  rccm: string | null;
  compte_contribuable: string | null;
  secteur: string | null;
  pays: string;
  taille: TailleClient | null;
  adresse: string | null;
  actif: boolean;
  cree_le: string;
  modifie_le: string;
}

export interface ClientDetaille extends Client {
  contacts: Contact[];
}

export interface PageListe<T> {
  elements: T[];
  curseur_suivant: string | null;
}

export const TAILLE_LIBELLES: Record<TailleClient, string> = {
  tpe: "TPE (très petite entreprise)",
  pme: "PME",
  eti: "ETI (entreprise de taille intermédiaire)",
  grande_entreprise: "Grande entreprise",
};

export const OPTIONS_TAILLES = TAILLES_CLIENT.map((t) => ({
  valeur: t,
  libelle: TAILLE_LIBELLES[t],
}));

// --- Liste --------------------------------------------------------------------

export type StatutFiltre = "actifs" | "archives" | "tous";

export interface ParametresListe {
  q: string;
  statut: StatutFiltre;
  curseur?: string;
}

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Paramètres de la liste lus dans l'URL (recherche bornée, statut connu, curseur borné). */
export function lireParametresListe(
  p: Record<string, string | string[] | undefined>,
): ParametresListe {
  const q = (un(p.q) ?? "").trim().slice(0, 100);
  const s = un(p.statut);
  const statut: StatutFiltre = s === "archives" || s === "tous" ? s : "actifs";
  const c = un(p.curseur);
  const curseur = c && c.length <= 500 && /^[A-Za-z0-9_-]+$/.test(c) ? c : undefined;
  return { q, statut, curseur };
}

/** Requête vers l'API (`/api/clients?…`, `/api/collaborateurs?…`). */
export function requeteApiListe(p: ParametresListe, limite = 25): string {
  const r = new URLSearchParams();
  if (p.q) r.set("q", p.q);
  if (p.statut === "actifs") r.set("actif", "true");
  if (p.statut === "archives") r.set("actif", "false");
  r.set("limite", String(limite));
  if (p.curseur) r.set("curseur", p.curseur);
  return r.toString();
}

/** Lien de la liste dans l'interface (le statut par défaut n'est pas répété). */
export function hrefListe(base: string, p: ParametresListe, extra: Record<string, string> = {}) {
  const r = new URLSearchParams();
  if (p.q) r.set("q", p.q);
  if (p.statut !== "actifs") r.set("statut", p.statut);
  for (const [k, v] of Object.entries(extra)) if (v) r.set(k, v);
  if (p.curseur) r.set("curseur", p.curseur);
  const s = r.toString();
  return s ? `${base}?${s}` : base;
}

// --- Formulaire client ----------------------------------------------------------

export interface SaisieClient {
  raison_sociale: string;
  forme_juridique: string;
  rccm: string;
  compte_contribuable: string;
  secteur: string;
  pays: string;
  taille: string;
  adresse: string;
}

export type ChampClient = keyof SaisieClient;

export const SAISIE_CLIENT_VIDE: SaisieClient = {
  raison_sociale: "",
  forme_juridique: "",
  rccm: "",
  compte_contribuable: "",
  secteur: "",
  pays: "CI",
  taille: "",
  adresse: "",
};

export function saisieDepuisClient(c: Client): SaisieClient {
  return {
    raison_sociale: c.raison_sociale,
    forme_juridique: c.forme_juridique ?? "",
    rccm: c.rccm ?? "",
    compte_contribuable: c.compte_contribuable ?? "",
    secteur: c.secteur ?? "",
    pays: c.pays,
    taille: c.taille ?? "",
    adresse: c.adresse ?? "",
  };
}

const LONGUEURS: Partial<Record<ChampClient, number>> = {
  raison_sociale: 200,
  forme_juridique: 60,
  rccm: 60,
  compte_contribuable: 60,
  secteur: 120,
  adresse: 500,
};

/** Charge commune à la création et à la modification (sans `actif`). */
export type ChargeClient = Omit<ClientCreation, "actif">;

export function validerClient(s: SaisieClient): Resultat<ChargeClient, ChampClient> {
  const erreurs: Partial<Record<ChampClient, string>> = {};
  if (s.raison_sociale.trim() === "") erreurs.raison_sociale = "Saisissez la raison sociale.";
  for (const [champ, max] of Object.entries(LONGUEURS) as [ChampClient, number][]) {
    if (!erreurs[champ] && s[champ].trim().length > max)
      erreurs[champ] = `${max} caractères au plus.`;
  }
  if (!/^[A-Z]{2}$/.test(s.pays)) erreurs.pays = "Choisissez un pays.";
  if (s.taille !== "" && !(TAILLES_CLIENT as readonly string[]).includes(s.taille))
    erreurs.taille = "Choisissez une taille dans la liste.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      raison_sociale: s.raison_sociale.trim(),
      forme_juridique: texteOuNull(s.forme_juridique),
      rccm: texteOuNull(s.rccm),
      compte_contribuable: texteOuNull(s.compte_contribuable),
      secteur: texteOuNull(s.secteur),
      pays: s.pays,
      taille: s.taille === "" ? null : (s.taille as TailleClient),
      adresse: texteOuNull(s.adresse),
    },
  };
}

// --- Formulaire contact ---------------------------------------------------------

export interface SaisieContact {
  nom: string;
  fonction: string;
  email: string;
  telephone: string;
  principal: boolean;
}

export type ChampContact = keyof SaisieContact;

export const SAISIE_CONTACT_VIDE: SaisieContact = {
  nom: "",
  fonction: "",
  email: "",
  telephone: "",
  principal: false,
};

export function saisieDepuisContact(c: Contact): SaisieContact {
  return {
    nom: c.nom,
    fonction: c.fonction ?? "",
    email: c.email ?? "",
    telephone: c.telephone ?? "",
    principal: c.principal,
  };
}

export function validerContact(s: SaisieContact): Resultat<ContactCreation, ChampContact> {
  const erreurs: Partial<Record<ChampContact, string>> = {};
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = "Saisissez le nom du contact.";
  else if (nom.length > 160) erreurs.nom = "160 caractères au plus.";
  if (s.fonction.trim().length > 120) erreurs.fonction = "120 caractères au plus.";
  const email = s.email.trim().toLowerCase();
  if (email !== "" && (!FORMAT_EMAIL.test(email) || email.length > 254))
    erreurs.email = "Adresse e-mail invalide. Exemple : prenom.nom@entreprise.ci";
  const tel = s.telephone.trim();
  if (tel.length > 40) erreurs.telephone = "40 caractères au plus.";
  else if (tel !== "" && !/^[+0-9 ().-]+$/.test(tel))
    erreurs.telephone =
      "Chiffres, espaces et signes + ( ) . - uniquement. Exemple : +225 07 00 00 00 00";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      nom,
      fonction: texteOuNull(s.fonction),
      email: email === "" ? null : email,
      telephone: texteOuNull(s.telephone),
      principal: s.principal,
    },
  };
}
