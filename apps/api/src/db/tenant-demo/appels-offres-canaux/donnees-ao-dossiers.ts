/*
 * Cahiers des charges FICTIFS des appels d'offres du Tenant démo (texte collé dans le dossier).
 * Chaque ligne numérotée porte une exigence que le découpage déterministe du moteur sait relever.
 */

const ADMINISTRATIF = [
  "3.1 Le soumissionnaire doit joindre un extrait du registre du commerce (RCCM) de moins de trois mois.",
  "3.2 Le soumissionnaire doit fournir une attestation fiscale et une attestation de régularité à la sécurité sociale en cours de validité.",
  "3.3 La lettre de soumission doit être signée par un représentant habilité, pouvoir joint.",
  "3.4 L'offre doit rester valable cent vingt jours à compter de la date limite de dépôt.",
];

const SPECIFIQUE: Record<string, string[]> = {
  "sicafe-plan": [
    "4.1 L'offre technique doit présenter la méthodologie de cascade d'objectifs de la holding vers les deux filiales.",
    "4.2 Le soumissionnaire doit justifier d'au moins trois missions similaires de plan stratégique pour des groupes industriels au cours des cinq dernières années.",
    "4.3 Le chef de mission doit justifier de dix ans d'expérience en planification stratégique et fournir son CV signé.",
    "4.4 Le chronogramme doit prévoir une restitution à la direction générale à mi-parcours.",
    "5.1 L'offre financière doit être présentée en FCFA hors taxes avec le détail des honoraires par expert.",
    "6.1 Il est souhaitable de fournir une expérience dans la filière agro-industrielle de la zone UEMOA.",
  ],
  "banque-pme-etude": [
    "4.1 L'offre technique doit décrire la méthodologie d'enquête auprès d'au moins soixante PME agricoles.",
    "4.2 Le soumissionnaire doit présenter au moins deux références d'études de produits de financement pour des banques.",
    "4.3 L'équipe doit comprendre un expert en finance agricole justifiant de huit ans d'expérience, CV à l'appui.",
    "4.4 Le rapport final doit être remis en français avec une synthèse de dix pages au plus.",
    "5.1 L'offre financière doit être libellée en FCFA et distinguer honoraires et frais de terrain.",
    "6.1 Il est souhaitable de fournir une attestation de bonne exécution délivrée par une institution financière.",
  ],
  "mboa-dd": [
    "4.1 L'offre technique doit détailler l'approche de revue financière, opérationnelle et contractuelle.",
    "4.2 Le soumissionnaire doit fournir au moins deux références de due diligence dans le secteur de l'énergie.",
    "4.3 Le directeur de mission doit justifier de douze ans d'expérience en transactions et fournir son CV.",
    "4.4 Le calendrier doit prévoir un rapport préliminaire avant la fin de la quatrième semaine.",
    "5.1 L'offre financière doit être exprimée en FCFA (XAF) hors taxes, honoraires et frais séparés.",
    "6.1 Il est souhaitable de fournir une attestation de confidentialité signée par chaque expert.",
  ],
  "retail-abandon": [
    "4.1 L'offre technique doit comprendre une proposition de gouvernance de la centrale d'achats.",
    "4.2 Le soumissionnaire doit présenter des références de structuration de centrales d'achats ou de groupements.",
    "4.3 L'équipe doit inclure un expert en distribution justifiant de dix ans d'expérience.",
    "5.1 L'offre financière doit être établie en FCFA et couvrir le business plan à cinq ans.",
  ],
  "gouvernance-publique": [
    "4.1 L'offre technique doit proposer une méthodologie de diagnostic de la programmation des investissements publics.",
    "4.2 Le soumissionnaire doit justifier d'au moins deux missions similaires auprès d'administrations publiques.",
    "4.3 L'équipe clé doit comprendre un expert en finances publiques gabonaises, CV signé exigé.",
    "4.4 Le plan de travail doit prévoir des ateliers de restitution avec la direction du budget.",
    "5.1 L'offre financière doit être présentée en FCFA (XAF) avec le bordereau des prix détaillé.",
    "6.1 Il est souhaitable de fournir une expérience du cadre budgétaire de la zone CEMAC.",
  ],
  "baobab-plan": [
    "4.1 L'offre technique doit présenter la démarche d'élaboration du plan stratégique 2026-2030 et du modèle financier.",
    "4.2 Le soumissionnaire doit justifier d'au moins trois références de plans stratégiques dans l'assurance ou la banque.",
    "4.3 Le chef de mission doit justifier de dix ans d'expérience et fournir son CV ainsi que ceux de l'équipe.",
    "4.4 Le livrable doit comprendre un tableau de bord de pilotage opérationnel.",
    "5.1 L'offre financière doit être établie en FCFA hors taxes et ventilée par phase.",
    "6.1 Il est souhaitable de fournir une maîtrise de la réglementation de la zone CIMA.",
  ],
  "cemac-formation": [
    "4.1 L'offre technique doit détailler la méthode de diagnostic flash des quarante PME exportatrices.",
    "4.2 Le soumissionnaire doit fournir au moins trois références de programmes d'accompagnement de PME.",
    "4.3 L'équipe doit comprendre quatre formateurs certifiés, CV et diplômes à l'appui.",
    "4.4 Le programme doit prévoir un suivi à six mois de chaque entreprise accompagnée.",
    "5.1 L'offre financière doit être présentée en FCFA (XAF) avec le coût unitaire par entreprise.",
    "5.2 Une garantie de soumission doit être constituée auprès d'une banque agréée.",
    "6.1 Il est souhaitable de fournir une expérience d'accompagnement à l'export dans la zone CEMAC.",
  ],
};

/** Texte du cahier des charges d'un appel d'offres (absent pour l'appel abandonné avant réponse). */
export function texteDossierAo(cle: string, titre: string, bailleur: string): string {
  const specifiques = SPECIFIQUE[cle];
  if (!specifiques) throw new Error(`Aucun cahier des charges prévu pour « ${cle} ».`);
  return [
    `Cahier des charges — ${titre}`,
    `Autorité contractante : ${bailleur}.`,
    "Article 3 — Conditions de participation",
    ...ADMINISTRATIF,
    "Article 4 — Offre technique",
    ...specifiques.filter((l) => l.startsWith("4.")),
    "Article 5 — Offre financière",
    ...specifiques.filter((l) => l.startsWith("5.")),
    "Article 6 — Éléments appréciés",
    ...specifiques.filter((l) => l.startsWith("6.")),
  ].join("\n");
}
