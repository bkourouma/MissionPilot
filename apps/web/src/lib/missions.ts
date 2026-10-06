/**
 * Missions (MIS-07, MIS-09, MIS-10, MIS-12) : logique pure, testée dans `missions.test.ts`.
 * Les règles d'actions reproduisent celles de l'API pour n'afficher que ce qui sera accepté ;
 * l'API reste seule juge (elle refuse toute action non autorisée).
 */
import {
  aPermission,
  cheminStockageSur,
  MODES_FACTURATION,
  STATUTS_MISSION,
  TYPES_DOCUMENT,
  type ModeFacturation,
  type Role,
  type StatutMission,
  type TypeDocument,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { DEVISES, type Devise } from "./format";
import { lireMontant, lireNombre, texteOuNull, type Resultat } from "./saisie";

export interface Mission {
  id: string;
  intitule: string;
  client_id: string;
  client_raison_sociale: string;
  type_mission_id: string | null;
  opportunite_id: string | null;
  proposition_id: string | null;
  mission_source_id: string | null;
  directeur_id: string | null;
  chef_id: string | null;
  date_debut: string | null;
  date_fin: string | null;
  devise: Devise;
  mode_facturation: ModeFacturation;
  statut: StatutMission;
  activite: string | null;
  secteur: string | null;
  bureau: string | null;
  date_signature: string | null;
  taux_change: number | null;
  devise_reference: string | null;
  cloturee_le: string | null;
  cree_le: string;
  modifie_le: string;
}

export interface MissionDetaillee extends Mission {
  equipe: { utilisateur_id: string; nom: string }[];
}

export interface DocumentMission {
  id: string;
  mission_id: string;
  type: TypeDocument;
  nom: string;
  version: number;
  auteur_nom: string | null;
  chemin_stockage: string | null;
  cree_le: string;
}

export const STATUT_MISSION: Record<StatutMission, { libelle: string; tonalite: TonaliteStatut }> =
  {
    opportunite: { libelle: "Opportunité", tonalite: "neutre" },
    proposition: { libelle: "Proposition", tonalite: "neutre" },
    signee: { libelle: "Signée", tonalite: "succes" },
    en_cours: { libelle: "En cours", tonalite: "succes" },
    a_cloturer: { libelle: "À clôturer", tonalite: "attention" },
    cloturee: { libelle: "Clôturée", tonalite: "neutre" },
  };

export const OPTIONS_STATUTS_MISSION = STATUTS_MISSION.map((s) => ({
  valeur: s,
  libelle: STATUT_MISSION[s].libelle,
}));

export const TYPE_DOCUMENT_LIBELLES: Record<TypeDocument, string> = {
  proposition: "Proposition",
  lettre_de_mission: "Lettre de mission",
  livrable: "Livrable",
  autre: "Autre document",
};

export const OPTIONS_TYPES_DOCUMENT = TYPES_DOCUMENT.map((t) => ({
  valeur: t,
  libelle: TYPE_DOCUMENT_LIBELLES[t],
}));

/** Statuts où la lettre de mission est signée : budget initial figé, devise figée. */
export const STATUTS_SIGNES: readonly StatutMission[] = [
  "signee",
  "en_cours",
  "a_cloturer",
  "cloturee",
];
export const estSignee = (statut: StatutMission) => STATUTS_SIGNES.includes(statut);

// --- Filtres de la liste --------------------------------------------------------------

export interface FiltresMissions {
  statut: StatutMission | "";
  client_id: string;
  directeur_id: string;
  q: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const uuidOuVide = (v: string | undefined) => (v && UUID.test(v) ? v : "");

export function lireFiltresMissions(
  p: Record<string, string | string[] | undefined>,
): FiltresMissions {
  const s = un(p.statut) ?? "";
  return {
    statut: (STATUTS_MISSION as readonly string[]).includes(s) ? (s as StatutMission) : "",
    client_id: uuidOuVide(un(p.client_id)),
    directeur_id: uuidOuVide(un(p.directeur_id)),
    q: (un(p.q) ?? "").trim().slice(0, 100),
  };
}

/** Requête `GET /api/missions?…` (le directeur est filtré dans la page : l'API ne le propose pas). */
export function requeteMissions(f: FiltresMissions): string {
  const r = new URLSearchParams();
  if (f.statut) r.set("statut", f.statut);
  if (f.client_id) r.set("client_id", f.client_id);
  if (f.q) r.set("q", f.q);
  return r.toString();
}

export function hrefMissions(f: FiltresMissions): string {
  const r = new URLSearchParams();
  if (f.q) r.set("q", f.q);
  if (f.statut) r.set("statut", f.statut);
  if (f.client_id) r.set("client_id", f.client_id);
  if (f.directeur_id) r.set("directeur_id", f.directeur_id);
  const s = r.toString();
  return s ? `/missions?${s}` : "/missions";
}

export function filtrerParDirecteur<T extends Pick<Mission, "directeur_id">>(
  missions: readonly T[],
  directeurId: string,
): T[] {
  return directeurId ? missions.filter((m) => m.directeur_id === directeurId) : [...missions];
}

// --- Droits sur une mission -------------------------------------------------------------

export interface DroitsMission {
  /** Voit toutes les missions ou en est directeur ou chef, et la mission n'est pas clôturée. */
  responsable: boolean;
  /** Modifier la fiche (mission.creer et responsabilité). */
  modifier: boolean;
  /** Réaffecter le chef (« mission.modifier_toutes »). */
  reaffecter: boolean;
  /** Changer le directeur de mission (associé seulement). */
  designerDirecteur: boolean;
  /** Découpage, équipe, statut simple (mission.planifier et responsabilité). */
  planifier: boolean;
  /** Budget en jours des tâches (budget.ecrire et responsabilité). */
  budgeterJours: boolean;
  /** Lire le budget en jours (synthèse, versions). */
  lireBudget: boolean;
  signer: boolean;
  cloturer: boolean;
  dupliquer: boolean;
  enregistrerModele: boolean;
  deposerDocument: boolean;
  /** Types de document que l'utilisateur peut déposer (proposition et lettre : responsables). */
  typesDocument: TypeDocument[];
  /** Transitions simples proposées (hors signature et clôture). */
  transitions: { cible: StatutMission; libelle: string }[];
}

const TRANSITIONS_SIMPLES: Partial<
  Record<StatutMission, { cible: StatutMission; libelle: string }[]>
> = {
  opportunite: [{ cible: "proposition", libelle: "Passer au stade de la proposition" }],
  signee: [{ cible: "en_cours", libelle: "Démarrer la mission" }],
  en_cours: [{ cible: "a_cloturer", libelle: "Passer « à clôturer »" }],
  a_cloturer: [{ cible: "en_cours", libelle: "Rouvrir (retour en cours)" }],
};

/**
 * Droits de l'utilisateur sur une mission (miroir de `missions/acces.ts` et `routes/missions.ts`
 * de l'API) : il faut la permission ET « mission.modifier_toutes » ou être directeur ou chef
 * de la mission. Lire toutes les missions ne donne pas le droit de les modifier. Une mission
 * clôturée ne se modifie plus. La lettre de mission est signée par le directeur désigné de la
 * mission ou un associé ; seul un associé change le directeur.
 */
export function droitsMission(
  m: Pick<Mission, "statut" | "directeur_id" | "chef_id">,
  roles: readonly Role[],
  utilisateurId: string,
): DroitsMission {
  const a = (p: Parameters<typeof aPermission>[1]) => aPermission(roles, p);
  const associe = roles.includes("associe");
  const directeur = m.directeur_id !== null && m.directeur_id === utilisateurId;
  const responsable = a("mission.modifier_toutes") || directeur || m.chef_id === utilisateurId;
  const ouverte = m.statut !== "cloturee";
  const ecrire = responsable && ouverte;
  const planifier = ecrire && a("mission.planifier");
  return {
    responsable: ecrire,
    modifier: ecrire && a("mission.creer"),
    reaffecter: ecrire && a("mission.creer") && a("mission.modifier_toutes"),
    designerDirecteur: ecrire && a("mission.creer") && associe,
    planifier,
    budgeterJours: ecrire && a("budget.ecrire"),
    lireBudget: a("budget.lire_jours"),
    signer: ecrire && a("mission.signer") && m.statut === "proposition" && (associe || directeur),
    cloturer: ecrire && a("mission.cloturer") && m.statut === "a_cloturer",
    dupliquer: a("mission.creer"),
    enregistrerModele: a("catalogue.ecrire"),
    deposerDocument: a("document.ecrire") && ouverte,
    typesDocument:
      a("document.ecrire") && ouverte
        ? TYPES_DOCUMENT.filter(
            (t) =>
              (t !== "proposition" && t !== "lettre_de_mission") ||
              (responsable && (t !== "lettre_de_mission" || a("mission.signer"))),
          )
        : [],
    transitions: planifier ? (TRANSITIONS_SIMPLES[m.statut] ?? []) : [],
  };
}

// --- Formulaire mission (création et modification) -------------------------------------

export interface SaisieMission {
  intitule: string;
  client_id: string;
  type_mission_id: string;
  mode_facturation: string;
  directeur_id: string;
  chef_id: string;
  date_debut: string;
  date_fin: string;
  devise: string;
  activite: string;
  secteur: string;
  bureau: string;
}

export type ChampMission = keyof SaisieMission;

export const SAISIE_MISSION_VIDE: SaisieMission = {
  intitule: "",
  client_id: "",
  type_mission_id: "",
  mode_facturation: "",
  directeur_id: "",
  chef_id: "",
  date_debut: "",
  date_fin: "",
  devise: "XOF",
  activite: "",
  secteur: "",
  bureau: "",
};

export function saisieDepuisMission(m: Mission): SaisieMission {
  return {
    intitule: m.intitule,
    client_id: m.client_id,
    type_mission_id: m.type_mission_id ?? "",
    mode_facturation: m.mode_facturation,
    directeur_id: m.directeur_id ?? "",
    chef_id: m.chef_id ?? "",
    date_debut: m.date_debut ?? "",
    date_fin: m.date_fin ?? "",
    devise: m.devise,
    activite: m.activite ?? "",
    secteur: m.secteur ?? "",
    bureau: m.bureau ?? "",
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const idOuNull = (v: string) => (v === "" ? null : v);

interface ChampsCommunsMission {
  intitule: string;
  directeur_id: string | null;
  chef_id: string | null;
  date_debut: string | null;
  date_fin: string | null;
  devise: Devise;
  activite: string | null;
  secteur: string | null;
  bureau: string | null;
}

export interface ChargeCreationMission extends ChampsCommunsMission {
  client_id: string;
  type_mission_id: string | null;
  mode_facturation?: ModeFacturation;
}

export interface ChargeModificationMission extends Partial<ChampsCommunsMission> {
  mode_facturation?: ModeFacturation;
}

function validerCommun(
  s: SaisieMission,
  erreurs: Partial<Record<ChampMission, string>>,
): ChampsCommunsMission {
  const intitule = s.intitule.trim();
  if (intitule === "") erreurs.intitule = "Saisissez l'intitulé de la mission.";
  else if (intitule.length > 200) erreurs.intitule = "200 caractères au plus.";
  for (const champ of ["directeur_id", "chef_id"] as const) {
    if (s[champ] !== "" && !UUID.test(s[champ])) erreurs[champ] = "Choisissez dans la liste.";
  }
  for (const champ of ["date_debut", "date_fin"] as const) {
    if (s[champ] !== "" && !DATE.test(s[champ])) erreurs[champ] = "Date invalide.";
  }
  if (!erreurs.date_fin && s.date_debut && s.date_fin && s.date_fin < s.date_debut)
    erreurs.date_fin = "La date de fin précède la date de début.";
  if (!(DEVISES as readonly string[]).includes(s.devise)) erreurs.devise = "Choisissez une devise.";
  for (const champ of ["activite", "secteur", "bureau"] as const) {
    if (s[champ].trim().length > 120) erreurs[champ] = "120 caractères au plus.";
  }
  return {
    intitule,
    directeur_id: idOuNull(s.directeur_id),
    chef_id: idOuNull(s.chef_id),
    date_debut: idOuNull(s.date_debut),
    date_fin: idOuNull(s.date_fin),
    devise: s.devise as Devise,
    activite: texteOuNull(s.activite),
    secteur: texteOuNull(s.secteur),
    bureau: texteOuNull(s.bureau),
  };
}

const estMode = (v: string): v is ModeFacturation =>
  (MODES_FACTURATION as readonly string[]).includes(v);

/** Création : depuis un type du catalogue (mode par défaut du type) ou vierge (mode requis). */
export function validerCreationMission(
  s: SaisieMission,
): Resultat<ChargeCreationMission, ChampMission> {
  const erreurs: Partial<Record<ChampMission, string>> = {};
  const commun = validerCommun(s, erreurs);
  if (!UUID.test(s.client_id)) erreurs.client_id = "Choisissez le client.";
  if (s.type_mission_id !== "" && !UUID.test(s.type_mission_id))
    erreurs.type_mission_id = "Choisissez un type dans la liste.";
  if (s.mode_facturation !== "" && !estMode(s.mode_facturation))
    erreurs.mode_facturation = "Choisissez un mode de facturation.";
  if (s.type_mission_id === "" && s.mode_facturation === "")
    erreurs.mode_facturation = "Sans type de mission, choisissez le mode de facturation.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      ...commun,
      client_id: s.client_id,
      type_mission_id: idOuNull(s.type_mission_id),
      ...(estMode(s.mode_facturation) ? { mode_facturation: s.mode_facturation } : {}),
    },
  };
}

/**
 * Modification : devise et mode de facturation sont figés après signature (l'API refuse un
 * changement) ; le chef ne se réaffecte qu'avec « mission.modifier_toutes » et seul un associé
 * désigne le directeur (l'API répond 403 sinon).
 */
export function validerModificationMission(
  s: SaisieMission,
  options: { signee: boolean; reaffecter: boolean; designerDirecteur: boolean },
): Resultat<ChargeModificationMission, ChampMission> {
  const erreurs: Partial<Record<ChampMission, string>> = {};
  const { directeur_id, chef_id, devise, ...commun } = validerCommun(s, erreurs);
  if (!options.signee && !estMode(s.mode_facturation))
    erreurs.mode_facturation = "Choisissez un mode de facturation.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      ...commun,
      ...(options.signee
        ? {}
        : { devise, mode_facturation: s.mode_facturation as ModeFacturation }),
      ...(options.reaffecter ? { chef_id } : {}),
      ...(options.designerDirecteur ? { directeur_id } : {}),
    },
  };
}

