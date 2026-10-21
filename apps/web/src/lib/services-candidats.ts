/**
 * Services candidats (diagnostic flash, business plan bancable) et guichets de financement :
 * logique pure, testée dans `services-candidats.test.ts`. Les formes de réponse reprennent celles
 * de `apps/api/src/services-candidats/{services,guichets}.ts` ; l'API reste seule juge.
 *
 * Les montants du prix fixe et des guichets sont des entiers en UNITÉS de la devise (le franc CFA
 * comme l'euro ; pas de centimes), comme dans le moteur de rapprochement.
 */
import {
  CODES_SERVICES_CANDIDATS,
  OBJETS_FINANCEMENT,
  TYPES_GUICHET,
  type CodeServiceCandidat,
  type ObjetFinancement,
  type PrixFixe,
  type TypeGuichet,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { DEVISES, VALEUR_ABSENTE, formaterNombre, type Devise } from "./format";
import {
  SAISIE_MISSION_VIDE,
  validerCreationMission,
  type ChampMission,
  type ChargeCreationMission,
} from "./missions";
import { decouperListe, joindreListe, lireNombre, texteOuNull, type Resultat } from "./saisie";

// --- Formes de réponse de l'API ------------------------------------------------------

export interface MethodePubliee {
  methode_id: string;
  version_id: string;
  version: number;
  libelle: string;
}

export interface ServiceCandidat {
  code: CodeServiceCandidat;
  libelle: string;
  description: string | null;
  methode: MethodePubliee | null;
  coherence: { valide: boolean; erreurs: string[]; avertissements: string[] } | null;
  type_mission: { id: string; a_valider: boolean } | null;
  prix: {
    montant: number | null;
    devise: string;
    /** Prix à saisir par le cabinet avant d'activer le type de mission (aucun prix par défaut). */
    a_fixer: boolean;
    personnalise: boolean;
    commentaire: string | null;
  };
  a_valider_expert: true;
}

export interface Guichet {
  id: string;
  nom: string;
  type: TypeGuichet;
  pays: string[];
  secteurs: string[];
  filieres: string[];
  tailles: string[];
  objets: ObjetFinancement[];
  devises: Devise[];
  montant_min: number | null;
  montant_max: number | null;
  devise_montant: Devise | null;
  date_limite: string | null;
  description: string | null;
  url: string | null;
  actif: boolean;
  a_valider: boolean;
}

export type StatutRapprochement = "compatible" | "partiel" | "exclu";
export type VerdictCritere = "ok" | "ko" | "inconnu" | "non_restreint";

export interface CritereRapprochement {
  critere: string;
  verdict: VerdictCritere;
  detail: string;
}

export interface ResultatRapprochement {
  guichet: Pick<Guichet, "id" | "nom" | "type" | "description" | "url" | "date_limite">;
  statut: StatutRapprochement;
  score: number;
  criteres: CritereRapprochement[];
  raisons_exclusion: string[];
}

export interface ReponseRapprochement {
  profil_utilise: Record<string, unknown>;
  dossier: { client_id: string; chiffre_affaires_millions: number | null } | null;
  resultats: ResultatRapprochement[];
  /** Vrai si l'API n'a rapproché qu'une partie des guichets. */
  tronque?: boolean;
  avertissement: string;
}

// --- Libellés ------------------------------------------------------------------------

export const MENTION_A_VALIDER = "Contenu à valider par un expert";
export const MENTION_GUICHETS_A_VALIDER =
  "Les guichets saisis par le cabinet sont à valider par un expert : le rapprochement est indicatif.";
export const MESSAGE_AUCUN_GUICHET =
  "Aucun guichet : la liste est gérée par le cabinet, aucune source externe.";

export const SYMBOLES_DEVISE: Record<Devise, string> = {
  XOF: "FCFA",
  XAF: "FCFA",
  EUR: "€",
  USD: "$US",
};

export const OPTIONS_DEVISES_SERVICE = DEVISES.map((d) => ({
  valeur: d,
  libelle: d === "XOF" ? "XOF (FCFA UEMOA)" : d === "XAF" ? "XAF (FCFA CEMAC)" : d,
}));

export const TYPE_GUICHET_LIBELLES: Record<TypeGuichet, string> = {
  banque: "Banque",
  bailleur: "Bailleur de fonds",
  fonds_investissement: "Fonds d'investissement",
  programme_public: "Programme public",
  autre: "Autre",
};
export const OPTIONS_TYPES_GUICHET = TYPES_GUICHET.map((t) => ({
  valeur: t,
  libelle: TYPE_GUICHET_LIBELLES[t],
}));

export const OBJET_LIBELLES: Record<ObjetFinancement, string> = {
  creation: "Création",
  investissement: "Investissement",
  bfr: "Besoin en fonds de roulement",
  croissance: "Croissance",
  restructuration: "Restructuration",
  export: "Export",
};
export const OPTIONS_OBJETS = OBJETS_FINANCEMENT.map((o) => ({
  valeur: o,
  libelle: OBJET_LIBELLES[o],
}));

export const STATUT_RAPPROCHEMENT: Record<
  StatutRapprochement,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  compatible: { libelle: "Compatible", tonalite: "succes" },
  partiel: { libelle: "Partiel", tonalite: "attention" },
  exclu: { libelle: "Exclu", tonalite: "danger" },
};

