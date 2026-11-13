"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { ChampsReconfirmation } from "../../../../components/securite/ChampsReconfirmation";
import { Bouton } from "../../../../components/ui/Bouton";
import { api } from "../../../../lib/api";
import {
  avecReconfirmation,
  confirmationDemandee,
  messageReconfirmation,
  messageSpecifiqueLangue,
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
  const t = useT();
  const langue = useLangue();
  const [confirmation, setConfirmation] = useState<SaisieConfirmation | null>(null);
  const f = useFormulaire<"mot_de_passe" | "code">();
  const chemin = `/api/utilisateurs/${encodeURIComponent(utilisateurId)}/2fa/reinitialiser`;

  const envoyer = (c: SaisieConfirmation | null) =>
    f.envoyer(
      avecReconfirmation({ ok: true, charge: {} }, c, langue),
      (charge) => api.post(chemin, charge, { redirigerSi401: false }),
      {
        succes: t(
          `Double authentification de ${nom} réinitialisée : ses sessions sont fermées.`,
          `Two-factor authentication of ${nom} reset: their sessions are closed.`,
        ),
        apres: () => setConfirmation(null),
        messageSpecifique: (e) => {
          if (confirmationDemandee(e)) setConfirmation((x) => x ?? SAISIE_CONFIRMATION_VIDE);
          return (
            messageReconfirmation(e, c?.facteur ?? "totp", langue) ??
            messageSpecifiqueLangue(langue)(e)
          );
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
        titreErreur={t("Réinitialisation impossible", "Unable to reset")}
      />
      {confirmation ? (
        <form
          ref={f.refFormulaire}
          className="mp-formulaire"
          noValidate
          onSubmit={soumettre}
          aria-label={t(
            `Réinitialiser la double authentification de ${nom}`,
            `Reset the two-factor authentication of ${nom}`,
          )}
        >
          <RetourFormulaire
            erreur={f.erreurGlobale}
            refAlerte={f.refAlerte}
            titreErreur={t("Réinitialisation impossible", "Unable to reset")}
          />
          <ChampsReconfirmation
            saisie={confirmation}
            onChange={setConfirmation}
            erreurs={f.erreurs}
            motif={`réinitialiser la double authentification de ${nom}`}
            motifEn={`reset the two-factor authentication of ${nom}`}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              variante="danger"
              chargement={f.enCours}
              texteChargement={t("Réinitialisation…", "Resetting…")}
            >
              {t("Confirmer la réinitialisation", "Confirm the reset")}
            </Bouton>
            <Bouton variante="discret" onClick={() => setConfirmation(null)}>
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </form>
      ) : (
        <div>
          <BoutonConfirmation
            libelle={t(
              "Réinitialiser la double authentification",
              "Reset two-factor authentication",
            )}
            icone="cadenas"
            ariaLabel={t(
              `Réinitialiser la double authentification de ${nom}`,
              `Reset the two-factor authentication of ${nom}`,
            )}
            question={t(
              `Réinitialiser la double authentification de ${nom} ? Ses codes et ses sessions seront supprimés ; la personne devra la reconfigurer.`,
              `Reset the two-factor authentication of ${nom}? Their codes and sessions will be deleted; the person will need to set it up again.`,
            )}
            libelleConfirmation={t("Oui, réinitialiser", "Yes, reset")}
            texteChargement={t("Réinitialisation…", "Resetting…")}
            action={() => envoyer(null)}
          />
        </div>
      )}
    </div>
  );
}