// --- Création depuis une proposition acceptée -----------------------------------------

export interface SaisieDepuisProposition {
  intitule: string;
  directeur_id: string;
  chef_id: string;
  date_debut: string;
  date_fin: string;
}

export function validerDepuisProposition(
  s: SaisieDepuisProposition,
): Resultat<Record<string, string>, keyof SaisieDepuisProposition> {
  const erreurs: Partial<Record<keyof SaisieDepuisProposition, string>> = {};
  const commun = validerCommun(
    { ...SAISIE_MISSION_VIDE, ...s, intitule: s.intitule || "x" },
    erreurs,
  );
  const intitule = s.intitule.trim();
  if (intitule.length > 200) erreurs.intitule = "200 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: Record<string, string> = {};
  if (intitule) charge.intitule = intitule;
  for (const champ of ["directeur_id", "chef_id", "date_debut", "date_fin"] as const) {
    const v = commun[champ];
    if (v) charge[champ] = v;
  }
  return { ok: true, charge };
}

// --- Signature de la lettre de mission (MIS-07) -----------------------------------------

export type NatureSupplementaire = "debours" | "sous_traitance";

export interface SaisieLigneSupplementaire {
  nature: NatureSupplementaire;
  libelle: string;
  montant: string;
  refacturable: boolean;
}

