/**
 * Pipeline commercial (MIS-04) : logique pure, testée dans `pipeline.test.ts`.
 * Les montants affichés (estimé, pondéré) sont calculés par l'API et ses moteurs ; ce module
 * ne fait que lire les saisies, construire les charges utiles et choisir les libellés.
 */
import {
  ETAPES_OPPORTUNITE,
  type EtapeOpportunite,
  type StatutOpportunite,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { DEVISES, formaterPourcentage, type Devise } from "./format";
import { lireMontant, lireNombre, montantVersSaisie, texteOuNull, type Resultat } from "./saisie";

export interface Opportunite {
  id: string;
  client_id: string;
  client_raison_sociale: string;
  intitule: string;
  type_mission_id: string | null;
  montant_estime: number;
  devise: Devise;
  probabilite: number;
  etape: EtapeOpportunite;
  statut: StatutOpportunite;
  motif_perte: string | null;
  responsable_id: string | null;
  date_cloture_prevue: string | null;
  cloturee_le: string | null;
  cree_le: string;
  modifie_le: string;
}

export interface LigneAgregat {
  etape: EtapeOpportunite;
  devise: Devise;
  nombre: number;
  montant_estime: number;
  montant_pondere: number;
}

export interface TotalAgregat {
  devise: Devise;
  nombre: number;
  montant_estime: number;
  montant_pondere: number;
}

/** Réponse de `GET /api/opportunites/pipeline` (opportunités ouvertes). */
export interface AgregatPipeline {
  par_etape: LigneAgregat[];
  totaux: TotalAgregat[];
  gagnees: number;
  perdues: number;
}

export const ETAPE_LIBELLES: Record<EtapeOpportunite, string> = {
  prospection: "Prospection",
  qualification: "Qualification",
  proposition: "Proposition",
  negociation: "Négociation",
};

export const OPTIONS_ETAPES = ETAPES_OPPORTUNITE.map((e) => ({
  valeur: e,
  libelle: ETAPE_LIBELLES[e],
}));

export const STATUT_OPPORTUNITE: Record<
  StatutOpportunite,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  ouverte: { libelle: "Ouverte", tonalite: "neutre" },
  gagnee: { libelle: "Gagnée", tonalite: "succes" },
  perdue: { libelle: "Perdue", tonalite: "danger" },
};

export const OPTIONS_DEVISES = DEVISES.map((d) => ({
  valeur: d,
  libelle: d === "XOF" ? "XOF (FCFA UEMOA)" : d === "XAF" ? "XAF (FCFA CEMAC)" : d,
}));

/** Probabilité saisie en points (0 à 100) → « 40 % » (espace insécable). */
export const formaterProbabilite = (p: number) => formaterPourcentage(p / 100, 0);

/** Étape suivante dans l'entonnoir, `null` à la négociation. */
export function etapeSuivante(etape: EtapeOpportunite): EtapeOpportunite | null {
  const i = ETAPES_OPPORTUNITE.indexOf(etape);
  return ETAPES_OPPORTUNITE[i + 1] ?? null;
}

// --- Filtres de la liste ------------------------------------------------------------

export type FiltreStatutOpportunite = "ouvertes" | "gagnees" | "perdues" | "toutes";

