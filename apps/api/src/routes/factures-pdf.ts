import type { FastifyPluginAsync } from "fastify";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { rendreDocument } from "../facturation/document.js";
import {
  exigerFactureVisible,
  lireLignes,
  masquerLignes,
  mentionsAFiger,
} from "../facturation/factures.js";
import { paramsId } from "../http/outils.js";
import { echapper } from "../rapports/html.js";
import { cheminNavigateur, htmlEnPdf } from "../rapports/pdf.js";

/*
 * GET /factures/:id/pdf — PDF de la facture ou de l'avoir (FIN-07), imprimé
 * par le Chromium isolé des rapports (rapports/pdf.ts : JavaScript coupé,
 * requêtes bloquées, profil jetable, délai, au plus un rendu simultané par
 * cabinet et deux en tout, et au plus PDF_FACTURES_PAR_FENETRE PDF par utilisateur sur
 * FENETRE_PDF_FACTURES_MINUTES minutes : 429 TROP_DE_PDF_FACTURES, comme les rapports) depuis le MÊME document HTML que
 * GET /factures/:id/document (facturation/document.ts : texte échappé,
 * montants du moteur, filigrane « BROUILLON » tant que la facture n'est pas
 * émise, montants unitaires de régie masqués sans « finance.lire »).
 *
 * « facture.lire » et mission visible (404 sinon, y compris un autre
 * cabinet). Le PDF n'est pas conservé : il est rendu à chaque demande et
 * servi en pièce jointe, sans cache. Chaque téléchargement est journalisé
 * (sans le contenu) ; le débit se compte sur ces lignes du journal, contrôlé avant le
 * rendu (un rendu refusé ou en échec ne compte pas). Fermé au portail (absent de LISTE_BLANCHE_PORTAIL) : le
 * client consulte ses factures par les routes du portail.
 */

/** PDF de factures admis par utilisateur sur la fenêtre glissante (même réglage que les rapports). */
export const PDF_FACTURES_PAR_FENETRE = 10;
export const FENETRE_PDF_FACTURES_MINUTES = 10;
const ACTION_TELECHARGEMENT = "telechargement_facture_pdf";

/** 429 si l'utilisateur a déjà téléchargé PDF_FACTURES_PAR_FENETRE PDF de factures sur la fenêtre. */
export async function verifierDebitFacturesPdf(db: Db, auth: Auth): Promise<void> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM journal_audit
     WHERE utilisateur_id = $1 AND action = $2 AND cree_le > now() - make_interval(mins => $3)`,
    [auth.utilisateurId, ACTION_TELECHARGEMENT, FENETRE_PDF_FACTURES_MINUTES],
  );
  if ((r.rows[0].n as number) >= PDF_FACTURES_PAR_FENETRE) {
    throw new AppError(
      429,
      "TROP_DE_PDF_FACTURES",
      `Au plus ${PDF_FACTURES_PAR_FENETRE} PDF de factures par ${FENETRE_PDF_FACTURES_MINUTES} minutes : réessayez plus tard.`,
    );
  }
}

/** Nom de fichier sûr (ASCII) d'après la nature et le numéro de la pièce. */
export function nomFichierFacture(nature: string, numero: string | null): string {
  const base = `${nature === "avoir" ? "Avoir" : "Facture"} ${numero ?? "brouillon"}`;
  return `${base.replace(/[^A-Za-z0-9 ._-]/g, "-").slice(0, 80)}.pdf`;
}

const pied = (texte: string) =>
  '<div style="font-family: Arial, sans-serif; font-size: 8pt; color: #52606d; width: 100%; ' +
  'padding: 0 15mm; display: flex; justify-content: space-between;">' +
  `<span>${echapper(texte)}</span>` +
  '<span>Page <span class="pageNumber"></span> sur <span class="totalPages"></span></span></div>';

export const routesFacturesPdf: FastifyPluginAsync = async (app) => {
  app.get("/factures/:id/pdf", async (request, reply) => {
    const auth = exiger(request, "facture.lire");
    const { id } = paramsId.parse(request.params);
    const { html, nom, numero } = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { facture } = await exigerFactureVisible(db, auth, id);
      await verifierDebitFacturesPdf(db, auth);
      const mentions = facture.mentions ?? (await mentionsAFiger(db, auth.cabinetId, facture));
      return {
        html: rendreDocument({
          facture,
          lignes: masquerLignes(await lireLignes(db, id), auth),
          mentions,
        }),
        nom: nomFichierFacture(facture.nature, facture.numero),
        numero: facture.numero,
      };
    });
    const pdf = await htmlEnPdf(html, {
      cheminNavigateur: navigateurOu503(cheminNavigateur(app.config)),
      cabinetId: auth.cabinetId,
      pied: pied(nom.replace(/\.pdf$/, "")),
    });
    await app.db.withTenant(auth.cabinetId, (db) =>
      journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: ACTION_TELECHARGEMENT,
        entite: "facture",
        entiteId: id,
        details: { numero, taille: pdf.length },
      }),
    );
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${nom}"`)
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "sandbox")
      .header("cache-control", "private, no-store")
      .send(pdf);
  });
};

function navigateurOu503(chemin: string | null): string {
  if (chemin) return chemin;
  throw new AppError(
    503,
    "RENDU_PDF_INDISPONIBLE",
    "Le rendu PDF est indisponible : aucun navigateur configuré (CHROMIUM_PATH).",
  );
}
