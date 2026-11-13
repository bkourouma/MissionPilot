"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RECOMMANDATIONS_NOTE } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminNotes,
  cheminSoumissionNote,
  cheminVersionsNote,
  hrefNote,
  libellesDd,
  messageDd,
  optionsDe,
  type ReponseEcriture,
} from "../../lib/due-diligence";
import {
  CONDITIONS_MAX,
  MOTIF_MAX,
  NOTE_SYNTHESE_MAX,
  saisieNoteVide,
  TITRE_MAX,
  validerNote,
  type ChampNote,
  type SaisieNote,
} from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface EditeurNoteProps {
  missionId: string;
  dossierId: string;
  /** Présent : nouvelle version (brouillon) de cette note ; absent : création d'une note. */
  note?: {
    id: string;
    versionCourante: number;
    recommandation: string;
    synthese: string;
    conditions: string[];
  };
}

/**
 * Note au comité (DD-13) : recommandation, synthèse et conditions. La note n'est jamais soumise
 * par ce formulaire : le brouillon est enregistré, contrôlé par le moteur, puis soumis à la
 * validation d'un tiers. Les chiffres du rapport viennent des moteurs, pas de ce texte.
 */
export function EditeurNote({ missionId, dossierId, note }: EditeurNoteProps) {
  const t = useT();
  const langue = useLangue();
  const optionsRecommandation = optionsDe(RECOMMANDATIONS_NOTE, libellesDd(langue).RECOMMANDATION);
  const router = useRouter();
  const f = useFormulaire<ChampNote>();
  const version = note !== undefined;
  const [s, setS] = useState<SaisieNote>(
    note
      ? {
          titre: "",
          recommandation: note.recommandation,
          synthese: note.synthese,
          conditions: note.conditions.join("\n"),
          motif: "",
        }
      : saisieNoteVide(),
  );
  const maj = (p: Partial<SaisieNote>) => setS((x) => ({ ...x, ...p }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerNote(s, version ? "version" : "creation", langue),
      (charge) =>
        note
          ? api.post<ReponseEcriture>(cheminVersionsNote(note.id), {
              recommandation: charge.recommandation,
              synthese: charge.synthese,
              conditions: charge.conditions,
              motif: charge.motif,
              version_courante: note.versionCourante,
            })
          : api.post<ReponseEcriture>(cheminNotes(dossierId), charge),
      {
        succes: version
          ? t("Nouveau brouillon enregistré.", "New draft saved.")
          : t("Note créée en brouillon.", "Memo created as a draft."),
        messageSpecifique: (err) => messageDd(err, langue),
        apres: (r) => {
          if (!note && r.id) router.push(hrefNote(missionId, dossierId, r.id));
          else maj({ motif: "" });
        },
        rafraichir: version,
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
        version
          ? t("Nouvelle version de la note", "New version of the memo")
          : t("Nouvelle note au comité", "New committee memo")
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Note refusée", "Memo refused")}
      />
      {!version ? (
        <Champ
          libelle={t("Titre de la note", "Memo title")}
          required
          maxLength={TITRE_MAX}
          value={s.titre}
          onChange={(e) => maj({ titre: e.target.value })}
          erreur={f.erreurs.titre}
        />
      ) : null}
      <Select
        libelle={t("Recommandation", "Recommendation")}
        required
        invite={t("Choisir…", "Choose…")}
        options={optionsRecommandation}
        value={s.recommandation}
        onChange={(e) => maj({ recommandation: e.target.value })}
        erreur={f.erreurs.recommandation}
        aide={t(
          "« Favorable » est refusée à la soumission si une exclusion n'est pas levée ou si une hypothèse principale est infirmée.",
          "“Favorable” is refused at submission if an exclusion is not cleared or if a main hypothesis is refuted.",
        )}
      />
      <ZoneTexte
        libelle={t("Synthèse", "Summary")}
        required
        rows={6}
        maxLength={NOTE_SYNTHESE_MAX}
        value={s.synthese}
        onChange={(e) => maj({ synthese: e.target.value })}
        erreur={f.erreurs.synthese}
        aide={t(
          "Le raisonnement de l'expert, en toutes lettres. Ne recopiez pas les chiffres : le rapport les reprend des moteurs.",
          "The expert's reasoning, written out in full. Do not copy the figures: the report takes them from the engines.",
        )}
      />
      <ZoneTexte
        libelle={t("Conditions", "Conditions")}
        rows={4}
        value={s.conditions}
        onChange={(e) => maj({ conditions: e.target.value })}
        erreur={f.erreurs.conditions}
        aide={t(
          `Une condition par ligne (${CONDITIONS_MAX} au plus). Obligatoire pour une recommandation « favorable sous conditions ».`,
          `One condition per line (${CONDITIONS_MAX} at most). Required for a “favorable with conditions” recommendation.`,
        )}
      />
      {version ? (
        <ZoneTexte
          libelle={t("Motif de la modification", "Reason for the change")}
          required
          rows={2}
          maxLength={MOTIF_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide={t("Conservé dans l'historique des versions.", "Kept in the version history.")}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {version
            ? t("Enregistrer un nouveau brouillon", "Save a new draft")
            : t("Créer la note", "Create the memo")}
        </Bouton>
        {version ? null : (
          <Bouton variante="secondaire" onClick={() => router.back()}>
            {t("Annuler", "Cancel")}
          </Bouton>
        )}
      </div>
    </form>
  );
}

export interface SoumettreNoteProps {
  noteId: string;
  /** Version « brouillon » à soumettre. */
  version: number;
  /** Le moteur de contrôle signale un bloquant : le bouton est désactivé et expliqué. */
  bloque: boolean;
}

/** Soumission d'un brouillon à la validation d'un tiers : l'API fige la base calculée par les moteurs. */
export function SoumettreNote({ noteId, version, bloque }: SoumettreNoteProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"version">();
  const [confirme, setConfirme] = useState(false);

  async function soumettre() {
    await f.envoyer(
      { ok: true, charge: { version } },
      (charge) => api.post(cheminSoumissionNote(noteId), charge),
      {
        succes: t(
          "Note soumise : elle attend la validation d'une autre personne.",
          "Memo submitted: it is awaiting approval by another person.",
        ),
        messageSpecifique: (err) => messageDd(err, langue),
        apres: () => setConfirme(false),
      },
    );
  }

  return (
    <div className="mp-dd-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Soumission refusée", "Submission refused")}
      />
      {bloque ? (
        <Alerte
          tonalite="danger"
          titre={t("Soumission impossible pour le moment", "Submission not possible for now")}
          annonce="aucune"
        >
          <p>
            {t(
              "Corrigez les points bloquants listés dans le contrôle, puis soumettez la note.",
              "Fix the blocking issues listed in the check, then submit the memo.",
            )}
          </p>
        </Alerte>
      ) : null}
      {confirme ? (
        <Alerte
          tonalite="attention"
          titre={t("Soumettre cette version ?", "Submit this version?")}
          annonce="status"
        >
          <p>
            {t(
              "La base des chiffres est figée à cet instant. Une modification ultérieure du dossier ne change plus cette version : il faudra une nouvelle version et une nouvelle validation.",
              "The figures base is frozen at this moment. A later change to the file no longer affects this version: a new version and a new approval will be needed.",
            )}
          </p>
        </Alerte>
      ) : null}
      <div className="mp-barre-actions">
        {confirme ? (
          <>
            <Bouton
              chargement={f.enCours}
              texteChargement={t("Soumission…", "Submitting…")}
              onClick={() => void soumettre()}
            >
              {t("Confirmer la soumission", "Confirm submission")}
            </Bouton>
            <Bouton variante="discret" onClick={() => setConfirme(false)}>
              {t("Annuler", "Cancel")}
            </Bouton>
          </>
        ) : (
          <Bouton disabled={bloque} onClick={() => setConfirme(true)} aria-disabled={bloque}>
            {t("Soumettre pour validation", "Submit for approval")}
          </Bouton>
        )}
      </div>
    </div>
  );
}
