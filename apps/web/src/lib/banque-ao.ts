import {
  aPermission,
  LIBELLES_NIVEAU_DIPLOME,
  LIBELLES_NIVEAU_LANGUE,
  LIBELLES_ROLE_REFERENCE,
  LIBELLES_SECTION_OFFRE,
  LIBELLES_TYPE_ATTESTATION,
  NIVEAUX_DIPLOME_AO,
  NIVEAUX_LANGUE_AO,
  SECTIONS_OFFRE_TECHNIQUE,
  type NiveauDiplomeAo,
  type NiveauLangueAo,
  type Permission,
  type Role,
  type SectionOffreTechnique,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { formaterNombre, type Devise } from "./format";
import {
  decouperListe,
  lireMontant,
  lireNombre,
  montantVersSaisie,
  texteOuNull,
  type Resultat,
} from "./saisie";

/*
 * Banques et offres des appels d'offres (lot AO-B : AO-04 à AO-07), côté web : types des
 * réponses, sous-pages, droits d'affichage (l'API reste la source de vérité), libellés et
 * lecture des saisies. Aucun calcul : années d'expérience, contrôles et montants viennent de
 * l'API (moteurs `banque-cv` et `offre-financiere`).
 */

export const RACINE_BANQUES = "/appels-offres/banques";

/* ----- Types des réponses ----- */

export interface ExperienceSaisie {
  intitule: string;
  employeur: string;
  pays?: string | null;
  debut: string;
  fin: string | null;
  secteurs: string[];
  bailleur?: string | null;
  description?: string | null;
}

export interface DiplomeSaisi {
  intitule: string;
  niveau: NiveauDiplomeAo;
  domaine: string;
  etablissement?: string | null;
  annee: number;
}

export interface LangueSaisie {
  langue: string;
  niveau: NiveauLangueAo;
}

export interface ContenuCv {
  titre: string;
  nationalite?: string | null;
  resume?: string | null;
  secteurs: string[];
  competences: string[];
  experiences: ExperienceSaisie[];
  diplomes: DiplomeSaisi[];
  langues: LangueSaisie[];
}

export interface CvResume {
  id: string;
  numero: number;
  nom: string;
  collaborateur_id: string | null;
  version: number;
  titre: string;
  secteurs: string[];
  annees_experience: number;
}

export interface CvDetail {
  id: string;
  numero: number;
  nom: string;
  collaborateur_id: string | null;
  collaborateur_nom: string | null;
  reference: string;
  annees_experience: number;
  courante: { version: number; contenu: ContenuCv; motif: string | null; cree_le: string };
  versions: { id: string; version: number; motif: string | null; cree_le: string }[];
}

export interface GabaritCv {
  code: string;
  libelle: string;
  bailleur: string;
  standard: boolean;
}

export interface CritereControle {
  code: string;
  objet: string | null;
  exige: string;
  constate: string;
  conforme: boolean;
}

export interface ResultatControle {
  conforme: boolean;
  annees_experience: number;
  reference: string;
  criteres: CritereControle[];
}

export interface VersionReference {
  version: number;
  titre: string;
  client_nom: string;
  pays: string;
  secteurs: string[];
  bailleur: string | null;
  montant: number;
  devise: Devise;
  date_debut: string;
  date_fin: string | null;
  role_cabinet: keyof typeof LIBELLES_ROLE_REFERENCE;
  description: string | null;
  motif: string | null;
  cree_le: string;
}

export interface ReferenceResume extends VersionReference {
  id: string;
  numero: number;
  attestations: number;
}

export interface Attestation {
  id: string;
  type: keyof typeof LIBELLES_TYPE_ATTESTATION;
  date_attestation: string;
  emetteur: string;
  retiree: boolean;
  motif_retrait: string | null;
  fichier: { id: string; nom: string; type_mime: string; taille: number };
}

export interface ReferenceDetail {
  id: string;
  numero: number;
  courante: VersionReference;
  versions: VersionReference[];
  attestations: Attestation[];
}

export type StatutOffreTechnique = "brouillon_ia" | "modifiee" | "validee";
export type SectionsOffre = Record<SectionOffreTechnique, string>;

export interface VersionOffreTechnique {
  id: string;
  version: number;
  sections: SectionsOffre;
  origine: "ia" | "gabarit" | "manuel";
  chiffres_non_verifies: boolean;
  nombres_non_verifies: string[];
  motif: string | null;
  cree_le: string;
  validation: { valide_par: string; acquitte_chiffres: boolean; valide_le: string } | null;
}

export interface OffreTechniqueResume {
  id: string;
  numero: number;
  appel_offres_id: string | null;
  titre: string;
  version: number;
  statut: StatutOffreTechnique;
  cree_le: string;
}

export interface OffreTechniqueDetail {
  id: string;
  numero: number;
  appel_offres_id: string | null;
  titre: string;
  statut: StatutOffreTechnique;
  courante: VersionOffreTechnique | null;
  versions: VersionOffreTechnique[];
}

export interface LigneResultat {
  libelle: string;
  quantite: number;
  prix_unitaire: number;
  montant: number;
  cle?: string;
}

export interface ResultatOffreFinanciere {
  devise: Devise;
  honoraires: LigneResultat[];
  per_diem: LigneResultat[];
  debours: LigneResultat[];
  jours_par_expert: { cle: string; libelle: string; jours_centiemes: number; montant: number }[];
  total_jours_centiemes: number;
  sous_total_honoraires: number;
  sous_total_per_diem: number;
  sous_total_debours: number;
  total_ht: number;
  taxes: { libelle: string; taux: number; assiette: string; base: number; montant: number }[];
  total_taxes: number;
  total_ttc: number;
  conversion: {
    devise_cible: Devise;
    taux: number;
    date_fixation: string;
    total_ht: number;
    total_ttc: number;
  } | null;
}

export interface OffreFinanciereResume {
  id: string;
  numero: number;
  titre: string;
  version: number;
  devise: Devise;
  total_ht: number;
  total_ttc: number;
  cree_le: string;
}

export interface OffreFinanciereDetail {
  id: string;
  numero: number;
  titre: string;
  courante: {
    version: number;
    devise: Devise;
    entree: Record<string, unknown>;
    resultat: ResultatOffreFinanciere;
    motif: string | null;
    cree_le: string;
  } | null;
  versions: { version: number; motif: string | null; cree_le: string }[];
}

/* ----- Navigation et droits ----- */

export interface SousPageBanques {
  id: string;
  libelle: string;
  href: string;
  /** Toutes exigées. */
  permissions: readonly Permission[];
}

export const SOUS_PAGES_BANQUES: readonly SousPageBanques[] = [
  { id: "cv", libelle: "Banque de CV", href: `${RACINE_BANQUES}/cv`, permissions: ["ao.lire"] },
  {
    id: "references",
    libelle: "Références",
    href: `${RACINE_BANQUES}/references`,
    permissions: ["ao.lire"],
  },
  {
    id: "offres-techniques",
    libelle: "Offres techniques",
    href: `${RACINE_BANQUES}/offres-techniques`,
    permissions: ["ao.lire"],
  },
  {
    id: "offres-financieres",
    libelle: "Offres financières",
    href: `${RACINE_BANQUES}/offres-financieres`,
    permissions: ["ao.lire", "finance.lire"],
  },
];

export function sousPagesBanques(roles: readonly Role[]): SousPageBanques[] {
  return SOUS_PAGES_BANQUES.filter((p) => p.permissions.every((x) => aPermission(roles, x)));
}

/** Droits d'affichage (confort : l'API refuse de toute façon). */
export function droitsBanqueAo(roles: readonly Role[]) {
  const finance = aPermission(roles, "ao.lire") && aPermission(roles, "finance.lire");
  return {
    lire: aPermission(roles, "ao.lire"),
    gerer: aPermission(roles, "ao.gerer"),
    /** Offre financière (FIN-02). */
    lireFinance: finance,
    ecrireFinance: finance && aPermission(roles, "taux.gerer"),
    redigerIa: aPermission(roles, "ao.gerer") && aPermission(roles, "ia.utiliser"),
    lierMethode: aPermission(roles, "standard.lire"),
  };
}

/* ----- Libellés ----- */

export const LIBELLES_STATUT_OFFRE: Record<StatutOffreTechnique, string> = {
  brouillon_ia: "Brouillon IA",
  modifiee: "Modifiée",
  validee: "Validée",
};

export function tonaliteStatutOffre(s: StatutOffreTechnique): "succes" | "attention" | "neutre" {
  if (s === "validee") return "succes";
  return s === "brouillon_ia" ? "attention" : "neutre";
}

export const LIBELLES_ORIGINE: Record<VersionOffreTechnique["origine"], string> = {
  ia: "Rédigée par l'IA",
  gabarit: "Gabarit déterministe",
  manuel: "Modification humaine",
};

export const libelleNiveauDiplome = (n: NiveauDiplomeAo) => LIBELLES_NIVEAU_DIPLOME[n];
export const libelleNiveauLangue = (n: NiveauLangueAo) => LIBELLES_NIVEAU_LANGUE[n];
export const libelleRoleReference = (r: keyof typeof LIBELLES_ROLE_REFERENCE) =>
  LIBELLES_ROLE_REFERENCE[r];
export const libelleTypeAttestation = (t: keyof typeof LIBELLES_TYPE_ATTESTATION) =>
  LIBELLES_TYPE_ATTESTATION[t];
export const libelleSection = (s: SectionOffreTechnique) => LIBELLES_SECTION_OFFRE[s];
export { SECTIONS_OFFRE_TECHNIQUE };

const LIBELLES_CRITERE: Record<string, string> = {
  annees_experience: "Années d'expérience",
  annees_secteur: "Années dans le secteur",
  diplome: "Diplôme",
  langue: "Langue",
  experiences_bailleur: "Expériences auprès du bailleur",
};
export const libelleCritere = (c: CritereControle) =>
  c.objet
    ? `${LIBELLES_CRITERE[c.code] ?? c.code} : ${c.objet}`
    : (LIBELLES_CRITERE[c.code] ?? c.code);

/** Mois « AAAA-MM » → « MM/AAAA » ; null → « en cours ». */
export function moisAffiche(mois: string | null): string {
  if (mois === null) return "en cours";
  return /^\d{4}-\d{2}$/.test(mois) ? `${mois.slice(5, 7)}/${mois.slice(0, 4)}` : mois;
}

/** Jours en centièmes (API) → « 12,5 j ». Affichage seulement. */
export const joursAffiches = (centiemes: number) => `${formaterNombre(centiemes / 100, 2)} j`;

/* ----- Lecture des saisies ----- */

const MOIS = /^(19[5-9]\d|20\d\d|2100)-(0[1-9]|1[0-2])$/;
const EN_COURS = new Set(["", "en cours", "en_cours", "-", "…"]);

/** « bac+5 », « Bac + 5 », « master », « doctorat » → niveau ; null si inconnu. */
export function lireNiveauDiplome(v: string): NiveauDiplomeAo | null {
  const t = v.toLowerCase().replace(/\s+/g, "").replace("+", "_");
  const alias: Record<string, NiveauDiplomeAo> = {
    licence: "bac_3",
    master: "bac_5",
    doctorat: "doctorat",
    phd: "doctorat",
    bts: "bac_2",
    dut: "bac_2",
  };
  if (alias[t]) return alias[t];
  return (NIVEAUX_DIPLOME_AO as readonly string[]).includes(t) ? (t as NiveauDiplomeAo) : null;
}

export function lireNiveauLangue(v: string): NiveauLangueAo | null {
  const t = v.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (t === "langue maternelle") return "maternelle";
  return (NIVEAUX_LANGUE_AO as readonly string[]).includes(t) ? (t as NiveauLangueAo) : null;
}

const lignes = (v: string) =>
  v
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
const champs = (l: string) => l.split("|").map((c) => c.trim());

/**
 * Expériences, une par ligne : « début | fin ou en cours | intitulé | employeur | pays |
 * secteurs séparés par ; | bailleur ». Mois au format AAAA-MM.
 */
export function lireExperiences(
  v: string,
): { ok: true; valeur: ExperienceSaisie[] } | { ok: false; erreur: string } {
  const sortie: ExperienceSaisie[] = [];
  for (const [i, l] of lignes(v).entries()) {
    const [
      debut = "",
      fin = "",
      intitule = "",
      employeur = "",
      pays = "",
      secteurs = "",
      bailleur = "",
    ] = champs(l);
    const finLue = EN_COURS.has(fin.toLowerCase()) ? null : fin;
    if (!MOIS.test(debut) || (finLue !== null && !MOIS.test(finLue))) {
      return { ok: false, erreur: `Ligne ${i + 1} : mois au format AAAA-MM attendus.` };
    }
    if (finLue !== null && finLue < debut) {
      return { ok: false, erreur: `Ligne ${i + 1} : la fin précède le début.` };
    }
    if (intitule === "" || employeur === "") {
      return { ok: false, erreur: `Ligne ${i + 1} : intitulé et employeur sont obligatoires.` };
    }
    if (pays !== "" && !/^[A-Za-z]{2}$/.test(pays)) {
      return { ok: false, erreur: `Ligne ${i + 1} : pays en code ISO à deux lettres (CI, SN…).` };
    }
    sortie.push({
      intitule,
      employeur,
      pays: pays === "" ? null : pays.toUpperCase(),
      debut,
      fin: finLue,
      secteurs: decouperListe(secteurs.replace(/;/g, ",")),
      bailleur: texteOuNull(bailleur),
    });
  }
  return { ok: true, valeur: sortie };
}

/** Diplômes, un par ligne : « année | niveau (bac+5, master…) | intitulé | domaine | établissement ». */
export function lireDiplomes(
  v: string,
): { ok: true; valeur: DiplomeSaisi[] } | { ok: false; erreur: string } {
  const sortie: DiplomeSaisi[] = [];
  for (const [i, l] of lignes(v).entries()) {
    const [annee = "", niveau = "", intitule = "", domaine = "", etablissement = ""] = champs(l);
    const a = Number(annee);
    const n = lireNiveauDiplome(niveau);
    if (!/^\d{4}$/.test(annee) || a < 1950 || a > 2100) {
      return { ok: false, erreur: `Ligne ${i + 1} : année sur quatre chiffres attendue.` };
    }
    if (!n) return { ok: false, erreur: `Ligne ${i + 1} : niveau inconnu (bac, bac+2… doctorat).` };
    if (intitule === "" || domaine === "") {
      return { ok: false, erreur: `Ligne ${i + 1} : intitulé et domaine sont obligatoires.` };
    }
    sortie.push({
      annee: a,
      niveau: n,
      intitule,
      domaine,
      etablissement: texteOuNull(etablissement),
    });
  }
  return { ok: true, valeur: sortie };
}

/** Langues, une par ligne : « langue : niveau » (notions, courant, bilingue, maternelle). */
export function lireLangues(
  v: string,
): { ok: true; valeur: LangueSaisie[] } | { ok: false; erreur: string } {
  const sortie: LangueSaisie[] = [];
  for (const [i, l] of lignes(v).entries()) {
    const [langue = "", niveau = ""] = l.split(":").map((x) => x.trim());
    const n = lireNiveauLangue(niveau);
    if (langue === "" || !n) {
      return { ok: false, erreur: `Ligne ${i + 1} : « langue : niveau » attendu.` };
    }
    sortie.push({ langue, niveau: n });
  }
  return { ok: true, valeur: sortie };
}

export interface SaisieCv {
  nom: string;
  titre: string;
  nationalite: string;
  resume: string;
  secteurs: string;
  competences: string;
  experiences: string;
  diplomes: string;
  langues: string;
}

type ChampCv = keyof SaisieCv;

/** Formulaire du CV → contenu attendu par l'API. */
export function lireCv(s: SaisieCv): Resultat<{ nom: string; contenu: ContenuCv }, ChampCv> {
  const erreurs: Partial<Record<ChampCv, string>> = {};
  const nom = s.nom.trim();
  const titre = s.titre.trim();
  if (nom === "") erreurs.nom = "Le nom de l'expert est obligatoire.";
  if (titre === "") erreurs.titre = "Le titre ou poste est obligatoire.";
  const experiences = lireExperiences(s.experiences);
  if (!experiences.ok) erreurs.experiences = experiences.erreur;
  const diplomes = lireDiplomes(s.diplomes);
  if (!diplomes.ok) erreurs.diplomes = diplomes.erreur;
  const langues = lireLangues(s.langues);
  if (!langues.ok) erreurs.langues = langues.erreur;
  if (Object.keys(erreurs).length > 0 || !experiences.ok || !diplomes.ok || !langues.ok) {
    return { ok: false, erreurs };
  }
  return {
    ok: true,
    charge: {
      nom,
      contenu: {
        titre,
        nationalite: texteOuNull(s.nationalite),
        resume: texteOuNull(s.resume),
        secteurs: decouperListe(s.secteurs),
        competences: decouperListe(s.competences),
        experiences: experiences.valeur,
        diplomes: diplomes.valeur,
        langues: langues.valeur,
      },
    },
  };
}

/** Contenu de l'API → champs du formulaire (nouvelle version). */
export function saisieDepuisCv(nom: string, c: ContenuCv): SaisieCv {
  return {
    nom,
    titre: c.titre,
    nationalite: c.nationalite ?? "",
    resume: c.resume ?? "",
    secteurs: c.secteurs.join(", "),
    competences: c.competences.join(", "),
    experiences: c.experiences
      .map((e) =>
        [
          e.debut,
          e.fin ?? "en cours",
          e.intitule,
          e.employeur,
          e.pays ?? "",
          e.secteurs.join(" ; "),
          e.bailleur ?? "",
        ].join(" | "),
      )
      .join("\n"),
    diplomes: c.diplomes
      .map((d) =>
        [String(d.annee), d.niveau, d.intitule, d.domaine, d.etablissement ?? ""].join(" | "),
      )
      .join("\n"),
    langues: c.langues.map((l) => `${l.langue} : ${l.niveau}`).join("\n"),
  };
}

export interface SaisieExigences {
  annees_min: string;
  niveau_diplome_min: string;
  secteur: string;
  annees_secteur: string;
  langue: string;
  niveau_langue: string;
  reference: string;
}

/** Exigences d'un dossier d'appel d'offres (formulaire de contrôle d'un CV). */
export function lireExigences(
  s: SaisieExigences,
): Resultat<Record<string, unknown>, keyof SaisieExigences> {
  const erreurs: Partial<Record<keyof SaisieExigences, string>> = {};
  const entier = (v: string, champ: keyof SaisieExigences) => {
    const n = lireNombre(v);
    if (n === null) return undefined;
    if (!Number.isInteger(n) || n < 0 || n > 60) erreurs[champ] = "Entier de 0 à 60.";
    return n;
  };
  const annees = entier(s.annees_min, "annees_min");
  const anneesSecteur = entier(s.annees_secteur, "annees_secteur");
  if (s.secteur.trim() !== "" && anneesSecteur === undefined) {
    erreurs.annees_secteur = "Indiquez les années exigées dans ce secteur.";
  }
  const niveauLangue = s.langue.trim() === "" ? null : lireNiveauLangue(s.niveau_langue);
  if (s.langue.trim() !== "" && !niveauLangue) erreurs.niveau_langue = "Choisissez le niveau.";
  if (s.reference !== "" && !MOIS.test(s.reference)) erreurs.reference = "Mois AAAA-MM attendu.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      ...(annees === undefined ? {} : { annees_min: annees }),
      ...(s.niveau_diplome_min ? { niveau_diplome_min: s.niveau_diplome_min } : {}),
      annees_par_secteur:
        s.secteur.trim() === "" ? [] : [{ secteur: s.secteur.trim(), annees: anneesSecteur }],
      langues: niveauLangue ? [{ langue: s.langue.trim(), niveau_min: niveauLangue }] : [],
      ...(s.reference ? { reference: s.reference } : {}),
    },
  };
}

