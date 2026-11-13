"use client";

import { useMemo } from "react";
import { diffTextes, libelleResumeDiff } from "../../lib/ia-diff";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import "./ia.css";

/**
 * Différences entre deux versions d'un texte : ajouts soulignés, retraits barrés (pas seulement
 * colorés), balisés `ins` / `del` avec un repère lu par les lecteurs d'écran.
 */
export function DiffTexteIa({ avant, apres }: { avant: string; apres: string }) {
  const t = useT();
  const langue = useLangue();
  const segments = useMemo(() => diffTextes(avant, apres), [avant, apres]);
  if (!segments) {
    return (
      <p className="mp-texte-doux">
        {t(
          "Textes trop longs et trop différents pour être comparés à l'écran : consultez chaque version séparément.",
          "Texts too long and too different to be compared on screen: view each version separately.",
        )}
      </p>
    );
  }
  return (
    <div className="mp-diff-ia">
      <p className="mp-texte-petit">
        {libelleResumeDiff(segments, langue)}{" "}
        <span className="mp-texte-doux">
          {t(
            "Ajouts soulignés, retraits barrés.",
            "Additions underlined, removals struck through.",
          )}
        </span>
      </p>
      <p className="mp-contenu-ia__texte">
        {segments.map((s, i) =>
          s.nature === "egal" ? (
            <span key={i}>{s.texte}</span>
          ) : s.nature === "ajout" ? (
            <ins key={i}>
              <span className="mp-visuellement-cache">
                {t("[début d'ajout] ", "[start of addition] ")}
              </span>
              {s.texte}
              <span className="mp-visuellement-cache">
                {t(" [fin d'ajout]", " [end of addition]")}
              </span>
            </ins>
          ) : (
            <del key={i}>
              <span className="mp-visuellement-cache">
                {t("[début de retrait] ", "[start of removal] ")}
              </span>
              {s.texte}
              <span className="mp-visuellement-cache">
                {t(" [fin de retrait]", " [end of removal]")}
              </span>
            </del>
          ),
        )}
      </p>
    </div>
  );
}
