/**
 * Dossier client vivant (DOS-01 à DOS-07) : logique pure des écrans, testée dans
 * `dossier.test.ts`. Ces fonctions mettent en forme et valident des saisies ; elles ne
 * calculent aucun chiffre métier (contrôles, fiabilité et frise sortent des moteurs de l'API).
 */
import {
  CATEGORIE_FAIT_LIBELLES,
  CATEGORIES_FAIT_DOSSIER,
  SECTION_ETAT_LIBELLES,
  type SectionEtatDossier,
  FIABILITES_PREUVE,
  TYPE_SOURCE_PREUVE_LIBELLES,
  creerTraduire,
  TYPES_SOURCE_PREUVE,
  type CategorieFaitDossier,
  type CorrectionOcr,
  type FiabilitePreuve,
  type Langue,
  type MethodeExtraction,
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
import { libellePosteEtat } from "./codes-lisibles";
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
  origine: "saisie" | "csv" | "excel" | "pdf";
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
    /** Valeur lue par reconnaissance de caractères (OCR) : à vérifier dans le document d'origine. */
    ocr?: boolean | null;
    /** Confiance de la lecture de la page, de 0 à 1000 (millièmes). */
    confiance_pm?: number | null;
  };
}

/** Document d'ingestion dont l'état est issu (null pour un état saisi ou importé sans ingestion). */
export interface IngestionEtat {
  document_id: string;
  methode: MethodeExtraction | null;
  corrections_ocr: CorrectionOcr[] | null;
}

export interface EtatDetaille extends EtatFinancier {
  constats: ConstatEtat[];
  lignes: LigneEtat[];
  ingestion?: IngestionEtat | null;
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

export const STATUT_FAIT_EN: Record<
  StatutFaitDossier,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  propose: { libelle: "To confirm", tonalite: "attention" },
  confirme: { libelle: "Confirmed", tonalite: "succes" },
  rejete: { libelle: "Rejected", tonalite: "danger" },
  remplace: { libelle: "Replaced", tonalite: "neutre" },
};

export const STATUT_ETAT_EN: Record<
  StatutEtatDossier,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  en_revue: { libelle: "Under review", tonalite: "attention" },
  accepte: { libelle: "Accepted", tonalite: "succes" },
  rejete: { libelle: "Rejected", tonalite: "danger" },
  remplace: { libelle: "Replaced", tonalite: "neutre" },
};

export function statutFait(s: StatutFaitDossier, langue: Langue = "fr") {
  return (langue === "en" ? STATUT_FAIT_EN : STATUT_FAIT)[s];
}
export function statutEtat(s: StatutEtatDossier, langue: Langue = "fr") {
  return (langue === "en" ? STATUT_ETAT_EN : STATUT_ETAT)[s];
}

export const CLASSE_FIABILITE: Record<
  Fiabilite["classe"],
  { libelle: string; tonalite: TonaliteStatut }
> = {
  A: { libelle: "A — Données fiables", tonalite: "succes" },
  B: { libelle: "B — Données correctes", tonalite: "succes" },
  C: { libelle: "C — Données fragiles", tonalite: "attention" },
  D: { libelle: "D — Données insuffisantes", tonalite: "danger" },
};

export const CLASSE_FIABILITE_EN: Record<
  Fiabilite["classe"],
  { libelle: string; tonalite: TonaliteStatut }
> = {
  A: { libelle: "A — Reliable data", tonalite: "succes" },
  B: { libelle: "B — Sound data", tonalite: "succes" },
  C: { libelle: "C — Fragile data", tonalite: "attention" },
  D: { libelle: "D — Insufficient data", tonalite: "danger" },
};

export function classeFiabilite(c: Fiabilite["classe"], langue: Langue = "fr") {
  return (langue === "en" ? CLASSE_FIABILITE_EN : CLASSE_FIABILITE)[c];
}

export function composantesFiabilite(langue: Langue = "fr") {
  const t = creerTraduire(langue);
  return [
    {
      cle: "certification",
      libelle: t("Certification des comptes", "Accounts certification"),
      max: 35,
    },
    { cle: "informel", libelle: t("Part de l'informel", "Share of informal activity"), max: 25 },
    {
      cle: "coherence",
      libelle: t("Cohérence des états financiers", "Consistency of financial statements"),
      max: 20,
    },
    {
      cle: "anciennete",
      libelle: t("Ancienneté du dernier exercice", "Age of the latest fiscal year"),
      max: 10,
    },
    { cle: "sources", libelle: t("Qualité des sources", "Source quality"), max: 10 },
  ] as { cle: keyof Fiabilite["detail"]; libelle: string; max: number }[];
}

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
  pdf: "PDF",
};

