"use client";

import { MessageErreur } from "../components/shell/MessageErreur";

/** Error boundary des pages (le cadre applicatif reste affiché quand l'erreur vient d'une page). */
export default function ErreurPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mp-page--isolee">
      <MessageErreur erreur={error} reessayer={reset} />
    </main>
  );
}
