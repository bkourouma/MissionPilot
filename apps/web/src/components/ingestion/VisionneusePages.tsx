"use client";

import { useState } from "react";
import { formaterDate } from "../../lib/format";
import { Bouton } from "../ui/Bouton";
import {
  formaterCaracteres,
  formaterConfiancePage,
  libelleMethode,
  methodeOcr,
  textePurge,
  lirePageIngestion,
  messageErreur,
  type ApiIngestion,
  type ResumePageIngestion,
} from "../../lib/ingestion";
import type { StatutDocumentIngestion } from "@missionpilot/shared";
import { messageAucunePage } from "../../lib/ingestion-detail";

export interface VisionneusePagesProps {
  /** Chemins d'API du domaine du document. */
  api: ApiIngestion;
  docId: string;
  pages: readonly ResumePageIngestion[];
  /** Page citée (`?page=N`) : mise en évidence. */
  pageCitee?: number | null;
  /** `texte_purge_le` du document : une fois daté, plus aucune page n'est proposée à l'ouverture. */
  textePurgeLe?: string | null;
  /** Statut du document : adapte le message quand aucune page n'est lue. */
  statut?: StatutDocumentIngestion;
  /** Motif de l'échec (déjà lisible), affiché sous le message d'absence de page. */
  motifEchec?: string | null;
}

type EtatPage =
  { etat: "chargement" } | { etat: "ok"; texte: string } | { etat: "erreur"; message: string };

/**
 * Pages lues d'un document : méthode, confiance, taille. Le texte d'une page est chargé à la
 * demande (jamais conservé hors de la mémoire de la page). Le texte est un contenu client : il
 * est affiché comme texte brut, jamais interprété.
 */
export function VisionneusePages({
  api,
  docId,
  pages,
  pageCitee = null,
  textePurgeLe = null,
  statut,
  motifEchec = null,
}: VisionneusePagesProps) {
  const [ouvertes, setOuvertes] = useState<Record<number, EtatPage | undefined>>({});

  async function basculer(numero: number) {
    const courant = ouvertes[numero];
    if (courant && courant.etat !== "erreur") {
      setOuvertes((o) => ({ ...o, [numero]: undefined }));
      return;
    }
    setOuvertes((o) => ({ ...o, [numero]: { etat: "chargement" } }));
    try {
      const p = await lirePageIngestion(api, docId, numero);
      setOuvertes((o) => ({ ...o, [numero]: { etat: "ok", texte: p.texte } }));
    } catch (e) {
      setOuvertes((o) => ({ ...o, [numero]: { etat: "erreur", message: messageErreur(e) } }));
    }
  }

  if (textePurge({ texte_purge_le: textePurgeLe })) {
    return (
      <p role="status">
        Le texte de ce document a été purgé le {formaterDate(textePurgeLe)} conformément à la durée
        de conservation ; les références de page restent valables.
      </p>
    );
  }

  if (pages.length === 0) {
    return <p role="status">{messageAucunePage(statut, motifEchec)}</p>;
  }

  return (
    <ul aria-label="Pages du document" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {pages.map((p) => {
        const e = ouvertes[p.numero];
        const citee = pageCitee === p.numero;
        const idTexte = `page-texte-${docId}-${p.numero}`;
        const ouverte = e?.etat === "ok";
        return (
          <li
            key={p.numero}
            id={`page-${p.numero}`}
            aria-current={citee ? "location" : undefined}
            style={{
              padding: "0.5rem 0.75rem",
              marginBottom: "0.5rem",
              border: citee ? "2px solid currentColor" : "1px solid rgba(128,128,128,0.4)",
              borderRadius: "0.5rem",
            }}
          >
            <div
              style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}
            >
              <strong>Page {p.numero}</strong>
              {citee ? <span>(page citée)</span> : null}
              <span>{libelleMethode(p.methode)}</span>
              <span>{formaterCaracteres(p.nb_caracteres)}</span>
              {methodeOcr(p.methode) ? (
                <span>Confiance {formaterConfiancePage(p.confiance_pm)}</span>
              ) : null}
              <Bouton
                variante="discret"
                aria-expanded={ouverte}
                aria-controls={idTexte}
                chargement={e?.etat === "chargement"}
                texteChargement="Chargement…"
                onClick={() => void basculer(p.numero)}
              >
                {ouverte
                  ? `Masquer le texte de la page ${p.numero}`
                  : `Voir le texte de la page ${p.numero}`}
              </Bouton>
            </div>
            <div id={idTexte} aria-live="polite">
              {e?.etat === "ok" ? (
                <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto", maxHeight: "24rem" }}>
                  {e.texte}
                </pre>
              ) : null}
              {e?.etat === "erreur" ? <p role="alert">{e.message}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
