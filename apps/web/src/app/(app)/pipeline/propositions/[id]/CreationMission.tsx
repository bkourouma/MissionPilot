"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { Champ } from "../../../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../../../components/ui/Select";
import { api } from "../../../../../lib/api";
import {
  validerDepuisProposition,
  type Mission,
  type SaisieDepuisProposition,
} from "../../../../../lib/missions";

export interface CreationMissionProps {
  propositionId: string;
  intitule: string;
  personnes: readonly OptionSelect[];
  /** Sans « mission.lire_toutes », le créateur devient chef de la mission. */
  voitToutes: boolean;
}

/** Proposition acceptée → mission (parcours A, étape 3) : découpage et jours recopiés. */
export function CreationMission({
  propositionId,
  intitule,
  personnes,
  voitToutes,
}: CreationMissionProps) {
  const router = useRouter();
  const [s, setS] = useState<SaisieDepuisProposition>({
    intitule,
    directeur_id: "",
    chef_id: "",
    date_debut: "",
    date_fin: "",
  });
  const f = useFormulaire<keyof SaisieDepuisProposition>();
  const maj = (champ: keyof SaisieDepuisProposition) => (v: string) =>
    setS((x) => ({ ...x, [champ]: v }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerDepuisProposition(s),
      (c) => api.post<Mission>(`/api/propositions/${encodeURIComponent(propositionId)}/mission`, c),
      {
        rafraichir: false,
        apres: (m) => {
          router.push(`/missions/${m.id}`);
          router.refresh();
        },
      },
    );
  }

  return (
    <Carte titre="Créer la mission">
      <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
        <p className="mp-texte-doux">
          Client, type, devise, découpage et jours par grade viennent de cette proposition. La
          lettre de mission se signe ensuite depuis la fiche mission.
        </p>
        <RetourFormulaire
          erreur={f.erreurGlobale}
          refAlerte={f.refAlerte}
          titreErreur="Création impossible"
        />
        <Champ
          libelle="Intitulé de la mission"
          name="intitule"
          maxLength={200}
          value={s.intitule}
          onChange={(e) => maj("intitule")(e.target.value)}
          erreur={f.erreurs.intitule}
        />
        <div className="mp-grille-champs">
          <Select
            libelle="Directeur de mission"
            name="directeur_id"
            options={personnes}
            invite="À désigner plus tard"
            value={s.directeur_id}
            onChange={(e) => maj("directeur_id")(e.target.value)}
            erreur={f.erreurs.directeur_id}
            aide="Associé ou directeur de mission. Obligatoire pour signer la lettre de mission."
          />
          <Select
            libelle="Chef de mission"
            name="chef_id"
            options={personnes}
            invite={voitToutes ? "À désigner plus tard" : "Vous-même"}
            value={s.chef_id}
            onChange={(e) => maj("chef_id")(e.target.value)}
            erreur={f.erreurs.chef_id}
            aide={voitToutes ? undefined : "Laissez « Vous-même » : vous serez chef de la mission."}
          />
          <Champ
            libelle="Date de début"
            name="date_debut"
            type="date"
            value={s.date_debut}
            onChange={(e) => maj("date_debut")(e.target.value)}
            erreur={f.erreurs.date_debut}
          />
          <Champ
            libelle="Date de fin"
            name="date_fin"
            type="date"
            value={s.date_fin}
            onChange={(e) => maj("date_fin")(e.target.value)}
            erreur={f.erreurs.date_fin}
          />
        </div>
        <div className="mp-actions-formulaire">
          <Bouton type="submit" icone="dossier" chargement={f.enCours} texteChargement="Création…">
            Créer la mission
          </Bouton>
        </div>
      </form>
    </Carte>
  );
}