export interface SaisieReference {
  titre: string;
  client_nom: string;
  pays: string;
  secteurs: string;
  bailleur: string;
  montant: string;
  devise: Devise;
  date_debut: string;
  date_fin: string;
  role_cabinet: string;
  description: string;
}

type ChampReference = keyof SaisieReference;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function lireReference(
  s: SaisieReference,
): Resultat<Record<string, unknown>, ChampReference> {
  const erreurs: Partial<Record<ChampReference, string>> = {};
  if (s.titre.trim() === "") erreurs.titre = "Le titre est obligatoire.";
  if (s.client_nom.trim() === "") erreurs.client_nom = "Le client est obligatoire.";
  if (!/^[A-Za-z]{2}$/.test(s.pays.trim())) erreurs.pays = "Code pays à deux lettres (CI, SN…).";
  const montant = lireMontant(s.montant, s.devise);
  if (montant === null || Number.isNaN(montant)) erreurs.montant = "Montant du marché invalide.";
  if (!DATE.test(s.date_debut)) erreurs.date_debut = "Date de début obligatoire.";
  if (s.date_fin !== "" && !DATE.test(s.date_fin)) erreurs.date_fin = "Date invalide.";
  else if (s.date_fin !== "" && s.date_fin < s.date_debut) {
    erreurs.date_fin = "La fin précède le début.";
  }
  if (!(s.role_cabinet in LIBELLES_ROLE_REFERENCE)) erreurs.role_cabinet = "Choisissez le rôle.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      titre: s.titre.trim(),
      client_nom: s.client_nom.trim(),
      pays: s.pays.trim().toUpperCase(),
      secteurs: decouperListe(s.secteurs),
      bailleur: texteOuNull(s.bailleur),
      montant,
      devise: s.devise,
      date_debut: s.date_debut,
      date_fin: s.date_fin === "" ? null : s.date_fin,
      role_cabinet: s.role_cabinet,
      description: texteOuNull(s.description),
    },
  };
}

