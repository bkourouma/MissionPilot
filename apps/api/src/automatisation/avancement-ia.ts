import type { ContenuAvancement } from "@missionpilot/shared";
import { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Database, Db } from "../db/pool.js";
import { termesNomsPropres } from "../copilote/noms-propres.js";
import {
  CONSIGNE_DONNEES_NON_FIABLES,
  encadrerContenuClient,
  neutraliserContenuClient,
} from "../ia/donnees-non-fiables.js";
import { contexteGarde, verifierChiffres } from "../ia/garde-chiffres.js";
import { creerMasque, type Masque } from "../ia/masquage.js";
import {
  admettreSansDemande,
  appelerSansDemande,
  type DependancesIa,
} from "../ia/orchestrateur.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import { journaliserIncident } from "./diagnostic.js";

/*
 * Commentaire IA du rapport d'avancement hebdomadaire (AUT-10) : BROUILLON proposé au chef de mission,
 * jamais visible du client, jamais validé sans relecture (statut « brouillon_ia », 409
 * COMMENTAIRE_IA_A_RELIRE à la validation). « L'IA propose, l'expert dispose » ; les chiffres viennent du
 * moteur, jamais du modèle.
 *
 * Seul chemin vers le fournisseur : l'orchestrateur IA (`admettreSansDemande` : coupe-circuit IA du
 * cabinet, droit « ia.utiliser » de l'utilisateur d'imputation, clé, plafond mensuel et réservation ;
 * `appelerSansDemande` : une seule tentative, règlement du coût, inscription dans ia_consommations).
 *
 * Ce que le modèle reçoit (liste blanche, `faitsPourIa`) : le pourcentage d'avancement, les COMPTES de
 * jalons, d'indicateurs et de livrables PARTAGÉS, et les libellés de jalons, masqués (noms connus du
 * cabinet et formats : ia/masquage.ts) puis traités comme DONNÉES non fiables. Jamais l'intitulé de la
 * mission, le client, les noms de livrables, les indicateurs détaillés, les livrables non partagés, ni
 * aucune donnée financière.
 *
 * Ce que la sortie peut contenir : un texte français de 600 caractères au plus. Tout nombre absent de la
 * liste blanche (garde-chiffres de ia/garde-chiffres.ts), tout jeton de masquage forgé, tout JSON
 * invalide ou texte trop long REJETTE la suggestion : repli SILENCIEUX (commentaire vide), jamais un
 * échec du job ni de la requête.
 */

export const TAILLE_MAX_SUGGESTION_AVANCEMENT = 600;

/** Raison d'absence de suggestion (repli) : sans contenu, journalisable. */
export type RaisonRepliAvancement =
  | "ia_desactivee"
  | "non_autorisee"
  | "indisponible"
  | "sortie_rejetee"
  | "echec"
  | "sans_utilisateur";

export type ResultatSuggestion =
  | { type: "ok"; commentaire: string; notifications: (NotificationCreee | null)[] }
  | { type: "repli"; raison: RaisonRepliAvancement; notifications: (NotificationCreee | null)[] };

export interface DependancesSuggestionAvancement {
  database: Database;
  ia: DependancesIa;
}

/** Faits transmis au modèle : lignes de texte, libellés de jalons et nombres autorisés en sortie. */
export interface FaitsPourIa {
  lignes: string[];
  libelles: string[];
  nombres: number[];
}

/** Liste blanche des faits : tout vient du contenu du moteur, rien d'autre. */
export function faitsPourIa(c: ContenuAvancement): FaitsPourIa {
  const nombres: number[] = [];
  const lignes: string[] = [];
  const nb = (n: number) => {
    nombres.push(n);
    return String(n);
  };
  if (c.avancement.pourcentage === null) {
    lignes.push("Avancement physique : non mesurable.");
  } else {
    lignes.push(`Avancement physique : ${nb(c.avancement.pourcentage)} %.`);
  }
  const j = c.jalons;
  lignes.push(
    `Jalons : ${nb(j.total)} au total, ${nb(j.atteints.nombre)} atteints, ${nb(j.en_retard.nombre)} en retard, ${nb(j.a_venir.nombre)} à venir, ${nb(j.sans_date)} sans date.`,
  );
  const k = c.kpis;
  lignes.push(
    `Indicateurs : ${nb(k.total)} au total, ${nb(k.vert)} au vert, ${nb(k.orange)} à l'orange, ${nb(k.rouge)} au rouge, ${nb(k.non_evalue)} non évalués.`,
  );
  lignes.push(`Livrables partagés avec le client : ${nb(c.livrables.partages)}.`);
  const libelles: string[] = [];
  for (const [titre, liste] of [
    ["Jalons atteints", j.atteints],
    ["Jalons en retard", j.en_retard],
    ["Jalons à venir", j.a_venir],
  ] as const) {
    for (const e of liste.elements.slice(0, 10)) libelles.push(`${titre} : ${e.libelle}`);
  }
  return { lignes, libelles, nombres };
}

