"use client";

import { useState } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../lib/api";
import { messageRelance, validerRelanceManuelle } from "../../../../lib/creances";

/**
 * Relance manuelle d'une facture restant due (niveau suivant, au plus 3), avec confirmation.
 * L'e-mail au contact du client n'est envoyé que si la case est cochée.
 */
export function RelanceManuelle({ factureId, cle }: { factureId: string; cle: string }) {
  const t = useT();
  const langue = useLangue();
  const [envoyer, setEnvoyer] = useState(false);
  const [message, setMessage] = useState("");
  const form = useFormulaire<"message">();
  const [attente, marquer] = useAttenteRafraichissement(cle);
  const question = envoyer
    ? t(
        "Enregistrer une relance et envoyer l'e-mail de relance au contact principal du client ?",
        "Record a reminder and send the reminder email to the client's main contact?",
      )
    : t(
        "Enregistrer une relance sans e-mail au client (à transmettre par vos soins) ?",
        "Record a reminder without emailing the client (you will forward it yourself)?",
      );
  return (
    <div className="mp-sous-formulaire mp-pile">
      <p className="mp-sous-formulaire__titre">
        {t("Relancer le client", "Send the client a reminder")}
      </p>
      <form ref={form.refFormulaire} noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="mp-pile">
          <RetourFormulaire
            erreur={form.erreurGlobale}
            succes={form.succes}
            refAlerte={form.refAlerte}
            titreErreur={t("Relance impossible", "Reminder not possible")}
          />
          <CaseACocher
            libelle={t(
              "Envoyer l'e-mail de relance au contact du client",
              "Send the reminder email to the client's contact",
            )}
            aide={t(
              "Sinon, la relance est seulement enregistrée dans l'historique.",
              "Otherwise, the reminder is only recorded in the history.",
            )}
            checked={envoyer}
            onChange={(e) => setEnvoyer(e.target.checked)}
          />
          <ZoneTexte
            libelle={t(
              "Message ajouté à la relance (facultatif)",
              "Message added to the reminder (optional)",
            )}
            maxLength={1000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            erreur={form.erreurs.message}
          />
          <div>
            <BoutonConfirmation
              key={cle}
              libelle={attente ? t("Mise à jour…", "Updating…") : t("Relancer", "Send reminder")}
              variante="primaire"
              icone="courrier"
              question={question}
              libelleConfirmation={t("Oui, relancer", "Yes, send reminder")}
              texteChargement={t("Relance…", "Sending reminder…")}
              action={() =>
                form.envoyer(
                  validerRelanceManuelle({ envoyer_email: envoyer, message }, langue),
                  (c) => api.post(`/api/factures/${encodeURIComponent(factureId)}/relances`, c),
                  {
                    succes: envoyer
                      ? t(
                          "Relance enregistrée ; l'e-mail part au contact du client.",
                          "Reminder recorded; the email is going to the client's contact.",
                        )
                      : t(
                          "Relance enregistrée dans l'historique.",
                          "Reminder recorded in the history.",
                        ),
                    messageSpecifique: (err) => messageRelance(err, langue),
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