export const VERDICT_LIBELLES: Record<VerdictCritere, string> = {
  ok: "Satisfait",
  ko: "Non satisfait",
  inconnu: "Inconnu",
  non_restreint: "Sans restriction",
};

export const CRITERE_LIBELLES: Record<string, string> = {
  actif: "Guichet actif",
  echeance: "Échéance",
  pays: "Pays",
  secteur: "Secteur",
  filiere: "Filière",
  taille: "Taille",
  objet: "Objet du financement",
  devise: "Devise",
  montant: "Montant",
};

export const libelleCritere = (c: string): string => CRITERE_LIBELLES[c] ?? c;
export const libelleStatut = (s: StatutRapprochement): string => STATUT_RAPPROCHEMENT[s].libelle;

// --- Prix fixe -----------------------------------------------------------------------

const NBSP = String.fromCharCode(0xa0);

const estDevise = (v: string): v is Devise => (DEVISES as readonly string[]).includes(v);

export const TEXTE_PRIX_A_FIXER = "À fixer par le cabinet";
export const MESSAGE_FIXER_PRIX_D_ABORD = "Fixez d'abord le prix.";

/** Alerte quand l'API n'a renvoyé que les N premiers guichets. */
export const messageListeTronquee = (n: number): string =>
  `La liste est tronquée : seuls les ${n} premiers guichets sont affichés.`;
/** Alerte quand le rapprochement n'a porté que sur une partie des guichets. */
export const messageRapprochementTronque = (n: number): string =>
  `La liste est tronquée : seuls les ${n} premiers guichets ont été rapprochés.`;

/** « 1 500 000 FCFA » ; sans montant : « À fixer par le cabinet » (prix requis) ou « Sur devis ». */
export function formaterPrixService(prix: ServiceCandidat["prix"]): string {
  const sans = prix.a_fixer ? TEXTE_PRIX_A_FIXER : "Sur devis";
  if (prix.montant === null) return sans;
  const nombre = formaterNombre(prix.montant, 0);
  if (nombre === VALEUR_ABSENTE) return sans;
  return `${nombre}${NBSP}${estDevise(prix.devise) ? SYMBOLES_DEVISE[prix.devise] : prix.devise}`;
}

/** Montant d'un prix ou d'une borne → texte modifiable (« 1500000 »). */
export const montantVersTexte = (montant: number | null): string =>
  montant === null ? "" : String(montant);

/** Montant entier en unités de la devise ; `null` si vide, `NaN` si illisible. */
function lireEntier(v: string): number | null {
  const n = lireNombre(v);
  if (n === null) return null;
  if (!Number.isSafeInteger(n) || n < 0) return Number.NaN;
  return n;
}

export type ChampPrix = "montant" | "devise" | "commentaire";

/**
 * Corps de PUT /api/services-candidats/:code/prix. Un montant vide signifie « à fixer » ou
 * « sur devis » ; une mention vide efface la mention existante.
 */
export function validerPrix(
  montant: string,
  devise: string,
  mention = "",
): Resultat<PrixFixe, ChampPrix> {
  const erreurs: Partial<Record<ChampPrix, string>> = {};
  const m = lireEntier(montant);
  if (m !== null && Number.isNaN(m))
    erreurs.montant =
      "Saisissez un montant entier, sans décimale (ex. 1 500 000), ou laissez vide.";
  else if (m !== null && m > 1_000_000_000_000) erreurs.montant = "Montant trop élevé.";
  if (!estDevise(devise)) erreurs.devise = "Choisissez une devise.";
  const commentaire = texteOuNull(mention);
  if (commentaire !== null && commentaire.length > 200)
    erreurs.commentaire = "200 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { montant: m, devise: devise as Devise, commentaire } };
}

// --- Création d'une mission depuis un service ----------------------------------------

