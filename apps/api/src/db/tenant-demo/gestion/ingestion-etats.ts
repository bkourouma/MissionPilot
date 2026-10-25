import { ajouterJours } from "@missionpilot/engines";
import type { CleClient } from "../cles.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { CLIENTS } from "../donnees-clients.js";
import type { Casting, MissionLue } from "./casting.js";
import { DOCUMENT_SANS_ETAT, ETATS_A_LIRE, type EtatDoc } from "./donnees-ingestion.js";
import { fabriquerXlsx, lignesLiasse, TYPE_XLSX } from "./ingestion-fichiers.js";
import {
  antedaterDocument,
  antedaterEtat,
  documentExistant,
  etaler,
  executerJobsDocument,
  televerser,
} from "./ingestion-outils.js";
import { ok } from "./outils.js";
import { sessionDe } from "./rapports-outils.js";

/*
 * ÉTATS FINANCIERS lus dans un tableur (DOS-03). Le chef de mission téléverse la liasse du client
 * (route réelle), les deux jobs d'ingestion la lisent par les RÈGLES du moteur (jamais d'IA : un
 * tableur n'en demande pas) et l'état naît avec ses contrôles : accepté automatiquement si tout
 * passe, sinon « en revue ». Un état en écart est ensuite tranché par une personne AUTRE que
 * l'importateur (acceptation sous réserve avec motif, ou rejet), puis le client remet une version
 * corrigée. Un tableur sans état chiffré donne `rien_trouve` (texte purgé plus tard par la
 * maintenance, ingestion.ts).
 * Reprise : un document se retrouve par (client, nom) ; chaque étape relit l'état avant d'agir.
 */

const devise = (client: CleClient): string =>
  CLIENTS.find((c) => c.cle === client)?.devise ?? "XOF";

const urlEtat = (clientId: string, exercice: number, client: CleClient): string => {
  const q = new URLSearchParams({
    exercice: String(exercice),
    date_cloture: `${exercice}-12-31`,
    devise: devise(client),
    tolerance: "0",
  });
  return `/api/dossiers/${clientId}/etats-financiers/document?${q.toString()}`;
};

/** Personnes habilitées à trancher l'état, autres que l'importateur (directeur de la mission d'abord). */
function decideurs(
  ctx: ContexteTenantDemo,
  m: MissionLue,
  importateur: SessionDemo,
): SessionDemo[] {
  const candidats = [
    sessionDe(ctx, m.directeurId),
    ctx.session("directeur.mission.2"),
    ctx.session("associe"),
  ];
  return candidats.filter(
    (s, i): s is SessionDemo =>
      s !== null && s.utilisateurId !== importateur.utilisateurId && candidats.indexOf(s) === i,
  );
}

async function statutEtat(s: SessionDemo, clientId: string, etatId: string): Promise<string> {
  const r = await s.get(`/api/dossiers/${clientId}/etats-financiers/${etatId}`);
  ok(200, r, "lecture de l'état financier");
  return r.json().statut as string;
}

/** Décision sur un état en revue : premier décideur habilité autre que l'importateur. */
async function trancher(
  ctx: ContexteTenantDemo,
  d: EtatDoc,
  m: MissionLue,
  importateur: SessionDemo,
  clientId: string,
  etatId: string,
): Promise<void> {
  const corps =
    d.suite === "rejeter"
      ? { decision: "rejete", motif: d.motif }
      : { decision: "accepte", motif: d.motif };
  for (const s of decideurs(ctx, m, importateur)) {
    const r = await s.post(`/api/dossiers/${clientId}/etats-financiers/${etatId}/decision`, corps);
    if (r.statusCode === 200) return;
    if (r.statusCode !== 403 && r.statusCode !== 404) ok(200, r, "décision sur l'état financier");
  }
  ctx.journal(
    `  [ingestion] état ${d.nom} : aucun décideur autre que l'importateur n'a pu trancher.`,
  );
}

