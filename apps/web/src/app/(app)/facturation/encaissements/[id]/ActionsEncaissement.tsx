"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFermetureDifferee } from "../../../../../components/formulaires/useFermetureDifferee";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { ZoneTexte } from "../../../../../components/ui/ZoneTexte";
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
  const [panneau, setPanneau, fermer] = useFermetureDifferee<Panneau>(cle);
  if (!a.demanderContrePassation && !a.imputerAvance) return null;
  const chemin = `/api/finance/encaissements/${encodeURIComponent(e.id)}`;
  return (
    <Carte titre="Actions">
      <div className="mp-pile">
        <div className="mp-barre-actions">
          {a.imputerAvance ? (
            <Bouton
              aria-expanded={panneau === "avance"}
              onClick={() => setPanneau(panneau === "avance" ? null : "avance")}
            >
              Imputer l&apos;avance sur des factures
            </Bouton>
          ) : null}
          {a.demanderContrePassation ? (
            <Bouton
              variante="secondaire"
              aria-expanded={panneau === "contre_passation"}
              onClick={() => setPanneau(panneau === "contre_passation" ? null : "contre_passation")}
            >
              Demander une contre-passation
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
  const [motif, setMotif] = useState("");
  const form = useFormulaire<"motif">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(
      validerMotifContrePassation(motif),
      (c) => api.post(`${chemin}/contre-passation`, c),
      { messageSpecifique: messageEncaissement, apres },
    );
  }
  return (
    <form
      ref={form.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Demander une contre-passation"
    >
      <p className="mp-sous-formulaire__titre">Demander une contre-passation</p>
      <RetourFormulaire erreur={form.erreurGlobale} refAlerte={form.refAlerte} />
      <ZoneTexte
        libelle="Motif"
        aide="Obligatoire. La demande est validée par un autre gestionnaire ou un associé ; elle crée alors un encaissement négatif et les factures imputées redeviennent dues."
        required
        maxLength={500}
        value={motif}
        onChange={(ev) => setMotif(ev.target.value)}
        erreur={form.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="danger" chargement={form.enCours} texteChargement="Envoi…">
          Envoyer la demande
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
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
  const [valeurs, setValeurs] = useState<Record<string, string>>({});
  const form = useFormulaire<"imputations">();
  const { creances, chargement, erreur } = useCreancesClient(clientId, 0);
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(
      validerImputationAvance(valeurs, creances, devise),
      (c) => api.post(`${chemin}/imputations`, c),
      { messageSpecifique: messageEncaissement, apres },
    );
  }
  return (
    <form
      ref={form.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Imputer l'avance"
    >
      <p className="mp-sous-formulaire__titre">Imputer l&apos;avance</p>
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
        <Bouton type="submit" chargement={form.enCours} texteChargement="Imputation…">
          Imputer
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
