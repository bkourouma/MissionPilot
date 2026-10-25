/*
 * Textes du module « avancement » du seed Tenant démo. Ce sont des notes de chef de mission (ou un
 * gabarit déterministe pour la suggestion « IA » : aucune clé, aucun réseau). Elles ne portent
 * AUCUN chiffre : les chiffres du rapport sortent du moteur `composerAvancementHebdo`.
 */

export const INTRODUCTIONS: readonly string[] = [
  "Bonjour, voici le point de la semaine sur votre mission. Les travaux se poursuivent conformément au calendrier convenu avec votre équipe.",
  "Bonjour, ce rapport résume l'avancement de la semaine écoulée : les jalons atteints, ceux à venir et l'état des indicateurs suivis avec vous.",
  "Bonjour, point hebdomadaire de la mission. Nous restons à votre disposition pour revenir sur n'importe quel élément lors de notre prochain échange.",
  "Bonjour, vous trouverez ci-dessous l'état d'avancement de la semaine. Merci à vos équipes pour leur disponibilité lors des derniers entretiens.",
  "Bonjour, voici notre rapport d'avancement hebdomadaire. Les points d'attention éventuels sont signalés dans les indicateurs.",
];

export const COMMENTAIRES: readonly string[] = [
  "La semaine a été consacrée à la consolidation des informations recueillies auprès de vos équipes. Nous préparons la prochaine restitution.",
  "Les entretiens prévus ont été menés et leurs enseignements sont en cours d'intégration dans le livrable. Aucun point bloquant à signaler.",
  "Nous avons échangé avec votre direction sur les priorités de la période. Les ajustements convenus sont intégrés au planning de la mission.",
  "Les données complémentaires demandées ont bien été reçues, ce qui nous permet de poursuivre l'analyse sans retard.",
  "Une réunion de cadrage est prévue prochainement pour valider les hypothèses de travail avant la phase suivante.",
  "Les indicateurs en alerte font l'objet d'un suivi rapproché ; nous vous proposerons des actions correctives lors du prochain point.",
  "La coordination avec vos équipes se passe bien. Nous vous remercions de nous transmettre les derniers documents en attente.",
  "Le livrable en cours de rédaction sera relu en interne avant transmission. Nous vous tiendrons informés de la date de remise.",
];

/** Suggestion de commentaire par gabarit déterministe (statut « brouillon IA », à relire par le chef). */
export const COMMENTAIRE_IA_GABARIT =
  "Proposition de commentaire (gabarit, à relire) : la semaine est marquée par la poursuite des travaux en cours. Les jalons à venir et les indicateurs en alerte sont listés dans le rapport ; le chef de mission précisera les points à discuter avec le client avant validation.";
