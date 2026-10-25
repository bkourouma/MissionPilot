import type { Fil } from "./collaboration-donnees-types.js";

/*
 * Fils de commentaires des missions TERMINÉES et du pipeline (SOC-08). Textes internes au cabinet :
 * ni montant, ni coût, ni marge (FIN-02), rien qui doive atteindre le portail client. Les dates
 * sont calculées à partir de la période réelle de la mission (lot 2a) : une mission terminée est
 * commentée jusqu'à sa fin.
 */
export const FILS_TERMINEES: readonly Fil[] = [
  // --- Plan stratégique SICAFÉ ---------------------------------------------------------------
  {
    m: "sicafe-plan",
    cible: { opportunite: "Plan stratégique 2025-2028 — SICAFE" },
    q: 3,
    msgs: [
      {
        de: "assoc",
        t: "Premier échange avec le PDG de la SICAFÉ : il veut un plan à trois ans et une restitution devant son conseil. {@dir} je te propose de prendre la direction de la mission.",
      },
      {
        de: "dir",
        t: "D'accord. Je prépare la proposition avec {@chef}, en reprenant la démarche d'un autre groupe agro-industriel que nous avons accompagné.",
      },
    ],
  },
  {
    m: "sicafe-plan",
    cible: { tache: "Entretiens avec la direction" },
    q: 0.18,
    msgs: [
      {
        de: "c1",
        t: "Onze entretiens sur quatorze sont faits. Le directeur commercial n'est pas disponible avant la fin du mois, je propose un entretien téléphonique.",
        rev: "Douze entretiens sur quatorze sont faits (le directeur des opérations vient d'être vu). Le directeur commercial n'est pas disponible avant la fin du mois, je propose un entretien téléphonique.",
      },
      {
        de: "chef",
        t: "Accord pour le téléphone, mais bloque une heure complète. {@c1} dépose les comptes rendus dans la salle de mission au fil de l'eau.",
      },
    ],
  },
  {
    m: "sicafe-plan",
    cible: { tache: "Restitution du diagnostic" },
    q: 0.38,
    msgs: [
      {
        de: "chef",
        t: "Version finale du diagnostic prête pour relecture. {@dir} peux-tu valider les messages clés avant l'envoi au client ?",
      },
      {
        de: "dir",
        t: "Relu. La matrice SWOT est solide ; j'adoucirais en revanche la formulation sur la gouvernance familiale et je la présenterais en séance plutôt que par écrit.",
      },
      { de: "c3", t: "Je viens de relire aussi, rien à ajouter de mon côté.", sup: "auteur" },
    ],
  },
  {
    m: "sicafe-plan",
    cible: { tache: "Séminaire de validation" },
    q: 0.62,
    msgs: [
      {
        de: "dir",
        t: "Séminaire tenu : trois axes stratégiques retenus par le comité de direction. Le PDG demande de chiffrer l'axe export avant la restitution finale.",
      },
      {
        de: "assoc",
        t: "Très bien. Le chiffrage de l'axe export doit s'appuyer sur le modèle financier, pas sur des estimations de séance. {@chef} merci d'y veiller.",
      },
    ],
  },
  {
    m: "sicafe-plan",
    cible: "mission",
    q: 0.96,
    msgs: [
      {
        de: "dir",
        t: "Restitution finale faite, le plan est adopté par le comité de direction. Reste la facturation du solde, la capitalisation et la note de satisfaction du client.",
      },
      {
        de: "assoc",
        t: "Félicitations à toute l'équipe. {@chef} pense à lancer la demande de satisfaction avant la clôture.",
      },
    ],
  },
  // --- Notation financière Sahel Coton -------------------------------------------------------
  {
    m: "sahel-coton-notation",
    cible: { tache: "Collecte des états financiers" },
    q: 0.2,
    msgs: [
      {
        de: "c1",
        t: "Il manque encore les états 2022 et 2023 de Sahel Coton. Le DAF promet un envoi par courriel sous huit jours.",
      },
      {
        de: "chef",
        t: "Pas de scoring sans trois exercices complets : si rien n'arrive d'ici lundi, on prévient le client que le calendrier glisse. {@c1} tiens-moi au courant.",
      },
    ],
  },
  {
    m: "sahel-coton-notation",
    cible: { tache: "Comité de notation" },
    q: 0.8,
    msgs: [
      {
        de: "dir",
        t: "Comité de notation tenu : la note proposée est confirmée, avec une réserve sur la concentration de la clientèle. {@chef} intègre la réserve dans le rapport.",
      },
      {
        de: "chef",
        t: "C'est fait, la réserve figure en section 4. Relecture finale demain.",
        rev: "C'est fait, la réserve figure en section 5 du rapport. Relecture finale demain.",
      },
      {
        de: "c2",
        t: "Ce commentaire concerne la mission Mboa Solaire, je le reporte au bon endroit.",
        sup: "associe",
      },
    ],
  },
  // --- Redressement Brasseries du Wouri -------------------------------------------------------
  {
    m: "wouri-redressement",
    cible: "mission",
    q: 0.03,
    msgs: [
      {
        de: "dir",
        t: "Mission de redressement ouverte à la demande de la banque principale. Priorité absolue : la prévision de trésorerie à 13 semaines. {@chef} point quotidien à 8 h 30 pendant les deux premières semaines.",
      },
      {
        de: "chef",
        t: "Compris. J'ai demandé les relevés bancaires des six derniers mois, la banque répond demain.",
      },
    ],
  },
  {
    m: "wouri-redressement",
    cible: { tache: "Cartographie des créanciers" },
    q: 0.12,
    msgs: [
      {
        de: "c1",
        t: "Cartographie terminée : 43 créanciers dont 6 critiques (fournisseurs de malt et d'emballages). Tableau déposé dans la salle de mission.",
      },
      {
        de: "dir",
        t: "Parfait. Les six critiques passent en priorité dans la négociation. {@assoc} peux-tu appeler la banque avant jeudi ?",
      },
    ],
  },
  {
    m: "wouri-redressement",
    cible: { tache: "Validation du plan" },
    q: 0.62,
    msgs: [
      {
        de: "dir",
        t: "Comité de pilotage tenu, plan de redressement validé avec deux réserves sur le calendrier de cession d'actifs. {@chef} mets à jour le plan d'actions.",
      },
      {
        de: "chef",
        t: "Plan d'actions mis à jour. Prochain point avec la banque jeudi prochain.",
        rev: "Plan d'actions mis à jour et diffusé au comité. Prochain point avec la banque jeudi prochain.",
      },
    ],
  },
  {
    m: "wouri-redressement",
    cible: { tache: "Bilan de clôture" },
    q: 0.97,
    msgs: [
      {
        de: "dir",
        t: "Bilan de clôture présenté au dirigeant : les engagements pris avec la banque sont tenus, le redressement est considéré comme réussi.",
      },
    ],
  },
  // --- Due diligence Mboa Solaire -------------------------------------------------------------
  {
    m: "mboa-dd",
    cible: { tache: "Lettre d'engagement" },
    q: 0.02,
    msgs: [
      {
        de: "dir",
        t: "Lettre d'engagement signée. Périmètre limité à la cible solaire du Cameroun, hors filiale sénégalaise. {@chef} reporte ce point dans la note de cadrage.",
      },
      { de: "chef", t: "Noté et reporté dans la note de cadrage." },
    ],
  },
  {
    m: "mboa-dd",
    cible: { tache: "Revue juridique" },
    q: 0.5,
    msgs: [
      {
        de: "exp",
        t: "Contrat d'achat d'électricité avec l'opérateur public : clause de changement de contrôle à signaler dans le rapport.",
      },
      {
        de: "dir",
        t: "Bien vu, à classer en risque majeur dans la synthèse. {@chef} fais confirmer par écrit par l'avocat partenaire.",
      },
    ],
  },
  {
    m: "mboa-dd",
    cible: { tache: "Présentation au comité d'investissement" },
    q: 0.97,
    msgs: [
      {
        de: "dir",
        t: "Présentation faite au comité d'investissement, décision attendue la semaine prochaine. Merci à tous pour le travail sous pression.",
      },
    ],
  },
  // --- Business plan bancable Atlantique Retail ---------------------------------------------
  {
    m: "atlantique-bp",
    cible: { tache: "Étude de marché et hypothèses" },
    q: 0.3,
    msgs: [
      {
        de: "c1",
        t: "Le dirigeant tient à une croissance de 18 % par an, ce qui me paraît élevé au regard du marché. Je prépare deux scénarios pour en discuter.",
        rev: "Le dirigeant tient à une croissance de 15 % par an, ce qui me paraît élevé au regard du marché. Je prépare deux scénarios pour en discuter.",
      },
      {
        de: "dir",
        t: "Présente d'abord le scénario prudent : le dirigeant doit comprendre pourquoi les banques exigeront des hypothèses réalistes.",
      },
    ],
  },
  {
    m: "atlantique-bp",
    cible: { tache: "Analyse de la capacité de remboursement" },
    q: 0.55,
    msgs: [
      {
        de: "chef",
        t: "Les ratios attendus par les financeurs sont respectés dans le scénario central, mais pas dans le scénario bas. {@dir} on le dit tel quel dans le dossier ?",
      },
      {
        de: "dir",
        t: "Oui, avec les mesures d'atténuation prévues. Mieux vaut un dossier honnête qu'un refus motivé par une omission.",
      },
    ],
  },
  {
    m: "atlantique-bp",
    cible: "mission",
    q: 0.98,
    msgs: [
      {
        de: "chef",
        t: "Dossier remis au dirigeant. Trois guichets identifiés, un rendez-vous est déjà pris avec la banque partenaire.",
      },
    ],
  },
];