export function libelleControle(code: ConstatEtat["code"], langue: Langue = "fr"): string {
  const en: Record<ConstatEtat["code"], string> = {
    SOUS_TOTAL: "Subtotal",
    TOTAL_SECTION: "Section total",
    EQUILIBRE_BILAN: "Balance sheet balance",
    RESULTAT_COMPTE: "Income statement result",
    RESULTAT_BILAN: "Balance sheet result",
  };
  return (langue === "en" ? en : CONTROLE_LIBELLES)[code] ?? code;
}

export function libelleTypeEvenement(type: EvenementFrise["type"], langue: Langue = "fr"): string {
  const en: Record<EvenementFrise["type"], string> = {
    notation: "Rating",
    mission: "Engagement",
    decision: "Decision",
    alerte: "Alert",
    fait: "Fact",
  };
  return (langue === "en" ? en : TYPE_EVENEMENT_LIBELLES)[type];
}

export function libelleOrigineEtat(
  origine: EtatFinancier["origine"],
  langue: Langue = "fr",
): string {
  const en: Record<EtatFinancier["origine"], string> = {
    saisie: "Manual entry",
    csv: "CSV file",
    excel: "Excel workbook",
    pdf: "PDF",
  };
  return (langue === "en" ? en : ORIGINE_ETAT_LIBELLES)[origine];
}

const CATEGORIE_FAIT_LIBELLES_EN: Record<CategorieFaitDossier, string> = {
  profil: "Profile",
  organisation: "Organization",
  processus: "Processes",
  produits_marches: "Products and markets",
  finances: "Finance",
  risques: "Risks",
  parties_prenantes: "Stakeholders",
};
export function libelleCategorieFait(c: CategorieFaitDossier, langue: Langue = "fr"): string {
  return (langue === "en" ? CATEGORIE_FAIT_LIBELLES_EN : CATEGORIE_FAIT_LIBELLES)[c];
}

const TYPE_SOURCE_LIBELLES_EN: Record<TypeSourcePreuve, string> = {
  questionnaire: "Questionnaire",
  entretien: "Interview",
  observation: "Field observation",
  document: "Document",
  donnee_externe: "External data",
};
export function libelleTypeSource(t: TypeSourcePreuve, langue: Langue = "fr"): string {
  return (langue === "en" ? TYPE_SOURCE_LIBELLES_EN : TYPE_SOURCE_PREUVE_LIBELLES)[t];
}

const SECTION_ETAT_LIBELLES_EN: Record<SectionEtatDossier, string> = {
  actif: "Assets",
  passif: "Liabilities",
  charges: "Expenses",
  produits: "Income",
  resultat: "Declared net result",
};
export function libelleSectionEtat(s: SectionEtatDossier, langue: Langue = "fr"): string {
  return (langue === "en" ? SECTION_ETAT_LIBELLES_EN : SECTION_ETAT_LIBELLES)[s];
}

export const optionsCategories = (langue: Langue = "fr") =>
  CATEGORIES_FAIT_DOSSIER.map((c) => ({ valeur: c, libelle: libelleCategorieFait(c, langue) }));
export const optionsSources = (langue: Langue = "fr") =>
  TYPES_SOURCE_PREUVE.map((t) => ({ valeur: t, libelle: libelleTypeSource(t, langue) }));
export const optionsFiabilite = (langue: Langue = "fr") =>
  FIABILITES_PREUVE.map((f) => ({
    valeur: f,
    libelle: (langue === "en"
      ? { A: "A — very reliable", B: "B — reliable", C: "C — to cross-check", D: "D — unreliable" }
      : { A: "A — très fiable", B: "B — fiable", C: "C — à recouper", D: "D — peu fiable" })[f],
  }));

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
export function formaterValeurFait(
  v: ValeurFait | null | undefined,
  langue: Langue = "fr",
): string {
  if (!v) return VALEUR_ABSENTE;
  switch (v.type) {
    case "texte":
      return v.texte;
    case "nombre":
      return formaterNombre(v.nombre, 4, langue);
    case "montant":
      return formaterMontantMineur(v.montant, v.devise, langue);
    case "date":
      return formaterDate(v.date, "UTC", langue);
    default:
      return v.booleen ? creerTraduire(langue)("Oui", "Yes") : creerTraduire(langue)("Non", "No");
  }
}

