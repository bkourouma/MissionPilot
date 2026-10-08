"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import type { OptionSelect } from "../../../../components/ui/Select";
import { Select } from "../../../../components/ui/Select";
import { api } from "../../../../lib/api";
import {
  validerGeneration,
  type Proposition,
  type SaisieGeneration,
} from "../../../../lib/propositions";

export interface GenerationPropositionProps {
  opportuniteId: string;
  types: readonly OptionSelect[];
  typeParDefaut: string;
}

/** Génère une proposition depuis un type du catalogue (MIS-05, parcours A étape 1). */
export function GenerationProposition({
  opportuniteId,
  types,
  typeParDefaut,
}: GenerationPropositionProps) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [s, setS] = useState<SaisieGeneration>({ type_mission_id: typeParDefaut, intitule: "" });
  const f = useFormulaire<keyof SaisieGeneration>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerGeneration(s),
      (c) =>
        api.post<Proposition>(
          `/api/opportunites/${encodeURIComponent(opportuniteId)}/propositions`,
          c,
        ),
      {
        rafraichir: false,
        apres: (p) => {
          router.push(`/pipeline/propositions/${p.id}`);
          router.refresh();
        },
      },
    );
  }

  if (!ouvert) {
    return (
      <div>
        <Bouton icone="plus" onClick={() => setOuvert(true)}>
          Générer une proposition
        </Bouton>
      </div>
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Générer une proposition"
    >
      <p className="mp-sous-formulaire__titre">Générer une proposition</p>
      <p className="mp-texte-doux">
        Le découpage, l&apos;équipe et les jours par grade du type sont recopiés dans un brouillon,
        à ajuster avant validation par un associé.
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Génération impossible"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Type de mission"
          name="type_mission_id"
          required
          options={types}
          invite={types.length ? "Choisir un type…" : "Aucun type actif dans le catalogue"}
          value={s.type_mission_id}
          onChange={(e) => setS((x) => ({ ...x, type_mission_id: e.target.value }))}
          erreur={f.erreurs.type_mission_id}
        />
        <Champ
          libelle="Intitulé (facultatif)"
          name="intitule"
          maxLength={200}
          value={s.intitule}
          onChange={(e) => setS((x) => ({ ...x, intitule: e.target.value }))}
          erreur={f.erreurs.intitule}
          aide="Par défaut : l'intitulé de l'opportunité."
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Génération…">
          Générer le brouillon
        </Bouton>
        <Bouton variante="discret" onClick={() => setOuvert(false)}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