/** Consigne système : rôle borné, chiffres imposés, sortie JSON seule. */
export function consigneAvancement(): string {
  return [
    "Tu aides le chef de mission d'un cabinet de conseil à rédiger le commentaire de son rapport d'avancement hebdomadaire. Ton texte est un BROUILLON relu et corrigé par le chef avant toute diffusion.",
    "Règles :",
    "- Écris en français, 2 à 4 phrases factuelles et sobres, 600 caractères au plus.",
    "- N'emploie QUE les nombres du bloc de faits, tels quels. Aucun autre chiffre : ni date, ni montant, ni calcul, ni pourcentage dérivé.",
    "- N'invente aucun fait, aucune cause, aucune promesse ; ne mentionne ni coût, ni budget, ni marge.",
    '- Réponds UNIQUEMENT par un objet JSON {"commentaire": "<texte>"}, sans autre texte.',
    CONSIGNE_DONNEES_NON_FIABLES,
  ].join("\n");
}

const sortieSchema = z.object({ commentaire: z.string() }).strict();

function contenuJson(texte: string): unknown {
  const brut = texte.trim();
  const cloture = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(brut);
  return JSON.parse(cloture ? (cloture[1] as string) : brut);
}

/**
 * Valide la sortie du modèle : JSON strict, 1 à 600 caractères, aucun nombre hors liste blanche ni
 * jeton forgé (garde-chiffres). Renvoie le texte démasqué localement, ou null (rejet).
 */
export function lireSuggestion(
  texte: string,
  nombres: readonly number[],
  textesEntree: readonly string[],
  masque: Masque,
): string | null {
  let commentaire: string;
  try {
    const lu = sortieSchema.safeParse(contenuJson(texte));
    if (!lu.success) return null;
    commentaire = lu.data.commentaire.trim();
  } catch {
    return null;
  }
  if (commentaire.length === 0 || commentaire.length > TAILLE_MAX_SUGGESTION_AVANCEMENT)
    return null;
  const garde = verifierChiffres(commentaire, nombres, contexteGarde(textesEntree), masque);
  if (garde.chiffresNonVerifies) return null;
  const demasque = masque.demasquer(commentaire).trim();
  if (demasque.length === 0 || demasque.length > TAILLE_MAX_SUGGESTION_AVANCEMENT) return null;
  return demasque;
}

/**
 * Demande une suggestion de commentaire à l'orchestrateur. Ne lève JAMAIS : IA désactivée, droit
 * absent, clé absente, plafond atteint, erreur du fournisseur ou sortie rejetée => repli (aucun
 * commentaire). `auth` est l'utilisateur d'imputation (son droit « ia.utiliser » est vérifié).
 * Appelée HORS de la transaction de l'appelant : l'admission et le règlement ont leurs propres
 * transactions courtes (la réservation du plafond doit être visible des autres appels).
 */
export async function suggererCommentaire(
  deps: DependancesSuggestionAvancement,
  auth: Auth,
  contenu: ContenuAvancement,
  maintenant: Date,
): Promise<ResultatSuggestion> {
  const faits = faitsPourIa(contenu);
  let masque: Masque = creerMasque([]);
  let libellesMasques: string[] = [];
  try {
    const admission = await deps.database.withTenant(auth.cabinetId, (db: Db) =>
      admettreSansDemande(
        db,
        deps.ia,
        {
          tache: "redaction",
          utilisateur: auth,
          messages: async (tx) => {
            const neutre = faits.libelles.map((l) => neutraliserContenuClient(l));
            const { termes } = await termesNomsPropres(tx, auth.cabinetId, neutre.join("\n"));
            masque = creerMasque(termes);
            libellesMasques = neutre.map((l) => masque.masquer(l));
            const messages = [
              { role: "system" as const, content: consigneAvancement() },
              {
                role: "user" as const,
                content: [
                  "Faits de la semaine (chiffres du moteur de calcul) :",
                  ...faits.lignes,
                  ...(libellesMasques.length > 0
                    ? [
                        "Libellés des jalons :",
                        encadrerContenuClient(libellesMasques.join("\n"), "libelles_jalons"),
                      ]
                    : []),
                ].join("\n"),
              },
            ];
            return messages;
          },
        },
        maintenant,
      ),
    );
    if (admission.type === "repli") {
      return { type: "repli", raison: admission.raison, notifications: [] };
    }
    const r = await appelerSansDemande<string | null>(
      deps.database,
      deps.ia,
      auth.cabinetId,
      admission,
      (texte) => {
        let valeur: string | null = null;
        try {
          valeur = lireSuggestion(texte, faits.nombres, libellesMasques, masque);
        } catch {
          valeur = null;
        }
        return { valide: valeur !== null, valeur };
      },
      maintenant,
    );
    if (r.sortie.type === "echec") {
      return { type: "repli", raison: "echec", notifications: r.notifications };
    }
    if (r.sortie.valeur === null) {
      return { type: "repli", raison: "sortie_rejetee", notifications: r.notifications };
    }
    return { type: "ok", commentaire: r.sortie.valeur, notifications: r.notifications };
  } catch (erreur) {
    // Jamais de contenu dans l'incident : le code et le message technique de l'erreur seulement.
    journaliserIncident("avancement_commentaire_ia", erreur, { cabinet_id: auth.cabinetId });
    return { type: "repli", raison: "echec", notifications: [] };
  }
}
