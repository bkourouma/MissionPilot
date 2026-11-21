"use client";

import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/composants.css";
import "../styles/cadre.css";
import "../styles/socle-formulaires.css";
import "../styles/socle-donnees.css";
import { useEffect, useState } from "react";
import { LANGUE_PAR_DEFAUT, type Langue } from "@missionpilot/shared";
import { FournisseurLangue } from "../components/i18n/FournisseurLangue";
import { langueHorsFournisseur } from "../components/i18n/langue-client";
import { MessageErreur } from "../components/shell/MessageErreur";

/**
 * Dernier filet : erreur dans le layout racine lui-même, donc hors du fournisseur de langue. Le
 * premier rendu est en français (langue par défaut, identique côté serveur) ; une fois monté, la
 * langue du cookie du sélecteur (à défaut, de `<html lang>`) est appliquée.
 */
export default function ErreurGlobale({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [langue, setLangue] = useState<Langue>(LANGUE_PAR_DEFAUT);
  useEffect(() => {
    try {
      setLangue(langueHorsFournisseur(document.cookie, document.documentElement.lang || null));
    } catch {
      // Cookies inaccessibles : on reste en français.
    }
  }, []);
  return (
    <html lang={langue}>
      <body>
        <FournisseurLangue langue={langue}>
          <main className="mp-page--isolee">
            <MessageErreur erreur={error} reessayer={reset} />
          </main>
        </FournisseurLangue>
      </body>
    </html>
  );
}
