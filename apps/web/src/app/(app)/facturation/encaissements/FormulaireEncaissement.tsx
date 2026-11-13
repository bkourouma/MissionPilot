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
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { api, messageErreur } from "../../../../lib/api";
import {
  messageEncaissement,
  optionsDevises,
  optionsModes,
  optionsOperateurs,
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
  const t = useT();
  const langue = useLangue();
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
      validerEncaissement(s, creances, dateDuJour, langue),
      (c) => api.post("/api/finance/encaissements", c),
      {
        succes: t("Encaissement enregistré et imputé.", "Payment recorded and allocated."),
        messageSpecifique: (e) => messageEncaissement(e, langue),
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
        <p>
          {t(
            "Aucun client actif : créez d'abord le client dans l'annuaire.",
            "No active client: first create the client in the directory.",
          )}
        </p>
      </Alerte>
    );
  }

  return (
    <form
      ref={form.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Saisir un encaissement", "Record a payment")}
    >
      <RetourFormulaire
        erreur={form.erreurGlobale}
        succes={form.succes}
        refAlerte={form.refAlerte}
        titreErreur={t("Encaissement refusé", "Payment refused")}
      />
      <div className="mp-grille-champs mp-grille-champs--bas">
        <Select
          libelle={t("Client", "Client")}
          required
          options={clients}
          invite={t("Choisir le client…", "Choose the client…")}
          value={s.client_id}
          onChange={(e) => setS((x) => ({ ...x, client_id: e.target.value, imputations: {} }))}
          erreur={form.erreurs.client_id}
        />
        <Champ
          libelle={t("Date de l'encaissement", "Payment date")}
          type="date"
          required
          max={dateDuJour}
          value={s.date}
          onChange={(e) => maj("date", e.target.value)}
          erreur={form.erreurs.date}
        />
        <Champ
          libelle={t("Montant reçu", "Amount received")}
          required
          inputMode="decimal"
          aide={aideMontant(s.devise, langue)}
          value={s.montant}
          onChange={(e) => maj("montant", e.target.value)}
          erreur={form.erreurs.montant}
        />
        <Select
          libelle={t("Devise", "Currency")}
          required
          options={optionsDevises(langue)}
          value={s.devise}
          onChange={(e) => maj("devise", e.target.value as Devise)}
        />
        <Select
          libelle={t("Moyen de paiement", "Payment method")}
          required
          options={optionsModes(langue)}
          invite={t("Choisir…", "Choose…")}
          value={s.mode}
          onChange={(e) => {
            const mode = e.target.value as SaisieEncaissement["mode"];
            setS((x) => ({ ...x, mode, operateur: mode === "mobile_money" ? x.operateur : "" }));
          }}
          erreur={form.erreurs.mode}
        />
        {s.mode === "mobile_money" ? (
          <Select
            libelle={t("Opérateur Mobile Money", "Mobile Money operator")}
            required
            options={optionsOperateurs(langue)}
            invite={t("Choisir l'opérateur…", "Choose the operator…")}
            value={s.operateur}
            onChange={(e) => maj("operateur", e.target.value as SaisieEncaissement["operateur"])}
            erreur={form.erreurs.operateur}
          />
        ) : null}
        <Champ
          libelle={
            s.mode === "cheque"
              ? t("Numéro du chèque", "Check number")
              : s.mode === "mobile_money"
                ? t("Référence de l'opération", "Transaction reference")
                : t("Référence (facultative)", "Reference (optional)")
          }
          required={s.mode === "cheque" || s.mode === "mobile_money"}
          maxLength={120}
          aide={
            s.mode === "mobile_money"
              ? t(
                  "Identifiant de transaction reçu par SMS (aucun paiement n'est déclenché par CabinetPilot).",
                  "Transaction ID received by SMS (CabinetPilot does not trigger any payment).",
                )
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
        libelle={t(
          "Accepter la part non imputée comme avance du client",
          "Accept the unallocated part as a client advance",
        )}
        aide={t(
          "Sans cette case, un encaissement supérieur aux montants imputés est refusé (trop-perçu). L'avance restera imputable plus tard.",
          "Without this box, a payment exceeding the allocated amounts is refused (overpayment). The advance can be allocated later.",
        )}
        checked={s.avance}
        onChange={(e) => maj("avance", e.target.checked)}
      />
      <ZoneTexte
        libelle={t("Commentaire (facultatif)", "Comment (optional)")}
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
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer l'encaissement", "Save the payment")}
        </Bouton>
      </div>
    </form>
  );
}
