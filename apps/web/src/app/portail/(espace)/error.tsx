"use client";

import { MessageErreur } from "../../../components/shell/MessageErreur";

/** Erreur dans une page de l'espace client : affichée dans le cadre (navigation conservée). */
export default function ErreurEspaceClient({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <MessageErreur erreur={error} reessayer={reset} />;
}
