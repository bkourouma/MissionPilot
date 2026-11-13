"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  API_CANAUX_SIMULATEUR_ENTRANT,
  aideNumeroSimule,
  libelleStatutRecuSimule,
  messageErreurCanaux,
  optionsTypeEntrant,
  STATUTS_RECUS_SIMULES,
  validerEntrantSimule,
  type ChampEntrantSimule,
  type TypeEntrantSimule,
} from "../../lib/canaux";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import "./canaux.css";

export interface FormulaireEntrantSimuleProps {
  /** Messages « envoyés » auxquels un statut peut se rapporter. */
  messages: readonly { id_externe: string; libelle: string }[];
}

/**
 * « Message reçu d'un destinataire de test » : le simulateur fabrique l'événement signé et
 * appelle le webhook (développement seulement). Aucun vrai audio : une voix de test est un
 * texte que l'API enveloppe dans un conteneur de test.
 */
export function FormulaireEntrantSimule({ messages }: FormulaireEntrantSimuleProps) {
  const t = useT();
  const langue = useLangue();
  const [type, setType] = useState<TypeEntrantSimule>("texte");
  const [numero, setNumero] = useState("");
  const [texte, setTexte] = useState("");
  const [idExterne, setIdExterne] = useState("");
  const [statut, setStatut] = useState("livre");
  const f = useFormulaire<ChampEntrantSimule>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerEntrantSimule({ type, numero, texte, idExterne, statut }, langue),
      (charge) => api.post(API_CANAUX_SIMULATEUR_ENTRANT, charge, { redirigerSi401: false }),
      {
        succes: t(
          "Événement simulé transmis au webhook. Consultez le journal et la boîte pour la suite.",
          "Simulated event sent to the webhook. See the log and the mailbox for what follows.",
        ),
        messageSpecifique: (e) => messageErreurCanaux(e, "totp", langue),
        apres: () => setTexte(""),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t(
        "Message reçu d'un destinataire de test",
        "Message received from a test recipient",
      )}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Select
        libelle={t("Type d'événement", "Event type")}
        value={type}
        onChange={(e) => setType(e.target.value as TypeEntrantSimule)}
        options={optionsTypeEntrant(langue).map((o) => ({ valeur: o.valeur, libelle: o.libelle }))}
      />
      {type === "statut" ? (
        <div className="mp-grille-champs">
          <Select
            libelle={t("Message envoyé concerné", "Sent message concerned")}
            required
            invite={t("Choisir un message…", "Choose a message…")}
            value={idExterne}
            onChange={(e) => setIdExterne(e.target.value)}
            options={messages.map((m) => ({ valeur: m.id_externe, libelle: m.libelle }))}
            erreur={f.erreurs.idExterne}
          />
          <Select
            libelle={t("Statut reçu", "Status received")}
            value={statut}
            onChange={(e) => setStatut(e.target.value)}
            options={STATUTS_RECUS_SIMULES.map((s) => ({
              valeur: s.valeur,
              libelle: libelleStatutRecuSimule(s.valeur, langue),
            }))}
            erreur={f.erreurs.statut}
          />
        </div>
      ) : (
        <>
          <Champ
            libelle={t("Numéro du destinataire de test", "Test recipient number")}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            required
            maxLength={40}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            erreur={f.erreurs.numero}
            aide={aideNumeroSimule(langue)}
          />
          <ZoneTexte
            libelle={
              type === "texte"
                ? t("Message", "Message")
                : t("Ce que dit la voix de test", "What the test voice says")
            }
            required
            maxLength={type === "texte" ? 4096 : 2000}
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            erreur={f.erreurs.texte}
            aide={t(
              "Essayez STOP, OUI, NON, ou une valeur d'indicateur (par exemple « chiffre d'affaires 12 500 »).",
              'Try STOP, YES, NO, or a KPI value (for example "revenue 12,500").',
            )}
          />
        </>
      )}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Envoi simulé…", "Simulated send…")}
        >
          {t("Simuler la réception", "Simulate receipt")}
        </Bouton>
      </div>
    </form>
  );
}