/** Pourquoi une mission ne peut pas encore être créée depuis ce service (`null` : possible). */
export function obstacleCreationMission(s: ServiceCandidat): string | null {
  if (!s.type_mission) return "Le type de mission n'est pas activé : activez-le d'abord.";
  if (!s.methode) return "Aucune méthode publiée dans le standard pour ce service.";
  if (s.coherence && !s.coherence.valide)
    return "La méthode du standard est incohérente : corrigez-la avant de créer une mission.";
  return null;
}

/** Intitulé proposé : « Diagnostic flash — Raison sociale ». */
export function intituleParDefaut(service: Pick<ServiceCandidat, "libelle">, client: string) {
  return client.trim() === "" ? service.libelle : `${service.libelle} — ${client.trim()}`;
}

export interface SaisieMissionService {
  client_id: string;
  intitule: string;
  date_debut: string;
  date_fin: string;
}

export const SAISIE_MISSION_SERVICE_VIDE: SaisieMissionService = {
  client_id: "",
  intitule: "",
  date_debut: "",
  date_fin: "",
};

/** Corps de POST /api/missions : type de mission du service, client, intitulé, dates. */
export function validerMissionService(
  s: SaisieMissionService,
  service: ServiceCandidat,
): Resultat<ChargeCreationMission, ChampMission> {
  const devise: Devise = estDevise(service.prix.devise) ? service.prix.devise : "XOF";
  return validerCreationMission({
    ...SAISIE_MISSION_VIDE,
    client_id: s.client_id,
    intitule: s.intitule,
    date_debut: s.date_debut,
    date_fin: s.date_fin,
    type_mission_id: service.type_mission?.id ?? "",
    devise,
  });
}

/** Corps de PUT /api/missions/:id/methode : version publiée de la méthode, contexte vide. */
export function corpsLiaisonMethode(
  service: Pick<ServiceCandidat, "methode">,
): { version_id: string; contexte: Record<string, never> } | null {
  return service.methode ? { version_id: service.methode.version_id, contexte: {} } : null;
}

export interface PreremplissageService {
  service: CodeServiceCandidat | null;
  client: string | null;
}

/**
 * Lit `?service=<code>&client=<uuid>` (lien posé depuis une fiche client ou une alerte) : une
 * valeur absente, répétée ou invalide est ignorée (`null`), jamais une erreur.
 */
export function lirePreremplissageService(
  params: Record<string, string | string[] | undefined>,
): PreremplissageService {
  const unique = (v: string | string[] | undefined): string | null =>
    typeof v === "string" ? v.trim() : null;
  const code = unique(params.service);
  const client = unique(params.client);
  return {
    service: (CODES_SERVICES_CANDIDATS as readonly string[]).includes(code ?? "")
      ? (code as CodeServiceCandidat)
      : null,
    client: client !== null && UUID.test(client) ? client.toLowerCase() : null,
  };
}

export const cheminMission = (id: string): string => `/missions/${encodeURIComponent(id)}`;

// --- Guichets ------------------------------------------------------------------------

export interface SaisieGuichet {
  nom: string;
  type: string;
  pays: string;
  secteurs: string;
  filieres: string;
  tailles: string;
  objets: string[];
  devises: string[];
  montant_min: string;
  montant_max: string;
  devise_montant: string;
  date_limite: string;
  description: string;
  url: string;
  actif: boolean;
}
export type ChampGuichet = keyof SaisieGuichet;

export const SAISIE_GUICHET_VIDE: SaisieGuichet = {
  nom: "",
  type: "",
  pays: "",
  secteurs: "",
  filieres: "",
  tailles: "",
  objets: [],
  devises: [],
  montant_min: "",
  montant_max: "",
  devise_montant: "",
  date_limite: "",
  description: "",
  url: "",
  actif: true,
};

export function saisieDepuisGuichet(g: Guichet): SaisieGuichet {
  return {
    nom: g.nom,
    type: g.type,
    pays: joindreListe(g.pays),
    secteurs: joindreListe(g.secteurs),
    filieres: joindreListe(g.filieres),
    tailles: joindreListe(g.tailles),
    objets: [...g.objets],
    devises: [...g.devises],
    montant_min: montantVersTexte(g.montant_min),
    montant_max: montantVersTexte(g.montant_max),
    devise_montant: g.devise_montant ?? "",
    date_limite: g.date_limite ?? "",
    description: g.description ?? "",
    url: g.url ?? "",
    actif: g.actif,
  };
}

