"use client";

import { useState } from "react";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { useT } from "../i18n/FournisseurLangue";

export interface ExporterDossierPreuveProps {
  /** Dossier de preuve en JSON, déjà mis en forme côté serveur (propriété sérialisable). */
  contenu: string;
  nomFichier: string;
}

/**
 * Exporte le dossier de preuve (JSON seul) tel que reçu de l'API, sans nouvel appel : le fichier
 * est fabriqué dans le navigateur à partir de ce qui est affiché.
 */
export function ExporterDossierPreuve({ contenu, nomFichier }: ExporterDossierPreuveProps) {
  const t = useT();
  const [exporte, setExporte] = useState(false);
  function exporter() {
    const blob = new Blob([contenu], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = nomFichier;
    lien.rel = "noopener";
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    URL.revokeObjectURL(url);
    setExporte(true);
  }
  return (
    <>
      <Bouton variante="secondaire" icone="telechargement" onClick={exporter}>
        {t("Exporter le dossier de preuve", "Export the evidence file")}
      </Bouton>
      {exporte ? (
        <Alerte tonalite="succes" annonce="status">
          <p>
            {t(
              `Dossier de preuve exporté : fichier JSON « ${nomFichier} » téléchargé.`,
              `Evidence file exported: JSON file "${nomFichier}" downloaded.`,
            )}
          </p>
        </Alerte>
      ) : null}
    </>
  );
}
