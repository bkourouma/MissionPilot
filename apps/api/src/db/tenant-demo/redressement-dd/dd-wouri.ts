import type { ContexteTenantDemo } from "../contexte.js";
import { MISSIONS, acteursPour, assurerEquipe, trouverMission } from "./commun.js";
import { Datation, ecrire, lire } from "./dd-outils.js";
import type { Referentiel } from "./dd-referentiel.js";

/*
 * Dossier de due diligence de la mission 11 « Due diligence — Wouri Distribution » (statut
 * « proposition » : mission en préparation, démarrage le 26 octobre 2026). Les routes `/api/dd/**`
 * n'exigent qu'une mission visible et non clôturée : le dossier s'ouvre donc avant la signature.
 *
 * Dossier OUVERT, cadrage en cours (une seule version), quelques éléments en brouillon : trois
 * points d'analyse (affirmations présentées comme avis d'équipe à confirmer, sans preuve), une
 * étape de chaîne, un risque rattaché à un signal de la bibliothèque (constat « à vérifier »), une
 * hypothèse sans lien ni verdict et une action de plan. Aucun verdict, aucun dimensionnement,
 * aucun filtrage : rien n'est validé. Dates : la semaine précédant « aujourd'hui ».
 */

const AVIS =
  "Première lecture de l'équipe à partir du dossier de présentation ; à confirmer par des sources.";

function affirmation(enonce: string, classe: "R2" | "R3") {
  return {
    enonce,
    classe_risque: classe,
    avis_expert: true,
    avis_expert_motif: AVIS,
    signer_avis: false,
  };
}

export async function semerDdWouri(ctx: ContexteTenantDemo, ref: Referentiel): Promise<string> {
  const a = await acteursPour(ctx, MISSIONS.ddPreparation);
  const mission = await trouverMission(ctx, MISSIONS.ddPreparation);
  const existants = await lire<{ elements: unknown[] }>(
    a.consultant,
    `/api/missions/${mission.id}/dd/dossiers`,
    "dossiers existants",
  ).catch(() => ({ elements: [] as unknown[] }));
  if (existants.elements.length > 0) {
    throw new Error("La mission Wouri Distribution porte déjà un dossier de due diligence.");
  }
  await assurerEquipe(ctx, mission.id, [
    ctx.utilisateurs["consultant"] ?? "",
    ctx.utilisateurs["consultant.2"] ?? "",
    ctx.utilisateurs["expert.metier"] ?? "",
  ]);
  const dat = new Datation(ctx, ctx.dateAvant(6));
  await dat.relever();
  const portee = (dossierId: string) => ({ dossierId, missionId: mission.id });

  const dossier = await ecrire<{ id: string }>(
    a.consultant,
    `/api/missions/${mission.id}/dd/dossiers`,
    {
      titre: "Acquisition de Wouri Distribution",
      secteur_code: "citi_g",
      filiere_code: "commerce",
      pays_code: "cm",
      cible_nom: "Wouri Distribution",
      type_operation: "acquisition",
      devise: "XOF",
      date_operation: "2027-03-31",
      question_investissement: null,
      perimetre: "Activité de distribution en gros de produits de grande consommation à Douala.",
    },
    "dossier Wouri",
  );
  const d = dossier.id;
  await dat.dater(dat.jourIso(0), portee(d));

  // Chaîne de valeur : une étape en brouillon.
  await ecrire(
    a.consultant,
    `/api/dd/dossiers/${d}/chaine/etapes`,
    {
      libelle: "Importation et approvisionnement",
      description: "Achat de marchandises auprès de fabricants et d'importateurs.",
      ordre: 1,
      part_cout_bp: null,
      part_marge_bp: null,
      acteurs: ["Fabricants", "Importateurs"],
      contraintes: null,
    },
    "étape Wouri",
  );
  await dat.dater(dat.jourIso(1), portee(d));

  // Analyses en brouillon.
  const points = [
    [
      "pestel",
      "economique",
      "Pouvoir d'achat",
      "Le pouvoir d'achat des ménages de Douala conditionne les volumes vendus aux revendeurs.",
      "R2",
      "modere",
    ],
    [
      "cinq_forces",
      "pouvoir_clients",
      "Poids des revendeurs",
      "Les revendeurs les plus importants peuvent imposer des délais de paiement longs.",
      "R2",
      "eleve",
    ],
    [
      "swot",
      "faiblesses",
      "Gestion des stocks",
      "La gestion des stocks de marchandises semble peu outillée.",
      "R2",
      "modere",
    ],
  ] as const;
  const riskPoint: string[] = [];
  for (const [analyse, categorie, libelle, enonce, classe, niveau] of points) {
    const p = await ecrire<{ id: string; assertion_id: string }>(
      a.consultant,
      `/api/dd/dossiers/${d}/points`,
      { analyse, categorie, libelle, niveau, ...affirmation(enonce, classe) },
      `point ${analyse}.${categorie}`,
    );
    riskPoint.push(p.id);
  }
  await dat.dater(dat.jourIso(2), portee(d));

  // Risque rattaché à un signal de la bibliothèque, constat à vérifier.
  const signal = ref.signaux.get("oper-creances-distributeurs");
  const risque = await ecrire<{ id: string }>(
    a.consultant2,
    `/api/dd/dossiers/${d}/risques`,
    {
      famille: "operationnel",
      niveau: "eleve",
      libelle: "Délais de paiement longs accordés aux revendeurs",
      etape_id: null,
      signal_id: signal ?? null,
      ...affirmation(
        "Les délais de paiement accordés aux revendeurs pourraient dépasser soixante jours de ventes.",
        "R2",
      ),
    },
    "risque Wouri",
  );
  await dat.dater(dat.jourIso(3), portee(d));
  if (signal) {
    await ecrire(
      a.consultant2,
      `/api/dd/dossiers/${d}/signaux/${signal}/constats`,
      {
        etat: "a_verifier",
        commentaire: "Ancienneté des créances à contrôler dès réception de la balance âgée.",
        risque_id: risque.id,
      },
      "constat Wouri",
    );
    await dat.dater(dat.jourIso(3), portee(d));
  }

  // Hypothèse ouverte (sans lien, sans verdict) et action de plan.
  await ecrire(
    a.consultant,
    `/api/dd/dossiers/${d}/hypotheses`,
    {
      libelle: "Les ventes aux revendeurs croissent d'au moins 10 % par an",
      description: "Hypothèse de croissance du plan présenté par le vendeur.",
      critere: "Croissance observée sur trois exercices.",
      parent_id: null,
    },
    "hypothèse Wouri",
  );
  await dat.dater(dat.jourIso(4), portee(d));
  await ecrire(
    a.consultant,
    `/api/dd/dossiers/${d}/plan-100j/actions`,
    {
      libelle: "Auditer la balance âgée des revendeurs",
      description: "Premier chantier après l'opération, si elle est décidée.",
      jour_debut: 0,
      jour_fin: 30,
      statut_action: "a_faire",
      responsable_id: null,
    },
    "action Wouri",
  );
  await dat.dater(dat.jourIso(5), portee(d));
  ctx.journal("  DD Wouri : dossier ouvert (cadrage v1, éléments en brouillon, aucun verdict).");
  return d;
}
