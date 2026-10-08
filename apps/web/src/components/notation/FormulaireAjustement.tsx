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
      ),
      (charge) =>
        api.post<VueVersionNotation>(cheminActionNotation(notationId, "ajustements"), charge),
      {
        succes:
          "Ajustement enregistré : le score retenu et le score global ont été recalculés par le moteur.",
        messageSpecifique: messageNotation,
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
        titreErreur="Ajustement refusé"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Dimension"
          required
          value={dimension}
          onChange={(e) => setDimension(e.target.value)}
          options={dimensions.map((d) => ({
            valeur: d.dimension,
            libelle: `${d.libelle} (${formaterScore(d.score)})`,
          }))}
          erreur={f.erreurs.dimension}
          aide={
            choisie ? `Score retenu actuel : ${formaterScore(choisie.score)} sur 100.` : undefined
          }
        />
        <Champ
          libelle="Écart en points"
          required
          inputMode="decimal"
          autoComplete="off"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          erreur={f.erreurs.delta}
          aide="Positif pour relever, négatif pour abaisser (ex. -4,5) ; une décimale au plus. Le score reste borné entre 0 et 100."
        />
      </div>
      <ZoneTexte
        id={`${id}-motif`}
        libelle="Motif"
        required
        rows={3}
        maxLength={MOTIF_MAX}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
        aide="Note terrain ou entretien qui justifie l'écart. Le motif est conservé dans l'historique, qui ne se modifie pas."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer l&apos;ajustement
        </Bouton>
      </div>
    </form>
  );
}
