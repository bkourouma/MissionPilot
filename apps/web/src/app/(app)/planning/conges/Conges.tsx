"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { api } from "../../../../lib/api";
import {
  OPTIONS_TYPES_ABSENCE,
  SAISIE_ABSENCE_VIDE,
  TYPE_ABSENCE_LIBELLES,
  validerAbsence,
  type SaisieAbsence,
} from "../../../../lib/planification";
import { validerMotif } from "../../../../lib/temps";

/** Demande d'absence pour soi (PLN-07). */
export function DemandeAbsence({ aujourdhui }: { aujourdhui: string }) {
  const [saisie, setSaisie] = useState<SaisieAbsence>(SAISIE_ABSENCE_VIDE);
  const f = useFormulaire<keyof SaisieAbsence>();
  const maj = (champ: keyof SaisieAbsence) => (v: string) =>
    setSaisie((s) => ({ ...s, [champ]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerAbsence(saisie), (c) => api.post("/api/absences", c), {
      succes: `Demande de ${TYPE_ABSENCE_LIBELLES[saisie.type as keyof typeof TYPE_ABSENCE_LIBELLES]?.toLowerCase() ?? "absence"} envoyée : elle attend la validation du responsable des ressources.`,
      apres: () => setSaisie(SAISIE_ABSENCE_VIDE),
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Demander une absence"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Demande impossible"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Type d'absence"
          name="type"
          required
          options={OPTIONS_TYPES_ABSENCE}
          value={saisie.type}
          onChange={(e) => maj("type")(e.target.value)}
          erreur={f.erreurs.type}
          aide="Le type n'est visible que de vous et des valideurs des congés."
        />
        <Champ
          libelle="Premier jour d'absence"
          type="date"
          name="date_debut"
          required
          min={aujourdhui}
          value={saisie.date_debut}
          onChange={(e) => {
            const v = e.target.value;
            setSaisie((s) => ({ ...s, date_debut: v, date_fin: s.date_fin || v }));
          }}
          erreur={f.erreurs.date_debut}
        />
        <Champ
          libelle="Dernier jour d'absence"
          type="date"
          name="date_fin"
          required
          min={saisie.date_debut || aujourdhui}
          value={saisie.date_fin}
          onChange={(e) => maj("date_fin")(e.target.value)}
          erreur={f.erreurs.date_fin}
        />
      </div>
      <ZoneTexte
        libelle="Commentaire (facultatif)"
        name="commentaire"
        maxLength={500}
        value={saisie.commentaire}
        onChange={(e) => maj("commentaire")(e.target.value)}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="envoyer" chargement={f.enCours} texteChargement="Envoi…">
          Envoyer la demande
        </Bouton>
      </div>
    </form>
  );
}

/** Annulation par le demandeur d'une absence qui n'a pas commencé. */
export function AnnulationAbsence({ id, libelle }: { id: string; libelle: string }) {
  const f = useFormulaire<never>();
  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Annulation impossible"
      />
      <BoutonConfirmation
        libelle="Annuler la demande"
        ariaLabel={`Annuler la demande : ${libelle}`}
        question={`Annuler cette demande (${libelle}) ?`}
        libelleConfirmation="Oui, annuler"
        texteChargement="Annulation…"
        icone="fermer"
        action={() =>
          f.envoyer({ ok: true, charge: null }, () =>
            api.post(`/api/absences/${encodeURIComponent(id)}/annuler`),
          )
        }
      />
    </div>
  );
}

/** Décision d'un valideur des congés : valider, ou refuser avec un motif obligatoire. */
export function DecisionAbsence({ id, libelle }: { id: string; libelle: string }) {
  const [refus, setRefus] = useState(false);
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const base = `/api/absences/${encodeURIComponent(id)}`;

  async function refuser(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerMotif(motif), (c) => api.post(`${base}/refuser`, c), {
      succes: "Demande refusée : le collaborateur est prévenu.",
    });
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Décision impossible"
      />
      {refus ? (
        <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={refuser}>
          <ZoneTexte
            libelle="Motif du refus"
            required
            maxLength={500}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
            aide="Le motif est transmis au collaborateur."
          />
          <div className="mp-barre-actions">
            <Bouton type="submit" variante="danger" chargement={f.enCours} texteChargement="Refus…">
              Refuser la demande
            </Bouton>
            <Bouton variante="secondaire" onClick={() => setRefus(false)} disabled={f.enCours}>
              Annuler
            </Bouton>
          </div>
        </form>
      ) : (
        <div className="mp-barre-actions">
          <Bouton
            icone="succes"
            chargement={f.enCours}
            texteChargement="Validation…"
            aria-label={`Valider la demande : ${libelle}`}
            onClick={() =>
              f.envoyer({ ok: true, charge: null }, () => api.post(`${base}/valider`), {
                succes: "Demande validée : la capacité du collaborateur est mise à jour.",
              })
            }
          >
            Valider
          </Bouton>
          <Bouton
            variante="secondaire"
            icone="fermer"
            aria-label={`Refuser la demande : ${libelle}`}
            onClick={() => setRefus(true)}
          >
            Refuser…
          </Bouton>
        </div>
      )}
    </div>
  );
}
