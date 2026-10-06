"use client";

import { useEffect, useRef, useState } from "react";
import { texteCodesSecours } from "../../lib/double-authentification";
import { formaterDate } from "../../lib/format";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";

export interface CodesSecoursProps {
  codes: readonly string[];
  email: string;
  /** Appelé quand l'utilisateur confirme avoir noté ses codes : ils disparaissent de l'écran. */
  onTerminer: () => void;
}

/**
 * Affichage UNIQUE des codes de secours : copie, téléchargement en fichier texte, et
 * confirmation « j'ai noté mes codes » avant de quitter. Les codes ne vivent que dans l'état
 * mémoire du composant parent.
 */
export function CodesSecours({ codes, email, onTerminer }: CodesSecoursProps) {
  const [note, setNote] = useState(false);
  const [retour, setRetour] = useState<string | null>(null);
  const titre = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titre.current?.focus();
  }, []);

  const contenu = () => texteCodesSecours(codes, email, formaterDate(new Date(), "Africa/Abidjan"));

  async function copier() {
    try {
      await navigator.clipboard.writeText(contenu());
      setRetour("Codes copiés dans le presse-papiers.");
    } catch {
      setRetour(
        "Copie impossible sur cet appareil : téléchargez le fichier ou recopiez les codes.",
      );
    }
  }

  function telecharger() {
    const url = URL.createObjectURL(new Blob([contenu()], { type: "text/plain;charset=utf-8" }));
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = "missionpilot-codes-de-secours.txt";
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    URL.revokeObjectURL(url);
    setRetour("Fichier des codes téléchargé.");
  }

  return (
    <div className="mp-pile">
      <h3 ref={titre} tabIndex={-1} className="mp-sous-formulaire__titre">
        Vos 10 codes de secours
      </h3>
      <Alerte tonalite="attention" annonce="aucune" titre="Affichés une seule fois">
        <p>
          Chaque code permet une connexion si vous n&apos;avez plus votre téléphone, et ne sert
          qu&apos;une fois. Conservez-les hors de votre téléphone (papier, coffre-fort de mots de
          passe). Ils ne seront plus jamais affichés.
        </p>
      </Alerte>
      <ol className="mp-codes-secours" aria-label="Codes de secours">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <div className="mp-barre-actions">
        <Bouton variante="secondaire" icone="copie" onClick={copier}>
          Copier les codes
        </Bouton>
        <Bouton variante="secondaire" icone="flecheBas" onClick={telecharger}>
          Télécharger (fichier texte)
        </Bouton>
      </div>
      {retour ? (
        <p className="mp-texte-doux" role="status">
          {retour}
        </p>
      ) : null}
      <CaseACocher
        libelle="J'ai noté mes codes de secours en lieu sûr"
        checked={note}
        onChange={(e) => setNote(e.target.checked)}
      />
      <div>
        <Bouton disabled={!note} onClick={onTerminer}>
          Terminer
        </Bouton>
      </div>
    </div>
  );
}
