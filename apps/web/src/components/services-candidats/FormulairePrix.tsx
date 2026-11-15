"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { api } from "../../lib/api";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  montantVersTexte,
  optionsDevisesService,
  validerPrix,
  type ChampPrix,
  type ServiceCandidat,
} from "../../lib/services-candidats";

/** Prix fixe du service (associé, directeur de mission) : aucun prix par défaut, le cabinet le fixe. */
export function FormulairePrix({ service }: { service: ServiceCandidat }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampPrix>();
  const [montant, setMontant] = useState(montantVersTexte(service.prix.montant));
  const [devise, setDevise] = useState(service.prix.devise);
  const [mention, setMention] = useState(service.prix.commentaire ?? "");

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerPrix(montant, devise, mention, langue),
      (charge) =>
        api.put(`/api/services-candidats/${encodeURIComponent(service.code)}/prix`, charge),
      { succes: t("Prix fixe enregistré.", "Fixed price saved.") },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement impossible", "Saving failed")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Montant du prix fixe", "Fixed price amount")}
          name="montant"
          inputMode="numeric"
          autoComplete="off"
          value={montant}
          onChange={(e) => setMontant(e.target.value)}
          erreur={f.erreurs.montant}
          aide={t(
            "Montant entier ; laisser vide pour « sur devis » ou « à fixer ».",
            'Whole amount; leave empty for "on quote" or "to be set".',
          )}
        />
        <Select
          libelle={t("Devise", "Currency")}
          name="devise"
          required
          options={optionsDevisesService(langue)}
          value={devise}
          onChange={(e) => setDevise(e.target.value)}
          erreur={f.erreurs.devise}
        />
        <Champ
          libelle={t("Mention (facultatif)", "Note (optional)")}
          name="commentaire"
          autoComplete="off"
          maxLength={200}
          value={mention}
          onChange={(e) => setMention(e.target.value)}
          erreur={f.erreurs.commentaire}
          aide={t(
            "Texte libre affiché avec le prix (ex. « DÉMONSTRATION »).",
            'Free text shown with the price (e.g. "DEMONSTRATION").',
          )}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer le prix", "Save the price")}
        </Bouton>
      </div>
    </form>
  );
}
