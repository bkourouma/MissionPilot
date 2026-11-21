"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Alerte } from "../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { DELAIS_RELANCE_DEPART } from "@missionpilot/shared";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../lib/api";
import {
  DELAIS_DEPART_TEXTE,
  libelleDelais,
  libelleNiveau,
  validerParametresRelances,
  type ParametresRelances as Parametres,
  type SaisieRelances,
} from "../../../../lib/creances";

/**
 * Paramètres de relance du cabinet. L'envoi automatique de l'e-mail au client est DÉSACTIVÉ
 * par défaut : il ne s'active que par un bouton dédié, après confirmation explicite.
 */
export function ParametresRelances({ parametres: p }: { parametres: Parametres }) {
  const t = useT();
  const langue = useLangue();
  const cle = `${p.delais_relance.join()}-${p.relances_actives}-${p.envoi_email_client}-${p.valeurs_validees}`;
  const [s, setS] = useState<SaisieRelances>({
    delais: p.delais_relance.join(", "),
    relances_actives: p.relances_actives,
    valeurs_validees: p.valeurs_validees,
  });
  const form = useFormulaire<"delais">();
  const envoi = useFormulaire<never>();
  const [attente, marquer] = useAttenteRafraichissement(cle);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(
      validerParametresRelances(s, langue),
      (c) => api.patch("/api/finance/parametres-relances", c),
      {
        succes: t("Paramètres de relance enregistrés.", "Reminder settings saved."),
        apres: marquer,
      },
    );
  }
  const basculerEnvoi = (actif: boolean) =>
    envoi.envoyer(
      { ok: true, charge: { envoi_email_client: actif } },
      (c) => api.patch("/api/finance/parametres-relances", c),
      {
        succes: actif
          ? t(
              "Envoi automatique activé : les prochaines relances partiront par e-mail au client.",
              "Automatic sending enabled: the next reminders will be emailed to the client.",
            )
          : t(
              "Envoi automatique désactivé : les relances sont seulement préparées.",
              "Automatic sending disabled: reminders are only prepared.",
            ),
        apres: marquer,
      },
    );

  return (
    <Carte titre={t("Relances", "Reminders")}>
      <div className="mp-pile">
        <section aria-labelledby="titre-envoi-auto" className="mp-pile">
          <h3 id="titre-envoi-auto" className="mp-sous-formulaire__titre">
            {t("Envoi automatique de l'e-mail au client", "Automatic email to the client")}
          </h3>
          <RetourFormulaire
            erreur={envoi.erreurGlobale}
            succes={envoi.succes}
            refAlerte={envoi.refAlerte}
            titreErreur={t("Modification impossible", "Change not possible")}
          />
          {p.envoi_email_client ? (
            <>
              <p>
                <BadgeStatut tonalite="attention">{t("Activé", "Enabled")}</BadgeStatut>{" "}
                {t(
                  "Chaque relance automatique envoie un e-mail au contact principal du client (reste à payer et échéance).",
                  "Each automatic reminder sends an email to the client's main contact (balance due and due date).",
                )}
              </p>
              <div>
                <Bouton
                  variante="secondaire"
                  chargement={envoi.enCours || attente}
                  texteChargement={t("Mise à jour…", "Updating…")}
                  onClick={() => basculerEnvoi(false)}
                >
                  {t("Désactiver l'envoi automatique", "Disable automatic sending")}
                </Bouton>
              </div>
            </>
          ) : (
            <>
              <Alerte
                tonalite="info"
                annonce="aucune"
                titre={t("Désactivé (réglage par défaut)", "Disabled (default setting)")}
              >
                <p>
                  {t(
                    "Les relances sont créées et notifiées à l'équipe, mais aucun e-mail ne part chez le client. Vous pouvez relancer à la main depuis chaque facture.",
                    "Reminders are created and notified to the team, but no email is sent to the client. You can send reminders manually from each invoice.",
                  )}
                </p>
              </Alerte>
              <div>
                <BoutonConfirmation
                  key={cle}
                  libelle={t("Activer l'envoi automatique", "Enable automatic sending")}
                  variante="secondaire"
                  icone="courrier"
                  question={t(
                    "Activer l'envoi automatique ? Les clients en retard recevront un e-mail de relance à chaque niveau atteint, sans validation préalable.",
                    "Enable automatic sending? Overdue clients will receive a reminder email at each level reached, without prior approval.",
                  )}
                  libelleConfirmation={t(
                    "Oui, activer l'envoi aux clients",
                    "Yes, enable sending to clients",
                  )}
                  texteChargement={t("Activation…", "Enabling…")}
                  action={() => basculerEnvoi(true)}
                />
              </div>
            </>
          )}
        </section>

        <form
          ref={form.refFormulaire}
          className="mp-formulaire mp-sous-formulaire"
          noValidate
          onSubmit={soumettre}
          aria-label={t("Paramètres de relance", "Reminder settings")}
        >
          <p className="mp-sous-formulaire__titre">
            {t("Délais et activation", "Delays and activation")}
          </p>
          {!p.valeurs_validees ? (
            <Alerte
              tonalite="attention"
              annonce="aucune"
              titre={t("Valeurs de départ à valider", "Starting values to approve")}
            >
              <p>
                {t(
                  `Délais de départ : ${libelleDelais(DELAIS_RELANCE_DEPART)} après l'échéance. Faites-les valider par l'associé ou le responsable financier du cabinet.`,
                  `Starting delays: ${libelleDelais(DELAIS_RELANCE_DEPART)} after the due date. Have them approved by the partner or the firm's finance manager.`,
                )}
              </p>
            </Alerte>
          ) : null}
          <RetourFormulaire
            erreur={form.erreurGlobale}
            succes={form.succes}
            refAlerte={form.refAlerte}
          />
          <Champ
            libelle={t(
              "Délais de relance (jours après l'échéance)",
              "Reminder delays (days after the due date)",
            )}
            aide={t(
              `Un délai par niveau, de 1 à 3, strictement croissants (ex. ${DELAIS_DEPART_TEXTE}). Niveaux : ${[1, 2, 3].map((n) => libelleNiveau(n)).join(", ")}.`,
              `One delay per level, from 1 to 3, strictly increasing (e.g. ${DELAIS_DEPART_TEXTE}). Levels: ${[1, 2, 3].map((n) => libelleNiveau(n, langue)).join(", ")}.`,
            )}
            required
            autoComplete="off"
            placeholder={DELAIS_DEPART_TEXTE}
            value={s.delais}
            onChange={(e) => setS((x) => ({ ...x, delais: e.target.value }))}
            erreur={form.erreurs.delais}
          />
          <CaseACocher
            libelle={t(
              "Créer les relances automatiquement chaque jour",
              "Create reminders automatically every day",
            )}
            aide={t(
              "La tâche quotidienne crée une relance pour chaque facture dont le retard atteint un nouveau niveau.",
              "The daily task creates a reminder for each invoice whose delay reaches a new level.",
            )}
            checked={s.relances_actives}
            onChange={(e) => setS((x) => ({ ...x, relances_actives: e.target.checked }))}
          />
          <CaseACocher
            libelle={t("Délais validés par le cabinet", "Delays approved by the firm")}
            aide={t(
              "À cocher une fois les délais ci-dessus approuvés par l'associé ou le responsable financier.",
              "Tick once the delays above have been approved by the partner or the finance manager.",
            )}
            checked={s.valeurs_validees}
            onChange={(e) => setS((x) => ({ ...x, valeurs_validees: e.target.checked }))}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              chargement={form.enCours || attente}
              texteChargement={t("Enregistrement…", "Saving…")}
            >
              {t("Enregistrer les paramètres", "Save settings")}
            </Bouton>
          </div>
        </form>
      </div>
    </Carte>
  );
}