export interface FiltresReferences {
  q?: string;
  secteur?: string;
  pays?: string;
  bailleur?: string;
  devise?: string;
  montant_min?: string;
  montant_max?: string;
}

/** Filtres de recherche (paramètres de la page) → requête de l'API ; montants en unités usuelles. */
export function requeteReferences(f: FiltresReferences, curseur: string | null = null): string {
  const q = new URLSearchParams({ limite: "30" });
  for (const cle of ["q", "secteur", "bailleur"] as const) {
    const v = f[cle]?.trim();
    if (v) q.set(cle, v.slice(0, 100));
  }
  if (f.pays && /^[A-Za-z]{2}$/.test(f.pays.trim())) q.set("pays", f.pays.trim().toUpperCase());
  const devise = (["XOF", "XAF", "EUR", "USD"] as const).find((d) => d === f.devise);
  if (devise) {
    q.set("devise", devise);
    for (const cle of ["montant_min", "montant_max"] as const) {
      const m = f[cle] ? lireMontant(f[cle] as string, devise) : null;
      if (m !== null && !Number.isNaN(m)) q.set(cle, String(m));
    }
  }
  if (curseur) q.set("curseur", curseur);
  return `/api/banque-ao/references?${q}`;
}

/** Sections modifiées d'une offre technique ; chacune obligatoire (20 000 caractères au plus). */
export function lireSectionsOffre(
  s: SectionsOffre & { motif: string },
): Resultat<{ sections: SectionsOffre; motif: string }, SectionOffreTechnique | "motif"> {
  const erreurs: Partial<Record<SectionOffreTechnique | "motif", string>> = {};
  const sections = {} as SectionsOffre;
  for (const cle of SECTIONS_OFFRE_TECHNIQUE) {
    const t = s[cle].trim();
    if (t === "") erreurs[cle] = "Cette section est obligatoire.";
    else if (t.length > 20_000) erreurs[cle] = "20 000 caractères au plus.";
    sections[cle] = t;
  }
  const motif = s.motif.trim();
  if (motif === "") erreurs.motif = "Le motif de la modification est obligatoire.";
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : { ok: true, charge: { sections, motif } };
}

