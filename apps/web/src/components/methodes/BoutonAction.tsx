"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, messageErreur } from "../../lib/api";
import { messageMethodes } from "../../lib/methodes";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { Alerte } from "../ui/Alerte";
import { Bouton, type VarianteBouton } from "../ui/Bouton";
import type { NomIcone } from "../ui/Icone";

export interface BoutonActionProps {
  libelle: string;
  /** Chemin de l'API (`/api/...`). */
  chemin: string;
  methode?: "POST" | "DELETE";
  corps?: unknown;
  /** Action sensible : confirmation en deux temps. */
  confirmation?: { question: string; libelleConfirmation: string };
  /** Page à ouvrir après succès (à partir de la réponse) ; sinon rafraîchissement. */
  destination?: (reponse: unknown) => string;
  variante?: VarianteBouton;
  icone?: NomIcone;
  texteChargement?: string;
}

/** Action ponctuelle sur l'API (publier, créer une variante, supprimer…) avec retour d'erreur. */
export function BoutonAction({
  libelle,
  chemin,
  methode = "POST",
  corps,
  confirmation,
  destination,
  variante = "secondaire",
  icone,
  texteChargement = "En cours…",
}: BoutonActionProps) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const refAlerte = useRef<HTMLDivElement>(null);

  async function agir(): Promise<boolean> {
    setErreur(null);
    setEnCours(true);
    try {
      const r =
        methode === "DELETE"
          ? await api.supprimer(chemin)
          : await api.post<unknown>(chemin, corps ?? {});
      if (destination) router.push(destination(r));
      else router.refresh();
      return true;
    } catch (e) {
      setErreur(messageMethodes(e) ?? messageErreur(e));
      setTimeout(() => refAlerte.current?.focus(), 0);
      return false;
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      {confirmation ? (
        <BoutonConfirmation
          libelle={libelle}
          question={confirmation.question}
          libelleConfirmation={confirmation.libelleConfirmation}
          action={agir}
          variante={variante}
          icone={icone}
          texteChargement={texteChargement}
        />
      ) : (
        <Bouton
          variante={variante}
          icone={icone}
          chargement={enCours}
          texteChargement={texteChargement}
          onClick={() => void agir()}
        >
          {libelle}
        </Bouton>
      )}
      {erreur ? (
        <Alerte ref={refAlerte} tonalite="danger" titre="Action impossible">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </div>
  );
}
