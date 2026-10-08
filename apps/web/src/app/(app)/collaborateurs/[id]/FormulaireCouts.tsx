"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Alerte } from "../../../../components/ui/Alerte";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { api } from "../../../../lib/api";
import { OPTIONS_DEVISES } from "../../../../lib/cabinet";
import { validerCouts, type ChampCouts, type SaisieCouts } from "../../../../lib/collaborateurs";
import type { Devise } from "../../../../lib/format";
import { aideMontant } from "../../../../lib/saisie";

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/**
 * Nouvelle ligne de coûts (taux.gerer). L'historique n'est jamais modifié : une révision crée
 * une ligne datée. Ce composant ne reçoit aucun montant existant.
 */
export function FormulaireCouts({
  collaborateurId,
  externe,
}: {
  collaborateurId: string;
  externe: boolean;
}) {
  const vide: SaisieCouts = {
    cout_journalier: "",
    taux_vente_specifique: "",
    cout_achat: "",
    devise: "XOF",
    depuis_le: aujourdhui(),
  };
  const [s, setS] = useState<SaisieCouts>(vide);
  const f = useFormulaire<ChampCouts | "global">();
  const maj = (k: ChampCouts) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [k]: e.target.value }));
  const aide = aideMontant(s.devise as Devise);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCouts(s),
      (c) => api.post(`/api/collaborateurs/${encodeURIComponent(collaborateurId)}/couts`, c),
      { succes: "Nouvelle ligne de coûts enregistrée.", apres: () => setS(vide) },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-labelledby="titre-couts"
    >
      <h3 id="titre-couts" className="mp-sous-formulaire__titre">
        Enregistrer de nouveaux coûts
      </h3>
      <p className="mp-texte-doux">
        Les lignes passées ne sont jamais modifiées : une révision crée une nouvelle ligne à sa date
        d&apos;effet.
      </p>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {f.erreurs.global ? (
        <Alerte tonalite="danger" titre="Montant manquant">
          <p>{f.erreurs.global}</p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Select
          libelle="Devise"
          name="devise"
          required
          options={OPTIONS_DEVISES}
          value={s.devise}
          onChange={maj("devise")}
          erreur={f.erreurs.devise}
        />
        <Champ
          libelle="Date d'effet"
          type="date"
          name="depuis_le"
          required
          value={s.depuis_le}
          onChange={maj("depuis_le")}
          erreur={f.erreurs.depuis_le}
        />
        <Champ
          libelle="Coût journalier chargé"
          name="cout_journalier"
          inputMode="decimal"
          value={s.cout_journalier}
          onChange={maj("cout_journalier")}
          erreur={f.erreurs.cout_journalier}
          aide={aide}
          autoComplete="off"
        />
        <Champ
          libelle="Taux de vente spécifique"
          name="taux_vente_specifique"
          inputMode="decimal"
          value={s.taux_vente_specifique}
          onChange={maj("taux_vente_specifique")}
          erreur={f.erreurs.taux_vente_specifique}
          aide="Laisser vide pour appliquer le taux du grade."
          autoComplete="off"
        />
        {externe ? (
          <Champ
            libelle="Coût d'achat journalier"
            name="cout_achat"
            inputMode="decimal"
            value={s.cout_achat}
            onChange={maj("cout_achat")}
            erreur={f.erreurs.cout_achat}
            aide="Prix payé par jour à l'expert externe ou au sous-traitant."
            autoComplete="off"
          />
        ) : null}
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer les coûts
        </Bouton>
      </div>
    </form>
  );
}