/** Valeur d'un facteur de contexte, lisible. */
export function formaterValeurFacteur(
  v: ValeurFacteur | null | undefined,
  langue: Langue = "fr",
): string {
  if (v === null || v === undefined) return VALEUR_ABSENTE;
  if (typeof v === "boolean")
    return v ? creerTraduire(langue)("Oui", "Yes") : creerTraduire(langue)("Non", "No");
  if (typeof v === "number") return formaterNombre(v, 4, langue);
  if (Array.isArray(v)) return v.length === 0 ? VALEUR_ABSENTE : v.join(", ");
  return v;
}

/** Source d'un fait : « Entretien — Entretien avec le DAF (p. 4) ». */
export function formaterSource(s: SourceDossier, langue: Langue = "fr"): string {
  const precision = [s.page ? `p. ${s.page}` : null, s.reference].filter(Boolean).join(", ");
  return `${libelleTypeSource(s.type, langue) ?? s.type} — ${s.libelle}${precision ? ` (${precision})` : ""}`;
}

/** Référence d'une valeur d'état financier : « liasse.xlsx, cellule D12 », « ligne 7 », « p. 3 ». */
export function formaterReference(
  r: LigneEtat["reference"] | null | undefined,
  langue: Langue = "fr",
): string {
  if (!r) return VALEUR_ABSENTE;
  const t = creerTraduire(langue);
  const court = t(MARQUEUR_OCR_COURT, "read by OCR");
  const morceaux = [
    r.fichier ?? null,
    r.feuille ? `${t("feuille", "sheet")} ${r.feuille}` : null,
    r.cellule
      ? `${t("cellule", "cell")} ${r.cellule}`
      : r.ligne
        ? `${t("ligne", "line")} ${r.ligne}`
        : null,
    r.page ? `p. ${r.page}` : null,
  ].filter(Boolean);
  if (morceaux.length === 0) return r.ocr ? court : VALEUR_ABSENTE;
  const base = morceaux.join(", ");
  return r.ocr ? `${base} · ${court}` : base;
}

export const MARQUEUR_OCR_COURT = "lu par OCR";
export const MARQUEUR_OCR_A_VERIFIER = "lu par OCR : à vérifier";
export const AVERTISSEMENT_OCR =
  "Cet état a été lu par reconnaissance de caractères (OCR) : chaque chiffre doit être vérifié dans le document d'origine avant toute décision. Il n'est jamais accepté automatiquement.";

export const MARQUEUR_OCR_A_VERIFIER_EN = "read by OCR: to be checked";
export const AVERTISSEMENT_OCR_EN =
  "This statement was read by optical character recognition (OCR): every figure must be checked against the original document before any decision. It is never accepted automatically.";

/** La ligne porte une valeur lue par reconnaissance de caractères. */
export function ligneLueParOcr(l: Pick<LigneEtat, "reference"> | null | undefined): boolean {
  return l?.reference?.ocr === true;
}

/** L'état, ou l'une de ses lignes, a été lu par OCR (réelle ou simulée) : revue humaine obligatoire. */
export function etatLuParOcr(
  e:
    | { lignes?: readonly Pick<LigneEtat, "reference">[]; ingestion?: IngestionEtat | null }
    | null
    | undefined,
): boolean {
  if (!e) return false;
  const m = e.ingestion?.methode;
  return m === "ocr" || m === "ocr_simule" || (e.lignes ?? []).some(ligneLueParOcr);
}

/** Mention accolée au montant d'une ligne lue par OCR : « lu par OCR : à vérifier (confiance de la page : 82 %) ». */
export function marqueurOcrLigne(
  l: Pick<LigneEtat, "reference">,
  langue: Langue = "fr",
): string | null {
  if (!ligneLueParOcr(l)) return null;
  const t = creerTraduire(langue);
  const marqueur = t(MARQUEUR_OCR_A_VERIFIER, MARQUEUR_OCR_A_VERIFIER_EN);
  const c = l.reference.confiance_pm;
  if (c === null || c === undefined || !Number.isFinite(c)) return marqueur;
  const pct = Math.round(Math.min(1000, Math.max(0, c)) / 10);
  return `${marqueur} (${t("confiance de la page", "page confidence")}${t(" : ", ": ")}${pct} %)`;
}

