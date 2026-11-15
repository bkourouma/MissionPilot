"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminEtapes,
  cheminVersionsEtape,
  messageDd,
  type ReponseEcriture,
} from "../../lib/due-diligence";
import {
  bpVersSaisie,
  MOTIF_MAX,
  saisieEtapeVide,
  TEXTE_LONG_MAX,
  TITRE_MAX,
  validerEtape,
  validerRetrait,
  type ChampEtape,
  type SaisieEtape,
} from "../../lib/due-diligence-saisie";
import { joindreListe } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FormulaireEtapeProps {
  dossierId: string;
  /** Rang proposé pour une nouvelle étape. */
  ordreSuivant?: number;
  /** Présent : correction de cette étape (nouvelle version, motif exigé). */
  etape?: {
    id: string;
    version: number;
    libelle: string;
    description: string | null;
    ordre: number;
    part_cout_bp: number | null;
    part_marge_bp: number | null;
    acteurs: string[];
    contraintes: string | null;
  };
}

/** Étape de la chaîne de valeur : rang, acteurs, parts de coût et de marge (en %), contraintes. */
export function FormulaireEtape({ dossierId, ordreSuivant = 1, etape }: FormulaireEtapeProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampEtape>();
  const correction = etape !== undefined;
  const [s, setS] = useState<SaisieEtape>(
    etape
      ? {
          libelle: etape.libelle,
          description: etape.description ?? "",
          ordre: String(etape.ordre),
          part_cout: bpVersSaisie(etape.part_cout_bp),
          part_marge: bpVersSaisie(etape.part_marge_bp),
          acteurs: joindreListe(etape.acteurs),
          contraintes: etape.contraintes ?? "",
          motif: "",
        }
      : saisieEtapeVide(ordreSuivant),
  );
  const maj = (p: Partial<SaisieEtape>) => setS((x) => ({ ...x, ...p }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerEtape(s, correction, langue),
      (charge) =>
        etape
          ? api.post<ReponseEcriture>(cheminVersionsEtape(etape.id), {
              ...charge,
              version_courante: etape.version,
            })
          : api.post<ReponseEcriture>(cheminEtapes(dossierId), charge),
      {
        succes: correction
          ? t("Nouvelle version enregistrée.", "New version saved.")
          : t("Étape ajoutée.", "Step added."),
        messageSpecifique: (err) => messageDd(err, langue),
        apres: () =>
          correction ? maj({ motif: "" }) : setS(saisieEtapeVide(Number(s.ordre) + 1 || 1)),
      },
    );
  }

  async function retirer() {
    if (!etape) return;
    await f.envoyer(
      validerRetrait(s.motif, true, langue),
      (charge) =>
        api.post<ReponseEcriture>(cheminVersionsEtape(etape.id), {
          ...charge,
          version_courante: etape.version,
        }),
      {
        succes: t("Étape retirée de la chaîne.", "Step removed from the chain."),
        messageSpecifique: (err) => messageDd(err, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={
        correction
          ? t(`Corriger l'étape ${etape.libelle}`, `Edit the step ${etape.libelle}`)
          : t("Nouvelle étape", "New step")
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Étape refusée", "Step refused")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Nom de l'étape", "Step name")}
          required
          maxLength={TITRE_MAX}
          value={s.libelle}
          onChange={(e) => maj({ libelle: e.target.value })}
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle={t("Rang dans la chaîne", "Rank in the chain")}
          required
          inputMode="numeric"
          value={s.ordre}
          onChange={(e) => maj({ ordre: e.target.value })}
          erreur={f.erreurs.ordre}
          aide={t("1 pour la première étape.", "1 for the first step.")}
        />
      </div>
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Part du coût total (%)", "Share of total cost (%)")}
          inputMode="decimal"
          value={s.part_cout}
          onChange={(e) => maj({ part_cout: e.target.value })}
          erreur={f.erreurs.part_cout}
          aide={t(
            "Facultative. Le total des étapes doit tendre vers 100 %.",
            "Optional. The total across steps should approach 100%.",
          )}
        />
        <Champ
          libelle={t("Part de la marge (%)", "Share of margin (%)")}
          inputMode="decimal"
          value={s.part_marge}
          onChange={(e) => maj({ part_marge: e.target.value })}
          erreur={f.erreurs.part_marge}
          aide={t("Facultative.", "Optional.")}
        />
      </div>
      <Champ
        libelle={t("Acteurs", "Actors")}
        value={s.acteurs}
        onChange={(e) => maj({ acteurs: e.target.value })}
        erreur={f.erreurs.acteurs}
        aide={t("Séparés par des virgules (12 au plus).", "Separated by commas (12 at most).")}
      />
      <ZoneTexte
        libelle={t("Description", "Description")}
        rows={2}
        maxLength={TEXTE_LONG_MAX}
        value={s.description}
        onChange={(e) => maj({ description: e.target.value })}
        erreur={f.erreurs.description}
      />
      <ZoneTexte
        libelle={t("Contraintes", "Constraints")}
        rows={2}
        value={s.contraintes}
        onChange={(e) => maj({ contraintes: e.target.value })}
        erreur={f.erreurs.contraintes}
      />
      {correction ? (
        <ZoneTexte
          libelle={t("Motif", "Reason")}
          required
          rows={2}
          maxLength={MOTIF_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide={t(
            "Conservé dans l'historique. Obligatoire pour corriger comme pour retirer l'étape.",
            "Kept in the history. Required to edit as well as to remove the step.",
          )}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {correction
            ? t("Enregistrer la correction", "Save the correction")
            : t("Ajouter l'étape", "Add the step")}
        </Bouton>
        {correction ? (
          <Bouton variante="danger" onClick={() => void retirer()} disabled={f.enCours}>
            {t("Retirer cette étape", "Remove this step")}
          </Bouton>
        ) : null}
      </div>
    </form>
  );
}
