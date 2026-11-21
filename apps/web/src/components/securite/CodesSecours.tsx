"use client";

import { useEffect, useRef, useState } from "react";
import { texteCodesSecours } from "../../lib/double-authentification";
import { formaterDate } from "../../lib/format";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const [note, setNote] = useState(false);
  const [retour, setRetour] = useState<string | null>(null);
  const titre = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titre.current?.focus();
  }, []);

  const contenu = () =>
    texteCodesSecours(codes, email, formaterDate(new Date(), "Africa/Abidjan", langue), langue);

  async function copier() {
    try {
      await navigator.clipboard.writeText(contenu());
      setRetour(t("Codes copiés dans le presse-papiers.", "Codes copied to the clipboard."));
    } catch {
      setRetour(
        t(
          "Copie impossible sur cet appareil : téléchargez le fichier ou recopiez les codes.",
          "Copy is not possible on this device: download the file or copy the codes by hand.",
        ),
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
    setRetour(t("Fichier des codes téléchargé.", "Codes file downloaded."));
  }

  return (
    <div className="mp-pile">
      <h3 ref={titre} tabIndex={-1} className="mp-sous-formulaire__titre">
        {t("Vos 10 codes de secours", "Your 10 backup codes")}
      </h3>
      <Alerte
        tonalite="attention"
        annonce="aucune"
        titre={t("Affichés une seule fois", "Shown only once")}
      >
        <p>
          {t(
            "Chaque code permet une connexion si vous n'avez plus votre téléphone, et ne sert qu'une fois. Conservez-les hors de votre téléphone (papier, coffre-fort de mots de passe). Ils ne seront plus jamais affichés.",
            "Each code lets you sign in if you no longer have your phone, and can only be used once. Keep them away from your phone (paper, password manager). They will never be shown again.",
          )}
        </p>
      </Alerte>
      <ol className="mp-codes-secours" aria-label={t("Codes de secours", "Backup codes")}>
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <div className="mp-barre-actions">
        <Bouton variante="secondaire" icone="copie" onClick={copier}>
          {t("Copier les codes", "Copy the codes")}
        </Bouton>
        <Bouton variante="secondaire" icone="flecheBas" onClick={telecharger}>
          {t("Télécharger (fichier texte)", "Download (text file)")}
        </Bouton>
      </div>
      {retour ? (
        <p className="mp-texte-doux" role="status">
          {retour}
        </p>
      ) : null}
      <CaseACocher
        libelle={t(
          "J'ai noté mes codes de secours en lieu sûr",
          "I have saved my backup codes in a safe place",
        )}
        checked={note}
        onChange={(e) => setNote(e.target.checked)}
      />
      <div className="mp-actions-formulaire">
        <Bouton disabled={!note} aria-describedby="codes-secours-aide" onClick={onTerminer}>
          {t("Terminer", "Done")}
        </Bouton>
        {note ? null : (
          <p id="codes-secours-aide" className="mp-texte-doux mp-texte-petit">
            {t("Cochez la case ci-dessus pour continuer.", "Tick the box above to continue.")}
          </p>
        )}
      </div>
    </div>
  );
}
