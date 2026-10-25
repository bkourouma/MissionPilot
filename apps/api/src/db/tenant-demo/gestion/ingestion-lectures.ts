import { ajouterJours } from "@missionpilot/engines";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import type { Casting } from "./casting.js";
import {
  LECTURES_DD,
  STANDARDS_HISTORIQUES,
  type LectureDoc,
  type StandardDoc,
} from "./donnees-ingestion.js";
import { fabriquerPdf } from "./ingestion-fichiers.js";
import {
  antedaterDocument,
  documentExistant,
  etaler,
  executerJobsDocument,
  terminerLectureSimulee,
  televerser,
  type PorteeDocument,
} from "./ingestion-outils.js";
import { ok } from "./outils.js";
import { sessionDe } from "./rapports-outils.js";

/*
 * LECTURES de documents par un gabarit d'« IA » déterministe (aucune clé) : rapports et salle de
 * données de due diligence (DD-02, DD-10) et documents historiques du standard (STD-13). Le chef de
 * mission (DD) ou un expert (standard) téléverse par la route réelle ; le texte des pages est lu
 * par le job réel ; le brouillon naît du gabarit relu par le moteur (ingestion-outils.ts). Puis
 * l'EXPERT dispose, par les routes réelles : correction éventuelle, validation ou rejet par une
 * personne AUTRE que le téléverseur et que le dernier modificateur (MQG02). Des brouillons restent
 * volontairement en attente. Sources absentes (aucun dossier de due diligence pour la mission, aucune
 * méthode brouillon) : saut avec avertissement, sauf méthode brouillon créée par la route réelle.
 */

/** Lignes que proposerait un modèle pour un document de due diligence (format de `lireLecturesIa`). */
function lignesDd(l: LectureDoc): string[] {
  return [
    ...l.resume.map(([page, texte]) => `RESUME | ${page} | ${texte}`),
    ...l.elements.map(
      ([page, type, extrait, enonce]) => `${page} | ${type} | ${extrait} | ${enonce}`,
    ),
  ];
}

async function derniereExtraction(
  ctx: ContexteTenantDemo,
  documentId: string,
): Promise<{ id: string; statut: string; contenu: Record<string, unknown> } | null> {
  const r = await ctx.proprietaire.query(
    `SELECT id, statut, contenu FROM ingestion_extractions WHERE document_id = $1
      ORDER BY cree_le DESC, id DESC LIMIT 1`,
    [documentId],
  );
  const l = r.rows[0];
  return l
    ? {
        id: l.id as string,
        statut: l.statut as string,
        contenu: l.contenu as Record<string, unknown>,
      }
    : null;
}

/** Sessions candidates (ordre de préférence), sans doublon ni personne exclue. */
function candidats(
  ctx: ContexteTenantDemo,
  cles: (CleCompte | SessionDemo | null)[],
  exclus: string[],
): SessionDemo[] {
  const vus = new Set<string>(exclus);
  const sessions: SessionDemo[] = [];
  for (const c of cles) {
    const s = typeof c === "string" ? ctx.sessions[c] : c;
    if (!s || vus.has(s.utilisateurId)) continue;
    vus.add(s.utilisateurId);
    sessions.push(s);
  }
  return sessions;
}

/** Décision sur un brouillon : premier candidat habilité (403 ou 404 : suivant) ; renvoie l'auteur. */
async function decider(
  ctx: ContexteTenantDemo,
  sessions: SessionDemo[],
  url: string,
  corps: Record<string, unknown>,
): Promise<string | null> {
  for (const s of sessions) {
    const r = await s.post(url, corps);
    if (r.statusCode === 200) return s.utilisateurId;
    if (r.statusCode !== 403 && r.statusCode !== 404) ok(200, r, "décision sur l'extraction");
  }
  return null;
}

