"use client";

import type { ChampConfirmation, SaisieConfirmation } from "../../lib/double-authentification";
import { useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";

export interface ChampsReconfirmationProps {
  saisie: SaisieConfirmation;
  onChange: (s: SaisieConfirmation) => void;
  erreurs: Partial<Record<ChampConfirmation | string, string>>;
  /** Pourquoi l'API redemande l'identité, ex. « modifier les coordonnées bancaires ». */
  motif: string;
  /** Version anglaise du motif (« change the firm's bank details ») ; sans elle, un texte générique. */
  motifEn?: string;
}

/**
 * Reconfirmation d'identité demandée par l'API avant une action à fort impact : mot de passe,
 * et code de l'application (ou code de secours) si la double authentification est active.
 */
export function ChampsReconfirmation({
  saisie,
  onChange,
  erreurs,
  motif,
  motifEn,
}: ChampsReconfirmationProps) {
  const t = useT();
  const secours = saisie.facteur === "secours";
  return (
    <fieldset className="mp-groupe mp-sous-formulaire">
      <legend className="mp-champ__libelle">
        {t("Confirmez votre identité", "Confirm your identity")}
      </legend>
      <Alerte tonalite="info" annonce="status">
        <p>
          {t(
            `Pour ${motif}, saisissez votre mot de passe et, si votre double authentification est active, le code de votre application.`,
            `${motifEn ? `To ${motifEn}` : "To continue"}, enter your password and, if your two-factor authentication is active, the code from your app.`,
          )}
        </p>
      </Alerte>
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Mot de passe", "Password")}
          type="password"
          autoComplete="current-password"
          required
          value={saisie.motDePasse}
          onChange={(e) => onChange({ ...saisie, motDePasse: e.target.value })}
          erreur={erreurs.mot_de_passe}
        />
        <Champ
          key={saisie.facteur}
          libelle={
            secours ? t("Code de secours", "Backup code") : t("Code à 6 chiffres", "6-digit code")
          }
          inputMode={secours ? "text" : "numeric"}
          autoComplete={secours ? "off" : "one-time-code"}
          maxLength={secours ? 40 : 7}
          value={saisie.code}
          onChange={(e) => onChange({ ...saisie, code: e.target.value })}
          erreur={erreurs.code}
        />
      </div>
      <div>
        <Bouton
          variante="discret"
          onClick={() => onChange({ ...saisie, code: "", facteur: secours ? "totp" : "secours" })}
        >
          {secours
            ? t("Utiliser le code de l'application", "Use the app code")
            : t("Utiliser un code de secours", "Use a backup code")}
        </Bouton>
      </div>
    </fieldset>
  );
}
