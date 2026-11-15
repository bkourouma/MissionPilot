"use client";

import { useRouter } from "next/navigation";
import { useRafraichir } from "../../../../components/formulaires/useRafraichir";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import type { OptionSelect } from "../../../../components/ui/Select";
import { Select } from "../../../../components/ui/Select";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [ouvert, setOuvert] = useState(false);
  const [s, setS] = useState<SaisieGeneration>({ type_mission_id: typeParDefaut, intitule: "" });
  const f = useFormulaire<keyof SaisieGeneration>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerGeneration(s, langue),
      (c) =>
        api.post<Proposition>(
          `/api/opportunites/${encodeURIComponent(opportuniteId)}/propositions`,
          c,
        ),
      {
        rafraichir: false,
        apres: (p) => {
          router.push(`/pipeline/propositions/${p.id}`);
          rafraichir();
        },
      },
    );
  }

  if (!ouvert) {
    return (
      <div>
        <Bouton icone="plus" onClick={() => setOuvert(true)}>
          {t("Générer une proposition", "Generate a proposal")}
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
      aria-label={t("Générer une proposition", "Generate a proposal")}
    >
      <p className="mp-sous-formulaire__titre">
        {t("Générer une proposition", "Generate a proposal")}
      </p>
      <p className="mp-texte-doux">
        {t(
          "Le découpage, l'équipe et les jours par grade du type sont recopiés dans un brouillon, à ajuster avant validation par un associé.",
          "The work breakdown, team and days per grade of the type are copied into a draft, to be adjusted before approval by a partner.",
        )}
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Génération impossible", "Generation failed")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Type de mission", "Engagement type")}
          name="type_mission_id"
          required
          options={types}
          invite={
            types.length
              ? t("Choisir un type…", "Choose a type…")
              : t("Aucun type actif dans le catalogue", "No active type in the catalog")
          }
          value={s.type_mission_id}
          onChange={(e) => setS((x) => ({ ...x, type_mission_id: e.target.value }))}
          erreur={f.erreurs.type_mission_id}
        />
        <Champ
          libelle={t("Intitulé (facultatif)", "Title (optional)")}
          name="intitule"
          maxLength={200}
          value={s.intitule}
          onChange={(e) => setS((x) => ({ ...x, intitule: e.target.value }))}
          erreur={f.erreurs.intitule}
          aide={t(
            "Par défaut : l'intitulé de l'opportunité.",
            "By default: the opportunity title.",
          )}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Génération…", "Generating…")}
        >
          {t("Générer le brouillon", "Generate the draft")}
        </Bouton>
        <Bouton variante="discret" onClick={() => setOuvert(false)}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
