"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { STRATES_ECHANTILLON } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminCreationCampagne,
  hrefCampagne,
  messageFroide,
  STRATES_LIBELLES,
} from "../../lib/qualite-froide";
import {
  validerCampagne,
  type ChampCampagne,
  type SaisieCampagne,
} from "../../lib/qualite-froide-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
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
          validerCampagne(s),
          (charge) => api.post<{ id: string }>(cheminCreationCampagne(), charge),
          {
            succes: "Échantillon tiré : la campagne est ouverte.",
            messageSpecifique: messageFroide,
            apres: (r) => router.push(hrefCampagne(r.id)),
          },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Tirage impossible"
      />
      <Champ
        libelle="Intitulé de la campagne"
        required
        maxLength={200}
        value={s.intitule}
        onChange={(e) => maj({ intitule: e.target.value })}
        erreur={f.erreurs.intitule}
        aide="Par exemple : « Revue à froid, missions clôturées au 2e semestre 2026 »."
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Clôturées à partir du"
          type="date"
          required
          value={s.periode_debut}
          onChange={(e) => maj({ periode_debut: e.target.value })}
          erreur={f.erreurs.periode_debut}
        />
        <Champ
          libelle="Clôturées jusqu'au"
          type="date"
          required
          value={s.periode_fin}
          onChange={(e) => maj({ periode_fin: e.target.value })}
          erreur={f.erreurs.periode_fin}
        />
      </div>
      {types.length > 0 ? (
        <GroupeCases
          legende="Types de mission"
          aide="Sans choix, tous les types de mission sont tirables."
          nom="types_mission"
          options={types}
          valeurs={s.types_mission_ids}
          onChange={(v) => maj({ types_mission_ids: v })}
        />
      ) : null}
      {directeurs.length > 0 ? (
        <GroupeCases
          legende="Directeurs de mission"
          aide="Sans choix, tous les directeurs sont concernés."
          nom="directeurs"
          options={directeurs}
          valeurs={s.directeur_ids}
          onChange={(v) => maj({ directeur_ids: v })}
        />
      ) : null}
      <div className="mp-grille-champs">
        <Champ
          libelle="Taille de l'échantillon"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          required
          value={s.taille}
          onChange={(e) => maj({ taille: e.target.value })}
          erreur={f.erreurs.taille}
          aide="Nombre de missions à revoir (100 au plus)."
        />
        <Select
          libelle="Stratification"
          value={s.stratifier_par}
          onChange={(e) => maj({ stratifier_par: e.target.value })}
          invite="Aucune (tirage simple)"
          options={STRATES_ECHANTILLON.map((v) => ({ valeur: v, libelle: STRATES_LIBELLES[v] }))}
          erreur={f.erreurs.stratifier_par}
          aide="Répartit l'échantillon de façon équilibrée entre les types ou les directeurs."
        />
      </div>
      <Champ
        libelle="Graine du tirage (facultatif)"
        maxLength={64}
        autoComplete="off"
        value={s.graine}
        onChange={(e) => maj({ graine: e.target.value })}
        erreur={f.erreurs.graine}
        aide="La graine rend le tirage reproductible, elle est enregistrée. Laissée vide, le serveur en choisit une et l'enregistre."
      />
      <CaseACocher
        libelle="Exclure les missions déjà revues"
        aide="Écarte les missions tirées dans une campagne précédente du cabinet."
        checked={s.exclure_deja_revues}
        onChange={(e) => maj({ exclure_deja_revues: e.target.checked })}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Tirage en cours…">
          Tirer un échantillon
        </Bouton>
      </div>
    </form>
  );
}
