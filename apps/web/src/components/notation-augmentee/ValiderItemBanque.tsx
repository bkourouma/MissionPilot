"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  cheminValiderItem,
  etatNotationAugmenteeChange,
  messageNotationAugmentee,
} from "../../lib/notation-augmentee";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";

export interface ValiderItemBanqueProps {
  itemId: string;
  code: string;
  version: number;
  statut: string;
  /** Explication quand la validation est impossible (bouton affiché mais désactivé), sinon `null`. */
  desactive: string | null;
}

/**
 * Validation d'une version d'item par un expert métier qui n'en est ni l'auteur ni le dernier
 * modificateur (séparation des tâches, MPN04). Confirmation en deux temps : la version validée est
 * figée (MPN08). Le bouton n'est affiché qu'à qui détient `notation.publier` ; pour l'auteur il est
 * désactivé avec l'explication. L'API reste seule juge et son refus est affiché.
 */
export function ValiderItemBanque({
  itemId,
  code,
  version,
  statut,
  desactive,
}: ValiderItemBanqueProps) {
  const router = useRouter();
  const idExplication = useId();
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const refAlerte = useRef<HTMLDivElement>(null);
  const [attente, attendre] = useAttenteRafraichissement(statut);
  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  async function valider(): Promise<boolean> {
    if (attente) return false;
    setErreur(null);
    setSucces(null);
    try {
      await api.post(cheminValiderItem(itemId));
      setSucces(`Version ${version} validée : elle est figée et peut servir aux questionnaires.`);
      attendre();
      router.refresh();
      return true;
    } catch (e) {
      setErreur(messageNotationAugmentee(e));
      if (etatNotationAugmenteeChange(e)) router.refresh();
      return false;
    }
  }

  return (
    <div className="mp-pile">
      {erreur ? (
        <Alerte ref={refAlerte} tonalite="danger" titre="Validation impossible">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}
      <div className="mp-barre-actions">
        {desactive ? (
          <Bouton variante="primaire" icone="succes" disabled aria-describedby={idExplication}>
            Valider cet item
          </Bouton>
        ) : (
          <BoutonConfirmation
            libelle="Valider cet item"
            question={`Valider la version ${version} de l'item « ${code} » ? Elle sera figée : seule une nouvelle version pourra la corriger.`}
            libelleConfirmation="Oui, valider"
            texteChargement="Validation…"
            variante="primaire"
            icone="succes"
            action={valider}
          />
        )}
      </div>
      {desactive ? (
        <p id={idExplication} className="mp-texte-doux mp-texte-petit">
          {desactive}
        </p>
      ) : null}
    </div>
  );
}
