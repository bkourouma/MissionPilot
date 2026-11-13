"use client";

import { useState } from "react";
import { CLASSES_RISQUE, type ClasseRisque } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { cheminActionSuivi, libelleClasse, validerRelevement } from "../../lib/qualite";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const a = useActionQualite();
  const superieures = CLASSES_RISQUE.slice(CLASSES_RISQUE.indexOf(classe) + 1);
  const [nouvelle, setNouvelle] = useState<string>(superieures[0] ?? "");
  const [motif, setMotif] = useState("");
  const [erreurs, setErreurs] = useState<Partial<Record<"classe" | "motif", string>>>({});

  if (superieures.length === 0) {
    return (
      <p className="mp-texte-doux">
        {t(
          "La classe R3 est la plus élevée : elle ne peut plus être relevée.",
          "Class R3 is the highest: it can no longer be raised.",
        )}
      </p>
    );
  }

  async function soumettre() {
    const v = validerRelevement(nouvelle, motif, classe, langue);
    if (!v.ok) {
      setErreurs(v.erreurs);
      return;
    }
    setErreurs({});
    const r = await a.agir(
      () => api.post(cheminActionSuivi(suiviId, "classe"), v.charge),
      t(
        "Classe relevée : la garde correspondante s'applique désormais.",
        "Class raised: the corresponding safeguard now applies.",
      ),
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
        libelle={t("Nouvelle classe", "New class")}
        required
        value={nouvelle}
        onChange={(e) => setNouvelle(e.target.value)}
        options={superieures.map((c) => ({
          valeur: c,
          libelle: libelleClasse(c, langue),
        }))}
        erreur={erreurs.classe}
        aide={t(
          "La classe se relève ; elle ne s'abaisse jamais et reste au moins égale à la classe minimale du type de livrable.",
          "The class can only be raised, never lowered, and stays at least equal to the minimum class of the deliverable type.",
        )}
      />
      <ZoneTexte
        libelle={t("Motif du relèvement", "Reason for raising")}
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
          texteChargement={t("Relèvement…", "Raising…")}
        >
          {t("Relever la classe", "Raise class")}
        </Bouton>
      </div>
    </form>
  );
}