/**
 * Lignes d'honoraires, une par ligne : « clé | libellé | jours | taux journalier » ;
 * per diem et débours : « libellé | quantité | prix unitaire ». Montants en unités usuelles.
 */
export function lireLignesOffre(
  v: string,
  devise: Devise,
  type: "honoraires" | "quantites",
): { ok: true; valeur: Record<string, unknown>[] } | { ok: false; erreur: string } {
  const sortie: Record<string, unknown>[] = [];
  for (const [i, l] of lignes(v).entries()) {
    const c = champs(l);
    const [cle, libelle, qte, prix] = type === "honoraires" ? c : ["", ...c];
    const quantite = lireNombre(qte ?? "");
    const montant = lireMontant(prix ?? "", devise);
    if ((type === "honoraires" && !cle) || !libelle) {
      return {
        ok: false,
        erreur: `Ligne ${i + 1} : ${type === "honoraires" ? "clé et libellé" : "libellé"} obligatoires.`,
      };
    }
    if (quantite === null || Number.isNaN(quantite) || quantite < 0) {
      return {
        ok: false,
        erreur: `Ligne ${i + 1} : ${type === "honoraires" ? "jours" : "quantité"} invalide.`,
      };
    }
    if (montant === null || Number.isNaN(montant)) {
      return { ok: false, erreur: `Ligne ${i + 1} : montant invalide.` };
    }
    sortie.push(
      type === "honoraires"
        ? { cle, libelle, jours: quantite, taux_journalier: montant }
        : { libelle, quantite, prix_unitaire: montant },
    );
  }
  return { ok: true, valeur: sortie };
}

