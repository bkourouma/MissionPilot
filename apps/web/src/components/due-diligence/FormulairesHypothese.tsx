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
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampHypothese>();
  const [s, setS] = useState<SaisieHypothese>(saisieHypotheseVide());
  const maj = (p: Partial<SaisieHypothese>) => setS((x) => ({ ...x, ...p }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerHypothese(s, langue),
      (charge) => api.post<{ id: string }>(cheminHypotheses(dossierId), charge),
      {
        succes: t("Hypothèse ajoutée.", "Hypothesis added."),
        messageSpecifique: (err) => messageDd(err, langue),
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
      aria-label={t("Nouvelle hypothèse", "New hypothesis")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Hypothèse refusée", "Hypothesis refused")}
      />
      <Champ
        libelle={t("Hypothèse", "Hypothesis")}
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
        aide={t(
          "Une proposition qui se confirme ou s'infirme : « Le marché croît de plus de 8 % par an ».",
          "A proposition that can be confirmed or refuted: “The market grows by more than 8% a year”.",
        )}
      />
      <Select
        libelle={t("Hypothèse parente", "Parent hypothesis")}
        invite={t("Aucune : hypothèse principale", "None: main hypothesis")}
        options={parents}
        value={s.parent_id}
        onChange={(e) => maj({ parent_id: e.target.value })}
        erreur={f.erreurs.parent_id}
        aide={t("L'arbre compte quatre niveaux au plus.", "The tree has four levels at most.")}
      />
      <ZoneTexte
        libelle={t("Critère de décision", "Decision criterion")}
        rows={2}
        maxLength={CRITERE_MAX}
        value={s.critere}
        onChange={(e) => maj({ critere: e.target.value })}
        erreur={f.erreurs.critere}
        aide={t(
          "Facultatif : ce qui permettra de la confirmer ou de l'infirmer.",
          "Optional: what will make it possible to confirm or refute it.",
        )}
      />
      <ZoneTexte
        libelle={t("Description", "Description")}
        rows={2}
        maxLength={TEXTE_LONG_MAX}
        value={s.description}
        onChange={(e) => maj({ description: e.target.value })}
        erreur={f.erreurs.description}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Ajouter l'hypothèse", "Add the hypothesis")}
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
  const t = useT();
  const langue = useLangue();
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
      validerCorrectionHypothese(s, hypothese, langue),
      (charge) =>
        api.post<{ version: number }>(cheminVersionsHypothese(hypothese.id), {
          ...charge,
          version_courante: hypothese.version,
        }),
      {
        succes: t(
          "Nouvelle version enregistrée ; l'ancienne reste dans l'historique.",
          "New version saved; the previous one stays in the history.",
        ),
        messageSpecifique: (err) => messageDd(err, langue),
        apres: () => maj({ motif: "" }),
      },
    );
  }

  async function retirer(): Promise<boolean> {
    return f.envoyer(
      validerRetrait(s.motif, true, langue),
      (charge) =>
        api.post<{ version: number }>(cheminVersionsHypothese(hypothese.id), {
          ...charge,
          version_courante: hypothese.version,
        }),
      {
        succes: t("Hypothèse retirée de l'arbre.", "Hypothesis removed from the tree."),
        messageSpecifique: (err) => messageDd(err, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={corriger}
      aria-label={t("Corriger l'hypothèse", "Edit the hypothesis")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Correction refusée", "Correction refused")}
      />
      <Champ
        libelle={t("Hypothèse", "Hypothesis")}
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      <ZoneTexte
        libelle={t("Critère de décision", "Decision criterion")}
        rows={2}
        maxLength={CRITERE_MAX}
        value={s.critere}
        onChange={(e) => maj({ critere: e.target.value })}
        erreur={f.erreurs.critere}
      />
      <ZoneTexte
        libelle={t("Description", "Description")}
        rows={2}
        maxLength={TEXTE_LONG_MAX}
        value={s.description}
        onChange={(e) => maj({ description: e.target.value })}
        erreur={f.erreurs.description}
      />
      <ZoneTexte
        libelle={t("Motif", "Reason")}
        required
        rows={2}
        maxLength={MOTIF_MAX}
        value={s.motif}
        onChange={(e) => maj({ motif: e.target.value })}
        erreur={f.erreurs.motif}
        aide={t(
          "Conservé dans l'historique. Obligatoire pour corriger comme pour retirer l'hypothèse.",
          "Kept in the history. Required to edit as well as to remove the hypothesis.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la correction", "Save the correction")}
        </Bouton>
        {validerRetrait(s.motif, true, langue).ok ? (
          <BoutonConfirmation
            libelle={t("Retirer cette hypothèse", "Remove this hypothesis")}
            question={t(
              "Retirer cette hypothèse de l'arbre ? Le motif est conservé dans l'historique.",
              "Remove this hypothesis from the tree? The reason is kept in the history.",
            )}
            libelleConfirmation={t("Oui, retirer", "Yes, remove")}
            texteChargement={t("Retrait…", "Removing…")}
            variante="danger"
            action={retirer}
          />
        ) : (
          <Bouton variante="danger" onClick={() => void retirer()} disabled={f.enCours}>
            {t("Retirer cette hypothèse", "Remove this hypothesis")}
          </Bouton>
        )}
      </div>
    </form>
  );
}
