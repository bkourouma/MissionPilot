"use client";

import { useId, useState } from "react";
import { libelleVersion, versionPrecedente, type VersionContenuIa } from "../../lib/ia-contenu";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { BadgeContenuIa } from "./BadgeContenuIa";
import { DiffTexteIa } from "./DiffTexteIa";
import "./ia.css";

/**
 * Historique des versions d'un contenu IA (ajout seul) : la plus récente d'abord, chaque
 * version comparable à la précédente. Replié par défaut pour ne pas allonger l'écran.
 */
export function HistoriqueVersionsIa({ versions }: { versions: readonly VersionContenuIa[] }) {
  const t = useT();
  const langue = useLangue();
  const base = useId();
  const [ouverte, setOuverte] = useState<number | null>(null);
  if (versions.length === 0) return null;
  const triees = [...versions].sort((a, b) => b.version - a.version);
  return (
    <details className="mp-details">
      <summary>
        {t(`Historique des versions (${versions.length})`, `Version history (${versions.length})`)}
      </summary>
      <ol className="mp-versions-ia__liste">
        {triees.map((v) => {
          const precedente = versionPrecedente(versions, v.version);
          const idDetail = `${base}-v${v.version}`;
          const ouvert = ouverte === v.version;
          return (
            <li key={v.version} className="mp-versions-ia__element">
              <div className="mp-versions-ia__ligne">
                <BadgeContenuIa statut={v.statut_contenu} />
                <span>{libelleVersion(v, langue)}</span>
                {v.chiffres_acquittes ? (
                  <span className="mp-badge mp-badge--neutre">
                    {t("Chiffres attestés par le valideur", "Figures attested by the approver")}
                  </span>
                ) : v.chiffres_non_verifies ? (
                  <span className="mp-badge mp-badge--attention">
                    {t("Chiffres non vérifiés", "Unverified figures")}
                  </span>
                ) : null}
                <Bouton
                  variante="discret"
                  aria-expanded={ouvert}
                  aria-controls={idDetail}
                  onClick={() => setOuverte(ouvert ? null : v.version)}
                >
                  {precedente
                    ? ouvert
                      ? t(
                          `Masquer la version ${precedente.version}`,
                          `Hide version ${precedente.version}`,
                        )
                      : t(
                          `Comparer avec la version ${precedente.version}`,
                          `Compare with version ${precedente.version}`,
                        )
                    : ouvert
                      ? t("Masquer le texte", "Hide the text")
                      : t("Afficher le texte", "Show the text")}
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
