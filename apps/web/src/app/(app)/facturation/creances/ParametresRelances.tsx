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
      validerParametresRelances(s),
      (c) => api.patch("/api/finance/parametres-relances", c),
      {
        succes: "Paramètres de relance enregistrés.",
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
          ? "Envoi automatique activé : les prochaines relances partiront par e-mail au client."
          : "Envoi automatique désactivé : les relances sont seulement préparées.",
        apres: marquer,
      },
    );

  return (
    <Carte titre="Relances">
      <div className="mp-pile">
        <section aria-labelledby="titre-envoi-auto" className="mp-pile">
          <h3 id="titre-envoi-auto" className="mp-sous-formulaire__titre">
            Envoi automatique de l&apos;e-mail au client
          </h3>
          <RetourFormulaire
            erreur={envoi.erreurGlobale}
            succes={envoi.succes}
            refAlerte={envoi.refAlerte}
            titreErreur="Modification impossible"
          />
          {p.envoi_email_client ? (
            <>
              <p>
                <BadgeStatut tonalite="attention">Activé</BadgeStatut> Chaque relance automatique
                envoie un e-mail au contact principal du client (reste à payer et échéance).
              </p>
              <div>
                <Bouton
                  variante="secondaire"
                  chargement={envoi.enCours || attente}
                  texteChargement="Mise à jour…"
                  onClick={() => basculerEnvoi(false)}
                >
                  Désactiver l&apos;envoi automatique
                </Bouton>
              </div>
            </>
          ) : (
            <>
              <Alerte tonalite="info" annonce="aucune" titre="Désactivé (réglage par défaut)">
                <p>
                  Les relances sont créées et notifiées à l&apos;équipe, mais aucun e-mail ne part
                  chez le client. Vous pouvez relancer à la main depuis chaque facture.
                </p>
              </Alerte>
              <div>
                <BoutonConfirmation
                  key={cle}
                  libelle="Activer l'envoi automatique"
                  variante="secondaire"
                  icone="courrier"
                  question="Activer l'envoi automatique ? Les clients en retard recevront un e-mail de relance à chaque niveau atteint, sans validation préalable."
                  libelleConfirmation="Oui, activer l'envoi aux clients"
                  texteChargement="Activation…"
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
          aria-label="Paramètres de relance"
        >
          <p className="mp-sous-formulaire__titre">Délais et activation</p>
          {!p.valeurs_validees ? (
            <Alerte tonalite="attention" annonce="aucune" titre="Valeurs de départ à valider">
              <p>{`Délais de départ : ${libelleDelais(DELAIS_RELANCE_DEPART)} après l'échéance. Faites-les valider par l'associé ou le responsable financier du cabinet.`}</p>
            </Alerte>
          ) : null}
          <RetourFormulaire
            erreur={form.erreurGlobale}
            succes={form.succes}
            refAlerte={form.refAlerte}
          />
          <Champ
            libelle="Délais de relance (jours après l'échéance)"
            aide={`Un délai par niveau, de 1 à 3, strictement croissants (ex. ${DELAIS_DEPART_TEXTE}). Niveaux : ${[1, 2, 3].map(libelleNiveau).join(", ")}.`}
            required
            value={s.delais}
            onChange={(e) => setS((x) => ({ ...x, delais: e.target.value }))}
            erreur={form.erreurs.delais}
          />
          <CaseACocher
            libelle="Créer les relances automatiquement chaque jour"
            aide="La tâche quotidienne crée une relance pour chaque facture dont le retard atteint un nouveau niveau."
            checked={s.relances_actives}
            onChange={(e) => setS((x) => ({ ...x, relances_actives: e.target.checked }))}
          />
          <CaseACocher
            libelle="Délais validés par le cabinet"
            checked={s.valeurs_validees}
            onChange={(e) => setS((x) => ({ ...x, valeurs_validees: e.target.checked }))}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              chargement={form.enCours || attente}
              texteChargement="Enregistrement…"
            >
              Enregistrer
            </Bouton>
          </div>
        </form>
      </div>
    </Carte>
  );
}
