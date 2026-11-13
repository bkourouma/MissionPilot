"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import {
  cheminSatisfactions,
  messageQualite,
  validerSatisfaction,
  type SaisieSatisfaction,
  type VueSatisfactions,
} from "../../lib/qualite";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FormulaireSatisfactionProps {
  missionId: string;
  jalons: { id: string; libelle: string }[];
}

/**
 * Saisie de la satisfaction du client (QUA-08) : note de recommandation de 0 à 10 à un jalon ou
 * à la clôture. Une nouvelle note pour le même moment remplace la précédente dans le calcul ;
 * l'historique est conservé. Le NPS est calculé par l'API.
 */
export function FormulaireSatisfaction({ missionId, jalons }: FormulaireSatisfactionProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"moment" | "jalon_id" | "note" | "commentaire">();
  const [saisie, setSaisie] = useState<SaisieSatisfaction>({
    moment: jalons.length > 0 ? "jalon" : "cloture",
    jalon_id: jalons[0]?.id ?? "",
    note: "",
    commentaire: "",
    repondant: "",
  });
  const maj = (c: Partial<SaisieSatisfaction>) => setSaisie((s) => ({ ...s, ...c }));

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        await f.envoyer(
          validerSatisfaction(saisie, langue),
          (charge) => api.post<VueSatisfactions>(cheminSatisfactions(missionId), charge),
          {
            succes: t("Note enregistrée.", "Score saved."),
            messageSpecifique: (e) => messageQualite(e, langue),
            apres: () => maj({ note: "", commentaire: "", repondant: "" }),
          },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Note refusée", "Score refused")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Moment", "Timing")}
          required
          value={saisie.moment}
          onChange={(e) => maj({ moment: e.target.value })}
          options={[
            ...(jalons.length > 0
              ? [{ valeur: "jalon", libelle: t("À un jalon", "At a milestone") }]
              : []),
            {
              valeur: "cloture",
              libelle: t("À la clôture de la mission", "At engagement close-out"),
            },
          ]}
          erreur={f.erreurs.moment}
        />
        {saisie.moment === "jalon" ? (
          <Select
            libelle={t("Jalon", "Milestone")}
            required
            value={saisie.jalon_id}
            onChange={(e) => maj({ jalon_id: e.target.value })}
            options={jalons.map((j) => ({ valeur: j.id, libelle: j.libelle }))}
            erreur={f.erreurs.jalon_id}
          />
        ) : null}
      </div>
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Note de 0 à 10", "Score from 0 to 10")}
          required
          inputMode="numeric"
          autoComplete="off"
          value={saisie.note}
          onChange={(e) => maj({ note: e.target.value })}
          erreur={f.erreurs.note}
          aide={t(
            "Quelle est la probabilité que le client recommande le cabinet ? 0 : pas du tout, 10 : certainement.",
            "How likely is the client to recommend the firm? 0: not at all, 10: certainly.",
          )}
        />
        <Champ
          libelle={t("Répondant (facultatif)", "Respondent (optional)")}
          maxLength={200}
          value={saisie.repondant}
          onChange={(e) => maj({ repondant: e.target.value })}
        />
      </div>
      <ZoneTexte
        libelle={t("Commentaire du client (facultatif)", "Client comment (optional)")}
        rows={3}
        maxLength={2000}
        value={saisie.commentaire}
        onChange={(e) => maj({ commentaire: e.target.value })}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la note", "Save score")}
        </Bouton>
      </div>
    </form>
  );
}
