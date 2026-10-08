"use client";

import { useId, useState } from "react";
import { libelleVersion, versionPrecedente, type VersionContenuIa } from "../../lib/ia-contenu";
import { Bouton } from "../ui/Bouton";
import { BadgeContenuIa } from "./BadgeContenuIa";
import { DiffTexteIa } from "./DiffTexteIa";
import "./ia.css";

/**
 * Historique des versions d'un contenu IA (ajout seul) : la plus récente d'abord, chaque
 * version comparable à la précédente. Replié par défaut pour ne pas allonger l'écran.
 */
export function HistoriqueVersionsIa({ versions }: { versions: readonly VersionContenuIa[] }) {
  const base = useId();
  const [ouverte, setOuverte] = useState<number | null>(null);
  if (versions.length === 0) return null;
  const triees = [...versions].sort((a, b) => b.version - a.version);
  return (
    <details className="mp-details">
      <summary>{`Historique des versions (${versions.length})`}</summary>
      <ol className="mp-versions-ia__liste">
        {triees.map((v) => {
          const precedente = versionPrecedente(versions, v.version);
          const idDetail = `${base}-v${v.version}`;
          const ouvert = ouverte === v.version;
          return (
            <li key={v.version} className="mp-versions-ia__element">
              <div className="mp-versions-ia__ligne">
                <BadgeContenuIa statut={v.statut_contenu} />
                <span>{libelleVersion(v)}</span>
                {v.chiffres_acquittes ? (
                  <span className="mp-badge mp-badge--neutre">
                    Chiffres attestés par le valideur
                  </span>
                ) : v.chiffres_non_verifies ? (
                  <span className="mp-badge mp-badge--attention">Chiffres non vérifiés</span>
                ) : null}
                <Bouton
                  variante="discret"
                  aria-expanded={ouvert}
                  aria-controls={idDetail}
                  onClick={() => setOuverte(ouvert ? null : v.version)}
                >
                  {precedente
                    ? `${ouvert ? "Masquer" : "Comparer avec"} la version ${precedente.version}`
                    : ouvert
                      ? "Masquer le texte"
                      : "Afficher le texte"}
                </Bouton>
              </div>
              <div id={idDetail} hidden={!ouvert}>
                {ouvert ? (
                  precedente ? (
                    <DiffTexteIa avant={precedente.texte} apres={v.texte} />
                  ) : (
                    <p className="mp-contenu-ia__texte">{v.texte}</p>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
