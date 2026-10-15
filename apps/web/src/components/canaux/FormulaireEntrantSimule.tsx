"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  API_CANAUX_SIMULATEUR_ENTRANT,
  AIDE_NUMERO_SIMULE,
  messageErreurCanaux,
  OPTIONS_TYPE_ENTRANT,
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
  const [type, setType] = useState<TypeEntrantSimule>("texte");
  const [numero, setNumero] = useState("");
  const [texte, setTexte] = useState("");
  const [idExterne, setIdExterne] = useState("");
  const [statut, setStatut] = useState("livre");
  const f = useFormulaire<ChampEntrantSimule>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerEntrantSimule({ type, numero, texte, idExterne, statut }),
      (charge) => api.post(API_CANAUX_SIMULATEUR_ENTRANT, charge, { redirigerSi401: false }),
      {
        succes:
          "Événement simulé transmis au webhook. Consultez le journal et la boîte pour la suite.",
        messageSpecifique: (e) => messageErreurCanaux(e),
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
      aria-label="Message reçu d'un destinataire de test"
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Select
        libelle="Type d'événement"
        value={type}
        onChange={(e) => setType(e.target.value as TypeEntrantSimule)}
        options={OPTIONS_TYPE_ENTRANT.map((o) => ({ valeur: o.valeur, libelle: o.libelle }))}
      />
      {type === "statut" ? (
        <div className="mp-grille-champs">
          <Select
            libelle="Message envoyé concerné"
            required
            invite="Choisir un message…"
            value={idExterne}
            onChange={(e) => setIdExterne(e.target.value)}
            options={messages.map((m) => ({ valeur: m.id_externe, libelle: m.libelle }))}
            erreur={f.erreurs.idExterne}
          />
          <Select
            libelle="Statut reçu"
            value={statut}
            onChange={(e) => setStatut(e.target.value)}
            options={STATUTS_RECUS_SIMULES.map((s) => ({ valeur: s.valeur, libelle: s.libelle }))}
            erreur={f.erreurs.statut}
          />
        </div>
      ) : (
        <>
          <Champ
            libelle="Numéro du destinataire de test"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            required
            maxLength={40}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            erreur={f.erreurs.numero}
            aide={AIDE_NUMERO_SIMULE}
          />
          <ZoneTexte
            libelle={type === "texte" ? "Message" : "Ce que dit la voix de test"}
            required
            maxLength={type === "texte" ? 4096 : 2000}
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            erreur={f.erreurs.texte}
            aide="Essayez STOP, OUI, NON, ou une valeur d'indicateur (par exemple « chiffre d'affaires 12 500 »)."
          />
        </>
      )}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Envoi simulé…">
          Simuler la réception
        </Bouton>
      </div>
    </form>
  );
}
