"use client";

import { useEffect, useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { Alerte } from "../../../../components/ui/Alerte";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { api, messageErreur } from "../../../../lib/api";
import {
  messageEncaissement,
  OPTIONS_DEVISES,
  OPTIONS_MODES,
  OPTIONS_OPERATEURS,
  validerEncaissement,
  type ChampEncaissement,
  type Creance,
  type SaisieEncaissement,
} from "../../../../lib/encaissements";
import type { Devise } from "../../../../lib/format";
import { aideMontant } from "../../../../lib/saisie";
import { ImputationsFactures } from "./ImputationsFactures";

const VIDE = (date: string): SaisieEncaissement => ({
  client_id: "",
  date,
  montant: "",
  devise: "XOF",
  mode: "",
  operateur: "",
  reference: "",
  commentaire: "",
  imputations: {},
  avance: false,
});

/** Factures restant dues d'un client, chargées à la demande (`GET /api/finance/creances`). */
export function useCreancesClient(clientId: string, version: number) {
  const [etat, setEtat] = useState<{
    creances: Creance[];
    chargement: boolean;
    erreur: string | null;
  }>({ creances: [], chargement: false, erreur: null });
  useEffect(() => {
    if (!clientId) {
      setEtat({ creances: [], chargement: false, erreur: null });
      return;
    }
    const controle = new AbortController();
    setEtat((e) => ({ ...e, chargement: true, erreur: null }));
    api
      .get<{ elements: Creance[] }>(
        `/api/finance/creances?client_id=${encodeURIComponent(clientId)}`,
        { signal: controle.signal },
      )
      .then((r) => setEtat({ creances: r.elements, chargement: false, erreur: null }))
      .catch((e: unknown) => {
        if (controle.signal.aborted) return;
        setEtat({ creances: [], chargement: false, erreur: messageErreur(e) });
      });
    return () => controle.abort();
  }, [clientId, version]);
  return etat;
}

export function FormulaireEncaissement({
  clients,
  dateDuJour,
  cle,
}: {
  clients: readonly { valeur: string; libelle: string }[];
  dateDuJour: string;
  /** Change quand la liste rafraîchie arrive (voir useAttenteRafraichissement). */
  cle: string;
}) {
  const [s, setS] = useState<SaisieEncaissement>(() => VIDE(dateDuJour));
  const [version, setVersion] = useState(0);
  const form = useFormulaire<ChampEncaissement>();
  const [attente, marquer] = useAttenteRafraichissement(cle);
  const { creances, chargement, erreur } = useCreancesClient(s.client_id, version);
  const maj = <K extends keyof SaisieEncaissement>(champ: K, v: SaisieEncaissement[K]) =>
    setS((x) => ({ ...x, [champ]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(
      validerEncaissement(s, creances, dateDuJour),
      (c) => api.post("/api/finance/encaissements", c),
      {
        succes: "Encaissement enregistré et imputé.",
        messageSpecifique: messageEncaissement,
        apres: () => {
          setS((x) => ({ ...VIDE(dateDuJour), client_id: x.client_id, devise: x.devise }));
          setVersion((v) => v + 1);
          marquer();
        },
      },
    );
  }

  if (clients.length === 0) {
    return (
      <Alerte tonalite="info" annonce="aucune">
        <p>Aucun client actif : créez d&apos;abord le client dans l&apos;annuaire.</p>
      </Alerte>
    );
  }

  return (
    <form
      ref={form.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Saisir un encaissement"
    >
      <RetourFormulaire
        erreur={form.erreurGlobale}
        succes={form.succes}
        refAlerte={form.refAlerte}
        titreErreur="Encaissement refusé"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Client"
          required
          options={clients}
          invite="Choisir le client…"
          value={s.client_id}
          onChange={(e) => setS((x) => ({ ...x, client_id: e.target.value, imputations: {} }))}
          erreur={form.erreurs.client_id}
        />
        <Champ
          libelle="Date de l'encaissement"
          type="date"
          required
          max={dateDuJour}
          value={s.date}
          onChange={(e) => maj("date", e.target.value)}
          erreur={form.erreurs.date}
        />
        <Champ
          libelle="Montant reçu"
          required
          inputMode="decimal"
          aide={aideMontant(s.devise)}
          value={s.montant}
          onChange={(e) => maj("montant", e.target.value)}
          erreur={form.erreurs.montant}
        />
        <Select
          libelle="Devise"
          required
          options={OPTIONS_DEVISES}
          value={s.devise}
          onChange={(e) => maj("devise", e.target.value as Devise)}
        />
        <Select
          libelle="Moyen de paiement"
          required
          options={OPTIONS_MODES}
          invite="Choisir…"
          value={s.mode}
          onChange={(e) => {
            const mode = e.target.value as SaisieEncaissement["mode"];
            setS((x) => ({ ...x, mode, operateur: mode === "mobile_money" ? x.operateur : "" }));
          }}
          erreur={form.erreurs.mode}
        />
        {s.mode === "mobile_money" ? (
          <Select
            libelle="Opérateur Mobile Money"
            required
            options={OPTIONS_OPERATEURS}
            invite="Choisir l'opérateur…"
            value={s.operateur}
            onChange={(e) => maj("operateur", e.target.value as SaisieEncaissement["operateur"])}
            erreur={form.erreurs.operateur}
          />
        ) : null}
        <Champ
          libelle={
            s.mode === "cheque"
              ? "Numéro du chèque"
              : s.mode === "mobile_money"
                ? "Référence de l'opération"
                : "Référence (facultative)"
          }
          required={s.mode === "cheque" || s.mode === "mobile_money"}
          maxLength={120}
          aide={
            s.mode === "mobile_money"
              ? "Identifiant de transaction reçu par SMS (aucun paiement n'est déclenché par MissionPilot)."
              : undefined
          }
          value={s.reference}
          onChange={(e) => maj("reference", e.target.value)}
          erreur={form.erreurs.reference}
        />
      </div>
      <ImputationsFactures
        clientChoisi={Boolean(s.client_id)}
        creances={creances}
        chargement={chargement}
        erreurChargement={erreur}
        devise={s.devise}
        valeurs={s.imputations}
        onChange={(imputations) => maj("imputations", imputations)}
        erreur={form.erreurs.imputations}
      />
      <CaseACocher
        libelle="Accepter la part non imputée comme avance du client"
        aide="Sans cette case, un encaissement supérieur aux montants imputés est refusé (trop-perçu). L'avance restera imputable plus tard."
        checked={s.avance}
        onChange={(e) => maj("avance", e.target.checked)}
      />
      <ZoneTexte
        libelle="Commentaire (facultatif)"
        maxLength={500}
        value={s.commentaire}
        onChange={(e) => maj("commentaire", e.target.value)}
        erreur={form.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="succes"
          chargement={form.enCours || attente}
          texteChargement="Enregistrement…"
        >
          Enregistrer l&apos;encaissement
        </Bouton>
      </div>
    </form>
  );
}
