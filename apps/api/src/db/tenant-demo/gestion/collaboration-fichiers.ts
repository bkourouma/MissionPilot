import { createHash } from "node:crypto";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { journaliser } from "../../../audit.js";
import { stockageDe } from "../../../stockage/index.js";
import {
  ancrer,
  encadrer,
  heureISO,
  sansDeclencheurs,
  supprimerAvec,
} from "./collaboration-outils.js";
import { ok } from "./outils.js";

/*
 * FICHIERS SUPPRIMÉS (`fichiers_suppressions`, migration 0070) : deux événements réels de la vie
 * du stockage, reproduits fidèlement.
 *
 * 1. Retrait par son auteur d'un téléversement non rattaché (`DELETE /api/fichiers/:id`, motif
 *    « retire ») : une vraie route.
 * 2. Purge des orphelins (job horaire `purge_fichiers_orphelins`, motif « orphelin », sans auteur) :
 *    aucune route, c'est un job. La requête est celle de `stockage/purge.ts` restreinte aux
 *    fichiers de cette démonstration (le job purgerait tous les orphelins du cabinet, dont des
 *    fichiers que d'autres modules rattachent par d'autres tables) ; l'objet de stockage est
 *    effacé comme le job le fait, et la ligne d'audit « purge_orphelins » est écrite.
 *
 * Les dates sont remontées par SQL du propriétaire (`fichiers` est en ajout seul). Idempotent : un
 * fichier est repéré par son nom d'origine.
 */

interface Depot {
  nom: string;
  auteur: "chef.mission" | "consultant" | "consultant.2";
  jour: string;
  /** retire : l'auteur le retire ; orphelin : jamais rattaché, purgé le lendemain. */
  issue: "retire" | "orphelin";
}

const DEPOTS: readonly Depot[] = [
  {
    nom: "brouillon-lettre-relance-doublon.pdf",
    auteur: "chef.mission",
    jour: "2025-09-18",
    issue: "retire",
  },
  {
    nom: "export-releve-bancaire-essai.pdf",
    auteur: "consultant",
    jour: "2026-03-10",
    issue: "retire",
  },
  {
    nom: "scan-note-de-frais-illisible.pdf",
    auteur: "consultant.2",
    jour: "2026-02-03",
    issue: "orphelin",
  },
  {
    nom: "compte-rendu-reunion-sans-suite.pdf",
    auteur: "chef.mission",
    jour: "2026-02-03",
    issue: "orphelin",
  },
];

