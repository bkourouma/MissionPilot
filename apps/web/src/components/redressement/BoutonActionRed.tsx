"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../lib/api";
import { messageRedressement } from "../../lib/redressement";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useEffacementSucces } from "../kpi/useEffacementSucces";
import { Bouton, type VarianteBouton } from "../ui/Bouton";

export interface BoutonActionRedProps {
  libelle: string;
  chemin: string;
  methode?: "POST" | "PATCH" | "PUT";
  corps?: unknown;
  /** Message annoncé après succès. */
  succes: string;
  titreErreur?: string;
  variante?: VarianteBouton;
  texteChargement?: string;
  /** Raison affichée quand le bouton est désactivé (jamais désactivé sans raison visible). */
  desactiveParce?: string;
  /** Action lourde de conséquences : un premier clic demande confirmation. */
  confirmation?: { question: string; libelleConfirmation: string };
}

/**
 * Action d'un clic sur l'API du redressement (publier des seuils, valider une version du plan,
 * passer le dossier en mise en œuvre…) : appel authentifié par le cookie de session, erreur
 * focalisée et annoncée, page rafraîchie après succès. L'API reste seule juge de l'état.
 */
export function BoutonActionRed({
  libelle,
  chemin,
  methode = "POST",
  corps = {},
  succes,
  titreErreur = "Action impossible",
  variante = "secondaire",
  texteChargement = "En cours…",
  desactiveParce,
  confirmation,
}: BoutonActionRedProps) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [reussi, setReussi] = useState<string | null>(null);
  const idRaison = useId();
  const verrou = useRef(false);
  const refAlerte = useRef<HTMLDivElement>(null);
  const signaler = useEffacementSucces(() => setReussi(null));
  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  /** Vrai si l'appel a abouti. */
  async function lancer(): Promise<boolean> {
    // Anti double clic : un seul appel à la fois.
    if (verrou.current) return false;
    verrou.current = true;
    signaler();
    setErreur(null);
    setReussi(null);
    setEnCours(true);
    try {
      if (methode === "POST") await api.post(chemin, corps);
      else if (methode === "PUT") await api.put(chemin, corps);
      else await api.patch(chemin, corps);
      setReussi(succes);
      router.refresh();
      return true;
    } catch (e) {
      setErreur(messageRedressement(e));
      return false;
    } finally {
      verrou.current = false;
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={erreur}
        succes={reussi}
        refAlerte={refAlerte}
        titreErreur={titreErreur}
      />
      <div className="mp-actions-formulaire">
        {desactiveParce ? (
          <>
            <Bouton variante={variante} disabled aria-describedby={idRaison}>
              {libelle}
            </Bouton>
            <span id={idRaison} className="mp-texte-doux mp-texte-petit">
              {desactiveParce}
            </span>
          </>
        ) : confirmation ? (
          <BoutonConfirmation
            libelle={libelle}
            question={confirmation.question}
            libelleConfirmation={confirmation.libelleConfirmation}
            variante={variante}
            texteChargement={texteChargement}
            action={lancer}
          />
        ) : (
          <Bouton
            variante={variante}
            chargement={enCours}
            texteChargement={texteChargement}
            onClick={() => void lancer()}
          >
            {libelle}
          </Bouton>
        )}
      </div>
    </div>
  );
}
