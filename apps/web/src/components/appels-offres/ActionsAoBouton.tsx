"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { messageAo } from "../../lib/appels-offres";
import { Alerte } from "../ui/Alerte";
import { Bouton, type VarianteBouton } from "../ui/Bouton";

export const seg = (id: string) => encodeURIComponent(id);

/** Bouton qui exécute une action d'API puis rafraîchit la page ; erreur annoncée en dessous. */
export function BoutonActionAo({
  children,
  action,
  variante = "secondaire",
  confirmation,
}: {
  children: ReactNode;
  action: () => Promise<unknown>;
  variante?: VarianteBouton;
  confirmation?: string;
}) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <span className="mp-pile">
      <Bouton
        variante={variante}
        chargement={enCours}
        onClick={async () => {
          if (confirmation && !window.confirm(confirmation)) return;
          setEnCours(true);
          setErreur(null);
          try {
            await action();
            router.refresh();
          } catch (e) {
            setErreur(messageAo(e));
          } finally {
            setEnCours(false);
          }
        }}
      >
        {children}
      </Bouton>
      {erreur ? (
        <Alerte tonalite="danger">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </span>
  );
}
