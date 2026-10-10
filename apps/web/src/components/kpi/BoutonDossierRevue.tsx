"use client";

import { useEffect, useRef, useState } from "react";
import {
  messagePilotage,
  nomFichierDossierRevue,
  telechargerDossierRevue,
  type FormatDossierRevue,
} from "../../lib/kpi-pilotage";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { Bouton } from "../ui/Bouton";

const FORMATS: readonly (readonly [FormatDossierRevue, string])[] = [
  ["pdf", "Dossier (PDF)"],
  ["docx", "Dossier (Word)"],
  ["pptx", "Présentation (PowerPoint)"],
];

/**
 * Téléchargement du dossier de la revue : appel authentifié par le cookie de session (pas de lien
 * direct), pour qu'un refus (trop de dossiers demandés, rendu PDF indisponible…) s'affiche en
 * français au lieu d'un JSON brut. Le fichier est remis au navigateur sans être conservé.
 */
export function BoutonDossierRevue({ revueId, numero }: { revueId: string; numero: number }) {
  const [enCours, setEnCours] = useState<FormatDossierRevue | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const refAlerte = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  async function telecharger(format: FormatDossierRevue) {
    setErreur(null);
    setSucces(null);
    setEnCours(format);
    try {
      const fichier = await telechargerDossierRevue(revueId, format);
      const url = URL.createObjectURL(fichier);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = nomFichierDossierRevue(numero, format);
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSucces("Dossier téléchargé.");
    } catch (e) {
      setErreur(messagePilotage(e));
    } finally {
      setEnCours(null);
    }
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={erreur}
        succes={succes}
        refAlerte={refAlerte}
        titreErreur="Téléchargement impossible"
      />
      <div className="mp-actions-formulaire">
        {FORMATS.map(([format, libelle]) => (
          <Bouton
            key={format}
            variante="secondaire"
            icone="telechargement"
            disabled={enCours !== null && enCours !== format}
            chargement={enCours === format}
            texteChargement="Préparation…"
            onClick={() => void telecharger(format)}
          >
            {libelle}
          </Bouton>
        ))}
      </div>
    </div>
  );
}