/** Constat de contrôle, lisible : « Équilibre du bilan : écart de −10 FCFA (attendu 1 000, constaté 990) ». */
export function formaterConstat(c: ConstatEtat, devise: Devise, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  const m = (v: number | null) => formaterMontantMineur(v, devise, langue);
  const cible = (x: string) => {
    const g = /^L(\d+)_(\d+)$/.exec(x.trim());
    return g ? `${t("page", "page")} ${g[1]}, ${t("ligne", "line")} ${g[2]}` : x.trim();
  };
  const remplacer = (texte: string) =>
    texte.replace(/\bL(\d+)_(\d+)\b/g, (code) => {
      const g = /^L(\d+)_(\d+)$/.exec(code);
      return langue === "en" && g
        ? `Line without source code (page ${g[1]}, line ${g[2]})`
        : libellePosteEtat(code);
    });
  const nom = `${libelleControle(c.code, langue)}${c.cible ? ` (${cible(c.cible)})` : ""}`;
  if (c.statut === "non_verifiable")
    return `${nom}${t(" : non vérifiable. ", ": cannot be verified. ")}${remplacer(c.message)}`;
  if (c.statut === "ok") return `${nom}${t(" : conforme.", ": compliant.")}`;
  return (
    `${nom}${t(" : écart de ", ": gap of ")}${m(c.ecart)} ` +
    `(${t("attendu", "expected")} ${m(c.attendu)}, ${t("constaté", "found")} ${m(c.constate)}).`
  );
}

