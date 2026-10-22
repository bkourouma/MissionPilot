/** Sous-module de `canaux.ts` : journal des envois. */
import {
  LIBELLES_OBJET_ENVOI_CANAL,
  LIBELLES_STATUT_ENVOI_CANAL,
  OBJETS_ENVOI_CANAL,
  STATUTS_ENVOI_CANAL,
  type EnvoiCanalApi,
  type ObjetEnvoiCanal,
  type StatutEnvoiCanal,
} from "@missionpilot/shared";
import { un } from "./canaux-utilitaires";
import { CHEMIN_CANAUX_JOURNAL, API_CANAUX_ENVOIS } from "./canaux-chemins";
import { libelleMotifBlocage, libelleCodeRefus, libelleObjetEnvoi } from "./canaux-libelles";

// --- Journal des envois ----------------------------------------------------------------------

export interface ParametresJournal {
  statut: StatutEnvoiCanal | null;
  objet_type: ObjetEnvoiCanal | null;
  destinataire_id: string | null;
  curseur: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lecture sûre des paramètres d'URL du journal : une valeur hors liste est ignorée. */
export function lireParametresJournal(
  p: Record<string, string | string[] | undefined>,
): ParametresJournal {
  const statut = un(p.statut);
  const objet = un(p.objet_type);
  const destinataire = un(p.destinataire_id);
  const curseur = un(p.curseur);
  return {
    statut: (STATUTS_ENVOI_CANAL as readonly string[]).includes(statut)
      ? (statut as StatutEnvoiCanal)
      : null,
    objet_type: (OBJETS_ENVOI_CANAL as readonly string[]).includes(objet)
      ? (objet as ObjetEnvoiCanal)
      : null,
    destinataire_id: UUID.test(destinataire) ? destinataire : null,
    curseur:
      curseur !== "" && curseur.length <= 500 && /^[A-Za-z0-9_-]+$/.test(curseur) ? curseur : null,
  };
}

/** Taille d'une page du journal (affichage). */
export const TAILLE_PAGE_JOURNAL = 30;

/** Requête de `GET /api/canaux/envois`. */
export function requeteJournal(p: ParametresJournal): string {
  const r = new URLSearchParams({ limite: String(TAILLE_PAGE_JOURNAL) });
  if (p.statut) r.set("statut", p.statut);
  if (p.objet_type) r.set("objet_type", p.objet_type);
  if (p.destinataire_id) r.set("destinataire_id", p.destinataire_id);
  if (p.curseur) r.set("curseur", p.curseur);
  return `${API_CANAUX_ENVOIS}?${r.toString()}`;
}

/** Lien vers une page du journal (mêmes filtres, curseur donné). */
export function hrefJournal(p: ParametresJournal, curseur: string | null = null): string {
  const r = new URLSearchParams();
  if (p.statut) r.set("statut", p.statut);
  if (p.objet_type) r.set("objet_type", p.objet_type);
  if (p.destinataire_id) r.set("destinataire_id", p.destinataire_id);
  if (curseur) r.set("curseur", curseur);
  const q = r.toString();
  return q ? `${CHEMIN_CANAUX_JOURNAL}?${q}` : CHEMIN_CANAUX_JOURNAL;
}

export const OPTIONS_STATUT_ENVOI = STATUTS_ENVOI_CANAL.map((s) => ({
  valeur: s,
  libelle: LIBELLES_STATUT_ENVOI_CANAL[s],
}));
export const OPTIONS_OBJET_ENVOI = OBJETS_ENVOI_CANAL.map((o) => ({
  valeur: o,
  libelle: LIBELLES_OBJET_ENVOI_CANAL[o],
}));

/** Précision sous le statut : motif du blocage ou du refus, sinon rien. Jamais un contenu. */
export function precisionEnvoi(
  e: Pick<EnvoiCanalApi, "statut" | "motif_blocage" | "code_refus">,
): string | null {
  if (e.motif_blocage) return libelleMotifBlocage(e.motif_blocage);
  if (e.code_refus) return libelleCodeRefus(e.code_refus);
  return null;
}

/** Libellé de l'objet lié : « Questionnaire », « Demande de signature »… */
export const objetLie = (e: Pick<EnvoiCanalApi, "objet_type">) => libelleObjetEnvoi(e.objet_type);

/** Un coût estimé n'existe qu'avec le droit financier : champ absent sinon (FIN-02). */
export function aUnCoutEstime(e: Pick<EnvoiCanalApi, "cout_estime_micro_usd">): boolean {
  return e.cout_estime_micro_usd !== undefined;
}