/** Téléverse un classeur (ou reprend le document existant) et exécute ses deux jobs. */
async function ingererClasseur(
  ctx: ContexteTenantDemo,
  s: SessionDemo,
  clientId: string,
  client: CleClient,
  exercice: number,
  nom: string,
  jour: string,
  contenu: () => Promise<Buffer>,
): Promise<string> {
  const existant = await documentExistant(ctx, { usage: "etat_financier", nom, clientId });
  if (existant && (existant.statut === "termine" || existant.statut === "echec")) {
    return existant.id;
  }
  await etaler(ctx, jour, ajouterJours(jour, 1), async () => {
    const id =
      existant?.id ??
      (await televerser(
        ctx,
        s,
        urlEtat(clientId, exercice, client),
        nom,
        await contenu(),
        TYPE_XLSX,
      ));
    await executerJobsDocument(ctx, id, true);
  });
  const lu = await documentExistant(ctx, { usage: "etat_financier", nom, clientId });
  if (!lu) throw new Error(`Document « ${nom} » introuvable après téléversement.`);
  return lu.id;
}

async function unEtat(ctx: ContexteTenantDemo, casting: Casting, d: EtatDoc): Promise<number> {
  const m = casting.missions[d.mission];
  const clientId = ctx.clients[d.client];
  if (!m || m.statut === "cloturee" || !clientId) {
    ctx.journal(`  [ingestion] état ${d.nom} : mission absente ou clôturée, sauté.`);
    return 0;
  }
  const s = sessionDe(ctx, m.chefId) ?? ctx.session("associe");
  const alea = ctx.alea.deriver(`gestion-ingestion-${d.client}-${d.exercice}`);
  const docId = await ingererClasseur(
    ctx,
    s,
    clientId,
    d.client,
    d.exercice,
    d.nom,
    d.jour,
    async () => fabriquerXlsx(lignesLiasse(d, alea)),
  );
  const doc = await documentExistant(ctx, { usage: "etat_financier", nom: d.nom, clientId });
  if (!doc || doc.statut !== "termine" || !doc.etatFinancierId) {
    ctx.journal(`  [ingestion] état ${d.nom} : lecture non aboutie (${doc?.statut ?? "absent"}).`);
    await antedaterDocument(ctx, docId, d.jour, null, null);
    return 1;
  }
  let statut = await statutEtat(s, clientId, doc.etatFinancierId);
  if (statut === "en_revue" && d.suite !== "auto") {
    const jourDecision = d.jourDecision ?? ajouterJours(d.jour, 1);
    await etaler(ctx, jourDecision, ajouterJours(jourDecision, 1), () =>
      trancher(ctx, d, m, s, clientId, doc.etatFinancierId as string),
    );
    statut = await statutEtat(s, clientId, doc.etatFinancierId);
  }
  const attendu = d.suite === "rejeter" ? "rejete" : "accepte";
  if (statut !== attendu && statut !== "remplace") {
    ctx.journal(`  [ingestion] état ${d.nom} : statut « ${statut} » (attendu « ${attendu} »).`);
  }
  await antedaterDocument(ctx, docId, d.jour, null, null);
  await antedaterEtat(ctx, doc.etatFinancierId, d.jour, d.jourDecision ?? null);
  return 1;
}

async function documentSansEtat(ctx: ContexteTenantDemo, casting: Casting): Promise<number> {
  const d = DOCUMENT_SANS_ETAT;
  const m = casting.missions[d.mission];
  const clientId = ctx.clients[d.client];
  if (!m || m.statut === "cloturee" || !clientId) {
    ctx.journal(`  [ingestion] ${d.nom} : mission absente ou clôturée, sauté.`);
    return 0;
  }
  const s = sessionDe(ctx, m.chefId) ?? ctx.session("associe");
  const docId = await ingererClasseur(ctx, s, clientId, d.client, d.exercice, d.nom, d.jour, () =>
    fabriquerXlsx(d.lignes),
  );
  await antedaterDocument(ctx, docId, d.jour, null, null);
  return 1;
}

/** Tous les états à lire ; renvoie le nombre de documents traités. */
export async function semerEtatsDocuments(
  ctx: ContexteTenantDemo,
  casting: Casting,
): Promise<number> {
  let n = 0;
  for (const d of ETATS_A_LIRE) n += await unEtat(ctx, casting, d);
  n += await documentSansEtat(ctx, casting);
  return n;
}
