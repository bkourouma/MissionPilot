"use client";

import { useMemo } from "react";
import { diffTextes, libelleResumeDiff } from "../../lib/ia-diff";
import "./ia.css";

/**
 * Différences entre deux versions d'un texte : ajouts soulignés, retraits barrés (pas seulement
 * colorés), balisés `ins` / `del` avec un repère lu par les lecteurs d'écran.
 */
export function DiffTexteIa({ avant, apres }: { avant: string; apres: string }) {
  const segments = useMemo(() => diffTextes(avant, apres), [avant, apres]);
  if (!segments) {
    return (
      <p className="mp-texte-doux">
        Textes trop longs et trop différents pour être comparés à l&apos;écran : consultez chaque
        version séparément.
      </p>
    );
  }
  return (
    <div className="mp-diff-ia">
      <p className="mp-texte-petit">
        {libelleResumeDiff(segments)}{" "}
        <span className="mp-texte-doux">Ajouts soulignés, retraits barrés.</span>
      </p>
      <p className="mp-contenu-ia__texte">
        {segments.map((s, i) =>
          s.nature === "egal" ? (
            <span key={i}>{s.texte}</span>
          ) : s.nature === "ajout" ? (
            <ins key={i}>
              <span className="mp-visuellement-cache">[début d&apos;ajout] </span>
              {s.texte}
              <span className="mp-visuellement-cache"> [fin d&apos;ajout]</span>
            </ins>
          ) : (
            <del key={i}>
              <span className="mp-visuellement-cache">[début de retrait] </span>
              {s.texte}
              <span className="mp-visuellement-cache"> [fin de retrait]</span>
            </del>
          ),
        )}
      </p>
    </div>
  );
}