/** PDF d'une page à couche texte (aucun contenu actif), unique par `titre`. */
function pdfMinimal(titre: string): Buffer {
  const ascii = titre
    .normalize("NFD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/([\\()])/g, "\\$1");
  const flux = `BT /F1 14 Tf 72 760 Td (${ascii}) Tj T* (Document de demonstration, sans suite.) Tj ET`;
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let corps = "%PDF-1.4\n";
  const decalages: number[] = [];
  objets.forEach((o, i) => {
    decalages.push(corps.length);
    corps += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = corps.length;
  corps += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const d of decalages) corps += `${String(d).padStart(10, "0")} 00000 n \n`;
  corps += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corps, "latin1");
}

async function televerser(
  ctx: ContexteTenantDemo,
  s: SessionDemo,
  nom: string,
): Promise<{ id: string; cle: string }> {
  const contenu = pdfMinimal(
    `${nom} ${createHash("sha256").update(nom).digest("hex").slice(0, 8)}`,
  );
  const frontiere = "----mpdemo-collaboration";
  const payload = Buffer.concat([
    Buffer.from(
      `--${frontiere}\r\nContent-Disposition: form-data; name="fichier"; filename="${nom}"\r\n` +
        "Content-Type: application/pdf\r\n\r\n",
      "utf8",
    ),
    contenu,
    Buffer.from(`\r\n--${frontiere}--\r\n`, "utf8"),
  ]);
  const r = await ctx.app.inject({
    method: "POST",
    url: "/api/fichiers",
    headers: { cookie: s.cookie, "content-type": `multipart/form-data; boundary=${frontiere}` },
    payload,
  });
  ok(201, r, `téléversement ${nom}`);
  const id = r.json().id as string;
  const cle = (
    await ctx.proprietaire.query("SELECT cle_stockage FROM fichiers WHERE id = $1", [id])
  ).rows[0].cle_stockage as string;
  return { id, cle };
}

export async function semerFichiersSupprimes(ctx: ContexteTenantDemo): Promise<number> {
  let faits = 0;
  const orphelins: { id: string; cle: string; jour: string }[] = [];
  for (const d of DEPOTS) {
    const s = ctx.session(d.auteur);
    const deja = await ctx.proprietaire.query(
      "SELECT f.id, EXISTS (SELECT 1 FROM fichiers_suppressions x WHERE x.fichier_id = f.id) AS supprime FROM fichiers f WHERE f.cabinet_id = $1 AND f.nom_origine = $2",
      [ctx.cabinetId, d.nom],
    );
    if ((deja.rowCount ?? 0) > 0) {
      // Reprise d'un essai interrompu entre le dépôt et le retrait : le délai de la route est dépassé.
      const l = deja.rows[0] as { id: string; supprime: boolean };
      if (d.issue === "retire" && !l.supprime) {
        await ctx.proprietaire.query(
          "INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif, supprime_par, supprime_le) VALUES ($1, $2, 'retire', $3, $4::timestamptz)",
          [ctx.cabinetId, l.id, s.utilisateurId, heureISO(d.jour, 10, 31)],
        );
      }
      continue;
    }
    const { resultat: depot, fenetre } = await encadrer(ctx, async () => {
      const f = await televerser(ctx, s, d.nom);
      if (d.issue === "retire") {
        ok(204, await supprimerAvec(ctx, s, `/api/fichiers/${f.id}`), `retrait ${d.nom}`);
      }
      return f;
    });
    const depose = heureISO(d.jour, 10, 12);
    await ancrer(ctx, fenetre, depose, true);
    await sansDeclencheurs(ctx, async (c) => {
      await c.query("UPDATE fichiers SET cree_le = $2::timestamptz WHERE id = $1", [
        depot.id,
        depose,
      ]);
      await c.query(
        "UPDATE fichiers_suppressions SET supprime_le = $2::timestamptz WHERE fichier_id = $1",
        [depot.id, heureISO(d.jour, 10, 31)],
      );
    });
    faits += 1;
    if (d.issue === "orphelin") orphelins.push({ ...depot, jour: d.jour });
  }
  // Purge horaire des orphelins de plus de 24 h, le lendemain du dépôt.
  if (orphelins.length > 0) {
    const jourPurge = new Date(Date.parse(`${orphelins[0]?.jour}T12:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const instant = heureISO(jourPurge, 11, 0);
    const { fenetre } = await encadrer(ctx, async () => {
      await ctx.database.withTenant(ctx.cabinetId, async (db) => {
        await db.query(
          `INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif)
           SELECT $1, f.id, 'orphelin' FROM fichiers f
            WHERE f.id = ANY ($2::uuid[]) AND fichier_orphelin(f.id)`,
          [ctx.cabinetId, orphelins.map((o) => o.id)],
        );
        await journaliser(db, {
          cabinetId: ctx.cabinetId,
          utilisateurId: null,
          action: "purge_orphelins",
          entite: "fichier",
          details: { nombre: orphelins.length, seuil: instant },
        });
      });
      for (const o of orphelins) await stockageDe(ctx.config).supprimer(ctx.cabinetId, o.cle);
    });
    await ancrer(ctx, fenetre, instant, true);
    await sansDeclencheurs(ctx, async (c) => {
      await c.query(
        "UPDATE fichiers_suppressions SET supprime_le = $2::timestamptz WHERE fichier_id = ANY ($1::uuid[])",
        [orphelins.map((o) => o.id), instant],
      );
    });
  }
  ctx.journal(
    `  fichiers : ${faits} téléversements supprimés (retrait ou purge) sur ${DEPOTS.length} prévus.`,
  );
  return faits;
}
