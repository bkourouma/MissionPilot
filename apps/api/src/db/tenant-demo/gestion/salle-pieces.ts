import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { MOTIFS_REJET, type ProfilDemande } from "./donnees-salle.js";
import { ok } from "./outils.js";
import { deposerParPortail, nomFichierPiece, pdfPiece } from "./salle-fichiers.js";

/*
 * Cycle d'une pièce de la salle de mission : demandée -> reçue (dépôt du client par le portail,
 * accusé de réception automatique) -> acceptée ou rejetée (décision de l'équipe, motif au client)
 * -> redéposée. Chaque étape passe par la route réelle ; l'état courant est relu avant chaque pas
 * (reprise sans doublon : une pièce déjà à sa cible n'est pas touchée).
 */

export type StatutPiece = "demandee" | "recue" | "acceptee" | "rejetee";
export type Cible = StatutPiece | "rejet_puis_acceptee";

export interface PieceVue {
  id: string;
  libelle: string;
  statut: StatutPiece;
  depots: { id: string }[];
  historique: { statut: string }[];
}

/** État visé de chaque pièce d'une demande de `n` pièces selon son profil. */
export function ciblesDuProfil(profil: ProfilDemande, n: number): Cible[] {
  const toutes = (c: Cible): Cible[] => Array.from({ length: n }, () => c);
  switch (profil) {
    case "complete":
      return toutes("acceptee");
    case "rejet": {
      const c = toutes("acceptee");
      c[Math.min(1, n - 1)] = "rejet_puis_acceptee";
      return c;
    }
    case "partielle": {
      const acceptees = Math.ceil(n / 2);
      return Array.from({ length: n }, (_, i): Cible => {
        if (i < acceptees) return "acceptee";
        if (i === acceptees) return "recue";
        return i === acceptees + 1 && n >= 5 ? "rejetee" : "demandee";
      });
    }
    case "retard": {
      const acceptees = Math.floor(n / 2);
      return Array.from({ length: n }, (_, i): Cible => {
        if (i < acceptees) return "acceptee";
        return i === acceptees && n >= 4 ? "recue" : "demandee";
      });
    }
    default:
      return toutes("demandee");
  }
}

export interface EnvPieces {
  ctx: ContexteTenantDemo;
  missionId: string;
  missionNom: string;
  demandeId: string;
  /** Équipe de la mission : décisions alternées entre les deux sessions. */
  decideurs: SessionDemo[];
  /** Dirigeants et contributeurs du client qui déposent. */
  deposants: SessionDemo[];
}

async function lirePiece(env: EnvPieces, pieceId: string): Promise<PieceVue> {
  const r = await env.decideurs[0]!.get(
    `/api/missions/${env.missionId}/salle/demandes/${env.demandeId}`,
  );
  ok(200, r, "lecture de la demande");
  const piece = (r.json().pieces as PieceVue[]).find((p) => p.id === pieceId);
  if (!piece) throw new Error(`Pièce ${pieceId} introuvable dans la demande.`);
  return piece;
}

/** Amène la pièce à sa cible, un pas à la fois (au plus six pas : dépôt, rejet, redépôt, acceptation). */
export async function amenerPiece(
  env: EnvPieces,
  pieceId: string,
  cible: Cible,
  rang: number,
): Promise<void> {
  const { ctx } = env;
  for (let pas = 0; pas < 6; pas++) {
    const p = await lirePiece(env, pieceId);
    if (cible === "demandee" || p.statut === "acceptee") return;
    if (p.statut === "rejetee" && cible === "rejetee") return;
    if (p.statut === "demandee" || p.statut === "rejetee") {
      const s = env.deposants[(rang + pas) % env.deposants.length] as SessionDemo;
      const version = p.depots.length + 1;
      const r = await deposerParPortail(
        ctx,
        s,
        p.id,
        nomFichierPiece(p.libelle, version),
        pdfPiece(p.libelle, env.missionNom, version, "le client"),
      );
      if (r.statusCode !== 201 && r.statusCode !== 200) {
        throw new Error(`dépôt « ${p.libelle} » : HTTP ${r.statusCode} ${r.body.slice(0, 200)}`);
      }
      continue;
    }
    // Pièce reçue : décision de l'équipe.
    if (cible === "recue") return;
    const decideur = env.decideurs[(rang + pas) % env.decideurs.length] as SessionDemo;
    const dejaRejetee = p.historique.some((e) => e.statut === "rejetee");
    const rejeter = cible === "rejetee" || (cible === "rejet_puis_acceptee" && !dejaRejetee);
    if (rejeter) {
      const motif = MOTIFS_REJET[rang % MOTIFS_REJET.length] as string;
      ok(
        200,
        await decideur.post(`/api/missions/${env.missionId}/salle/pieces/${p.id}/rejeter`, {
          motif,
        }),
        "rejet de la pièce",
      );
    } else {
      ok(
        200,
        await decideur.post(`/api/missions/${env.missionId}/salle/pieces/${p.id}/accepter`, {}),
        "acceptation de la pièce",
      );
    }
  }
}
