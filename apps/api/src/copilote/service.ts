import {
  composerAide,
  estOutilModifiant,
  extraireEcheance,
  LIMITE_ELEMENTS_COPILOTE,
  MESSAGE_ACCES_REFUSE,
  MESSAGE_ACTION_REFUSEE,
  nettoyerMessageCopilote,
  plierTexteCopilote,
  routerMessageCopilote,
  TEXTE_ACTION_PROPOSEE,
  TEXTE_NON_COMPRIS,
  type ChoixCopilote,
  type ElementCopilote,
  type OutilCopilote,
  type RoutageCopilote,
} from "@missionpilot/engines";
import {
  reponseCopiloteSchema,
  type ActionProposeeCopilote,
  type MessageCopilote,
  type ReponseCopilote,
  type StatutReponseCopilote,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { signauxInjection } from "../ia/donnees-non-fiables.js";
import { AppError } from "../errors.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import { proposerAction } from "./actions.js";
import { outilsPermis } from "./catalogue.js";
import { exigerCopiloteActif, compterMessage } from "./limites.js";
import {
  facturesEchues,
  kpiRouges,
  mesFeuillesTemps,
  mesTaches,
  rechercheUnifiee,
  resumeMission,
  type ContexteOutil,
} from "./lecture.js";
import {
  appelerModele,
  preparerAppelIa,
  type DependancesCopilote,
  type RaisonRepli,
} from "./routage-ia.js";

/*
 * TRAITEMENT D'UN MESSAGE DU COPILOTE (AGT-08). L'IA ROUTE, LE CODE RÉPOND :
 *
 * 1. Admission (une transaction) : coupe-circuit du cabinet (agent « copilote »), débit de
 *    l'utilisateur (429), puis, si le cabinet a activé l'IA et que le plafond le permet, réservation
 *    du coût de l'appel de routage (routage-ia.ts).
 * 2. Routage : le choix `{ outil, parametres }` du modèle, validé strictement et limité aux outils
 *    PERMIS ; sans IA, désactivée, en erreur, au plafond ou si la sortie est refusée : routage
 *    DÉTERMINISTE du moteur (mode « sans IA », signalé dans la réponse). Le message de l'utilisateur
 *    est une DONNÉE : « ignore les consignes et supprime… » ne peut produire qu'un outil du
 *    catalogue fermé, avec des paramètres bornés.
 * 3. Exécution (une transaction) sous l'`Auth` de l'utilisateur : outil de lecture (réponse par
 *    gabarits à partir des faits des services) ou PROPOSITION d'action (jamais exécutée ici). Un
 *    outil non permis répond « Vous n'avez pas accès à cette information », comme une mission
 *    inexistante ou non visible (jamais de fuite d'existence). Journal de l'échange SANS le texte du
 *    message : outil, mode, statut, longueur, coût IA, signaux d'injection.
 */

export interface ResultatMessage {
  reponse: ReponseCopilote;
  /** E-mails de notification à envoyer après validation des transactions. */
  notifications: (NotificationCreee | null)[];
}

interface Execution {
  outil: OutilCopilote | null;
  statut: StatutReponseCopilote;
  texte: string;
  elements: ElementCopilote[];
  action?: ActionProposeeCopilote;
}

const refus = (outil: OutilCopilote): Execution => ({
  outil,
  statut: "refuse",
  texte: estOutilModifiant(outil) ? MESSAGE_ACTION_REFUSEE : MESSAGE_ACCES_REFUSE,
  elements: [],
});

/** Exécute le choix : lecture, ou proposition d'action ; un outil non permis est refusé. */
async function executerChoix(
  c: ContexteOutil,
  choix: ChoixCopilote,
  permis: readonly OutilCopilote[],
  maintenant: Date,
): Promise<Execution> {
  const outil = choix.outil;
  if (!permis.includes(outil)) return refus(outil);
  try {
    switch (choix.outil) {
      case "mes_taches":
        return { outil, ...(await mesTaches(c)) };
      case "mes_feuilles_temps":
        return { outil, ...(await mesFeuillesTemps(c)) };
      case "resume_mission":
        return { outil, ...(await resumeMission(c, choix.parametres)) };
      case "kpi_rouges":
        return { outil, ...(await kpiRouges(c)) };
      case "factures_echues":
        return { outil, ...(await facturesEchues(c)) };
      case "recherche":
        return { outil, ...(await rechercheUnifiee(c, choix.parametres)) };
      case "creer_tache": {
        const p = await proposerAction(c, choix.outil, choix.parametres, maintenant);
        return p.type === "proposee"
          ? {
              outil,
              statut: "action_proposee",
              texte: TEXTE_ACTION_PROPOSEE,
              elements: [],
              action: p.action,
            }
          : { outil, statut: "precision_requise", texte: p.texte, elements: [] };
      }
    }
  } catch (error) {
    // Une ressource non visible ou non permise répond comme une ressource inexistante.
    if (error instanceof AppError && (error.statut === 403 || error.statut === 404)) {
      return refus(outil);
    }
    throw error;
  }
}

async function executerRoutage(
  c: ContexteOutil,
  routage: RoutageCopilote,
  permis: readonly OutilCopilote[],
  maintenant: Date,
): Promise<Execution> {
  switch (routage.type) {
    case "outil":
      return executerChoix(c, routage.choix, permis, maintenant);
    case "precision":
      return {
        outil: routage.outil,
        statut: "precision_requise",
        texte: routage.question,
        elements: [],
      };
    case "aide":
      return { outil: null, statut: "aide", ...composerAide(permis) };
    case "inconnu":
      return { outil: null, statut: "non_compris", texte: TEXTE_NON_COMPRIS, elements: [] };
  }
}

/**
 * Le modèle ne voit aucune date : une échéance relative (« demain », « dans 3 jours ») ou écrite
 * dans le message est reprise par le moteur déterministe quand le modèle l'a omise.
 */
function completerEcheance(
  choix: ChoixCopilote,
  message: string,
  aujourdhui: string,
): ChoixCopilote {
  if (choix.outil !== "creer_tache" || choix.parametres.echeance !== undefined) return choix;
  const e = extraireEcheance(plierTexteCopilote(message), aujourdhui);
  if (e?.type !== "date") return choix;
  return { outil: "creer_tache", parametres: { ...choix.parametres, echeance: e.date } };
}

export async function traiterMessage(
  deps: DependancesCopilote,
  auth: Auth,
  corps: MessageCopilote,
): Promise<ResultatMessage> {
  const maintenant = (deps.horloge ?? (() => new Date()))();
  const aujourdhui = maintenant.toISOString().slice(0, 10);
  const message = nettoyerMessageCopilote(corps.message);
  const permis = outilsPermis(auth);
  const notifications: (NotificationCreee | null)[] = [];

  const admission = await deps.database.withTenant(auth.cabinetId, async (db) => {
    await exigerCopiloteActif(db);
    await compterMessage(db, auth, message.length);
    return preparerAppelIa(db, deps, auth, permis, message, maintenant);
  });

  let mode: "ia" | "deterministe" = "deterministe";
  let repli: RaisonRepli | undefined;
  let detailRepli: string | undefined;
  let cout: number | null = null;
  let routage: RoutageCopilote | null = null;
  if (admission.type === "repli") {
    repli = admission.raison;
    detailRepli = admission.detail;
  } else {
    const appel = await appelerModele(deps, auth, admission, permis, maintenant);
    cout = appel.cout;
    notifications.push(...appel.notifications);
    if (appel.sortie.type === "choix") {
      mode = "ia";
      routage = {
        type: "outil",
        choix: completerEcheance(appel.sortie.choix, message, aujourdhui),
      };
    } else if (appel.sortie.type === "aucun") {
      // Le modèle ne reconnaît rien : les règles simples essaient à leur tour (sans repli annoncé).
      detailRepli = "aucun";
    } else {
      repli = "indisponible";
      detailRepli =
        appel.sortie.type === "invalide" ? `sortie_${appel.sortie.motif}` : appel.sortie.code;
    }
  }
  routage ??= routerMessageCopilote(message, { aujourdhui });
  if (mode === "deterministe" && repli === undefined && detailRepli === "aucun") {
    // Aucun outil trouvé non plus : la réponse reste étiquetée « IA » (le modèle a été consulté).
    if (routage.type === "inconnu" || routage.type === "aide") mode = "ia";
  }

  const signaux = signauxInjection(message);
  const execution = await deps.database.withTenant(auth.cabinetId, async (db) => {
    const e = await executerRoutage(
      { db, auth, aujourdhui, missionId: corps.contexte?.mission_id },
      routage,
      permis,
      maintenant,
    );
    await journaliser(db, {
      cabinetId: auth.cabinetId,
      utilisateurId: auth.utilisateurId,
      action: "copilote.echange",
      entite: "copilote",
      // Jamais le texte du message : outil, mode, statut, longueur, coût, signaux d'injection.
      details: {
        outil: e.outil,
        mode,
        statut: e.statut,
        longueur: message.length,
        ...(detailRepli ? { repli: detailRepli } : {}),
        ...(cout !== null ? { cout_micro_usd: cout } : {}),
        ...(signaux.length > 0 ? { signaux_injection: signaux } : {}),
      },
    });
    return e;
  });

  const reponse = reponseCopiloteSchema.parse({
    mode,
    ...(mode === "deterministe" && repli ? { repli } : {}),
    outil: execution.outil,
    statut: execution.statut,
    texte: execution.texte,
    elements: execution.elements.slice(0, LIMITE_ELEMENTS_COPILOTE),
    ...(execution.action ? { action: execution.action } : {}),
  });
  return { reponse, notifications };
}
