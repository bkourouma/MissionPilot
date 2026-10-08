/**
 * Dossier client vivant (DOS-01 à DOS-07) : logique pure des écrans, testée dans
 * `dossier.test.ts`. Ces fonctions mettent en forme et valident des saisies ; elles ne
 * calculent aucun chiffre métier (contrôles, fiabilité et frise sortent des moteurs de l'API).
 */
import {
  CATEGORIE_FAIT_LIBELLES,
  CATEGORIES_FAIT_DOSSIER,
  FIABILITES_PREUVE,
  TYPE_SOURCE_PREUVE_LIBELLES,
  TYPES_SOURCE_PREUVE,
  type CategorieFaitDossier,
  type FiabilitePreuve,
  type StatutEtatDossier,
  type StatutFaitDossier,
  type TypeSourcePreuve,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import {
  formaterDate,
  formaterMontantMineur,
  formaterNombre,
  VALEUR_ABSENTE,
  type Devise,
} from "./format";
import { lireMontant, lireNombre, texteOuNull, type Resultat } from "./saisie";

// --- Types renvoyés par l'API ------------------------------------------------------------

export type ValeurFait =
  | { type: "texte"; texte: string }
  | { type: "nombre"; nombre: number }
  | { type: "montant"; montant: number; devise: Devise }
  | { type: "date"; date: string }
  | { type: "booleen"; booleen: boolean };

export interface SourceDossier {
  type: TypeSourcePreuve;
  libelle: string;
  document_id: string | null;
  page: number | null;
  reference: string | null;
}

export interface Personne {
  id: string;
  nom: string;
}

export interface Fait {
  id: string;
  categorie: CategorieFaitDossier;
  cle: string;
  valeur: ValeurFait;
  date_effet: string;
  source: SourceDossier;
  fiabilite: FiabilitePreuve;
  origine: "saisie" | "ia";
  commentaire: string | null;
  statut: StatutFaitDossier;
  remplace_id: string | null;
  remplace_par_id: string | null;
  auteur: Personne;
  cree_le: string;
  decision: {
    decision: "confirme" | "rejete";
    motif: string | null;
    par: Personne;
    le: string;
  } | null;
}

export type ValeurFacteur = boolean | number | string | string[];

export interface Facteur {
  id: string;
  code: string;
  type: "booleen" | "nombre" | "enumeration" | "liste";
  valeur: ValeurFacteur;
  date_effet: string;
  source: SourceDossier;
  fiabilite: FiabilitePreuve;
  auteur: Personne;
  cree_le: string;
}

export interface ConstatEtat {
  code: "SOUS_TOTAL" | "TOTAL_SECTION" | "EQUILIBRE_BILAN" | "RESULTAT_COMPTE" | "RESULTAT_BILAN";
  statut: "ok" | "ecart" | "non_verifiable";
  cible: string | null;
  attendu: number | null;
  constate: number | null;
  ecart: number | null;
  lignes: string[];
  message: string;
}

export interface TotauxEtat {
  actif: number | null;
  passif: number | null;
  charges: number | null;
  produits: number | null;
  resultat: number | null;
}

export interface EtatFinancier {
  id: string;
  exercice: number;
  date_cloture: string;
  devise: Devise;
  origine: "saisie" | "csv" | "excel";
  source_libelle: string | null;
  fichier: { nom: string | null; sha256: string; taille: number } | null;
  tolerance: number;
  statut: StatutEtatDossier;
  controles_ok: boolean;
  conforme: boolean;
  complet: boolean;
  ecarts: number;
  non_verifiables: number;
  constats?: ConstatEtat[];
  totaux: TotauxEtat;
  remplace_id: string | null;
  remplace_par_id: string | null;
  importe_par: Personne;
  cree_le: string;
  decision: {
    decision: "accepte" | "rejete";
    automatique: boolean;
    motif: string | null;
    par: Personne | null;
    le: string;
  } | null;
}

export interface LigneEtat {
  rang: number;
  code: string;
  libelle: string;
  section: "actif" | "passif" | "charges" | "produits" | "resultat";
  montant: number;
  parent: string | null;
  role: "total" | "resultat_exercice" | "resultat_net" | null;
  reference: {
    fichier?: string | null;
    feuille?: string | null;
    cellule?: string | null;
    ligne?: number | null;
    page?: number | null;
  };
}

export interface EtatDetaille extends EtatFinancier {
  constats: ConstatEtat[];
  lignes: LigneEtat[];
}

export interface Fiabilite {
  points: number;
  classe: "A" | "B" | "C" | "D";
  detail: {
    certification: number;
    informel: number;
    coherence: number;
    anciennete: number;
    sources: number;
  };
  analyses_indicatives: boolean;
  mois_depuis_derniere_cloture: number | null;
  recommandations: { code: string; message: string }[];
}

export interface EvenementFrise {
  type: "notation" | "mission" | "decision" | "alerte" | "fait";
  id: string;
  date: string;
  libelle: string;
  mission_id: string | null;
}

export interface ClientDossier {
  id: string;
  raison_sociale: string;
  forme_juridique: string | null;
  rccm: string | null;
  secteur: string | null;
  pays: string;
  taille: string | null;
  actif: boolean;
}

export interface VueDossier {
  client: ClientDossier;
  date_reference: string;
  profil: Fait[];
  propositions: Fait[];
  facteurs: Facteur[];
  etats_financiers: EtatFinancier[];
  fiabilite: Fiabilite;
}

export interface DossierResume {
  id: string;
  raison_sociale: string;
  secteur: string | null;
  pays: string;
  actif: boolean;
  dernier_fait_le: string | null;
  propositions: number;
  etats_en_revue: number;
}

// --- Libellés et tonalités ---------------------------------------------------------------

export const STATUT_FAIT: Record<StatutFaitDossier, { libelle: string; tonalite: TonaliteStatut }> =
  {
    propose: { libelle: "À confirmer", tonalite: "attention" },
    confirme: { libelle: "Confirmé", tonalite: "succes" },
    rejete: { libelle: "Rejeté", tonalite: "danger" },
    remplace: { libelle: "Remplacé", tonalite: "neutre" },
  };

export const STATUT_ETAT: Record<StatutEtatDossier, { libelle: string; tonalite: TonaliteStatut }> =
  {
    en_revue: { libelle: "En revue", tonalite: "attention" },
    accepte: { libelle: "Accepté", tonalite: "succes" },
    rejete: { libelle: "Rejeté", tonalite: "danger" },
    remplace: { libelle: "Remplacé", tonalite: "neutre" },
  };

export const CLASSE_FIABILITE: Record<
  Fiabilite["classe"],
  { libelle: string; tonalite: TonaliteStatut }
> = {
  A: { libelle: "A — Données fiables", tonalite: "succes" },
  B: { libelle: "B — Données correctes", tonalite: "succes" },
  C: { libelle: "C — Données fragiles", tonalite: "attention" },
  D: { libelle: "D — Données insuffisantes", tonalite: "danger" },
};

export const COMPOSANTES_FIABILITE: {
  cle: keyof Fiabilite["detail"];
  libelle: string;
  max: number;
}[] = [
  { cle: "certification", libelle: "Certification des comptes", max: 35 },
  { cle: "informel", libelle: "Part de l'informel", max: 25 },
  { cle: "coherence", libelle: "Cohérence des états financiers", max: 20 },
  { cle: "anciennete", libelle: "Ancienneté du dernier exercice", max: 10 },
  { cle: "sources", libelle: "Qualité des sources", max: 10 },
];

export const CONTROLE_LIBELLES: Record<ConstatEtat["code"], string> = {
  SOUS_TOTAL: "Sous-total",
  TOTAL_SECTION: "Total de section",
  EQUILIBRE_BILAN: "Équilibre du bilan",
  RESULTAT_COMPTE: "Résultat du compte de résultat",
  RESULTAT_BILAN: "Résultat au bilan",
};

export const TYPE_EVENEMENT_LIBELLES: Record<EvenementFrise["type"], string> = {
  notation: "Notation",
  mission: "Mission",
  decision: "Décision",
  alerte: "Alerte",
  fait: "Fait",
};

export const ORIGINE_ETAT_LIBELLES: Record<EtatFinancier["origine"], string> = {
  saisie: "Saisie",
  csv: "Fichier CSV",
  excel: "Classeur Excel",
};

export const OPTIONS_CATEGORIES = CATEGORIES_FAIT_DOSSIER.map((c) => ({
  valeur: c,
  libelle: CATEGORIE_FAIT_LIBELLES[c],
}));
export const OPTIONS_SOURCES = TYPES_SOURCE_PREUVE.map((t) => ({
  valeur: t,
  libelle: TYPE_SOURCE_PREUVE_LIBELLES[t],
}));
export const OPTIONS_FIABILITE = FIABILITES_PREUVE.map((f) => ({
  valeur: f,
  libelle: { A: "A — très fiable", B: "B — fiable", C: "C — à recouper", D: "D — peu fiable" }[f],
}));

// --- Mise en forme -------------------------------------------------------------------------

/** Valeur d'un fait, lisible : montant formaté, date JJ/MM/AAAA, Oui/Non. */
export function formaterValeurFait(v: ValeurFait | null | undefined): string {
  if (!v) return VALEUR_ABSENTE;
  switch (v.type) {
    case "texte":
      return v.texte;
    case "nombre":
      return formaterNombre(v.nombre, 4);
    case "montant":
      return formaterMontantMineur(v.montant, v.devise);
    case "date":
      return formaterDate(v.date);
    default:
      return v.booleen ? "Oui" : "Non";
  }
}

/** Valeur d'un facteur de contexte, lisible. */
export function formaterValeurFacteur(v: ValeurFacteur | null | undefined): string {
  if (v === null || v === undefined) return VALEUR_ABSENTE;
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (typeof v === "number") return formaterNombre(v, 4);
  if (Array.isArray(v)) return v.length === 0 ? VALEUR_ABSENTE : v.join(", ");
  return v;
}

/** Source d'un fait : « Entretien — Entretien avec le DAF (p. 4) ». */
export function formaterSource(s: SourceDossier): string {
  const precision = [s.page ? `p. ${s.page}` : null, s.reference].filter(Boolean).join(", ");
  return `${TYPE_SOURCE_PREUVE_LIBELLES[s.type] ?? s.type} — ${s.libelle}${precision ? ` (${precision})` : ""}`;
}

/** Référence d'une valeur d'état financier : « liasse.xlsx, cellule D12 », « ligne 7 », « p. 3 ». */
export function formaterReference(r: LigneEtat["reference"] | null | undefined): string {
  if (!r) return VALEUR_ABSENTE;
  const morceaux = [
    r.fichier ?? null,
    r.feuille ? `feuille ${r.feuille}` : null,
    r.cellule ? `cellule ${r.cellule}` : r.ligne ? `ligne ${r.ligne}` : null,
    r.page ? `p. ${r.page}` : null,
  ].filter(Boolean);
  return morceaux.length === 0 ? VALEUR_ABSENTE : morceaux.join(", ");
}

/** Constat de contrôle, lisible : « Équilibre du bilan : écart de −10 FCFA (attendu 1 000, constaté 990) ». */
export function formaterConstat(c: ConstatEtat, devise: Devise): string {
  const nom = `${CONTROLE_LIBELLES[c.code] ?? c.code}${c.cible ? ` (${c.cible})` : ""}`;
  if (c.statut === "non_verifiable") return `${nom} : non vérifiable. ${c.message}`;
  if (c.statut === "ok") return `${nom} : conforme.`;
  return (
    `${nom} : écart de ${formaterMontantMineur(c.ecart, devise)} ` +
    `(attendu ${formaterMontantMineur(c.attendu, devise)}, constaté ${formaterMontantMineur(c.constate, devise)}).`
  );
}

/** Groupe des faits par catégorie, dans l'ordre des catégories ; catégories vides omises. */
export function grouperParCategorie<T extends { categorie: CategorieFaitDossier }>(
  faits: readonly T[],
): { categorie: CategorieFaitDossier; libelle: string; faits: T[] }[] {
  return CATEGORIES_FAIT_DOSSIER.map((c) => ({
    categorie: c,
    libelle: CATEGORIE_FAIT_LIBELLES[c],
    faits: faits.filter((f) => f.categorie === c),
  })).filter((g) => g.faits.length > 0);
}

/** États COURANTS (ni remplacés ni rejetés), un par exercice, du plus récent au plus ancien. */
export function etatsCourants(etats: readonly EtatFinancier[]): EtatFinancier[] {
  return etats
    .filter((e) => e.statut === "accepte" || e.statut === "en_revue")
    .sort((a, b) => b.exercice - a.exercice);
}

/** Année d'un événement de frise (date civile ou horodatage ISO). */
export function anneeEvenement(date: string): string {
  return date.slice(0, 4);
}

/** Frise groupée par année, dans l'ordre reçu (déjà trié par l'API). */
export function grouperFriseParAnnee(
  evenements: readonly EvenementFrise[],
): { annee: string; evenements: EvenementFrise[] }[] {
  const groupes: { annee: string; evenements: EvenementFrise[] }[] = [];
  for (const e of evenements) {
    const annee = anneeEvenement(e.date);
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.annee === annee) dernier.evenements.push(e);
    else groupes.push({ annee, evenements: [e] });
  }
  return groupes;
}

