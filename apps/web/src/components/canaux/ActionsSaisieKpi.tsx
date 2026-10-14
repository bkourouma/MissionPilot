"use client";

import { useState, type FormEvent } from "react";
import type { SaisieKpiApi } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminSaisieKpi,
  messageErreurCanaux,
  peutRejeterSaisie,
  peutReprendreSaisie,
  validerRejetSaisie,
  validerRepriseSaisie,
} from "../../lib/canaux";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";
import "./canaux.css";

export interface ActionsSaisieKpiProps {
  saisie: Pick<SaisieKpiApi, "id" | "kpi_libelle" | "statut" | "date_mesure">;
}

type Panneau = "reprendre" | "rejeter" | null;

/**
 * « Reprendre dans le KPI » (la mesure n'est écrite que par un utilisateur du cabinet, sous son
 * identité, avec une date de mesure modifiable) ou « Rejeter » (motif obligatoire).
 */
export function ActionsSaisieKpi({ saisie }: ActionsSaisieKpiProps) {
  const [panneau, setPanneau] = useState<Panneau>(null);
  if (!peutReprendreSaisie(saisie) && !peutRejeterSaisie(saisie)) {
    return <span className="mp-texte-doux">Aucune action</span>;
  }
  return (
    <div>
      <div className="mp-canaux__actions-ligne">
        <Bouton
          variante="primaire"
          aria-expanded={panneau === "reprendre"}
          aria-label={`Reprendre la saisie de ${saisie.kpi_libelle} dans le KPI`}
          onClick={() => setPanneau(panneau === "reprendre" ? null : "reprendre")}
        >
          Reprendre dans le KPI
        </Bouton>
        <Bouton
          variante="secondaire"
          aria-expanded={panneau === "rejeter"}
          aria-label={`Rejeter la saisie de ${saisie.kpi_libelle}`}
          onClick={() => setPanneau(panneau === "rejeter" ? null : "rejeter")}
        >
          Rejeter
        </Bouton>
      </div>
      {panneau === "reprendre" ? (
        <FormulaireReprise saisie={saisie} onFin={() => setPanneau(null)} />
      ) : null}
      {panneau === "rejeter" ? (
        <FormulaireRejet saisie={saisie} onFin={() => setPanneau(null)} />
      ) : null}
    </div>
  );
}

function FormulaireReprise({
  saisie,
  onFin,
}: {
  saisie: ActionsSaisieKpiProps["saisie"];
  onFin: () => void;
}) {
  const [date, setDate] = useState(saisie.date_mesure);
  const [commentaire, setCommentaire] = useState("");
  const f = useFormulaire<"date_mesure" | "commentaire">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerRepriseSaisie({ date_mesure: date, commentaire }),
      (charge) =>
        api.post(cheminSaisieKpi(saisie.id, "reprendre"), charge, { redirigerSi401: false }),
      {
        succes: "Saisie reprise : la mesure est enregistrée dans l'indicateur.",
        messageSpecifique: (e) => messageErreurCanaux(e),
        apres: onFin,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-canaux__panneau"
      noValidate
      onSubmit={soumettre}
      aria-label={`Reprise de la saisie de ${saisie.kpi_libelle}`}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-texte-doux">
        La valeur reçue par message, confirmée par la personne, devient une mesure de
        l&apos;indicateur sous votre identité.
      </p>
      <Champ
        libelle="Date de la mesure"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        erreur={f.erreurs.date_mesure}
        min="2000-01-01"
        max="2100-12-31"
      />
      <ZoneTexte
        libelle="Commentaire (facultatif)"
        maxLength={500}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Reprendre la mesure
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireRejet({
  saisie,
  onFin,
}: {
  saisie: ActionsSaisieKpiProps["saisie"];
  onFin: () => void;
}) {
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerRejetSaisie(motif),
      (charge) =>
        api.post(cheminSaisieKpi(saisie.id, "rejeter"), charge, { redirigerSi401: false }),
      {
        succes: "Saisie rejetée.",
        messageSpecifique: (e) => messageErreurCanaux(e),
        apres: onFin,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-canaux__panneau"
      noValidate
      onSubmit={soumettre}
      aria-label={`Rejet de la saisie de ${saisie.kpi_libelle}`}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle="Motif du rejet"
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="danger" chargement={f.enCours} texteChargement="Rejet…">
          Rejeter la saisie
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
