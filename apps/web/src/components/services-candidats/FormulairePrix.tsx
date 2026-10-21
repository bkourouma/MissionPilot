"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { api } from "../../lib/api";
import {
  montantVersTexte,
  OPTIONS_DEVISES_SERVICE,
  validerPrix,
  type ChampPrix,
  type ServiceCandidat,
} from "../../lib/services-candidats";

/** Prix fixe du service (associé, directeur de mission) : aucun prix par défaut, le cabinet le fixe. */
export function FormulairePrix({ service }: { service: ServiceCandidat }) {
  const f = useFormulaire<ChampPrix>();
  const [montant, setMontant] = useState(montantVersTexte(service.prix.montant));
  const [devise, setDevise] = useState(service.prix.devise);
  const [mention, setMention] = useState(service.prix.commentaire ?? "");

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerPrix(montant, devise, mention),
      (charge) =>
        api.put(`/api/services-candidats/${encodeURIComponent(service.code)}/prix`, charge),
      { succes: "Prix fixe enregistré." },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Montant du prix fixe"
          name="montant"
          inputMode="numeric"
          autoComplete="off"
          value={montant}
          onChange={(e) => setMontant(e.target.value)}
          erreur={f.erreurs.montant}
          aide="Montant entier ; laisser vide pour « sur devis » ou « à fixer »."
        />
        <Select
          libelle="Devise"
          name="devise"
          required
          options={OPTIONS_DEVISES_SERVICE}
          value={devise}
          onChange={(e) => setDevise(e.target.value)}
          erreur={f.erreurs.devise}
        />
        <Champ
          libelle="Mention (facultatif)"
          name="commentaire"
          autoComplete="off"
          maxLength={200}
          value={mention}
          onChange={(e) => setMention(e.target.value)}
          erreur={f.erreurs.commentaire}
          aide="Texte libre affiché avec le prix (ex. « DÉMONSTRATION »)."
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer le prix
        </Bouton>
      </div>
    </form>
  );
}
