"use client";

import { useState } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { api } from "../../../../lib/api";
import { messageRelance, validerRelanceManuelle } from "../../../../lib/creances";

/**
 * Relance manuelle d'une facture restant due (niveau suivant, au plus 3), avec confirmation.
 * L'e-mail au contact du client n'est envoyé que si la case est cochée.
 */
export function RelanceManuelle({ factureId, cle }: { factureId: string; cle: string }) {
  const [envoyer, setEnvoyer] = useState(false);
  const [message, setMessage] = useState("");
  const form = useFormulaire<"message">();
  const [attente, marquer] = useAttenteRafraichissement(cle);
  const question = envoyer
    ? "Enregistrer une relance et envoyer l'e-mail de relance au contact principal du client ?"
    : "Enregistrer une relance sans e-mail au client (à transmettre par vos soins) ?";
  return (
    <div className="mp-sous-formulaire mp-pile">
      <p className="mp-sous-formulaire__titre">Relancer le client</p>
      <form ref={form.refFormulaire} noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="mp-pile">
          <RetourFormulaire
            erreur={form.erreurGlobale}
            succes={form.succes}
            refAlerte={form.refAlerte}
            titreErreur="Relance impossible"
          />
          <CaseACocher
            libelle="Envoyer l'e-mail de relance au contact du client"
            aide="Sinon, la relance est seulement enregistrée dans l'historique."
            checked={envoyer}
            onChange={(e) => setEnvoyer(e.target.checked)}
          />
          <ZoneTexte
            libelle="Message ajouté à la relance (facultatif)"
            maxLength={1000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            erreur={form.erreurs.message}
          />
          <div>
            <BoutonConfirmation
              key={cle}
              libelle={attente ? "Mise à jour…" : "Relancer"}
              variante="primaire"
              icone="courrier"
              question={question}
              libelleConfirmation="Oui, relancer"
              texteChargement="Relance…"
              action={() =>
                form.envoyer(
                  validerRelanceManuelle({ envoyer_email: envoyer, message }),
                  (c) => api.post(`/api/factures/${encodeURIComponent(factureId)}/relances`, c),
                  {
                    succes: envoyer
                      ? "Relance enregistrée ; l'e-mail part au contact du client."
                      : "Relance enregistrée dans l'historique.",
                    messageSpecifique: messageRelance,
                    apres: () => {
                      setMessage("");
                      marquer();
                    },
                  },
                )
              }
            />
          </div>
        </div>
      </form>
    </div>
  );
}