// --- Liste ---------------------------------------------------------------------------------

export interface ParametresListeDossiers {
  q: string;
  curseur?: string;
}

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function lireParametresDossiers(
  p: Record<string, string | string[] | undefined>,
): ParametresListeDossiers {
  const q = (un(p.q) ?? "").trim().slice(0, 100);
  const c = un(p.curseur);
  const curseur = c && c.length <= 500 && /^[A-Za-z0-9_-]+$/.test(c) ? c : undefined;
  return { q, curseur };
}

export function requeteDossiers(p: ParametresListeDossiers): string {
  const r = new URLSearchParams();
  if (p.q) r.set("q", p.q);
  if (p.curseur) r.set("curseur", p.curseur);
  return r.toString();
}

export function hrefDossiers(p: ParametresListeDossiers): string {
  const r = requeteDossiers(p);
  return r ? `/dossiers?${r}` : "/dossiers";
}

// --- Chemins -------------------------------------------------------------------------------

const enc = encodeURIComponent;
export const cheminApiDossier = (id: string) => `/api/dossiers/${enc(id)}`;
export const cheminExport = (id: string, format: "json" | "zip") =>
  `${cheminApiDossier(id)}/export?format=${format}`;

/** Onglets d'un dossier. */
export function ongletsDossier(id: string) {
  const base = `/dossiers/${enc(id)}`;
  return [
    { id: "ensemble", libelle: "Vue d'ensemble", href: base },
    { id: "faits", libelle: "Faits", href: `${base}/faits` },
    { id: "finances", libelle: "Finances", href: `${base}/finances` },
    { id: "frise", libelle: "Frise", href: `${base}/frise` },
  ];
}

