"use client";

import { MessageErreur } from "../../components/shell/MessageErreur";

/** Erreur dans une page : affichée dans le cadre applicatif (navigation conservée). */
export default function ErreurPageApplication({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <MessageErreur erreur={error} reessayer={reset} />;
}
