"use client";

import { Bouton } from "../ui/Bouton";

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
  }
  return (
    <Bouton variante="secondaire" icone="telechargement" onClick={exporter}>
      Exporter le dossier de preuve
    </Bouton>
  );
}