/** Suite d'un brouillon DD : correction, validation ou rejet par un expert autre que le téléverseur. */
async function suiteDd(
  ctx: ContexteTenantDemo,
  l: LectureDoc,
  docId: string,
  chef: SessionDemo,
  directeur: SessionDemo | null,
): Promise<void> {
  const x = await derniereExtraction(ctx, docId);
  if (!x || (x.statut !== "brouillon_ia" && x.statut !== "modifie")) return;
  if (l.suite === "attente") return;
  const jour = l.jourDecision ?? ajouterJours(l.jour, 7);
  let modificateur: string | null = null;
  await etaler(ctx, jour, ajouterJours(jour, 1), async () => {
    if (l.suite === "valider_corrige" && x.statut === "brouillon_ia" && l.correction) {
      const resume = (x.contenu.resume as { page: number; texte: string }[]).map((r, i) =>
        i === 0 ? { ...r, texte: `${r.texte} ${l.correction}` } : r,
      );
      for (const s of candidats(
        ctx,
        [directeur, "consultant", "chef.mission.2"],
        [chef.utilisateurId],
      )) {
        const p = await s.patch(`/api/dd/extractions/${x.id}`, {
          contenu: { ...x.contenu, resume },
        });
        if (p.statusCode === 200) {
          modificateur = s.utilisateurId;
          break;
        }
        if (p.statusCode !== 403 && p.statusCode !== 404) ok(200, p, "correction du brouillon");
      }
    }
    const experts = candidats(
      ctx,
      ["expert.metier", "expert.metier.2", "associe", "directeur.mission.2"],
      [chef.utilisateurId, ...(modificateur ? [modificateur] : [])],
    );
    const decision =
      l.suite === "rejeter"
        ? { decision: "rejetee", motif: l.motif }
        : { decision: "validee", acquitte_chiffres: true };
    const par = await decider(ctx, experts, `/api/dd/extractions/${x.id}/decision`, decision);
    if (!par) ctx.journal(`  [ingestion] ${l.nom} : aucune personne habilitée n'a pu trancher.`);
  });
}

async function uneLectureDd(
  ctx: ContexteTenantDemo,
  casting: Casting,
  l: LectureDoc,
): Promise<number> {
  const m = casting.missions[l.mission];
  if (!m || m.statut === "cloturee") {
    ctx.journal(`  [ingestion] ${l.nom} : mission absente ou clôturée, sautée.`);
    return 0;
  }
  const d = await ctx.proprietaire.query(
    "SELECT id FROM dd_dossiers WHERE cabinet_id = $1 AND mission_id = $2 ORDER BY numero DESC LIMIT 1",
    [ctx.cabinetId, m.id],
  );
  const dossierId = (d.rows[0]?.id as string | undefined) ?? null;
  const chef = sessionDe(ctx, m.chefId);
  if (!dossierId || !chef) {
    ctx.journal(`  [ingestion] ${l.nom} : aucun dossier de due diligence pour la mission, sautée.`);
    return 0;
  }
  const portee: PorteeDocument = {
    usage: l.type === "rapport" ? "dd_rapport" : "dd_salle",
    nom: l.nom,
    ddDossierId: dossierId,
  };
  let doc = await documentExistant(ctx, portee);
  await etaler(ctx, l.jour, ajouterJours(l.jour, 1), async () => {
    const id =
      doc?.id ??
      (await televerser(
        ctx,
        chef,
        `/api/dd/dossiers/${dossierId}/documents?type=${l.type}`,
        l.nom,
        fabriquerPdf(l.pages),
        "application/pdf",
      ));
    if (!doc || doc.statut === "en_file" || doc.statut === "extraction") {
      await executerJobsDocument(ctx, id, false);
    }
    await terminerLectureSimulee(ctx, id, { nature: "lecture_document", lignes: lignesDd(l) });
  });
  doc = await documentExistant(ctx, portee);
  if (!doc) throw new Error(`Document « ${l.nom} » introuvable après téléversement.`);
  await suiteDd(ctx, l, doc.id, chef, sessionDe(ctx, m.directeurId));
  const decide = l.suite === "attente" ? null : (l.jourDecision ?? ajouterJours(l.jour, 7));
  await antedaterDocument(ctx, doc.id, l.jour, decide, decide ? ajouterJours(decide, -1) : null);
  return 1;
}

