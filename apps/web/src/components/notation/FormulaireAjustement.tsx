"use client";

import { useId, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminActionNotation,
  formaterScore,
  MOTIF_MAX,
  messageNotation,
  validerAjustement,
  type VueVersionNotation,
} from "../../lib/notation";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FormulaireAjustementProps {
  notationId: string;
  /** Dimensions notables de la version (seules ajustables), avec leur score retenu (API). */
  dimensions: { dimension: string; libelle: string; score: number | null }[];
}

/**
 * Ajustement motivé d'une dimension (NOT-04) : écart en points (une décimale au plus) et motif
 * OBLIGATOIRE. Le moteur de l'API applique l'écart, borne le score et recalcule le global ; la
 * page affiche ensuite ses chiffres. L'historique est immuable.
 */
export function FormulaireAjustement({ notationId, dimensions }: FormulaireAjustementProps) {
  const t = useT();
  const langue = useLangue();
  const id = useId();
  const f = useFormulaire<"dimension" | "delta" | "motif">();
  const [dimension, setDimension] = useState(dimensions[0]?.dimension ?? "");
  const [delta, setDelta] = useState("");
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerAjustement(
        { dimension, delta, motif },
        dimensions.map((d) => d.dimension),
        langue,
      ),
      (charge) =>
        api.post<VueVersionNotation>(cheminActionNotation(notationId, "ajustements"), charge),
      {
        succes: t(
          "Ajustement enregistré : le score retenu et le score global ont été recalculés par le moteur.",
          "Adjustment saved: the retained score and the overall score were recomputed by the engine.",
        ),
        messageSpecifique: (err) => messageNotation(err, langue),
      },
    );
    if (ok) {
      setDelta("");
      setMotif("");
    }
  }

  const choisie = dimensions.find((d) => d.dimension === dimension);
  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Ajustement refusé", "Adjustment refused")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Dimension", "Dimension")}
          required
          value={dimension}
          onChange={(e) => setDimension(e.target.value)}
          options={dimensions.map((d) => ({
            valeur: d.dimension,
            libelle: `${d.libelle} (${formaterScore(d.score, langue)})`,
          }))}
          erreur={f.erreurs.dimension}
          aide={
            choisie
              ? t(
                  `Score retenu actuel : ${formaterScore(choisie.score, langue)} sur 100.`,
                  `Current retained score: ${formaterScore(choisie.score, langue)} out of 100.`,
                )
              : undefined
          }
        />
        <Champ
          libelle={t("Écart en points", "Difference in points")}
          required
          inputMode="decimal"
          autoComplete="off"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          erreur={f.erreurs.delta}
          aide={t(
            "Positif pour relever, négatif pour abaisser (ex. -4,5) ; une décimale au plus. Le score reste borné entre 0 et 100.",
            "Positive to raise, negative to lower (e.g. -4.5); one decimal at most. The score stays between 0 and 100.",
          )}
        />
      </div>
      <ZoneTexte
        id={`${id}-motif`}
        libelle={t("Motif", "Reason")}
        required
        rows={3}
        maxLength={MOTIF_MAX}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
        aide={t(
          "Note terrain ou entretien qui justifie l'écart. Le motif est conservé dans l'historique, qui ne se modifie pas.",
          "Field note or interview that justifies the difference. The reason is kept in the history, which cannot be edited.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer l'ajustement", "Save adjustment")}
        </Bouton>
      </div>
    </form>
  );
}
