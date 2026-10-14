"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { cheminHypotheses, cheminVersionsHypothese, messageDd } from "../../lib/due-diligence";
import {
  CRITERE_MAX,
  MOTIF_MAX,
  saisieHypotheseVide,
  TEXTE_LONG_MAX,
  TITRE_MAX,
  validerCorrectionHypothese,
  validerHypothese,
  validerRetrait,
  type ChampCorrectionHypothese,
  type ChampHypothese,
  type SaisieCorrectionHypothese,
  type SaisieHypothese,
} from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FormulaireHypotheseProps {
  dossierId: string;
  /** Hypothèses sous lesquelles on peut encore ajouter (profondeur 4 au plus), par libellé. */
  parents: { valeur: string; libelle: string }[];
}

/** Ajout d'une hypothèse (racine ou sous-hypothèse). Un verdict n'est jamais saisi ici. */
export function FormulaireHypothese({ dossierId, parents }: FormulaireHypotheseProps) {
  const f = useFormulaire<ChampHypothese>();
  const [s, setS] = useState<SaisieHypothese>(saisieHypotheseVide());
  const maj = (p: Partial<SaisieHypothese>) => setS((x) => ({ ...x, ...p }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerHypothese(s),
      (charge) => api.post<{ id: string }>(cheminHypotheses(dossierId), charge),
      {
        succes: "Hypothèse ajoutée.",
        messageSpecifique: messageDd,
        apres: () => setS(saisieHypotheseVide()),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Nouvelle hypothèse"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Hypothèse refusée"
      />
      <Champ
        libelle="Hypothèse"
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
        aide="Une proposition qui se confirme ou s'infirme : « Le marché croît de plus de 8 % par an »."
      />
      <Select
        libelle="Hypothèse parente"
        invite="Aucune : hypothèse principale"
        options={parents}
        value={s.parent_id}
        onChange={(e) => maj({ parent_id: e.target.value })}
        erreur={f.erreurs.parent_id}
        aide="L'arbre compte quatre niveaux au plus."
      />
      <ZoneTexte
        libelle="Critère de décision"
        rows={2}
        maxLength={CRITERE_MAX}
        value={s.critere}
        onChange={(e) => maj({ critere: e.target.value })}
        erreur={f.erreurs.critere}
        aide="Facultatif : ce qui permettra de la confirmer ou de l'infirmer."
      />
      <ZoneTexte
        libelle="Description"
        rows={2}
        maxLength={TEXTE_LONG_MAX}
        value={s.description}
        onChange={(e) => maj({ description: e.target.value })}
        erreur={f.erreurs.description}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Ajouter l&apos;hypothèse
        </Bouton>
      </div>
    </form>
  );
}

export interface CorrectionHypotheseProps {
  hypothese: {
    id: string;
    version: number;
    libelle: string;
    description: string | null;
    critere: string | null;
  };
}

/** Correction motivée d'une hypothèse (nouvelle version) ou retrait ; le verdict en attente l'interdit. */
export function CorrectionHypothese({ hypothese }: CorrectionHypotheseProps) {
  const f = useFormulaire<ChampCorrectionHypothese>();
  const [s, setS] = useState<SaisieCorrectionHypothese>({
    libelle: hypothese.libelle,
    description: hypothese.description ?? "",
    critere: hypothese.critere ?? "",
    motif: "",
  });
  const maj = (p: Partial<SaisieCorrectionHypothese>) => setS((x) => ({ ...x, ...p }));

  async function corriger(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerCorrectionHypothese(s, hypothese),
      (charge) =>
        api.post<{ version: number }>(cheminVersionsHypothese(hypothese.id), {
          ...charge,
          version_courante: hypothese.version,
        }),
      {
        succes: "Nouvelle version enregistrée ; l'ancienne reste dans l'historique.",
        messageSpecifique: messageDd,
        apres: () => maj({ motif: "" }),
      },
    );
  }

  async function retirer() {
    await f.envoyer(
      validerRetrait(s.motif, true),
      (charge) =>
        api.post<{ version: number }>(cheminVersionsHypothese(hypothese.id), {
          ...charge,
          version_courante: hypothese.version,
        }),
      { succes: "Hypothèse retirée de l'arbre.", messageSpecifique: messageDd },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={corriger}
      aria-label="Corriger l'hypothèse"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Correction refusée"
      />
      <Champ
        libelle="Hypothèse"
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      <ZoneTexte
        libelle="Critère de décision"
        rows={2}
        maxLength={CRITERE_MAX}
        value={s.critere}
        onChange={(e) => maj({ critere: e.target.value })}
        erreur={f.erreurs.critere}
      />
      <ZoneTexte
        libelle="Description"
        rows={2}
        maxLength={TEXTE_LONG_MAX}
        value={s.description}
        onChange={(e) => maj({ description: e.target.value })}
        erreur={f.erreurs.description}
      />
      <ZoneTexte
        libelle="Motif"
        required
        rows={2}
        maxLength={MOTIF_MAX}
        value={s.motif}
        onChange={(e) => maj({ motif: e.target.value })}
        erreur={f.erreurs.motif}
        aide="Conservé dans l'historique. Obligatoire pour corriger comme pour retirer l'hypothèse."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la correction
        </Bouton>
        <Bouton variante="danger" onClick={() => void retirer()} disabled={f.enCours}>
          Retirer cette hypothèse
        </Bouton>
      </div>
    </form>
  );
}
