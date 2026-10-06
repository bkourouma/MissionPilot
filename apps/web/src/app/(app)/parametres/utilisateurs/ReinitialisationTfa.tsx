"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { ChampsReconfirmation } from "../../../../components/securite/ChampsReconfirmation";
import { Bouton } from "../../../../components/ui/Bouton";
import { api } from "../../../../lib/api";
import {
  avecReconfirmation,
  confirmationDemandee,
  messageReconfirmation,
  SAISIE_CONFIRMATION_VIDE,
  type SaisieConfirmation,
} from "../../../../lib/double-authentification";

/**
 * Réinitialisation de la 2FA d'une autre personne (téléphone perdu), confirmation en deux
 * temps ; si l'API redemande l'identité de l'associé, ses champs s'affichent avant l'envoi.
 */
export function ReinitialisationTfa({
  utilisateurId,
  nom,
}: {
  utilisateurId: string;
  nom: string;
}) {
  const [confirmation, setConfirmation] = useState<SaisieConfirmation | null>(null);
  const f = useFormulaire<"mot_de_passe" | "code">();
  const chemin = `/api/utilisateurs/${encodeURIComponent(utilisateurId)}/2fa/reinitialiser`;

  const envoyer = (c: SaisieConfirmation | null) =>
    f.envoyer(
      avecReconfirmation({ ok: true, charge: {} }, c),
      (charge) => api.post(chemin, charge, { redirigerSi401: false }),
      {
        succes: `Double authentification de ${nom} réinitialisée : ses sessions sont fermées.`,
        apres: () => setConfirmation(null),
        messageSpecifique: (e) => {
          if (confirmationDemandee(e)) setConfirmation((x) => x ?? SAISIE_CONFIRMATION_VIDE);
          return messageReconfirmation(e, c?.facteur ?? "totp");
        },
      },
    );

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await envoyer(confirmation);
    if (!ok) setConfirmation((x) => (x ? { ...x, motDePasse: "", code: "" } : x));
  }

  return (
    <div className="mp-pile mp-pleine-largeur">
      <RetourFormulaire
        erreur={confirmation ? null : f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Réinitialisation impossible"
      />
      {confirmation ? (
        <form
          ref={f.refFormulaire}
          className="mp-formulaire"
          noValidate
          onSubmit={soumettre}
          aria-label={`Réinitialiser la double authentification de ${nom}`}
        >
          <RetourFormulaire
            erreur={f.erreurGlobale}
            refAlerte={f.refAlerte}
            titreErreur="Réinitialisation impossible"
          />
          <ChampsReconfirmation
            saisie={confirmation}
            onChange={setConfirmation}
            erreurs={f.erreurs}
            motif={`réinitialiser la double authentification de ${nom}`}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              variante="danger"
              chargement={f.enCours}
              texteChargement="Réinitialisation…"
            >
              Confirmer la réinitialisation
            </Bouton>
            <Bouton variante="discret" onClick={() => setConfirmation(null)}>
              Annuler
            </Bouton>
          </div>
        </form>
      ) : (
        <div>
          <BoutonConfirmation
            libelle="Réinitialiser la double authentification"
            icone="cadenas"
            ariaLabel={`Réinitialiser la double authentification de ${nom}`}
            question={`Réinitialiser la double authentification de ${nom} ? Ses codes et ses sessions seront supprimés ; la personne devra la reconfigurer.`}
            libelleConfirmation="Oui, réinitialiser"
            texteChargement="Réinitialisation…"
            action={() => envoyer(null)}
          />
        </div>
      )}
    </div>
  );
}
