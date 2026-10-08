"use client";

import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/composants.css";
import "../styles/cadre.css";
import { MessageErreur } from "../components/shell/MessageErreur";

/** Dernier filet : erreur dans le layout racine lui-même. */
export default function ErreurGlobale({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body>
        <main className="mp-page--isolee">
          <MessageErreur erreur={error} reessayer={reset} />
        </main>
      </body>
    </html>
  );
}
