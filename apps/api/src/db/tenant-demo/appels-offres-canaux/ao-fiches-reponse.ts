import { createHash } from "node:crypto";
import { decouperExigences, retroPlanning, type ExigenceProposee } from "@missionpilot/engines";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { texteDossierAo } from "./donnees-ao-dossiers.js";
import type { AppelOffresDemo } from "./donnees-ao-liste.js";
import type { ScenarioAo } from "./donnees-ao-scenarios.js";

/*
 * Réponse à un appel d'offres clos, antidatée (SQL propriétaire, comme `ao-fiches-historique.ts`) :
 * dossier, extraction (IA simulée, repli déterministe) validée, matrice de conformité dont chaque
 * état entre dans `ao_exigences_suivi` par le déclencheur, rétro-planning.
 */
export const heure = (jour: string, hhmm: string) => `${jour}T${hhmm}:00Z`;

export function plusJours(jour: string, n: number): string {
  const [a, m, j] = jour.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

/**
 * Entrée du journal d'audit ANTIDATÉE, équivalente à celle que les services d'appels d'offres
 * écrivent (même action, entité `appel_offres`, même forme de détails, jamais de contenu). Le
 * journal n'a pas de déclencheur : le propriétaire fixe `cree_le`.
 */
export async function journaliserAo(
  ctx: ContexteTenantDemo,
  auteur: CleCompte,
  action: string,
  aoId: string,
  details: Record<string, unknown>,
  quand: string,
): Promise<void> {
  await ctx.proprietaire.query(
    `INSERT INTO journal_audit (cabinet_id, utilisateur_id, action, entite, entite_id, details, cree_le)
     VALUES ($1, $2, $3, 'appel_offres', $4, $5, $6::timestamptz)`,
    [ctx.cabinetId, uid(ctx, auteur), action, aoId, JSON.stringify(details), quand],
  );
}

export const uid = (ctx: ContexteTenantDemo, cle: CleCompte): string => {
  const id = ctx.utilisateurs[cle];
  if (!id) throw new Error(`Utilisateur « ${cle} » introuvable dans le contexte.`);
  return id;
};

/** Statut final d'une ligne de la matrice : toujours satisfaisant pour les exigences obligatoires. */
function statutFinal(p: ExigenceProposee, rang: number, sc: ScenarioAo) {
  if (p.obligatoire) {
    return rang % 7 === 5
      ? ({
          statut: "sans_objet",
          commentaire: "Sans objet : pièce déjà fournie dans le dossier administratif commun.",
        } as const)
      : ({ statut: "conforme", commentaire: null } as const);
  }
  if (sc.issue?.statut !== "perdu") return { statut: "conforme", commentaire: null } as const;
  return sc.cle === "banque-pme-etude"
    ? ({
        statut: "non_conforme",
        commentaire: "Aucune attestation d'institution financière disponible.",
      } as const)
    : ({
        statut: "partiel",
        commentaire: "Expérience régionale partielle, précisée dans l'offre.",
      } as const);
}

async function matrice(
  ctx: ContexteTenantDemo,
  aoId: string,
  extractionId: string,
  propositions: ExigenceProposee[],
  sc: ScenarioAo,
  reponse: NonNullable<ScenarioAo["reponse"]>,
): Promise<void> {
  const equipe: CleCompte[] = [sc.responsable, "consultant", "chef.mission", "directeur.mission"];
  for (const [i, p] of propositions.entries()) {
    const responsable = uid(ctx, equipe[i % equipe.length] as CleCompte);
    const valideur = uid(ctx, reponse.valideur);
    const creee = heure(reponse.valideurJour, "11:00");
    const r = await ctx.proprietaire.query(
      `INSERT INTO ao_exigences (cabinet_id, ao_id, numero, libelle, categorie, obligatoire,
         reference, origine, extraction_id, responsable_id, cree_par, cree_le, modifie_par, modifie_le)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'extraction', $8, $9, $10, $11::timestamptz, $10,
         $11::timestamptz) RETURNING id`,
      [
        ctx.cabinetId,
        aoId,
        i + 1,
        p.libelle,
        p.categorie,
        p.obligatoire,
        p.reference,
        extractionId,
        responsable,
        valideur,
        creee,
      ],
    );
    const id = r.rows[0].id as string;
    const veille = plusJours(reponse.valideurJour, 1);
    const fin = plusJours(reponse.valideurJour, 2 + (i % 3));
    const final = statutFinal(p, i, sc);
    const etapes = [
      { statut: "en_cours", commentaire: null, piece: null, quand: heure(veille, "09:30") },
      {
        ...final,
        piece: final.statut === "conforme" ? `Annexe ${i + 1}` : null,
        quand: heure(fin < reponse.depotJour ? fin : veille, "15:00"),
      },
    ];
    for (const s of etapes) {
      await ctx.proprietaire.query(
        `UPDATE ao_exigences SET statut = $2, commentaire = $3, piece = $4, modifie_par = $5,
           modifie_le = $6::timestamptz WHERE id = $1`,
        [id, s.statut, s.commentaire, s.piece, responsable, s.quand],
      );
      await journaliserAo(
        ctx,
        equipe[i % equipe.length] as CleCompte,
        "suivi_exigence",
        aoId,
        { exigence_id: id, statut: s.statut },
        s.quand,
      );
    }
  }
}

async function retro(
  ctx: ContexteTenantDemo,
  aoId: string,
  ao: AppelOffresDemo,
  sc: ScenarioAo,
): Promise<void> {
  const plan = retroPlanning(ao.date_limite, sc.decision.jour);
  await journaliserAo(
    ctx,
    sc.createur,
    "generation_retroplanning",
    aoId,
    { etapes: plan.etapes.length, compresse: plan.compresse },
    heure(sc.decision.jour, "11:00"),
  );
  for (const e of plan.etapes) {
    const faiteLe = heure(e.datePrevue, "15:00");
    const etape = await ctx.proprietaire.query(
      `INSERT INTO ao_retroplanning_etapes (cabinet_id, ao_id, ordre, code, libelle, date_prevue,
         responsable_id, faite, faite_le, cree_par, cree_le, modifie_par, modifie_le)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8::timestamptz, $9, $10::timestamptz, $7, $8::timestamptz)
       RETURNING id`,
      [
        ctx.cabinetId,
        aoId,
        e.ordre,
        e.code,
        e.libelle,
        e.datePrevue,
        uid(ctx, sc.responsable),
        faiteLe,
        uid(ctx, sc.createur),
        heure(sc.decision.jour, "11:00"),
      ],
    );
    await journaliserAo(
      ctx,
      sc.responsable,
      "suivi_retroplanning",
      aoId,
      { etape_id: etape.rows[0].id as string, faite: true },
      faiteLe,
    );
  }
}

/** Réponse : dossier, extraction (IA simulée, repli déterministe) validée, matrice, rétro-planning. */
export async function repondre(
  ctx: ContexteTenantDemo,
  aoId: string,
  ao: AppelOffresDemo,
  sc: ScenarioAo,
  reponse: NonNullable<ScenarioAo["reponse"]>,
): Promise<void> {
  const texte = texteDossierAo(sc.cle, ao.titre, ao.bailleur);
  const dossier = await ctx.proprietaire.query(
    `INSERT INTO ao_dossiers (cabinet_id, ao_id, numero, source, sha256, texte, cree_par, cree_le)
     VALUES ($1, $2, 1, 'texte', $3, $4, $5, $6::timestamptz) RETURNING id`,
    [
      ctx.cabinetId,
      aoId,
      createHash("sha256").update(texte, "utf8").digest("hex"),
      texte,
      uid(ctx, reponse.auteurDossier),
      heure(reponse.dossierJour, "09:00"),
    ],
  );
  const dossierId = dossier.rows[0].id as string;
  await journaliserAo(
    ctx,
    reponse.auteurDossier,
    "ajout_dossier",
    aoId,
    { dossier_id: dossierId, source: "texte", signaux: [] },
    heure(reponse.dossierJour, "09:00"),
  );
  const { exigences, tronque } = decouperExigences(texte);
  const extraire = async (propositions: ExigenceProposee[], quand: string) => {
    const r = await ctx.proprietaire.query(
      `INSERT INTO ao_extractions (cabinet_id, ao_id, dossier_id, methode, gabarit, tronque,
         propositions, nombre, cree_par, cree_le)
       VALUES ($1, $2, $3, 'ia', true, $4, $5, $6, $7, $8::timestamptz) RETURNING id`,
      [
        ctx.cabinetId,
        aoId,
        dossierId,
        tronque,
        JSON.stringify(propositions),
        propositions.length,
        uid(ctx, reponse.auteurDossier),
        quand,
      ],
    );
    const extractionId = r.rows[0].id as string;
    await journaliserAo(
      ctx,
      reponse.auteurDossier,
      "extraction_exigences",
      aoId,
      {
        extraction_id: extractionId,
        methode: "ia",
        gabarit: true,
        nombre: propositions.length,
        ia_demande_id: null,
      },
      quand,
    );
    return extractionId;
  };
  const trancher = async (
    id: string,
    statut: "validee" | "rejetee",
    retenues: number[] | null,
    motif: string | null,
    quand: string,
  ) => {
    await ctx.proprietaire.query(
      `UPDATE ao_extractions SET statut = $2, retenues = $3, motif = $4, tranche_par = $5,
         tranche_le = $6::timestamptz WHERE id = $1`,
      [id, statut, retenues, motif, uid(ctx, reponse.valideur), quand],
    );
    await journaliserAo(
      ctx,
      reponse.valideur,
      "validation_extraction",
      aoId,
      {
        extraction_id: id,
        decision: statut,
        retenues: retenues?.length ?? 0,
        acquitte_chiffres: false,
      },
      quand,
    );
  };
  if (sc.cle === "mboa-dd") {
    // Premier brouillon de l'IA rejeté (propositions trop fines), repris après relecture du dossier.
    const rejetee = await extraire(exigences.slice(0, 4), heure(reponse.dossierJour, "09:20"));
    await trancher(
      rejetee,
      "rejetee",
      null,
      "Propositions trop partielles : extraction relancée.",
      heure(reponse.dossierJour, "16:00"),
    );
  }
  const extractionId = await extraire(exigences, heure(reponse.dossierJour, "09:30"));
  await trancher(
    extractionId,
    "validee",
    exigences.map((_, i) => i),
    null,
    heure(reponse.valideurJour, "10:30"),
  );
  await matrice(ctx, aoId, extractionId, exigences, sc, reponse);
  await retro(ctx, aoId, ao, sc);
}
