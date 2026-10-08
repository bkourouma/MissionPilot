"use client";

import type { ChampConfirmation, SaisieConfirmation } from "../../lib/double-authentification";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";

export interface ChampsReconfirmationProps {
  saisie: SaisieConfirmation;
  onChange: (s: SaisieConfirmation) => void;
  erreurs: Partial<Record<ChampConfirmation | string, string>>;
  /** Pourquoi l'API redemande l'identité, ex. « modifier les coordonnées bancaires ». */
  motif: string;
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
}: ChampsReconfirmationProps) {
  const secours = saisie.facteur === "secours";
  return (
    <fieldset className="mp-groupe mp-sous-formulaire">
      <legend className="mp-champ__libelle">Confirmez votre identité</legend>
      <Alerte tonalite="info" annonce="status">
        <p>{`Pour ${motif}, saisissez votre mot de passe et, si votre double authentification est active, le code de votre application.`}</p>
      </Alerte>
      <div className="mp-grille-champs">
        <Champ
          libelle="Mot de passe"
          type="password"
          autoComplete="current-password"
          required
          value={saisie.motDePasse}
          onChange={(e) => onChange({ ...saisie, motDePasse: e.target.value })}
          erreur={erreurs.mot_de_passe}
        />
        <Champ
          key={saisie.facteur}
          libelle={secours ? "Code de secours" : "Code à 6 chiffres"}
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
          {secours ? "Utiliser le code de l'application" : "Utiliser un code de secours"}
        </Bouton>
      </div>
    </fieldset>
  );
}
