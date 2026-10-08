"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { ChampsReconfirmation } from "../../../../components/securite/ChampsReconfirmation";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { SAISIE_CONFIRMATION_VIDE } from "../../../../lib/double-authentification";
import {
  formaterMicroUsd,
  hausseDePlafond,
  lirePlafond,
  plafondVersSaisie,
  textePlafondPlateforme,
  type ParametresIa,
} from "../../../../lib/ia";
import { useEnregistrementIa } from "./useEnregistrementIa";

/**
 * Plafond mensuel de coût IA du cabinet (mois civil). Au-delà, les générations par l'IA sont
 * refusées. Une hausse engage une dépense : l'identité de l'auteur est redemandée.
 */
export function PlafondIa({ parametres }: { parametres: ParametresIa }) {
  const actuel = parametres.plafond_mensuel_micro_usd;
  const [saisie, setSaisie] = useState(() => plafondVersSaisie(actuel));
  const [info, setInfo] = useState<string | null>(null);
  const e = useEnregistrementIa<"plafond">();
  const lu = lirePlafond(saisie);
  const hausse = lu.ok && hausseDePlafond(lu.charge.plafond_mensuel_micro_usd, actuel);
  const afficherConfirmation = hausse || e.confirmation !== null;
  const plateforme = textePlafondPlateforme(parametres);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setInfo(null);
    if (lu.ok && lu.charge.plafond_mensuel_micro_usd === actuel) {
      setInfo("Plafond inchangé : rien à enregistrer.");
      return;
    }
    await e.enregistrer(lu, { succes: "Plafond mensuel enregistré.", exigerConfirmation: hausse });
  }

  return (
    <form
      ref={e.f.refFormulaire}
      className="mp-formulaire"
      method="post"
      noValidate
      onSubmit={soumettre}
    >
      <RetourFormulaire erreur={e.f.erreurGlobale} succes={e.f.succes} refAlerte={e.f.refAlerte} />
      {info ? (
        <p className="mp-texte-doux" role="status">
          {info}
        </p>
      ) : null}
      <div className="mp-grille-champs">
        <Champ
          libelle="Plafond mensuel (dollars US)"
          aide={`Actuellement ${formaterMicroUsd(actuel)}. 0 bloque tout appel facturé. Une hausse demande de confirmer votre identité.`}
          inputMode="decimal"
          required
          maxLength={12}
          value={saisie}
          onChange={(ev) => {
            setSaisie(ev.target.value);
            setInfo(null);
          }}
          erreur={e.f.erreurs.plafond}
        />
      </div>
      {plateforme ? <p className="mp-texte-petit">{plateforme}</p> : null}
      {afficherConfirmation ? (
        <ChampsReconfirmation
          saisie={e.confirmation ?? SAISIE_CONFIRMATION_VIDE}
          onChange={e.setConfirmation}
          erreurs={e.f.erreurs}
          motif="relever le plafond mensuel de coût IA"
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={e.f.enCours} texteChargement="Enregistrement…">
          Enregistrer le plafond
        </Bouton>
      </div>
    </form>
  );
}