export interface FiltresPipeline {
  statut: FiltreStatutOpportunite;
  etape: EtapeOpportunite | "";
  client_id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export const OPTIONS_FILTRE_STATUT: { valeur: FiltreStatutOpportunite; libelle: string }[] = [
  { valeur: "ouvertes", libelle: "Ouvertes" },
  { valeur: "gagnees", libelle: "Gagnées" },
  { valeur: "perdues", libelle: "Perdues" },
  { valeur: "toutes", libelle: "Toutes" },
];

/** Filtres lus dans l'URL ; toute valeur inconnue revient à la valeur par défaut. */
export function lireFiltresPipeline(
  p: Record<string, string | string[] | undefined>,
): FiltresPipeline {
  const s = un(p.statut);
  const statut = OPTIONS_FILTRE_STATUT.some((o) => o.valeur === s)
    ? (s as FiltreStatutOpportunite)
    : "ouvertes";
  const e = un(p.etape) ?? "";
  const etape = (ETAPES_OPPORTUNITE as readonly string[]).includes(e)
    ? (e as EtapeOpportunite)
    : "";
  const c = un(p.client_id) ?? "";
  return { statut, etape, client_id: UUID.test(c) ? c : "" };
}

const STATUT_API: Record<FiltreStatutOpportunite, StatutOpportunite | null> = {
  ouvertes: "ouverte",
  gagnees: "gagnee",
  perdues: "perdue",
  toutes: null,
};

/** Requête `GET /api/opportunites?…`. */
export function requeteOpportunites(f: FiltresPipeline): string {
  const r = new URLSearchParams();
  const statut = STATUT_API[f.statut];
  if (statut) r.set("statut", statut);
  if (f.etape) r.set("etape", f.etape);
  if (f.client_id) r.set("client_id", f.client_id);
  return r.toString();
}

/** Lien de la liste dans l'interface (le statut par défaut n'est pas répété). */
export function hrefPipeline(f: FiltresPipeline): string {
  const r = new URLSearchParams();
  if (f.statut !== "ouvertes") r.set("statut", f.statut);
  if (f.etape) r.set("etape", f.etape);
  if (f.client_id) r.set("client_id", f.client_id);
  const s = r.toString();
  return s ? `/pipeline?${s}` : "/pipeline";
}

// --- Formulaire opportunité ---------------------------------------------------------

export interface SaisieOpportunite {
  intitule: string;
  client_id: string;
  type_mission_id: string;
  montant_estime: string;
  devise: string;
  probabilite: string;
  etape: string;
  responsable_id: string;
  date_cloture_prevue: string;
}

export type ChampOpportunite = keyof SaisieOpportunite;

export const SAISIE_OPPORTUNITE_VIDE: SaisieOpportunite = {
  intitule: "",
  client_id: "",
  type_mission_id: "",
  montant_estime: "",
  devise: "XOF",
  probabilite: "50",
  etape: "prospection",
  responsable_id: "",
  date_cloture_prevue: "",
};

export function saisieDepuisOpportunite(o: Opportunite): SaisieOpportunite {
  return {
    intitule: o.intitule,
    client_id: o.client_id,
    type_mission_id: o.type_mission_id ?? "",
    montant_estime: montantVersSaisie(o.montant_estime, o.devise),
    devise: o.devise,
    probabilite: String(o.probabilite),
    etape: o.etape,
    responsable_id: o.responsable_id ?? "",
    date_cloture_prevue: o.date_cloture_prevue ?? "",
  };
}

export interface ChargeOpportunite {
  intitule: string;
  client_id: string;
  type_mission_id: string | null;
  montant_estime: number;
  devise: Devise;
  probabilite: number;
  responsable_id: string | null;
  date_cloture_prevue: string | null;
  /** Création seulement : l'étape se change ensuite par `POST /etape`. */
  etape?: EtapeOpportunite;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const idOuNull = (v: string) => (v.trim() === "" ? null : v.trim());

/**
 * Valide la saisie. En création, l'étape fait partie de la charge ; en modification, elle
 * en est exclue (l'API la refuse : elle passe par le changement d'étape).
 */
export function validerOpportunite(
  s: SaisieOpportunite,
  mode: "creation" | "modification",
): Resultat<ChargeOpportunite, ChampOpportunite> {
  const erreurs: Partial<Record<ChampOpportunite, string>> = {};
  const intitule = s.intitule.trim();
  if (intitule === "") erreurs.intitule = "Saisissez l'intitulé de l'opportunité.";
  else if (intitule.length > 200) erreurs.intitule = "200 caractères au plus.";
  if (!UUID.test(s.client_id)) erreurs.client_id = "Choisissez le client.";
  if (s.type_mission_id !== "" && !UUID.test(s.type_mission_id))
    erreurs.type_mission_id = "Choisissez un type dans la liste.";
  if (s.responsable_id !== "" && !UUID.test(s.responsable_id))
    erreurs.responsable_id = "Choisissez une personne dans la liste.";
  const devise = (DEVISES as readonly string[]).includes(s.devise) ? (s.devise as Devise) : null;
  if (!devise) erreurs.devise = "Choisissez une devise.";
  const montant = devise ? lireMontant(s.montant_estime, devise) : null;
  if (devise && montant !== null && Number.isNaN(montant))
    erreurs.montant_estime =
      devise === "XOF" || devise === "XAF"
        ? "Montant entier positif, sans décimale (ex. 15 000 000)."
        : "Montant positif, deux décimales au plus (ex. 25 000,50).";
  const proba = lireNombre(s.probabilite);
  if (proba === null || Number.isNaN(proba) || !Number.isInteger(proba) || proba < 0 || proba > 100)
    erreurs.probabilite = "Nombre entier entre 0 et 100.";
  if (s.date_cloture_prevue !== "" && !DATE.test(s.date_cloture_prevue))
    erreurs.date_cloture_prevue = "Date au format JJ/MM/AAAA.";
  const etape = (ETAPES_OPPORTUNITE as readonly string[]).includes(s.etape)
    ? (s.etape as EtapeOpportunite)
    : null;
  if (mode === "creation" && !etape) erreurs.etape = "Choisissez une étape.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      intitule,
      client_id: s.client_id,
      type_mission_id: idOuNull(s.type_mission_id),
      montant_estime: montant ?? 0,
      devise: devise as Devise,
      probabilite: proba as number,
      responsable_id: idOuNull(s.responsable_id),
      date_cloture_prevue: texteOuNull(s.date_cloture_prevue),
      ...(mode === "creation" ? { etape: etape as EtapeOpportunite } : {}),
    },
  };
}

// --- Issue (gagnée / perdue) --------------------------------------------------------

export type ChargeIssue = { statut: "gagnee" } | { statut: "perdue"; motif_perte: string };

/** Une opportunité perdue exige un motif (1 à 1000 caractères). */
export function validerIssue(
  statut: "gagnee" | "perdue",
  motif: string,
): Resultat<ChargeIssue, "motif_perte"> {
  if (statut === "gagnee") return { ok: true, charge: { statut } };
  const m = motif.trim();
  if (m === "") return { ok: false, erreurs: { motif_perte: "Indiquez le motif de la perte." } };
  if (m.length > 1000) return { ok: false, erreurs: { motif_perte: "1000 caractères au plus." } };
  return { ok: true, charge: { statut, motif_perte: m } };
}
