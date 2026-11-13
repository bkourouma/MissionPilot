"use client";

import { LANGUES, LIBELLES_LANGUES } from "@missionpilot/shared";
import { changerLangue, useLangue, useT } from "./FournisseurLangue";

/** Bascule français / anglais : deux boutons, l'actif est marqué `aria-pressed`. */
export function SelecteurLangue({ className }: { className?: string }) {
  const langue = useLangue();
  const t = useT();
  return (
    <div
      className={["mp-langue", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={t("Langue de l'interface", "Interface language")}
    >
      {LANGUES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          className="mp-langue__choix"
          aria-pressed={l === langue}
          title={LIBELLES_LANGUES[l]}
          onClick={() => {
            if (l !== langue) changerLangue(l);
          }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
