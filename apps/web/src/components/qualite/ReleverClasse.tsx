"use client";

import { useState } from "react";
import { CLASSES_RISQUE, CLASSE_RISQUE_LIBELLES, type ClasseRisque } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { cheminActionSuivi, validerRelevement } from "../../lib/qualite";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { RetourAction } from "./RetourAction";
import { useActionQualite } from "./useActionQualite";

export interface ReleverClasseProps {
  suiviId: string;
  classe: ClasseRisque;
}

/** Relèvement de la classe de risque (QUA-01) : jamais d'abaissement, motif obligatoire. */
export function ReleverClasse({ suiviId, classe }: ReleverClasseProps) {
  const a = useActionQualite();
  const superieures = CLASSES_RISQUE.slice(CLASSES_RISQUE.indexOf(classe) + 1);
  const [nouvelle, setNouvelle] = useState<string>(superieures[0] ?? "");
  const [motif, setMotif] = useState("");
  const [erreurs, setErreurs] = useState<Partial<Record<"classe" | "motif", string>>>({});

  if (superieures.length === 0) {
    return (
      <p className="mp-texte-doux">
        La classe R3 est la plus élevée : elle ne peut plus être relevée.
      </p>
    );
  }

  async function soumettre() {
    const v = validerRelevement(nouvelle, motif, classe);
    if (!v.ok) {
      setErreurs(v.erreurs);
      return;
    }
    setErreurs({});
    const r = await a.agir(
      () => api.post(cheminActionSuivi(suiviId, "classe"), v.charge),
      "Classe relevée : la garde correspondante s'applique désormais.",
    );
    if (r !== undefined) setMotif("");
  }

  return (
    <form
      className="mp-formulaire"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void soumettre();
      }}
    >
      <RetourAction
        erreur={a.erreur}
        succes={a.succes}
        violations={a.violations}
        refAlerte={a.refAlerte}
      />
      <Select
        libelle="Nouvelle classe"
        required
        value={nouvelle}
        onChange={(e) => setNouvelle(e.target.value)}
        options={superieures.map((c) => ({
          valeur: c,
          libelle: `${c} · ${CLASSE_RISQUE_LIBELLES[c]}`,
        }))}
        erreur={erreurs.classe}
        aide="La classe se relève ; elle ne s'abaisse jamais et reste au moins égale à la classe minimale du type de livrable."
      />
      <ZoneTexte
        libelle="Motif du relèvement"
        required
        rows={2}
        maxLength={1000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={a.enCours}
          texteChargement="Relèvement…"
        >
          Relever la classe
        </Bouton>
      </div>
    </form>
  );
}
