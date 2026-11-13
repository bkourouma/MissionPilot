"use client";

import { useRouter } from "next/navigation";
import { useRafraichir } from "../../../../../components/formulaires/useRafraichir";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { Champ } from "../../../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../../../components/ui/Select";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
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
      validerDepuisProposition(s, langue),
      (c) => api.post<Mission>(`/api/propositions/${encodeURIComponent(propositionId)}/mission`, c),
      {
        rafraichir: false,
        apres: (m) => {
          router.push(`/missions/${m.id}`);
          rafraichir();
        },
      },
    );
  }

  return (
    <Carte titre={t("Créer la mission", "Create the engagement")}>
      <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
        <p className="mp-texte-doux">
          {t(
            "Client, type, devise, découpage et jours par grade viennent de cette proposition. La lettre de mission se signe ensuite depuis la fiche mission.",
            "Client, type, currency, work breakdown and days per grade come from this proposal. The engagement letter is then signed from the engagement record.",
          )}
        </p>
        <RetourFormulaire
          erreur={f.erreurGlobale}
          refAlerte={f.refAlerte}
          titreErreur={t("Création impossible", "Creation failed")}
        />
        <Champ
          libelle={t("Intitulé de la mission", "Engagement title")}
          name="intitule"
          maxLength={200}
          value={s.intitule}
          onChange={(e) => maj("intitule")(e.target.value)}
          erreur={f.erreurs.intitule}
        />
        <div className="mp-grille-champs">
          <Select
            libelle={t("Directeur de mission", "Engagement director")}
            name="directeur_id"
            options={personnes}
            invite={t("À désigner plus tard", "To be assigned later")}
            value={s.directeur_id}
            onChange={(e) => maj("directeur_id")(e.target.value)}
            erreur={f.erreurs.directeur_id}
            aide={t(
              "Associé ou directeur de mission. Obligatoire pour signer la lettre de mission.",
              "Partner or engagement director. Required to sign the engagement letter.",
            )}
          />
          <Select
            libelle={t("Chef de mission", "Engagement manager")}
            name="chef_id"
            options={personnes}
            invite={
              voitToutes
                ? t("À désigner plus tard", "To be assigned later")
                : t("Vous-même", "Yourself")
            }
            value={s.chef_id}
            onChange={(e) => maj("chef_id")(e.target.value)}
            erreur={f.erreurs.chef_id}
            aide={
              voitToutes
                ? undefined
                : t(
                    "Laissez « Vous-même » : vous serez chef de la mission.",
                    'Leave "Yourself": you will be the engagement manager.',
                  )
            }
          />
          <Champ
            libelle={t("Date de début", "Start date")}
            name="date_debut"
            type="date"
            value={s.date_debut}
            onChange={(e) => maj("date_debut")(e.target.value)}
            erreur={f.erreurs.date_debut}
          />
          <Champ
            libelle={t("Date de fin", "End date")}
            name="date_fin"
            type="date"
            value={s.date_fin}
            onChange={(e) => maj("date_fin")(e.target.value)}
            erreur={f.erreurs.date_fin}
          />
        </div>
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            icone="dossier"
            chargement={f.enCours}
            texteChargement={t("Création…", "Creating…")}
          >
            {t("Créer la mission", "Create the engagement")}
          </Bouton>
        </div>
      </form>
    </Carte>
  );
}
