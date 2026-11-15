"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { STRATES_ECHANTILLON } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminCreationCampagne,
  hrefCampagne,
  libelleStrate,
  messageFroide,
} from "../../lib/qualite-froide";
import {
  validerCampagne,
  type ChampCampagne,
  type SaisieCampagne,
} from "../../lib/qualite-froide-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher, GroupeCases } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

export interface FroideFormulaireTirageProps {
  types: { valeur: string; libelle: string }[];
  directeurs: { valeur: string; libelle: string }[];
}

const SAISIE_INITIALE: SaisieCampagne = {
  intitule: "",
  periode_debut: "",
  periode_fin: "",
  types_mission_ids: [],
  directeur_ids: [],
  stratifier_par: "",
  taille: "8",
  graine: "",
  exclure_deja_revues: true,
};

/**
 * Tirage d'un échantillon de missions clôturées (QUA-05). Le tirage, la stratification et
 * l'exclusion des missions déjà revues sont exécutés par l'API ; la graine, toujours enregistrée,
 * rend le tirage reproductible.
 */
export function FroideFormulaireTirage({ types, directeurs }: FroideFormulaireTirageProps) {
  const t = useT();
  const langue = useLangue();
  const router = useRouter();
  const f = useFormulaire<ChampCampagne>();
  const [s, setS] = useState<SaisieCampagne>(SAISIE_INITIALE);
  const maj = (p: Partial<SaisieCampagne>) => setS((x) => ({ ...x, ...p }));

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        await f.envoyer(
          validerCampagne(s, langue),
          (charge) => api.post<{ id: string }>(cheminCreationCampagne(), charge),
          {
            succes: t(
              "Échantillon tiré : la campagne est ouverte.",
              "Sample drawn: the campaign is open.",
            ),
            messageSpecifique: (e) => messageFroide(e, langue),
            apres: (r) => router.push(hrefCampagne(r.id)),
          },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Tirage impossible", "Draw failed")}
      />
      <Champ
        libelle={t("Intitulé de la campagne", "Campaign title")}
        required
        maxLength={200}
        value={s.intitule}
        onChange={(e) => maj({ intitule: e.target.value })}
        erreur={f.erreurs.intitule}
        aide={t(
          "Par exemple : « Revue à froid, missions clôturées au 2e semestre 2026 ».",
          'For example: "Cold review, engagements closed in H2 2026".',
        )}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Clôturées à partir du", "Closed from")}
          type="date"
          required
          value={s.periode_debut}
          onChange={(e) => maj({ periode_debut: e.target.value })}
          erreur={f.erreurs.periode_debut}
        />
        <Champ
          libelle={t("Clôturées jusqu'au", "Closed until")}
          type="date"
          required
          value={s.periode_fin}
          onChange={(e) => maj({ periode_fin: e.target.value })}
          erreur={f.erreurs.periode_fin}
        />
      </div>
      {types.length > 0 ? (
        <GroupeCases
          legende={t("Types de mission", "Engagement types")}
          aide={t(
            "Sans choix, tous les types de mission sont tirables.",
            "If none is selected, all engagement types can be drawn.",
          )}
          nom="types_mission"
          options={types}
          valeurs={s.types_mission_ids}
          onChange={(v) => maj({ types_mission_ids: v })}
        />
      ) : null}
      {directeurs.length > 0 ? (
        <GroupeCases
          legende={t("Directeurs de mission", "Engagement directors")}
          aide={t(
            "Sans choix, tous les directeurs sont concernés.",
            "If none is selected, all directors are included.",
          )}
          nom="directeurs"
          options={directeurs}
          valeurs={s.directeur_ids}
          onChange={(v) => maj({ directeur_ids: v })}
        />
      ) : null}
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Taille de l'échantillon", "Sample size")}
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          required
          value={s.taille}
          onChange={(e) => maj({ taille: e.target.value })}
          erreur={f.erreurs.taille}
          aide={t(
            "Nombre de missions à revoir (100 au plus).",
            "Number of engagements to review (100 at most).",
          )}
        />
        <Select
          libelle={t("Stratification", "Stratification")}
          value={s.stratifier_par}
          onChange={(e) => maj({ stratifier_par: e.target.value })}
          invite={t("Aucune (tirage simple)", "None (simple draw)")}
          options={STRATES_ECHANTILLON.map((v) => ({
            valeur: v,
            libelle: libelleStrate(v, langue),
          }))}
          erreur={f.erreurs.stratifier_par}
          aide={t(
            "Répartit l'échantillon de façon équilibrée entre les types ou les directeurs.",
            "Spreads the sample evenly across types or directors.",
          )}
        />
      </div>
      <Champ
        libelle={t("Graine du tirage (facultatif)", "Draw seed (optional)")}
        maxLength={64}
        autoComplete="off"
        value={s.graine}
        onChange={(e) => maj({ graine: e.target.value })}
        erreur={f.erreurs.graine}
        aide={t(
          "La graine rend le tirage reproductible, elle est enregistrée. Laissée vide, le serveur en choisit une et l'enregistre.",
          "The seed makes the draw reproducible and is recorded. If left empty, the server picks one and records it.",
        )}
      />
      <CaseACocher
        libelle={t("Exclure les missions déjà revues", "Exclude engagements already reviewed")}
        aide={t(
          "Écarte les missions tirées dans une campagne précédente du cabinet.",
          "Leaves out engagements drawn in a previous campaign of the firm.",
        )}
        checked={s.exclure_deja_revues}
        onChange={(e) => maj({ exclure_deja_revues: e.target.checked })}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Tirage en cours…", "Drawing…")}
        >
          {t("Tirer un échantillon", "Draw a sample")}
        </Bouton>
      </div>
    </form>
  );
}
