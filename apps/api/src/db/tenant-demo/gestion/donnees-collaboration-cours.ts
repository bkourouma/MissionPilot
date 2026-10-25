import type { Fil } from "./collaboration-donnees-types.js";

/*
 * Fils de commentaires des missions EN COURS, de la mission signée, de celle en préparation et du
 * pipeline commercial (SOC-08). Internes au cabinet : ni montant, ni coût, ni marge (FIN-02).
 */
export const FILS_EN_COURS: readonly Fil[] = [
  // --- Plan stratégique Baobab Assurances ----------------------------------------------------
  {
    m: "baobab-plan",
    cible: "mission",
    q: 0.03,
    msgs: [
      {
        de: "dir",
        t: "Lancement fait avec le directeur général de Baobab Assurances : le conseil d'administration attend le plan avant la fin de l'année. {@chef} tout retard se répercute sur la restitution finale.",
      },
      {
        de: "chef",
        t: "Compris. Le planning garde deux semaines de marge et je ne les consomme pas.",
      },
    ],
  },
  {
    m: "baobab-plan",
    cible: { tache: "Entretiens avec la direction" },
    q: 0.25,
    msgs: [
      {
        de: "c1",
        t: "Le directeur technique reporte son entretien pour la deuxième fois. Je le relance par son assistante.",
      },
      {
        de: "chef",
        t: "Insiste, son avis est central pour l'axe produits. {@c1} propose-lui un créneau en visioconférence.",
      },
    ],
  },
  {
    m: "baobab-plan",
    cible: { tache: "Rapport de diagnostic" },
    q: 0.55,
    msgs: [
      {
        de: "c2",
        t: "Première version de la matrice SWOT déposée. Le point faible sur la distribution digitale mérite quelques cas concrets.",
      },
      {
        de: "dir",
        t: "Bonne base. À traiter avant la restitution du diagnostic : la gouvernance du comité de direction reste à nuancer.",
      },
    ],
  },
  {
    m: "baobab-plan",
    cible: { tache: "Séminaire de validation" },
    q: 0.92,
    msgs: [
      { de: "dir", t: "Séminaire de validation fixé au 13 octobre. {@assoc} ouvrira la séance." },
      {
        de: "assoc",
        t: "Confirmé. Je rencontre le président du conseil la veille pour caler les messages.",
      },
      { de: "c3", t: "Message publié par erreur sur cette mission.", sup: "auteur" },
    ],
  },
  // --- Redressement Gabon Offshore Services (régie) --------------------------------------------
  {
    m: "gabon-redressement",
    cible: "mission",
    q: 0.05,
    msgs: [
      {
        de: "dir",
        t: "Mission en régie : le client veut une présence soutenue chez lui. {@chef} organise la rotation des consultants pour rester dans le temps convenu.",
      },
      { de: "chef", t: "Rotation à deux consultants, un jour sur site par semaine chacun." },
    ],
  },
  {
    m: "gabon-redressement",
    cible: { tache: "Revue de la trésorerie" },
    q: 0.2,
    msgs: [
      {
        de: "c1",
        t: "Prévision de trésorerie à 13 semaines produite. Les encaissements clients sont très incertains : trois gros clients paient avec plus de 90 jours de retard.",
      },
      {
        de: "dir",
        t: "Mets cet élément en avant au comité : tout le plan de financement en dépend.",
      },
    ],
  },
  {
    m: "gabon-redressement",
    cible: { tache: "Négociation complémentaire" },
    q: 0.6,
    msgs: [
      {
        de: "chef",
        t: "Le pool bancaire demande un point mensuel et un reporting de trésorerie hebdomadaire. Le client accepte.",
      },
      {
        de: "c2",
        t: "Je prépare le modèle de reporting hebdomadaire, première version vendredi.",
        rev: "Je prépare le modèle de reporting hebdomadaire, première version jeudi.",
      },
    ],
  },
  {
    m: "gabon-redressement",
    cible: "mission",
    q: 0.85,
    msgs: [
      {
        de: "assoc",
        t: "Point d'attention : le temps consommé dépasse nettement ce qui était prévu. {@dir} il faut en parler au client avant la fin du mois.",
      },
      {
        de: "dir",
        t: "J'en parle au directeur général cette semaine et je propose un recentrage du périmètre ou un avenant.",
      },
      {
        de: "c3",
        t: "Note interne à ne pas conserver : voir les échanges avec le client par courriel.",
        sup: "associe",
      },
    ],
  },
  // --- Notation Banque du Sahel (portefeuille PME) ---------------------------------------------
  {
    m: "banque-sahel-notation",
    cible: { tache: "Collecte des états financiers" },
    q: 0.2,
    msgs: [
      {
        de: "c1",
        t: "Sur les quinze PME de l'extension, onze ont envoyé leurs états. Quatre sont relancées.",
      },
      {
        de: "chef",
        t: "Relance par téléphone via le chargé de clientèle de la banque. {@c1} prépare la liste des pièces manquantes par PME.",
      },
    ],
  },
  {
    m: "banque-sahel-notation",
    cible: { tache: "Extension à quinze PME" },
    q: 0.4,
    msgs: [
      {
        de: "dir",
        t: "L'extension est actée par avenant. Elle ne change pas la méthode de notation mais décale le calendrier du comité.",
      },
      {
        de: "c2",
        t: "Les grilles sectorielles sont à jour pour les secteurs ajoutés (transport et commerce de détail).",
      },
    ],
  },
  {
    m: "banque-sahel-notation",
    cible: { tache: "Calcul des ratios" },
    q: 0.7,
    msgs: [
      {
        de: "c3",
        t: "Écart de cohérence sur trois PME entre le bilan et la liasse fiscale. Je préviens {@chef} avant de scorer.",
      },
      {
        de: "chef",
        t: "Ne note pas ces trois dossiers tant que le client n'a pas confirmé la version définitive des états.",
      },
    ],
  },
  // --- Diagnostic flash Teranga Logistique -----------------------------------------------------
  {
    m: "teranga-flash",
    cible: "mission",
    q: 0.1,
    msgs: [
      {
        de: "dir",
        t: "Diagnostic flash de trois semaines : on reste sur l'essentiel, rapport court de dix pages au plus. {@chef} vérifie que les priorités d'action tiennent sur une page.",
      },
      { de: "chef", t: "Bien noté, le plan du rapport a été validé ce matin avec le dirigeant." },
    ],
  },
  {
    m: "teranga-flash",
    cible: { tache: "Entretien avec le dirigeant" },
    q: 0.4,
    msgs: [
      {
        de: "c1",
        t: "Le dirigeant est très ouvert mais ne veut pas que les constats sur la flotte sortent de la direction. Je le note pour la restitution.",
      },
      {
        de: "dir",
        t: "Respecte sa demande : le constat figure dans le rapport remis à lui seul.",
      },
    ],
  },
  // --- Mission signée et mission en préparation -----------------------------------------------
  {
    m: "sicafe-export-plan",
    cible: "mission",
    q: 0.5,
    msgs: [
      {
        de: "dir",
        t: "Mission signée, démarrage prévu le 9 novembre. {@chef} prépare la réunion de lancement avec la direction de Sicafe Export.",
      },
      {
        de: "chef",
        t: "Dossier de démarrage en cours : lettre de mission déposée, liste des documents à demander en préparation.",
      },
    ],
  },
  {
    m: "wouri-dd",
    cible: { opportunite: "Due diligence — Wouri Distribution" },
    q: 2,
    msgs: [
      {
        de: "assoc",
        t: "Le dirigeant de Brasseries du Wouri souhaite une revue de sa filiale de distribution avant une cession partielle. Dossier sensible : accès limité à l'équipe.",
      },
      {
        de: "dir",
        t: "Entendu. Proposition envoyée, nous attendons la signature de la lettre d'engagement.",
      },
    ],
  },
  // --- Pipeline commercial -----------------------------------------------------------------------
  {
    m: "teranga-flash",
    cible: { opportunite: "Audit organisationnel — Teranga Logistique" },
    q: 20,
    msgs: [
      {
        de: "dir",
        t: "Perdu face à un cabinet local mieux implanté. Leçon : mettre en avant nos références logistiques dès la première réunion.",
      },
    ],
  },
  {
    m: "sahel-coton-notation",
    cible: { opportunite: "Notation financière — Sahel Coton (revue annuelle)" },
    q: 6,
    msgs: [
      {
        de: "assoc",
        t: "Revue annuelle : le client est satisfait de la première notation, il faut proposer le renouvellement avant la fin de l'année.",
      },
    ],
  },
  {
    m: "mboa-dd",
    cible: { proposition: "Business plan bancable — Mboa Solaire (extension de capacité)" },
    q: 4,
    msgs: [
      {
        de: "dir",
        t: "Proposition envoyée pour l'extension de capacité de Mboa Solaire ; le client attend l'accord de ses actionnaires.",
      },
    ],
  },
];
