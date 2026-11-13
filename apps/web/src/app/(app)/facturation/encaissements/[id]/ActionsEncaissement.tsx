"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFermetureDifferee } from "../../../../../components/formulaires/useFermetureDifferee";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { ZoneTexte } from "../../../../../components/ui/ZoneTexte";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../../lib/api";
import {
  messageEncaissement,
  validerImputationAvance,
  validerMotifContrePassation,
  type ActionsEncaissement as Actions,
} from "../../../../../lib/encaissements";
import type { Devise } from "../../../../../lib/format";
import { useCreancesClient } from "../FormulaireEncaissement";
import { ImputationsFactures } from "../ImputationsFactures";

type Panneau = "contre_passation" | "avance";

export function ActionsEncaissement({
  encaissement: e,
  actions: a,
  cle,
}: {
  encaissement: { id: string; client_id: string; devise: Devise };
  actions: Actions;
  cle: string;
}) {
  const t = useT();
  const [panneau, setPanneau, fermer] = useFermetureDifferee<Panneau>(cle);
  if (!a.demanderContrePassation && !a.imputerAvance) return null;
  const chemin = `/api/finance/encaissements/${encodeURIComponent(e.id)}`;
  return (
    <Carte titre={t("Actions", "Actions")}>
      <div className="mp-pile">
        <div className="mp-barre-actions">
          {a.imputerAvance ? (
            <Bouton
              aria-expanded={panneau === "avance"}
              onClick={() => setPanneau(panneau === "avance" ? null : "avance")}
            >
              {t("Imputer l'avance sur des factures", "Allocate the advance to invoices")}
            </Bouton>
          ) : null}
          {a.demanderContrePassation ? (
            <Bouton
              variante="secondaire"
              aria-expanded={panneau === "contre_passation"}
              onClick={() => setPanneau(panneau === "contre_passation" ? null : "contre_passation")}
            >
              {t("Demander une contre-passation", "Request a reversal")}
            </Bouton>
          ) : null}
        </div>
        {panneau === "contre_passation" ? (
          <FormulaireContrePassation
            chemin={chemin}
            onFin={() => setPanneau(null)}
            apres={fermer}
          />
        ) : null}
        {panneau === "avance" ? (
          <FormulaireAvance
            chemin={chemin}
            clientId={e.client_id}
            devise={e.devise}
            onFin={() => setPanneau(null)}
            apres={fermer}
          />
        ) : null}
      </div>
    </Carte>
  );
}

function FormulaireContrePassation({
  chemin,
  onFin,
  apres,
}: {
  chemin: string;
  onFin: () => void;
  apres: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [motif, setMotif] = useState("");
  const form = useFormulaire<"motif">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(
      validerMotifContrePassation(motif, langue),
      (c) => api.post(`${chemin}/contre-passation`, c),
      { messageSpecifique: (e) => messageEncaissement(e, langue), apres },
    );
  }
  return (
    <form
      ref={form.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Demander une contre-passation", "Request a reversal")}
    >
      <p className="mp-sous-formulaire__titre">
        {t("Demander une contre-passation", "Request a reversal")}
      </p>
      <RetourFormulaire erreur={form.erreurGlobale} refAlerte={form.refAlerte} />
      <ZoneTexte
        libelle={t("Motif", "Reason")}
        aide={t(
          "Obligatoire. La demande est validée par un autre gestionnaire ou un associé ; elle crée alors un encaissement négatif et les factures imputées redeviennent dues.",
          "Required. The request is approved by another manager or a partner; it then creates a negative payment and the allocated invoices become due again.",
        )}
        required
        maxLength={500}
        value={motif}
        onChange={(ev) => setMotif(ev.target.value)}
        erreur={form.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="danger"
          chargement={form.enCours}
          texteChargement={t("Envoi…", "Sending…")}
        >
          {t("Envoyer la demande", "Send the request")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireAvance({
  chemin,
  clientId,
  devise,
  onFin,
  apres,
}: {
  chemin: string;
  clientId: string;
  devise: Devise;
  onFin: () => void;
  apres: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [valeurs, setValeurs] = useState<Record<string, string>>({});
  const form = useFormulaire<"imputations">();
  const { creances, chargement, erreur } = useCreancesClient(clientId, 0);
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(
      validerImputationAvance(valeurs, creances, devise, langue),
      (c) => api.post(`${chemin}/imputations`, c),
      { messageSpecifique: (e) => messageEncaissement(e, langue), apres },
    );
  }
  return (
    <form
      ref={form.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Imputer l'avance", "Allocate the advance")}
    >
      <p className="mp-sous-formulaire__titre">{t("Imputer l'avance", "Allocate the advance")}</p>
      <RetourFormulaire erreur={form.erreurGlobale} refAlerte={form.refAlerte} />
      <ImputationsFactures
        clientChoisi
        creances={creances}
        chargement={chargement}
        erreurChargement={erreur}
        devise={devise}
        valeurs={valeurs}
        onChange={setValeurs}
        erreur={form.erreurs.imputations}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={form.enCours}
          texteChargement={t("Imputation…", "Allocating…")}
        >
          {t("Imputer", "Allocate")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