export interface SaisieSignature {
  date_signature: string;
  taux_change: string;
  lignes: SaisieLigneSupplementaire[];
}

export interface ChargeSignature {
  date_signature: string;
  taux_change?: number;
  lignes_supplementaires: {
    nature: NatureSupplementaire;
    libelle: string;
    montant: number;
    refacturable: boolean;
  }[];
}

/** Natures de lignes saisissables à la signature selon les droits (FIN-02). */
export function naturesSupplementaires(roles: readonly Role[]): NatureSupplementaire[] {
  const natures: NatureSupplementaire[] = [];
  if (aPermission(roles, "budget.lire_montants") || aPermission(roles, "finance.lire"))
    natures.push("debours");
  if (aPermission(roles, "finance.lire")) natures.push("sous_traitance");
  return natures;
}

/**
 * Devise à cours flottant (USD) : seule à exiger un taux de change saisi à la signature ; FCFA
 * et euro ont une parité légale fixe que l'API impose (tout autre taux est refusé).
 */
export const deviseFlottante = (devise: Devise) => devise === "USD";

export function validerSignature(
  s: SaisieSignature,
  devise: Devise,
  naturesPermises: readonly NatureSupplementaire[],
): Resultat<ChargeSignature, string> {
  const erreurs: Record<string, string> = {};
  if (!DATE.test(s.date_signature)) erreurs.date_signature = "Indiquez la date de signature.";
  const taux = deviseFlottante(devise) ? lireNombre(s.taux_change) : null;
  if (deviseFlottante(devise) && taux === null)
    erreurs.taux_change = `Indiquez le taux de change de la devise ${devise}.`;
  else if (taux !== null && (Number.isNaN(taux) || taux < 0.000001 || taux > 1_000_000))
    erreurs.taux_change = "Nombre positif entre 0,000001 et 1 000 000 (ex. 605,25).";
  const lignes: ChargeSignature["lignes_supplementaires"] = [];
  s.lignes.forEach((l, i) => {
    if (!naturesPermises.includes(l.nature)) {
      erreurs[`lignes.${i}.nature`] = "Nature non autorisée pour votre rôle.";
      return;
    }
    const libelle = l.libelle.trim();
    if (libelle === "" || libelle.length > 200)
      erreurs[`lignes.${i}.libelle`] = "Libellé de 1 à 200 caractères.";
    const montant = lireMontant(l.montant, devise);
    if (montant === null || Number.isNaN(montant))
      erreurs[`lignes.${i}.montant`] = "Montant positif dans la devise de la mission.";
    lignes.push({
      nature: l.nature,
      libelle,
      montant: montant ?? 0,
      refacturable: l.nature === "debours" && l.refacturable,
    });
  });
  if (s.lignes.length > 50) erreurs.lignes = "50 lignes au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      date_signature: s.date_signature,
      ...(taux === null ? {} : { taux_change: taux }),
      lignes_supplementaires: lignes,
    },
  };
}

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