export interface ChargeGuichet {
  nom: string;
  type: TypeGuichet;
  pays: string[];
  secteurs: string[];
  filieres: string[];
  tailles: string[];
  objets: ObjetFinancement[];
  devises: Devise[];
  montant_min: number | null;
  montant_max: number | null;
  devise_montant: Devise | null;
  date_limite: string | null;
  description: string | null;
  url: string | null;
  actif: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Mêmes bornes que le schéma partagé : entrées, longueur d'une entrée, total (jointes par « , »). */
function lireListe(
  v: string,
  champ: ChampGuichet,
  erreurs: Partial<Record<ChampGuichet, string>>,
  maxEntrees: number,
  maxCaracteres: number,
) {
  const liste = decouperListe(v);
  if (liste.length > maxEntrees || liste.some((e) => e.length > 80))
    erreurs[champ] = `${maxEntrees} éléments de 80 caractères au plus.`;
  else if (liste.join(",").length > maxCaracteres)
    erreurs[champ] = `${maxCaracteres} caractères au plus en tout.`;
  return liste;
}

const CARACTERE_DE_CONTROLE = /\p{Cc}/u;
const ADRESSE_HTTP = /^https?:\/\/[^\s]+$/i;

/** Corps complet de création (POST) ou de modification (PATCH) d'un guichet. */
export function validerGuichet(s: SaisieGuichet): Resultat<ChargeGuichet, ChampGuichet> {
  const erreurs: Partial<Record<ChampGuichet, string>> = {};
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = "Saisissez le nom du guichet.";
  else if (nom.length > 200) erreurs.nom = "200 caractères au plus.";
  else if (CARACTERE_DE_CONTROLE.test(nom))
    erreurs.nom = "Le nom ne doit pas contenir de caractère de contrôle.";
  if (!(TYPES_GUICHET as readonly string[]).includes(s.type))
    erreurs.type = "Choisissez un type de guichet.";
  const pays = lireListe(s.pays, "pays", erreurs, 60, 600);
  const secteurs = lireListe(s.secteurs, "secteurs", erreurs, 50, 2000);
  const filieres = lireListe(s.filieres, "filieres", erreurs, 50, 2000);
  const tailles = lireListe(s.tailles, "tailles", erreurs, 10, 200);
  const objets = [...new Set(s.objets)] as ObjetFinancement[];
  if (
    objets.length > 10 ||
    objets.some((o) => !(OBJETS_FINANCEMENT as readonly string[]).includes(o))
  )
    erreurs.objets = "10 objets de financement valides au plus.";
  const devises = [...new Set(s.devises)] as Devise[];
  if (devises.length > 4 || devises.some((d) => !estDevise(d)))
    erreurs.devises = "4 devises valides au plus.";
  const min = lireEntier(s.montant_min);
  const max = lireEntier(s.montant_max);
  if (min !== null && Number.isNaN(min)) erreurs.montant_min = "Montant entier positif attendu.";
  if (max !== null && Number.isNaN(max)) erreurs.montant_max = "Montant entier positif attendu.";
  if (!erreurs.montant_min && !erreurs.montant_max && min !== null && max !== null && min > max)
    erreurs.montant_min = "Le montant minimum ne peut pas dépasser le maximum.";
  const borne = (min !== null && !Number.isNaN(min)) || (max !== null && !Number.isNaN(max));
  if (s.devise_montant !== "" && !estDevise(s.devise_montant))
    erreurs.devise_montant = "Choisissez une devise.";
  else if (borne && s.devise_montant === "")
    erreurs.devise_montant = "La devise du montant est obligatoire quand une borne est donnée.";
  if (s.date_limite !== "" && !DATE.test(s.date_limite)) erreurs.date_limite = "Date invalide.";
  const description = texteOuNull(s.description);
  if (description && description.length > 2000) erreurs.description = "2 000 caractères au plus.";
  const url = texteOuNull(s.url);
  if (url) {
    let ok = url.length <= 500 && ADRESSE_HTTP.test(url);
    try {
      const { protocol } = new URL(url);
      ok = ok && (protocol === "http:" || protocol === "https:");
    } catch {
      ok = false;
    }
    if (!ok) erreurs.url = "Adresse http ou https attendue, sans espace (500 caractères au plus).";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      nom,
      type: s.type as TypeGuichet,
      pays,
      secteurs,
      filieres,
      tailles,
      objets,
      devises,
      montant_min: min,
      montant_max: max,
      devise_montant: s.devise_montant === "" ? null : (s.devise_montant as Devise),
      date_limite: s.date_limite === "" ? null : s.date_limite,
      description,
      url,
      actif: s.actif,
    },
  };
}

