"use client";

import { useState, type FormEvent } from "react";
import { NIVEAUX_RISQUE_DD, type AnalyseDd } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminPoints,
  cheminVersionsPoint,
  libelleCategorie,
  libellesDd,
  messageDd,
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
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ChampsAffirmation } from "./ChampsAffirmation";

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
  const t = useT();
  const langue = useLangue();
  const optionsImportance = optionsDe(NIVEAUX_RISQUE_DD, libellesDd(langue).NIVEAU_RISQUE);
  const f = useFormulaire<ChampPoint>();
  const [s, setS] = useState<SaisiePoint>(saisiePointVide());
  const maj = (p: Partial<SaisiePoint>) => setS((x) => ({ ...x, ...p }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerPoint(s, analyse, categorie, langue),
      (charge) => api.post<{ id: string; assertion_id: string }>(cheminPoints(dossierId), charge),
      {
        succes: t(
          "Point ajouté. Reliez-lui des sources depuis le bouton « Ajouter une source ».",
          "Item added. Link sources to it using the “Add a source” button.",
        ),
        messageSpecifique: (err) => messageDd(err, langue),
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
      aria-label={t(
        `Nouveau point : ${libelleCategorie(categorie, langue)}`,
        `New item: ${libelleCategorie(categorie, langue)}`,
      )}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Point refusé", "Item refused")}
      />
      <ChampsAffirmation valeur={s} onChange={maj} erreurs={f.erreurs} peutSigner={peutSigner} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Titre court", "Short title")}
          maxLength={TITRE_MAX}
          value={s.libelle}
          onChange={(e) => maj({ libelle: e.target.value })}
          erreur={f.erreurs.libelle}
          aide={t("Facultatif.", "Optional.")}
        />
        <Select
          libelle={t("Importance", "Importance")}
          invite={t("Non précisée", "Not specified")}
          options={optionsImportance}
          value={s.niveau}
          onChange={(e) => maj({ niveau: e.target.value })}
          erreur={f.erreurs.niveau}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Ajouter le point", "Add the item")}
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
  const t = useT();
  const langue = useLangue();
  const optionsImportance = optionsDe(NIVEAUX_RISQUE_DD, libellesDd(langue).NIVEAU_RISQUE);
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
      validerCorrectionPoint(s, point, langue),
      (charge) =>
        api.post<{ version: number }>(cheminVersionsPoint(point.id), {
          ...charge,
          version_courante: point.version,
        }),
      {
        succes: t(
          "Nouvelle version enregistrée ; l'ancienne reste dans l'historique.",
          "New version saved; the previous one stays in the history.",
        ),
        messageSpecifique: (err) => messageDd(err, langue),
        apres: () => maj({ motif: "" }),
      },
    );
  }

  async function retirer(): Promise<boolean> {
    return f.envoyer(
      validerRetrait(s.motif, true, langue),
      (charge) =>
        api.post<{ version: number }>(cheminVersionsPoint(point.id), {
          ...charge,
          version_courante: point.version,
        }),
      {
        succes: t(
          "Point retiré ; l'assertion est abandonnée.",
          "Item removed; the statement is abandoned.",
        ),
        messageSpecifique: (err) => messageDd(err, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={corriger}
      aria-label={t("Corriger le point", "Edit the item")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Correction refusée", "Correction refused")}
      />
      <ZoneTexte
        libelle={t("Affirmation", "Statement")}
        required
        rows={3}
        maxLength={ENONCE_MAX}
        value={s.enonce}
        onChange={(e) => maj({ enonce: e.target.value })}
        erreur={f.erreurs.enonce}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Titre court", "Short title")}
          maxLength={TITRE_MAX}
          value={s.libelle}
          onChange={(e) => maj({ libelle: e.target.value })}
          erreur={f.erreurs.libelle}
        />
        <Select
          libelle={t("Importance", "Importance")}
          invite={t("Non précisée", "Not specified")}
          options={optionsImportance}
          value={s.niveau}
          onChange={(e) => maj({ niveau: e.target.value })}
          erreur={f.erreurs.niveau}
        />
      </div>
      <ZoneTexte
        libelle={t("Motif", "Reason")}
        required
        rows={2}
        maxLength={MOTIF_MAX}
        value={s.motif}
        onChange={(e) => maj({ motif: e.target.value })}
        erreur={f.erreurs.motif}
        aide={t(
          "Conservé dans l'historique. Obligatoire pour corriger comme pour retirer le point.",
          "Kept in the history. Required to edit as well as to remove the item.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la correction", "Save the correction")}
        </Bouton>
        {validerRetrait(s.motif, true, langue).ok ? (
          <BoutonConfirmation
            libelle={t("Retirer ce point", "Remove this item")}
            question={t(
              "Retirer ce point ? Son assertion sera abandonnée ; le motif est conservé dans l'historique.",
              "Remove this item? Its statement will be abandoned; the reason is kept in the history.",
            )}
            libelleConfirmation={t("Oui, retirer", "Yes, remove")}
            texteChargement={t("Retrait…", "Removing…")}
            variante="danger"
            action={retirer}
          />
        ) : (
          <Bouton variante="danger" onClick={() => void retirer()} disabled={f.enCours}>
            {t("Retirer ce point", "Remove this item")}
          </Bouton>
        )}
      </div>
    </form>
  );
}