export interface SaisieOffreFinanciere {
  titre: string;
  devise: Devise;
  honoraires: string;
  per_diem: string;
  debours: string;
  tva: string;
}

type ChampOffreFinanciere = keyof SaisieOffreFinanciere;

export function lireOffreFinanciere(
  s: SaisieOffreFinanciere,
): Resultat<{ titre: string; entree: Record<string, unknown> }, ChampOffreFinanciere> {
  const erreurs: Partial<Record<ChampOffreFinanciere, string>> = {};
  if (s.titre.trim() === "") erreurs.titre = "Le titre est obligatoire.";
  const hon = lireLignesOffre(s.honoraires, s.devise, "honoraires");
  if (!hon.ok) erreurs.honoraires = hon.erreur;
  const pd = lireLignesOffre(s.per_diem, s.devise, "quantites");
  if (!pd.ok) erreurs.per_diem = pd.erreur;
  const deb = lireLignesOffre(s.debours, s.devise, "quantites");
  if (!deb.ok) erreurs.debours = deb.erreur;
  const tva = lireNombre(s.tva);
  if (tva !== null && (Number.isNaN(tva) || tva < 0 || tva > 100)) erreurs.tva = "Taux de 0 à 100.";
  if (Object.keys(erreurs).length > 0 || !hon.ok || !pd.ok || !deb.ok)
    return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      titre: s.titre.trim(),
      entree: {
        devise: s.devise,
        honoraires: hon.valeur,
        per_diem: pd.valeur,
        debours: deb.valeur,
        taxes:
          tva === null || tva === 0 ? [] : [{ libelle: "TVA", taux: tva, assiette: "total_ht" }],
      },
    },
  };
}