/** Liste de restrictions d'un guichet ; une liste vide signifie « aucune restriction ». */
export function joindreRestrictions(liste: readonly string[]): string {
  return liste.length === 0 ? "Aucune restriction" : liste.join(", ");
}

/** « 5 000 000 – 50 000 000 FCFA », « À partir de … », « Jusqu'à … » ou « Non borné ». */
export function formaterBornesGuichet(
  g: Pick<Guichet, "montant_min" | "montant_max" | "devise_montant">,
): string {
  const symbole = g.devise_montant ? SYMBOLES_DEVISE[g.devise_montant] : "";
  const suffixe = symbole ? `${NBSP}${symbole}` : "";
  const { montant_min: min, montant_max: max } = g;
  if (min !== null && max !== null)
    return `${formaterNombre(min, 0)} – ${formaterNombre(max, 0)}${suffixe}`;
  if (min !== null) return `À partir de ${formaterNombre(min, 0)}${suffixe}`;
  if (max !== null) return `Jusqu'à ${formaterNombre(max, 0)}${suffixe}`;
  return "Non borné";
}

// --- Rapprochement -------------------------------------------------------------------

export interface SaisieRapprochement {
  client_id: string;
  pays: string;
  secteur: string;
  filieres: string;
  taille: string;
  objet: string;
  montant: string;
  devise: string;
}
export type ChampRapprochement = keyof SaisieRapprochement;

export const SAISIE_RAPPROCHEMENT_VIDE: SaisieRapprochement = {
  client_id: "",
  pays: "",
  secteur: "",
  filieres: "",
  taille: "",
  objet: "",
  montant: "",
  devise: "",
};

export interface CorpsRapprochement {
  client_id?: string;
  profil?: {
    pays?: string;
    secteur?: string;
    filieres?: string[];
    taille?: string;
    objet?: ObjetFinancement;
    montant?: number;
    devise?: Devise;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corps de POST /api/guichets-financement/rapprochement : seules les surcharges renseignées. */
export function validerRapprochement(
  s: SaisieRapprochement,
): Resultat<CorpsRapprochement, ChampRapprochement> {
  const erreurs: Partial<Record<ChampRapprochement, string>> = {};
  if (s.client_id !== "" && !UUID.test(s.client_id))
    erreurs.client_id = "Choisissez dans la liste.";
  const profil: NonNullable<CorpsRapprochement["profil"]> = {};
  const pays = texteOuNull(s.pays);
  const secteur = texteOuNull(s.secteur);
  const taille = texteOuNull(s.taille);
  for (const [champ, v] of [
    ["pays", pays],
    ["secteur", secteur],
    ["taille", taille],
  ] as const) {
    if (v && v.length > 80) erreurs[champ] = "80 caractères au plus.";
  }
  if (pays) profil.pays = pays;
  if (secteur) profil.secteur = secteur;
  if (taille) profil.taille = taille;
  const filieres = decouperListe(s.filieres);
  if (filieres.length > 50 || filieres.some((f) => f.length > 80))
    erreurs.filieres = "50 éléments de 80 caractères au plus.";
  if (filieres.length > 0) profil.filieres = filieres;
  if (s.objet !== "") {
    if (!(OBJETS_FINANCEMENT as readonly string[]).includes(s.objet))
      erreurs.objet = "Choisissez un objet dans la liste.";
    else profil.objet = s.objet as ObjetFinancement;
  }
  const montant = lireEntier(s.montant);
  if (montant !== null) {
    if (Number.isNaN(montant)) erreurs.montant = "Montant entier positif attendu.";
    else profil.montant = montant;
  }
  if (s.devise !== "" && !estDevise(s.devise)) erreurs.devise = "Choisissez une devise.";
  else if (s.devise !== "") profil.devise = s.devise as Devise;
  if (montant !== null && !Number.isNaN(montant) && s.devise === "")
    erreurs.devise = "Précisez la devise du montant.";
  if (Object.keys(erreurs).length === 0 && s.client_id === "" && Object.keys(profil).length === 0) {
    erreurs.client_id = "Choisissez un client ou renseignez au moins un critère.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      ...(s.client_id !== "" ? { client_id: s.client_id } : {}),
      ...(Object.keys(profil).length > 0 ? { profil } : {}),
    },
  };
}

/** Nombre de résultats par statut, pour le résumé du rapprochement. */
export function compterParStatut(
  resultats: readonly Pick<ResultatRapprochement, "statut">[],
): Record<StatutRapprochement, number> {
  const c: Record<StatutRapprochement, number> = { compatible: 0, partiel: 0, exclu: 0 };
  for (const r of resultats) c[r.statut] += 1;
  return c;
}