/** Version cible d'un amorçage : un brouillon du cabinet, sinon une méthode du cabinet créée par la route. */
async function versionBrouillon(
  ctx: ContexteTenantDemo,
  expert: SessionDemo,
): Promise<string | null> {
  const r = await ctx.proprietaire.query(
    `SELECT id FROM methode_versions WHERE cabinet_id = $1 AND statut = 'brouillon'
      ORDER BY cree_le, id LIMIT 1`,
    [ctx.cabinetId],
  );
  if (r.rows[0]) return r.rows[0].id as string;
  const service = await ctx.proprietaire.query(
    "SELECT id FROM services_conseil WHERE code = 'plan_strategique' AND (cabinet_id IS NULL OR cabinet_id = $1)",
    [ctx.cabinetId],
  );
  const serviceId = service.rows[0]?.id as string | undefined;
  const code = "plan_strategique_cabinet";
  const existe = await ctx.proprietaire.query(
    "SELECT id FROM methodes WHERE cabinet_id = $1 AND code = $2",
    [ctx.cabinetId, code],
  );
  if (!serviceId || existe.rows[0]) return null;
  const c = await expert.post("/api/methodes", {
    service_id: serviceId,
    code,
    libelle: "Plan stratégique : méthode du cabinet (amorçage depuis nos documents)",
    description:
      "Méthode interne en cours de construction à partir des documents historiques du cabinet.",
  });
  ok(201, c, "création de la méthode du cabinet");
  return (c.json() as { version_id: string }).version_id;
}

async function unStandard(
  ctx: ContexteTenantDemo,
  s: StandardDoc,
  versionId: string,
  auteur: SessionDemo,
): Promise<number> {
  const portee: PorteeDocument = {
    usage: "standard_historique",
    nom: s.nom,
    versionMethodeId: versionId,
  };
  let doc = await documentExistant(ctx, portee);
  await etaler(ctx, s.jour, ajouterJours(s.jour, 1), async () => {
    const id =
      doc?.id ??
      (await televerser(
        ctx,
        auteur,
        `/api/methodes/versions/${versionId}/amorcage/documents`,
        s.nom,
        fabriquerPdf(s.pages),
        "application/pdf",
      ));
    if (!doc || doc.statut === "en_file" || doc.statut === "extraction") {
      await executerJobsDocument(ctx, id, false);
    }
    await terminerLectureSimulee(ctx, id, { nature: "standard_proposition", lignes: s.lignes });
  });
  doc = await documentExistant(ctx, portee);
  if (!doc) throw new Error(`Document « ${s.nom} » introuvable après téléversement.`);
  const x = await derniereExtraction(ctx, doc.id);
  if (x && s.suite === "valider" && (x.statut === "brouillon_ia" || x.statut === "modifie")) {
    const jour = s.jourDecision ?? ajouterJours(s.jour, 7);
    await etaler(ctx, jour, ajouterJours(jour, 1), async () => {
      const experts = candidats(
        ctx,
        ["expert.metier", "expert.externe", "associe"],
        [auteur.utilisateurId],
      );
      const par = await decider(ctx, experts, `/api/amorcage/extractions/${x.id}/decision`, {
        decision: "validee",
      });
      if (!par) ctx.journal(`  [ingestion] ${s.nom} : aucune personne habilitée n'a pu valider.`);
    });
  }
  const decide = s.suite === "valider" ? (s.jourDecision ?? ajouterJours(s.jour, 7)) : null;
  await antedaterDocument(ctx, doc.id, s.jour, decide, null);
  return 1;
}

/** Documents historiques du standard (amorçage d'une méthode du cabinet). */
export async function semerStandardHistorique(ctx: ContexteTenantDemo): Promise<number> {
  const auteur = ctx.sessions["expert.metier.2"];
  if (!auteur) {
    ctx.journal("  [ingestion] standard : compte expert.metier.2 absent, amorçage sauté.");
    return 0;
  }
  const versionId = await versionBrouillon(ctx, auteur);
  if (!versionId) {
    ctx.journal("  [ingestion] standard : aucune méthode brouillon du cabinet, amorçage sauté.");
    return 0;
  }
  let n = 0;
  for (const s of STANDARDS_HISTORIQUES) n += await unStandard(ctx, s, versionId, auteur);
  return n;
}

/** Rapports et salle de données de due diligence. */
export async function semerLecturesDd(ctx: ContexteTenantDemo, casting: Casting): Promise<number> {
  let n = 0;
  for (const l of LECTURES_DD) n += await uneLectureDd(ctx, casting, l);
  return n;
}
