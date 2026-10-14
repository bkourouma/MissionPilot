"use client";

import { useState, type FormEvent } from "react";
import { NIVEAUX_RISQUE_DD, type AnalyseDd } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminPoints,
  cheminVersionsPoint,
  libelleCategorie,
  messageDd,
  NIVEAU_RISQUE_DD_LIBELLES,
  optionsDe,
} from "../../lib/due-diligence";
import {
  saisiePointVide,
  TITRE_MAX,
  MOTIF_MAX,
  ENONCE_MAX,
  validerCorrectionPoint,
  validerPoint,
  validerRetrait,
  type ChampCorrectionPoint,
  type ChampPoint,
  type SaisieCorrectionPoint,
  type SaisiePoint,
} from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ChampsAffirmation } from "./ChampsAffirmation";

const OPTIONS_IMPORTANCE = optionsDe(NIVEAUX_RISQUE_DD, NIVEAU_RISQUE_DD_LIBELLES);

export interface FormulairePointProps {
  dossierId: string;
  analyse: AnalyseDd;
  categorie: string;
  peutSigner: boolean;
}

/** Ajout d'un point d'analyse : une affirmation, qui devient une assertion du registre des preuves. */
export function FormulairePoint({
  dossierId,
  analyse,
  categorie,
  peutSigner,
}: FormulairePointProps) {
  const f = useFormulaire<ChampPoint>();
  const [s, setS] = useState<SaisiePoint>(saisiePointVide());
  const maj = (p: Partial<SaisiePoint>) => setS((x) => ({ ...x, ...p }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerPoint(s, analyse, categorie),
      (charge) => api.post<{ id: string; assertion_id: string }>(cheminPoints(dossierId), charge),
      {
        succes: "Point ajouté. Reliez-lui des sources depuis le bouton « Ajouter une source ».",
        messageSpecifique: messageDd,
        apres: () => setS(saisiePointVide()),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={`Nouveau point : ${libelleCategorie(categorie)}`}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Point refusé"
      />
      <ChampsAffirmation valeur={s} onChange={maj} erreurs={f.erreurs} peutSigner={peutSigner} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Titre court"
          maxLength={TITRE_MAX}
          value={s.libelle}
          onChange={(e) => maj({ libelle: e.target.value })}
          erreur={f.erreurs.libelle}
          aide="Facultatif."
        />
        <Select
          libelle="Importance"
          invite="Non précisée"
          options={OPTIONS_IMPORTANCE}
          value={s.niveau}
          onChange={(e) => maj({ niveau: e.target.value })}
          erreur={f.erreurs.niveau}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Ajouter le point
        </Bouton>
      </div>
    </form>
  );
}

export interface CorrectionPointProps {
  point: {
    id: string;
    version: number;
    libelle: string | null;
    niveau: string | null;
    enonce: string;
  };
}

/** Correction motivée d'un point (nouvelle version) ou retrait du point (l'assertion est abandonnée). */
export function CorrectionPoint({ point }: CorrectionPointProps) {
  const f = useFormulaire<ChampCorrectionPoint>();
  const [s, setS] = useState<SaisieCorrectionPoint>({
    libelle: point.libelle ?? "",
    niveau: point.niveau ?? "",
    enonce: point.enonce,
    motif: "",
  });
  const maj = (p: Partial<SaisieCorrectionPoint>) => setS((x) => ({ ...x, ...p }));

  async function corriger(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerCorrectionPoint(s, point),
      (charge) =>
        api.post<{ version: number }>(cheminVersionsPoint(point.id), {
          ...charge,
          version_courante: point.version,
        }),
      {
        succes: "Nouvelle version enregistrée ; l'ancienne reste dans l'historique.",
        messageSpecifique: messageDd,
        apres: () => maj({ motif: "" }),
      },
    );
  }

  async function retirer() {
    await f.envoyer(
      validerRetrait(s.motif, true),
      (charge) =>
        api.post<{ version: number }>(cheminVersionsPoint(point.id), {
          ...charge,
          version_courante: point.version,
        }),
      { succes: "Point retiré ; l'assertion est abandonnée.", messageSpecifique: messageDd },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={corriger}
      aria-label="Corriger le point"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Correction refusée"
      />
      <ZoneTexte
        libelle="Affirmation"
        required
        rows={3}
        maxLength={ENONCE_MAX}
        value={s.enonce}
        onChange={(e) => maj({ enonce: e.target.value })}
        erreur={f.erreurs.enonce}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Titre court"
          maxLength={TITRE_MAX}
          value={s.libelle}
          onChange={(e) => maj({ libelle: e.target.value })}
          erreur={f.erreurs.libelle}
        />
        <Select
          libelle="Importance"
          invite="Non précisée"
          options={OPTIONS_IMPORTANCE}
          value={s.niveau}
          onChange={(e) => maj({ niveau: e.target.value })}
          erreur={f.erreurs.niveau}
        />
      </div>
      <ZoneTexte
        libelle="Motif"
        required
        rows={2}
        maxLength={MOTIF_MAX}
        value={s.motif}
        onChange={(e) => maj({ motif: e.target.value })}
        erreur={f.erreurs.motif}
        aide="Conservé dans l'historique. Obligatoire pour corriger comme pour retirer le point."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la correction
        </Bouton>
        <Bouton variante="danger" onClick={() => void retirer()} disabled={f.enCours}>
          Retirer ce point
        </Bouton>
      </div>
    </form>
  );
}
