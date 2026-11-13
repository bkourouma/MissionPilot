/** Sous-module de `canaux.ts` : saisies de KPI reçues par message et aperçu de la synthèse. */
import {
  LIBELLES_STATUT_SAISIE_KPI,
  LOCALES_INTL,
  STATUTS_SAISIE_KPI,
  creerTraduire,
  type DestinataireCanalApi,
  type Langue,
  type SaisieKpiApi,
  type StatutSaisieKpi,
} from "@missionpilot/shared";
import type { Resultat } from "./saisie";
import { un } from "./canaux-utilitaires";
import { libelleStatutSaisie } from "./canaux-libelles";
import {
  CHEMIN_CANAUX_SAISIES,
  API_CANAUX_APERCU_SYNTHESE,
  API_CANAUX_SAISIES_KPI,
} from "./canaux-chemins";
import { TAILLE_PAGE_JOURNAL } from "./canaux-journal";

// --- Saisies de KPI reçues par message -------------------------------------------------------

/**
 * Valeur décimale exacte de l'API (« 12.500000 ») → « 12,5 » : opérations sur le TEXTE, jamais
 * de conversion en nombre à virgule flottante (la valeur vient du moteur et de l'API).
 */
export function formaterValeurSaisie(valeur: string, langue: Langue = "fr"): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(valeur.trim());
  if (!m) return valeur;
  const en = langue === "en";
  const entier = (m[2] ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, en ? "," : " ");
  const decimales = (m[3] ?? "").replace(/0+$/, "");
  return `${m[1]}${entier}${decimales ? `${en ? "." : ","}${decimales}` : ""}`;
}

export const peutReprendreSaisie = (s: Pick<SaisieKpiApi, "statut">) => s.statut === "confirmee";
export const peutRejeterSaisie = (s: Pick<SaisieKpiApi, "statut">) => s.statut === "confirmee";

/** Date de mesure « AAAA-MM-JJ » saisie (champ date) : facultative, borne 2000 à 2100 comme l'API. */
export function validerRepriseSaisie(
  saisie: {
    date_mesure: string;
    commentaire: string;
  },
  langue: Langue = "fr",
): Resultat<{ date_mesure?: string; commentaire?: string }, "date_mesure" | "commentaire"> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"date_mesure" | "commentaire", string>> = {};
  const date = saisie.date_mesure.trim();
  const commentaire = saisie.commentaire.trim();
  if (date !== "") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const annee = m ? Number(m[1]) : 0;
    if (!m || annee < 2000 || annee > 2100) {
      erreurs.date_mesure = t(
        "Date invalide : choisissez un jour entre 2000 et 2100.",
        "Invalid date: choose a day between 2000 and 2100.",
      );
    }
  }
  if (commentaire.length > 500) {
    erreurs.commentaire = t(
      "Le commentaire ne doit pas dépasser 500 caractères.",
      "The comment must not exceed 500 characters.",
    );
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      ...(date !== "" ? { date_mesure: date } : {}),
      ...(commentaire !== "" ? { commentaire } : {}),
    },
  };
}

export function validerRejetSaisie(
  motif: string,
  langue: Langue = "fr",
): Resultat<{ motif: string }, "motif"> {
  const t = creerTraduire(langue);
  const m = motif.trim();
  if (m === "")
    return {
      ok: false,
      erreurs: { motif: t("Indiquez le motif du rejet.", "Enter the reason for rejection.") },
    };
  if (m.length > 500) {
    return {
      ok: false,
      erreurs: {
        motif: t(
          "Le motif ne doit pas dépasser 500 caractères.",
          "The reason must not exceed 500 characters.",
        ),
      },
    };
  }
  return { ok: true, charge: { motif: m } };
}

// --- Liste des saisies reçues ----------------------------------------------------------------

export interface ParametresSaisies {
  statut: StatutSaisieKpi;
  curseur: string | null;
}

/** Par défaut : les propositions confirmées par la personne, qui attendent une reprise. */
export const STATUT_SAISIES_DEFAUT: StatutSaisieKpi = "confirmee";

export const OPTIONS_STATUT_SAISIE = STATUTS_SAISIE_KPI.map((s) => ({
  valeur: s,
  libelle: LIBELLES_STATUT_SAISIE_KPI[s],
}));

/** Options du filtre de statut dans la langue demandée. */
export const optionsStatutSaisie = (langue: Langue = "fr") =>
  STATUTS_SAISIE_KPI.map((s) => ({ valeur: s, libelle: libelleStatutSaisie(s, langue) }));

export function lireParametresSaisies(
  p: Record<string, string | string[] | undefined>,
): ParametresSaisies {
  const statut = un(p.statut);
  const curseur = un(p.curseur);
  return {
    statut: (STATUTS_SAISIE_KPI as readonly string[]).includes(statut)
      ? (statut as StatutSaisieKpi)
      : STATUT_SAISIES_DEFAUT,
    curseur:
      curseur !== "" && curseur.length <= 500 && /^[A-Za-z0-9_-]+$/.test(curseur) ? curseur : null,
  };
}

/** Requête de `GET /api/canaux/saisies-kpi`. */
export function requeteSaisies(p: ParametresSaisies): string {
  const r = new URLSearchParams({ statut: p.statut, limite: String(TAILLE_PAGE_JOURNAL) });
  if (p.curseur) r.set("curseur", p.curseur);
  return `${API_CANAUX_SAISIES_KPI}?${r.toString()}`;
}

export function hrefSaisies(p: ParametresSaisies, curseur: string | null = null): string {
  const r = new URLSearchParams();
  if (p.statut !== STATUT_SAISIES_DEFAUT) r.set("statut", p.statut);
  if (curseur) r.set("curseur", curseur);
  const q = r.toString();
  return q ? `${CHEMIN_CANAUX_SAISIES}?${q}` : CHEMIN_CANAUX_SAISIES;
}

// --- Aperçu de la synthèse du dirigeant ------------------------------------------------------

/** `GET /api/canaux/synthese-dirigeant/apercu` : n'envoie rien et ne crée aucune ligne d'envoi. */
export function requeteApercuSynthese(clientId: string, destinataireId: string): string {
  const r = new URLSearchParams({ client_id: clientId, destinataire_id: destinataireId });
  return `${API_CANAUX_APERCU_SYNTHESE}?${r.toString()}`;
}

/**
 * Destinataires proposés pour l'aperçu : les dirigeants du client sur WhatsApp (la synthèse ne
 * part qu'à eux), un par personne. La valeur est l'IDENTIFIANT DE L'UTILISATEUR (le paramètre
 * `destinataire_id` de l'API le désigne ainsi, SPEC-3c §10.2) et non la ligne
 * `canaux_destinataires`, qui n'existe pas tant qu'aucun numéro n'est enregistré : l'aperçu
 * reste possible pour un dirigeant sans numéro.
 */
export function dirigeantsApercu(
  destinataires: readonly DestinataireCanalApi[],
  langue: Langue = "fr",
): { valeur: string; libelle: string }[] {
  const vus = new Set<string>();
  return destinataires
    .filter((d) => d.role === "client_dirigeant" && d.canal === "whatsapp")
    .filter((d) => (vus.has(d.utilisateur_id) ? false : (vus.add(d.utilisateur_id), true)))
    .map((d) => ({ valeur: d.utilisateur_id, libelle: d.utilisateur_nom }))
    .sort((a, b) => a.libelle.localeCompare(b.libelle, LOCALES_INTL[langue]));
}
