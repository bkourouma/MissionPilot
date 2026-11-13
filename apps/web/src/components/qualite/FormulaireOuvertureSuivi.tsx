"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CLASSES_RISQUE, CLASSE_MINIMALE_PAR_TYPE, TYPES_LIVRABLE } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  hrefSuivi,
  libelleClasse,
  libelleType,
  messageQualite,
  validerOuverture,
  type DetailSuivi,
  type SaisieOuverture,
} from "../../lib/qualite";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";

export interface FormulaireOuvertureSuiviProps {
  missions: { id: string; intitule: string }[];
}

/**
 * Ouverture du suivi qualité d'un livrable (QUA-01) : la classe proposée est la classe minimale
 * du type ; elle peut être relevée dès l'ouverture, jamais abaissée. Les modules (rapports,
 * notation, plans) pourront ouvrir ce suivi eux-mêmes ; en attendant, l'identifiant du livrable
 * se saisit ici (un livrable « autre » en reçoit un automatiquement).
 */
export function FormulaireOuvertureSuivi({ missions }: FormulaireOuvertureSuiviProps) {
  const t = useT();
  const langue = useLangue();
  const router = useRouter();
  const f = useFormulaire<keyof SaisieOuverture>();
  const [saisie, setSaisie] = useState<SaisieOuverture>({
    mission_id: missions[0]?.id ?? "",
    type_livrable: "autre",
    livrable_id: "",
    libelle: "",
    classe: "",
  });
  const maj = (c: Partial<SaisieOuverture>) => setSaisie((s) => ({ ...s, ...c }));
  const minimale =
    CLASSE_MINIMALE_PAR_TYPE[saisie.type_livrable as keyof typeof CLASSE_MINIMALE_PAR_TYPE];

  if (missions.length === 0) {
    return (
      <p className="mp-texte-doux">
        {t(
          "Aucune mission visible : ouvrez d'abord une mission.",
          "No visible engagement: open an engagement first.",
        )}
      </p>
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        await f.envoyer(
          validerOuverture(saisie, () => crypto.randomUUID(), langue),
          (charge) => api.post<DetailSuivi>("/api/qualite/suivis", charge),
          {
            messageSpecifique: (e) => messageQualite(e, langue),
            rafraichir: false,
            apres: (r) => router.push(hrefSuivi(r.suivi.id)),
          },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Ouverture impossible", "Opening failed")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Mission", "Engagement")}
          required
          value={saisie.mission_id}
          onChange={(e) => maj({ mission_id: e.target.value })}
          options={missions.map((m) => ({ valeur: m.id, libelle: m.intitule }))}
          erreur={f.erreurs.mission_id}
        />
        <Select
          libelle={t("Type de livrable", "Deliverable type")}
          required
          value={saisie.type_livrable}
          onChange={(e) => maj({ type_livrable: e.target.value })}
          options={TYPES_LIVRABLE.map((tl) => ({ valeur: tl, libelle: libelleType(tl, langue) }))}
          erreur={f.erreurs.type_livrable}
        />
      </div>
      <Champ
        libelle={t("Nom du livrable", "Deliverable name")}
        required
        maxLength={200}
        value={saisie.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Identifiant du livrable", "Deliverable ID")}
          autoComplete="off"
          value={saisie.livrable_id}
          onChange={(e) => maj({ livrable_id: e.target.value })}
          erreur={f.erreurs.livrable_id}
          aide={
            saisie.type_livrable === "autre"
              ? t("Facultatif : un identifiant est généré.", "Optional: an ID is generated.")
              : t(
                  "Identifiant affiché par le module du livrable (rapport, notation, plan…).",
                  "ID shown by the deliverable's module (report, rating, plan…).",
                )
          }
        />
        <Select
          libelle={t("Classe de risque", "Risk class")}
          value={saisie.classe}
          onChange={(e) => maj({ classe: e.target.value })}
          invite={
            minimale
              ? t(
                  `Classe minimale du type (${minimale})`,
                  `Minimum class for the type (${minimale})`,
                )
              : undefined
          }
          options={CLASSES_RISQUE.map((c) => ({
            valeur: c,
            libelle: libelleClasse(c, langue),
          }))}
          erreur={f.erreurs.classe}
          aide={t(
            "Relevable, jamais en dessous de la classe minimale.",
            "Can be raised, never below the minimum class.",
          )}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Ouverture…", "Opening…")}>
          {t("Ouvrir le suivi qualité", "Open quality follow-up")}
        </Bouton>
      </div>
    </form>
  );
}
