import type { ContexteTenantDemo } from "../contexte.js";
import { activerCompteWhatsapp, lireComptes, preparerContacts } from "./canaux-comptes.js";
import { executerTaches, ouvrirContexteCanaux } from "./canaux-contexte.js";
import { semerEnvoisBloques, semerEnvoisHistoriques } from "./canaux-envois.js";
import { assurerKpiMessagerie, assurerQuestionnaire } from "./canaux-kpi.js";
import { semerSaisiesKpi, semerStop } from "./canaux-saisies.js";
import { semerSignatures } from "./canaux-signatures.js";
import { semerTranscriptions } from "./canaux-transcriptions.js";
import { missionDuCasting } from "./outils.js";

/*
 * Module « canaux » de la phase « appels-offres-canaux » : canaux externes SIMULÉS du cabinet
 * (WhatsApp simulé actif, SMS non configuré), numéros de test vérifiés et consentements, journal
 * d'envois, saisies de KPI par messagerie, transcriptions de réunions et signatures électroniques
 * LOCALES. AUCUN envoi réel, aucune clé, aucun appel réseau : fournisseurs simulés ou locaux,
 * numéros de test du simulateur, audio synthétique, messages dans la boîte en mémoire du processus.
 * Chaque libellé visible porte la mention « DÉMONSTRATION ». Rejouable sans doublon (voir chaque
 * étape).
 *
 * Ordre : KPI et questionnaire (avant l'activation : ni alerte ni relance parasite), compte et
 * contacts, signatures (leurs décisions en attente alimentent la synthèse du dirigeant), journal
 * d'envois HISTORIQUE (avant tout envoi daté d'aujourd'hui : les plafonds par destinataire se
 * comptent sur toutes les lignes plus récentes), transcriptions, saisies de KPI par message (les
 * alertes sortantes partent à la reprise), STOP d'un contact en dernier puis envois refusés.
 */
export async function semerCanaux(ctx: ContexteTenantDemo): Promise<void> {
  const { cc, fermer } = await ouvrirContexteCanaux(ctx);
  try {
    ctx.journal("    canaux : KPI alimentés par message et questionnaire…");
    await assurerKpiMessagerie(cc);
    const questionnaire = await assurerQuestionnaire(cc);

    ctx.journal("    canaux : compte WhatsApp simulé et contacts…");
    await activerCompteWhatsapp(cc);
    const destinataires = await preparerContacts(cc);

    ctx.journal("    canaux : signatures électroniques locales…");
    const sicafe = await missionDuCasting(ctx, "planSicafe");
    await semerSignatures(cc, sicafe.clientId);
    await executerTaches(cc);

    ctx.journal("    canaux : journal d'envois historique…");
    await semerEnvoisHistoriques(cc, destinataires, questionnaire);

    ctx.journal("    canaux : transcriptions de réunions…");
    await semerTranscriptions(cc);

    ctx.journal("    canaux : messages entrants (saisies de KPI, STOP)…");
    await semerSaisiesKpi(cc, destinataires);
    await semerStop(cc, destinataires, "dirigeant.client.2");
    await semerEnvoisBloques(cc, destinataires, questionnaire);
    await executerTaches(cc);

    const wa = (await lireComptes(cc)).find((c) => c.canal === "whatsapp");
    if (!wa?.actif || !wa.alerte_kpi || !wa.saisie_kpi) {
      throw new Error("Le compte WhatsApp simulé n'a pas les options attendues.");
    }
  } finally {
    await fermer();
  }
}
