import { attendre, type ContexteTenantDemo } from "../contexte.js";

/*
 * Dictionnaire de données du cabinet (STD-10), facteurs de contexte propres au cabinet (STD-04) et
 * notes de contexte (STD-06), par les routes `/api/standard/**`. Ajout seul : le standard n'est jamais
 * écrasé. Rejouable : chaque entrée est retrouvée par sa clé naturelle avant d'être créée.
 */

const TAXONOMIES: { taxonomie: string; code: string; libelle: string; description: string }[] = [
  {
    taxonomie: "filiere",
    code: "peche_artisanale",
    libelle: "Pêche artisanale et transformation du poisson",
    description: "Pirogues, mareyage, fumage et séchage ; saisonnalité forte.",
  },
  {
    taxonomie: "filiere",
    code: "economie_numerique",
    libelle: "Économie numérique et paiements mobiles",
    description: "Opérateurs de monnaie mobile, plateformes et services associés.",
  },
  {
    taxonomie: "filiere",
    code: "logistique_portuaire",
    libelle: "Logistique portuaire et transit",
    description: "Manutention, transit, entreposage sous douane et transport routier.",
  },
  {
    taxonomie: "kpi",
    code: "delai_recouvrement",
    libelle: "Délai de recouvrement des créances clients",
    description: "Famille d'indicateurs de trésorerie suivis par le cabinet.",
  },
  {
    taxonomie: "kpi",
    code: "taux_service_logistique",
    libelle: "Taux de service logistique",
    description: "Livraisons conformes dans les délais promis.",
  },
  {
    taxonomie: "risque",
    code: "contrepartie_publique",
    libelle: "Risque de contrepartie publique",
    description: "Créances sur l'État et collectivités, délais de règlement.",
  },
  {
    taxonomie: "risque",
    code: "approvisionnement_importe",
    libelle: "Risque d'approvisionnement en intrants importés",
    description: "Ruptures, délais de dédouanement et exposition au change.",
  },
  {
    taxonomie: "processus",
    code: "gestion_sous_traitants",
    libelle: "Gestion des transporteurs sous-traitants",
    description: "Sélection, contractualisation et suivi des prestataires.",
  },
  {
    taxonomie: "fonction",
    code: "direction_export",
    libelle: "Direction de l'export",
    description: "Pilotage des ventes à l'international.",
  },
];

const FACTEURS = [
  {
    code: "exigence_bailleur",
    libelle: "Normes exigées par le bailleur",
    description: "Cadre de performance imposé par le financeur du projet.",
    type: "enumeration",
    valeurs: [
      { code: "aucune", libelle: "Aucune exigence particulière" },
      { code: "ifc", libelle: "Normes de performance IFC" },
      { code: "afd", libelle: "Cadre de l'Agence française de développement" },
      { code: "boad", libelle: "Cadre de la BOAD" },
    ],
    porte_par: "mission",
  },
  {
    code: "nombre_filiales",
    libelle: "Nombre de filiales du groupe",
    description: "Périmètre de consolidation du client.",
    type: "nombre",
    min: 0,
    max: 500,
    porte_par: "dossier",
  },
];

const NOTES = [
  {
    cible_type: "methode",
    cible_code: "diagnostic_flash",
    contexte: "Zone UEMOA",
    texte:
      "En zone UEMOA, demander dès le cadrage les états financiers au référentiel SYSCOHADA révisé. Pour les PME informelles, un relevé de caisse et les relevés bancaires tiennent souvent lieu de comptes.",
  },
  {
    cible_type: "methode",
    cible_code: "business_plan_bancable",
    contexte: "Zone CEMAC",
    texte:
      "Les banques de la CEMAC demandent généralement la déclaration statistique et fiscale et l'extrait de la centrale des bilans : prévoir ces pièces en début de collecte.",
  },
  {
    cible_type: "brique",
    cible_code: "reconstitution_ca",
    contexte: "Part d'espèces forte",
    texte:
      "Croiser les encaissements bancaires, les ventes déclarées et les achats de matières avant de retenir un chiffre d'affaires reconstitué ; consigner la méthode dans le rapport.",
  },
  {
    cible_type: "facteur",
    cible_code: "part_informel",
    contexte: "Marchés de gros",
    texte:
      "Sur les marchés de gros, la part d'espèces est structurellement élevée : ne pas la lire seule comme un signal de fragilité.",
  },
];

export async function semerDictionnaire(ctx: ContexteTenantDemo): Promise<void> {
  const expert = ctx.session("expert.metier");
  for (const t of TAXONOMIES) {
    const existe = await ctx.proprietaire.query(
      "SELECT 1 FROM taxonomie_entrees WHERE cabinet_id = $1 AND taxonomie = $2 AND code = $3",
      [ctx.cabinetId, t.taxonomie, t.code],
    );
    if (existe.rowCount) continue;
    attendre(201, await expert.post("/api/standard/taxonomies", t), `taxonomie ${t.code}`);
  }
  const associe = ctx.session("associe");
  for (const f of FACTEURS) {
    const existe = await ctx.proprietaire.query(
      "SELECT 1 FROM facteurs_contexte WHERE cabinet_id = $1 AND code = $2",
      [ctx.cabinetId, f.code],
    );
    if (existe.rowCount) continue;
    attendre(201, await associe.post("/api/standard/facteurs", f), `facteur ${f.code}`);
  }
  for (const n of NOTES) {
    const existe = await ctx.proprietaire.query(
      `SELECT 1 FROM notes_contexte
        WHERE cabinet_id = $1 AND cible_type = $2 AND cible_code = $3 AND contexte = $4`,
      [ctx.cabinetId, n.cible_type, n.cible_code, n.contexte],
    );
    if (existe.rowCount) continue;
    attendre(201, await expert.post("/api/standard/notes", n), `note ${n.cible_code}`);
  }
  ctx.journal("  dictionnaire, facteurs et notes du cabinet à jour.");
}