/** Groupe des faits par catégorie, dans l'ordre des catégories ; catégories vides omises. */
export function grouperParCategorie<T extends { categorie: CategorieFaitDossier }>(
  faits: readonly T[],
  langue: Langue = "fr",
): { categorie: CategorieFaitDossier; libelle: string; faits: T[] }[] {
  return CATEGORIES_FAIT_DOSSIER.map((c) => ({
    categorie: c,
    libelle: libelleCategorieFait(c, langue),
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
export function ongletsDossier(id: string, langue: Langue = "fr") {
  const base = `/dossiers/${enc(id)}`;
  const t = creerTraduire(langue);
  return [
    { id: "ensemble", libelle: t("Vue d'ensemble", "Overview"), href: base },
    { id: "faits", libelle: t("Faits", "Facts"), href: `${base}/faits` },
    { id: "finances", libelle: t("Finances", "Finance"), href: `${base}/finances` },
    { id: "frise", libelle: t("Frise", "Timeline"), href: `${base}/frise` },
    { id: "groupe", libelle: t("Groupe", "Group"), href: `${base}/groupe` },
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

export const optionsTypesValeur = (
  langue: Langue = "fr",
): { valeur: TypeValeurFait; libelle: string }[] => {
  const t = creerTraduire(langue);
  return [
    { valeur: "texte", libelle: t("Texte", "Text") },
    { valeur: "nombre", libelle: t("Nombre", "Number") },
    { valeur: "montant", libelle: t("Montant", "Amount") },
    { valeur: "date", libelle: t("Date", "Date") },
    { valeur: "booleen", libelle: t("Oui / non", "Yes / no") },
  ];
};

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

function lireValeurFait(s: SaisieFait, langue: Langue = "fr"): ValeurFait | string {
  const tr = creerTraduire(langue);
  const t = s.valeur.trim();
  switch (s.type_valeur) {
    case "texte":
      return t === ""
        ? tr("Saisissez la valeur.", "Enter the value.")
        : t.length > 2000
          ? tr("2 000 caractères au plus.", "2,000 characters at most.")
          : { type: "texte", texte: t };
    case "nombre": {
      const n = lireNombre(t);
      return n === null || Number.isNaN(n)
        ? tr("Nombre attendu (ex. 42 ou 12,5).", "Number expected (e.g. 42 or 12.5).")
        : { type: "nombre", nombre: n };
    }
    case "montant": {
      const m = lireMontant(t, s.devise);
      return m === null || Number.isNaN(m)
        ? tr(
            "Montant positif attendu, à la précision de la devise.",
            "Positive amount expected, at the currency's precision.",
          )
        : { type: "montant", montant: m, devise: s.devise };
    }
    case "date":
      return DATE.test(t) ? { type: "date", date: t } : tr("Date attendue.", "Date expected.");
    default:
      return t === "oui" || t === "non"
        ? { type: "booleen", booleen: t === "oui" }
        : tr("Choisissez oui ou non.", "Choose yes or no.");
  }
}

/** Valide la saisie d'un fait → corps de `POST /api/dossiers/:id/faits`. */
export function validerFait(
  s: SaisieFait,
  langue: Langue = "fr",
): Resultat<Record<string, unknown>, ChampFait> {
  const tr = creerTraduire(langue);
  const erreurs: Partial<Record<ChampFait, string>> = {};
  const cle = versCle(s.cle);
  if (!CLE.test(cle))
    erreurs.cle = tr(
      "Clé attendue (lettres, chiffres, « _ »), ex. effectif_total.",
      'Key expected (letters, digits, "_"), e.g. effectif_total.',
    );
  const valeur = lireValeurFait(s, langue);
  if (typeof valeur === "string") erreurs.valeur = valeur;
  if (!DATE.test(s.date_effet))
    erreurs.date_effet = tr("Date d'effet attendue.", "Effective date expected.");
  const libelle = texteOuNull(s.source_libelle);
  if (!libelle)
    erreurs.source_libelle = tr(
      "Précisez la source (document, entretien…).",
      "Specify the source (document, interview…).",
    );
  else if (libelle.length > 300)
    erreurs.source_libelle = tr("300 caractères au plus.", "300 characters at most.");
  const page = texteOuNull(s.source_page);
  const numero = page === null ? null : Number(page);
  if (
    page !== null &&
    (s.source_type !== "document" || !Number.isInteger(numero) || (numero as number) < 1)
  ) {
    erreurs.source_page = tr(
      "Numéro de page (document seulement).",
      "Page number (documents only).",
    );
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

/** Facteurs de convention, dans la langue demandée. */
export function facteursConvention(langue: Langue = "fr"): typeof FACTEURS_CONVENTION {
  if (langue !== "en") return FACTEURS_CONVENTION;
  return [
    {
      code: "fiabilite_comptes",
      libelle: "Reliability of the accounts",
      valeurs: [
        { valeur: "certifies", libelle: "Certified" },
        { valeur: "non_certifies", libelle: "Not certified" },
        { valeur: "reconstitues", libelle: "Reconstructed" },
      ],
    },
    {
      code: "part_informel",
      libelle: "Share of informal activity and cash",
      valeurs: [
        { valeur: "faible", libelle: "Low" },
        { valeur: "moyenne", libelle: "Medium" },
        { valeur: "forte", libelle: "High" },
      ],
    },
  ];
}

type LectureFacteur = { ok: true; valeur: ValeurFacteur } | { ok: false; message: string };

function lireValeurFacteur(s: SaisieFacteur, langue: Langue = "fr"): LectureFacteur {
  const tr = creerTraduire(langue);
  const t = s.valeur.trim();
  const ko = (message: string): LectureFacteur => ({ ok: false, message });
  if (s.type === "booleen") {
    return t === "oui" || t === "non"
      ? { ok: true, valeur: t === "oui" }
      : ko(tr("Choisissez oui ou non.", "Choose yes or no."));
  }
  if (s.type === "nombre") {
    const n = lireNombre(t);
    return n === null || Number.isNaN(n)
      ? ko(tr("Nombre attendu.", "Number expected."))
      : { ok: true, valeur: n };
  }
  if (s.type === "enumeration") {
    return CLE.test(t)
      ? { ok: true, valeur: t }
      : ko(
          tr(
            "Code attendu (minuscules, chiffres, « _ »).",
            'Code expected (lowercase, digits, "_").',
          ),
        );
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
    : ko(tr("Liste de codes séparés par des virgules.", "List of codes separated by commas."));
}

/** Valide la saisie d'un facteur → corps de `POST /api/dossiers/:id/facteurs`. */
export function validerFacteur(
  s: SaisieFacteur,
  langue: Langue = "fr",
): Resultat<Record<string, unknown>, ChampFacteur> {
  const tr = creerTraduire(langue);
  const erreurs: Partial<Record<ChampFacteur, string>> = {};
  const code = versCle(s.code);
  if (!CLE.test(code))
    erreurs.code = tr(
      "Code du facteur attendu, ex. secteur_filiere.",
      "Factor code expected, e.g. secteur_filiere.",
    );
  const convention = facteursConvention(langue).find((f) => f.code === code);
  const lecture = lireValeurFacteur(convention ? { ...s, type: "enumeration" } : s, langue);
  if (convention && !(lecture.ok && convention.valeurs.some((v) => v.valeur === lecture.valeur))) {
    erreurs.valeur = `${tr("Choisissez", "Choose")}${tr(" : ", ": ")}${convention.valeurs.map((v) => v.libelle).join(", ")}.`;
  } else if (!lecture.ok) {
    erreurs.valeur = lecture.message;
  }
  if (!DATE.test(s.date_effet))
    erreurs.date_effet = tr("Date d'effet attendue.", "Effective date expected.");
  const libelle = texteOuNull(s.source_libelle);
  if (!libelle) erreurs.source_libelle = tr("Précisez la source.", "Specify the source.");
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
  langue: Langue = "fr",
): Resultat<{ decision: "accepte" | "rejete"; motif?: string }, ChampDecision> {
  const tr = creerTraduire(langue);
  const m = texteOuNull(motif);
  if (!m && (decision === "rejete" || !controlesOk)) {
    return {
      ok: false,
      erreurs: {
        motif:
          decision === "rejete"
            ? tr(
                "Motif obligatoire pour rejeter l'état.",
                "A reason is required to reject the statement.",
              )
            : tr(
                "Motif obligatoire pour accepter un état dont des contrôles échouent.",
                "A reason is required to accept a statement with failed checks.",
              ),
      },
    };
  }
  if (m && m.length > 2000)
    return {
      ok: false,
      erreurs: { motif: tr("2 000 caractères au plus.", "2,000 characters at most.") },
    };
  return { ok: true, charge: m ? { decision, motif: m } : { decision } };
}

/** Décision sur un fait proposé : motif obligatoire pour rejeter. */
export function validerDecisionFait(
  decision: "confirme" | "rejete",
  motif: string,
  langue: Langue = "fr",
): Resultat<{ decision: "confirme" | "rejete"; motif?: string }, ChampDecision> {
  const m = texteOuNull(motif);
  if (decision === "rejete" && !m)
    return {
      ok: false,
      erreurs: {
        motif: creerTraduire(langue)(
          "Motif obligatoire pour rejeter.",
          "A reason is required to reject.",
        ),
      },
    };
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

export function aideImportEtat(langue: Langue = "fr"): string {
  if (langue !== "en") return AIDE_IMPORT_ETAT;
  return (
    "Columns: section (actif, passif, charges, produits, resultat), code, label, amount, and optional " +
    "parent and role (total, result for the year, net result). .xlsx workbook " +
    '(2 MB at most, first visible sheet) or UTF-8 CSV (separator ";" or ",").'
  );
}

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
  langue: Langue = "fr",
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
  const tr = creerTraduire(langue);
  const erreurs: Partial<Record<ChampImportEtat, string>> = {};
  const exercice = Number(s.exercice);
  if (!/^\d{4}$/.test(s.exercice.trim()) || exercice < 1990 || exercice > 2100) {
    erreurs.exercice = tr(
      "Exercice sur quatre chiffres (ex. 2025).",
      "Fiscal year with four digits (e.g. 2025).",
    );
  }
  if (!DATE.test(s.date_cloture))
    erreurs.date_cloture = tr("Date de clôture attendue.", "Closing date expected.");
  const tolerance = s.tolerance.trim() === "" ? 0 : Number(s.tolerance.trim());
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 1_000_000) {
    erreurs.tolerance = tr(
      "Entier entre 0 et 1 000 000 (unités mineures).",
      "Integer between 0 and 1,000,000 (minor units).",
    );
  }
  const format = fichier ? formatFichierEtat(fichier.name) : null;
  if (!fichier)
    erreurs.fichier = tr(
      "Choisissez un classeur .xlsx ou un fichier .csv.",
      "Choose an .xlsx workbook or a .csv file.",
    );
  else if (!format)
    erreurs.fichier = tr("Format accepté : .xlsx ou .csv.", "Accepted format: .xlsx or .csv.");
  else if (fichier.size <= 0) erreurs.fichier = tr("Ce fichier est vide.", "This file is empty.");
  else if (fichier.size > (format === "excel" ? TAILLE_EXCEL_MAX : TAILLE_CSV_MAX)) {
    erreurs.fichier =
      format === "excel"
        ? tr("Classeur trop volumineux (2 Mo au plus).", "Workbook too large (2 MB at most).")
        : tr(
            "CSV trop volumineux (200 000 caractères au plus).",
            "CSV too large (200,000 characters at most).",
          );
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
