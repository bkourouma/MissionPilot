import type { SessionDemo } from "../contexte.js";
import type { Chantier } from "./dd-mboa.js";
import { HYPOTHESES, type DefHypothese, type ValideurDd } from "./dd-mboa-marche-donnees.js";
import { ecrire, lire } from "./dd-outils.js";

/*
 * Hypothèses, liens vers les assertions et verdicts du dossier Mboa Solaire (DD-09).
 *
 * - les hypothèses sont posées par un consultant ; chacune est liée aux assertions « Mboa Solaire :
 *   … » du registre des preuves (et à des affirmations de ses propres analyses) ;
 * - le verdict proposé suit l'INDICATION du moteur (lue sur la route des hypothèses) : un écart ne
 *   se produit que s'il est déclaré dans les données, avec un motif détaillé, et il est alors tracé
 *   comme ajustement ; le proposant cite les assertions de même sens que le verdict ;
 * - la validation (ou le rejet motivé) revient à un compte `dd.valider` qui n'est ni le proposant,
 *   ni l'auteur de l'hypothèse, ni l'auteur d'une assertion citée (séparation des tâches, MPZ25) :
 *   expert métier, second expert métier ou directeur de la mission.
 */

interface Noeud {
  id: string;
  version: number;
  indication: { indication: "confirmee" | "infirmee" | "non_concluante" };
  liens: { assertion_id: string; sens: "soutient" | "contredit" }[];
}

function valideur(ch: Chantier, cle: ValideurDd): SessionDemo {
  return cle === "expert" ? ch.a.expert : cle === "expert2" ? ch.a.expert2 : ch.a.directeur;
}

function resoudre(ch: Chantier, cle: string): string {
  const id = cle.startsWith("pt:") ? ch.points.get(cle.slice(3))?.assertion : ch.registre.get(cle);
  if (!id) throw new Error(`Assertion « ${cle} » introuvable pour les liens d'hypothèse.`);
  return id;
}

interface Evenement {
  j: number;
  executer: () => Promise<void>;
}

/** Propose le verdict d'une hypothèse (indication du moteur, sauf écart déclaré) ; rend son id. */
async function proposer(ch: Chantier, h: DefHypothese, hypotheseId: string): Promise<string> {
  const session = ch.par(h.par);
  const etat = await lire<{ noeuds: Noeud[] }>(
    session,
    `/api/dd/dossiers/${ch.dossierId}/hypotheses`,
    "lecture des hypothèses",
  );
  const noeud = etat.noeuds.find((n) => n.id === hypotheseId);
  if (!noeud) throw new Error(`Hypothèse ${h.cle} absente de la lecture.`);
  const indication = noeud.indication.indication;
  const verdict = h.ecart?.verdict ?? indication;
  const cites = noeud.liens
    .filter((l) =>
      verdict === "confirmee"
        ? l.sens === "soutient"
        : verdict === "infirmee"
          ? l.sens === "contredit"
          : true,
    )
    .map((l) => l.assertion_id);
  ch.ctx.journal(`  hypothèse « ${h.cle} » : indication ${indication}, verdict ${verdict}.`);
  const v = await ecrire<{ id: string }>(
    session,
    `/api/dd/hypotheses/${hypotheseId}/verdicts`,
    {
      hypothese_version: noeud.version,
      verdict,
      motif: h.ecart?.motif ?? h.motifVerdict,
      assertions_citees: cites,
    },
    `verdict ${h.cle}`,
  );
  return v.id;
}

export async function semerVerdictsMboa(ch: Chantier): Promise<void> {
  const evts: Evenement[] = [];
  for (const h of HYPOTHESES) {
    let hypotheseId = "";
    let verdictId = "";
    evts.push({
      j: h.j,
      executer: async () => {
        const r = await ecrire<{ id: string }>(
          ch.par(h.par),
          `/api/dd/dossiers/${ch.dossierId}/hypotheses`,
          { libelle: h.libelle, description: h.description, critere: h.critere, parent_id: null },
          `hypothèse ${h.cle}`,
        );
        hypotheseId = r.id;
      },
    });
    if (h.correction) {
      const c = h.correction;
      evts.push({
        j: c.j,
        executer: async () => {
          await ecrire(
            ch.par(h.par),
            `/api/dd/hypotheses/${hypotheseId}/versions`,
            { version_courante: 1, motif: c.motif, libelle: c.libelle },
            `hypothèse ${h.cle} v2`,
          );
        },
      });
    }
    evts.push({
      j: h.jLiens,
      executer: async () => {
        for (const l of h.liens) {
          await ecrire(
            ch.par(h.par),
            `/api/dd/hypotheses/${hypotheseId}/liens`,
            { assertion_id: resoudre(ch, l.assertion), action: "lier", sens: l.sens },
            `lien ${h.cle}/${l.assertion}`,
          );
        }
      },
    });
    evts.push({
      j: h.jVerdict,
      executer: async () => {
        verdictId = await proposer(ch, h, hypotheseId);
      },
    });
    if (h.rejet) {
      const r = h.rejet;
      evts.push({
        j: r.j,
        executer: async () => {
          await ecrire(
            valideur(ch, r.par),
            `/api/dd/verdicts/${verdictId}/validation`,
            { decision: "rejete", motif: r.motif },
            `rejet du verdict ${h.cle}`,
          );
        },
      });
      evts.push({
        j: r.jNouveau,
        executer: async () => {
          verdictId = await proposer(ch, h, hypotheseId);
        },
      });
    }
    evts.push({
      j: h.jValidation,
      executer: async () => {
        await ecrire(
          valideur(ch, h.valideur),
          `/api/dd/verdicts/${verdictId}/validation`,
          { decision: "valide" },
          `validation du verdict ${h.cle}`,
        );
      },
    });
  }
  // Ordre chronologique stable (les événements d'une même hypothèse restent dans leur ordre).
  const tries = evts
    .map((e, i) => ({ e, i }))
    .sort((x, y) => x.e.j - y.e.j || x.i - y.i)
    .map((x) => x.e);
  for (const e of tries) {
    await e.executer();
    await ch.dater(e.j);
  }
  ch.ctx.journal(`  DD Mboa : ${HYPOTHESES.length} hypothèses avec verdict validé.`);
}