/* ----- Erreurs ----- */

const MESSAGES: Record<string, string> = {
  CV_EXISTANT: "Ce collaborateur a déjà un CV : ajoutez-lui une nouvelle version.",
  GABARIT_EXISTANT: "Un gabarit du cabinet porte déjà ce code.",
  FICHIER_DEJA_RATTACHE: "Ce fichier est déjà rattaché à une pièce.",
  VERSION_CONCURRENTE: "Une autre version vient d'être enregistrée : rechargez la page.",
  VERSION_PERIMEE: "Une version plus récente existe : rechargez la page avant de valider.",
  VERSION_DEJA_VALIDEE: "Cette version est déjà validée.",
  CHIFFRES_A_ACQUITTER:
    "Le brouillon IA cite des nombres non vérifiés : relisez-les puis cochez l'acquittement.",
  TROP_D_EXPORTS_CV: "Trop d'exports de CV récents : réessayez dans quelques minutes.",
  RENDU_PDF_INDISPONIBLE: "Le rendu PDF est indisponible sur ce serveur : exportez en Word.",
  GENERATION_IA_ECHEC: "La rédaction par l'IA a échoué : réessayez ou partez du gabarit.",
};

export function messageBanqueAo(e: unknown): string {
  if (e instanceof ErreurApi && MESSAGES[e.code]) return MESSAGES[e.code] as string;
  return messageErreur(e);
}