// --- Saisie d'un fait ----------------------------------------------------------------------

export type TypeValeurFait = ValeurFait["type"];

export const OPTIONS_TYPES_VALEUR: { valeur: TypeValeurFait; libelle: string }[] = [
  { valeur: "texte", libelle: "Texte" },
  { valeur: "nombre", libelle: "Nombre" },
  { valeur: "montant", libelle: "Montant" },
  { valeur: "date", libelle: "Date" },
  { valeur: "booleen", libelle: "Oui / non" },
];

export interface SaisieFait {
  categorie: CategorieFaitDossier;
  cle: string;
  type_valeur: TypeValeurFait;
  valeur: string;
  devise: Devise;
  date_effet: string;
  source_type: TypeSourcePreuve;
  source_libelle: string;
  source_page: string;
  fiabilite: FiabilitePreuve;
  confirmer: boolean;
  commentaire: string;
  remplace_id: string | null;
}

export type ChampFait = "cle" | "valeur" | "date_effet" | "source_libelle" | "source_page";

export const SAISIE_FAIT_VIDE: SaisieFait = {
  categorie: "profil",
  cle: "",
  type_valeur: "texte",
  valeur: "",
  devise: "XOF",
  date_effet: "",
  source_type: "entretien",
  source_libelle: "",
  source_page: "",
  fiabilite: "B",
  confirmer: false,
  commentaire: "",
  remplace_id: null,
};

