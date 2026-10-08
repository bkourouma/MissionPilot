"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CLASSES_RISQUE,
  CLASSE_RISQUE_LIBELLES,
  CLASSE_MINIMALE_PAR_TYPE,
  TYPES_LIVRABLE,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  hrefSuivi,
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
      <p className="mp-texte-doux">Aucune mission visible : ouvrez d&apos;abord une mission.</p>
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
          validerOuverture(saisie, () => crypto.randomUUID()),
          (charge) => api.post<DetailSuivi>("/api/qualite/suivis", charge),
          {
            messageSpecifique: messageQualite,
            rafraichir: false,
            apres: (r) => router.push(hrefSuivi(r.suivi.id)),
          },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Ouverture impossible"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Mission"
          required
          value={saisie.mission_id}
          onChange={(e) => maj({ mission_id: e.target.value })}
          options={missions.map((m) => ({ valeur: m.id, libelle: m.intitule }))}
          erreur={f.erreurs.mission_id}
        />
        <Select
          libelle="Type de livrable"
          required
          value={saisie.type_livrable}
          onChange={(e) => maj({ type_livrable: e.target.value })}
          options={TYPES_LIVRABLE.map((t) => ({ valeur: t, libelle: libelleType(t) }))}
          erreur={f.erreurs.type_livrable}
        />
      </div>
      <Champ
        libelle="Nom du livrable"
        required
        maxLength={200}
        value={saisie.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Identifiant du livrable"
          autoComplete="off"
          value={saisie.livrable_id}
          onChange={(e) => maj({ livrable_id: e.target.value })}
          erreur={f.erreurs.livrable_id}
          aide={
            saisie.type_livrable === "autre"
              ? "Facultatif : un identifiant est généré."
              : "Identifiant affiché par le module du livrable (rapport, notation, plan…)."
          }
        />
        <Select
          libelle="Classe de risque"
          value={saisie.classe}
          onChange={(e) => maj({ classe: e.target.value })}
          invite={minimale ? `Classe minimale du type (${minimale})` : undefined}
          options={CLASSES_RISQUE.map((c) => ({
            valeur: c,
            libelle: `${c} · ${CLASSE_RISQUE_LIBELLES[c]}`,
          }))}
          erreur={f.erreurs.classe}
          aide="Relevable, jamais en dessous de la classe minimale."
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Ouverture…">
          Ouvrir le suivi qualité
        </Bouton>
      </div>
    </form>
  );
}