/* ----- Chemins ----- */

/** Lien d'une page de liste avec ses filtres et, facultatif, le curseur de la page suivante. */
export function hrefListe(
  chemin: string,
  filtres: URLSearchParams,
  curseur: string | null,
): string {
  const q = new URLSearchParams(filtres);
  q.delete("limite");
  q.delete("curseur");
  if (curseur) q.set("curseur", curseur);
  const s = q.toString();
  return s ? `${chemin}?${s}` : chemin;
}

/** Résultat enregistré → champs du formulaire (nouvelle version de l'offre financière). */
export function saisieDepuisOffreFinanciere(
  titre: string,
  r: ResultatOffreFinanciere,
): SaisieOffreFinanciere {
  const nombre = (n: number) => String(n).replace(".", ",");
  const prix = (m: number) => montantVersSaisie(m, r.devise);
  const tva = r.taxes.find((t) => t.assiette === "total_ht");
  return {
    titre,
    devise: r.devise,
    honoraires: r.honoraires
      .map((l) => [l.cle ?? "", l.libelle, nombre(l.quantite), prix(l.prix_unitaire)].join(" | "))
      .join("\n"),
    per_diem: r.per_diem
      .map((l) => [l.libelle, nombre(l.quantite), prix(l.prix_unitaire)].join(" | "))
      .join("\n"),
    debours: r.debours
      .map((l) => [l.libelle, nombre(l.quantite), prix(l.prix_unitaire)].join(" | "))
      .join("\n"),
    tva: tva ? nombre(tva.taux) : "",
  };
}