/** Saisie pré-remplie pour remplacer un fait (même catégorie et clé, nouvelle valeur à saisir). */
export function saisieRemplacement(f: Fait): SaisieFait {
  return {
    ...SAISIE_FAIT_VIDE,
    categorie: f.categorie,
    cle: f.cle,
    type_valeur: f.valeur.type,
    devise: f.valeur.type === "montant" ? f.valeur.devise : "XOF",
    remplace_id: f.id,
  };
}

const CLE = /^[a-z0-9_.-]{1,120}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Clé saisie librement (« Effectif total ») → code de référentiel (« effectif_total »). */
export function versCle(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function lireValeurFait(s: SaisieFait): ValeurFait | string {
  const t = s.valeur.trim();
  switch (s.type_valeur) {
    case "texte":
      return t === ""
        ? "Saisissez la valeur."
        : t.length > 2000
          ? "2 000 caractères au plus."
          : { type: "texte", texte: t };
    case "nombre": {
      const n = lireNombre(t);
      return n === null || Number.isNaN(n)
        ? "Nombre attendu (ex. 42 ou 12,5)."
        : { type: "nombre", nombre: n };
    }
    case "montant": {
      const m = lireMontant(t, s.devise);
      return m === null || Number.isNaN(m)
        ? "Montant positif attendu, à la précision de la devise."
        : { type: "montant", montant: m, devise: s.devise };
    }
    case "date":
      return DATE.test(t) ? { type: "date", date: t } : "Date attendue.";
    default:
      return t === "oui" || t === "non"
        ? { type: "booleen", booleen: t === "oui" }
        : "Choisissez oui ou non.";
  }
}

/** Valide la saisie d'un fait → corps de `POST /api/dossiers/:id/faits`. */
export function validerFait(s: SaisieFait): Resultat<Record<string, unknown>, ChampFait> {
  const erreurs: Partial<Record<ChampFait, string>> = {};
  const cle = versCle(s.cle);
  if (!CLE.test(cle)) erreurs.cle = "Clé attendue (lettres, chiffres, « _ »), ex. effectif_total.";
  const valeur = lireValeurFait(s);
  if (typeof valeur === "string") erreurs.valeur = valeur;
  if (!DATE.test(s.date_effet)) erreurs.date_effet = "Date d'effet attendue.";
  const libelle = texteOuNull(s.source_libelle);
  if (!libelle) erreurs.source_libelle = "Précisez la source (document, entretien…).";
  else if (libelle.length > 300) erreurs.source_libelle = "300 caractères au plus.";
  const page = texteOuNull(s.source_page);
  const numero = page === null ? null : Number(page);
  if (
    page !== null &&
    (s.source_type !== "document" || !Number.isInteger(numero) || (numero as number) < 1)
  ) {
    erreurs.source_page = "Numéro de page (document seulement).";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const commentaire = texteOuNull(s.commentaire);
  return {
    ok: true,
    charge: {
      categorie: s.categorie,
      cle,
      valeur,
      date_effet: s.date_effet,
      source: { type: s.source_type, libelle, ...(numero !== null ? { page: numero } : {}) },
      fiabilite: s.fiabilite,
      statut: s.confirmer ? "confirme" : "propose",
      ...(commentaire ? { commentaire } : {}),
      ...(s.remplace_id ? { remplace_id: s.remplace_id } : {}),
    },
  };
}

// --- Saisie d'un facteur ------------------------------------------------------------------

export interface SaisieFacteur {
  code: string;
  type: Facteur["type"];
  valeur: string;
  date_effet: string;
  source_type: TypeSourcePreuve;
  source_libelle: string;
  fiabilite: FiabilitePreuve;
}

export type ChampFacteur = "code" | "valeur" | "date_effet" | "source_libelle";

/** Facteurs de convention lus par l'indice de fiabilité (valeurs imposées). */
export const FACTEURS_CONVENTION: {
  code: string;
  libelle: string;
  valeurs: { valeur: string; libelle: string }[];
}[] = [
  {
    code: "fiabilite_comptes",
    libelle: "Fiabilité des comptes",
    valeurs: [
      { valeur: "certifies", libelle: "Certifiés" },
      { valeur: "non_certifies", libelle: "Non certifiés" },
      { valeur: "reconstitues", libelle: "Reconstitués" },
    ],
  },
  {
    code: "part_informel",
    libelle: "Part de l'informel et des espèces",
    valeurs: [
      { valeur: "faible", libelle: "Faible" },
      { valeur: "moyenne", libelle: "Moyenne" },
      { valeur: "forte", libelle: "Forte" },
    ],
  },
];

type LectureFacteur = { ok: true; valeur: ValeurFacteur } | { ok: false; message: string };

function lireValeurFacteur(s: SaisieFacteur): LectureFacteur {
  const t = s.valeur.trim();
  const ko = (message: string): LectureFacteur => ({ ok: false, message });
  if (s.type === "booleen") {
    return t === "oui" || t === "non"
      ? { ok: true, valeur: t === "oui" }
      : ko("Choisissez oui ou non.");
  }
  if (s.type === "nombre") {
    const n = lireNombre(t);
    return n === null || Number.isNaN(n) ? ko("Nombre attendu.") : { ok: true, valeur: n };
  }
  if (s.type === "enumeration") {
    return CLE.test(t)
      ? { ok: true, valeur: t }
      : ko("Code attendu (minuscules, chiffres, « _ »).");
  }
  const liste = [
    ...new Set(
      t
        .split(/[,;\n]/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
  return liste.length > 0 && liste.every((x) => CLE.test(x))
    ? { ok: true, valeur: liste }
    : ko("Liste de codes séparés par des virgules.");
}

/** Valide la saisie d'un facteur → corps de `POST /api/dossiers/:id/facteurs`. */
export function validerFacteur(s: SaisieFacteur): Resultat<Record<string, unknown>, ChampFacteur> {
  const erreurs: Partial<Record<ChampFacteur, string>> = {};
  const code = versCle(s.code);
  if (!CLE.test(code)) erreurs.code = "Code du facteur attendu, ex. secteur_filiere.";
  const convention = FACTEURS_CONVENTION.find((f) => f.code === code);
  const lecture = lireValeurFacteur(convention ? { ...s, type: "enumeration" } : s);
  if (convention && !(lecture.ok && convention.valeurs.some((v) => v.valeur === lecture.valeur))) {
    erreurs.valeur = `Choisissez : ${convention.valeurs.map((v) => v.libelle).join(", ")}.`;
  } else if (!lecture.ok) {
    erreurs.valeur = lecture.message;
  }
  if (!DATE.test(s.date_effet)) erreurs.date_effet = "Date d'effet attendue.";
  const libelle = texteOuNull(s.source_libelle);
  if (!libelle) erreurs.source_libelle = "Précisez la source.";
  if (Object.keys(erreurs).length > 0 || !lecture.ok) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      code,
      type: convention ? "enumeration" : s.type,
      valeur: lecture.valeur,
      date_effet: s.date_effet,
      source: { type: s.source_type, libelle },
      fiabilite: s.fiabilite,
    },
  };
}

// --- Revue d'un état financier -------------------------------------------------------------

export type ChampDecision = "motif";

/** Décision sur un état en revue : motif obligatoire pour rejeter, ou accepter malgré des écarts. */
export function validerDecisionEtat(
  decision: "accepte" | "rejete",
  motif: string,
  controlesOk: boolean,
): Resultat<{ decision: "accepte" | "rejete"; motif?: string }, ChampDecision> {
  const m = texteOuNull(motif);
  if (!m && (decision === "rejete" || !controlesOk)) {
    return {
      ok: false,
      erreurs: {
        motif:
          decision === "rejete"
            ? "Motif obligatoire pour rejeter l'état."
            : "Motif obligatoire pour accepter un état dont des contrôles échouent.",
      },
    };
  }
  if (m && m.length > 2000) return { ok: false, erreurs: { motif: "2 000 caractères au plus." } };
  return { ok: true, charge: m ? { decision, motif: m } : { decision } };
}

/** Décision sur un fait proposé : motif obligatoire pour rejeter. */
export function validerDecisionFait(
  decision: "confirme" | "rejete",
  motif: string,
): Resultat<{ decision: "confirme" | "rejete"; motif?: string }, ChampDecision> {
  const m = texteOuNull(motif);
  if (decision === "rejete" && !m)
    return { ok: false, erreurs: { motif: "Motif obligatoire pour rejeter." } };
  return { ok: true, charge: m ? { decision, motif: m } : { decision } };
}

// --- Import d'un état financier ------------------------------------------------------------

export interface SaisieImportEtat {
  exercice: string;
  date_cloture: string;
  devise: Devise;
  tolerance: string;
}

export type ChampImportEtat = "exercice" | "date_cloture" | "tolerance" | "fichier";

export const TAILLE_EXCEL_MAX = 2 * 1024 * 1024;
export const TAILLE_CSV_MAX = 200_000;

export const AIDE_IMPORT_ETAT =
  "Colonnes : section (actif, passif, charges, produits, resultat), code, libellé, montant, et " +
  "facultatives parent et rôle (total, résultat de l'exercice, résultat net). Classeur .xlsx " +
  "(2 Mo au plus, première feuille visible) ou CSV UTF-8 (séparateur « ; » ou « , »).";

export function formatFichierEtat(nom: string): "excel" | "csv" | null {
  const n = nom.toLowerCase();
  if (n.endsWith(".xlsx")) return "excel";
  if (n.endsWith(".csv")) return "csv";
  return null;
}

/** Valide l'en-tête et le fichier d'un import (le contenu est contrôlé par l'API et ses moteurs). */
export function validerImportEtat(
  s: SaisieImportEtat,
  fichier: { name: string; size: number } | null,
): Resultat<
  {
    exercice: number;
    date_cloture: string;
    devise: Devise;
    tolerance: number;
    format: "excel" | "csv";
  },
  ChampImportEtat
> {
  const erreurs: Partial<Record<ChampImportEtat, string>> = {};
  const exercice = Number(s.exercice);
  if (!/^\d{4}$/.test(s.exercice.trim()) || exercice < 1990 || exercice > 2100) {
    erreurs.exercice = "Exercice sur quatre chiffres (ex. 2025).";
  }
  if (!DATE.test(s.date_cloture)) erreurs.date_cloture = "Date de clôture attendue.";
  const tolerance = s.tolerance.trim() === "" ? 0 : Number(s.tolerance.trim());
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 1_000_000) {
    erreurs.tolerance = "Entier entre 0 et 1 000 000 (unités mineures).";
  }
  const format = fichier ? formatFichierEtat(fichier.name) : null;
  if (!fichier) erreurs.fichier = "Choisissez un classeur .xlsx ou un fichier .csv.";
  else if (!format) erreurs.fichier = "Format accepté : .xlsx ou .csv.";
  else if (fichier.size <= 0) erreurs.fichier = "Ce fichier est vide.";
  else if (fichier.size > (format === "excel" ? TAILLE_EXCEL_MAX : TAILLE_CSV_MAX)) {
    erreurs.fichier =
      format === "excel"
        ? "Classeur trop volumineux (2 Mo au plus)."
        : "CSV trop volumineux (200 000 caractères au plus).";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      exercice,
      date_cloture: s.date_cloture,
      devise: s.devise,
      tolerance,
      format: format as "excel" | "csv",
    },
  };
}

/** Chemin d'import Excel : métadonnées en requête (le corps multipart ne porte que le fichier). */
export function cheminImportExcel(
  id: string,
  e: { exercice: number; date_cloture: string; devise: Devise; tolerance: number },
): string {
  const q = new URLSearchParams({
    exercice: String(e.exercice),
    date_cloture: e.date_cloture,
    devise: e.devise,
    tolerance: String(e.tolerance),
  });
  return `${cheminApiDossier(id)}/etats-financiers/excel?${q.toString()}`;
}

/** Lignes en erreur d'un import refusé (`IMPORT_INVALIDE`, détails de l'erreur), sinon []. */
export function erreursImport(details: unknown): { ligne: number; message: string }[] {
  if (typeof details !== "object" || details === null) return [];
  const erreurs = (details as { erreurs?: unknown }).erreurs;
  if (!Array.isArray(erreurs)) return [];
  return erreurs
    .filter(
      (e): e is { ligne: number; message: string } =>
        typeof e === "object" &&
        e !== null &&
        typeof e.ligne === "number" &&
        typeof e.message === "string",
    )
    .slice(0, 50);
}
