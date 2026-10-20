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
  messageDd,
  optionsDe,
  RECOMMANDATION_NOTE_LIBELLES,
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
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const OPTIONS_RECOMMANDATION = optionsDe(RECOMMANDATIONS_NOTE, RECOMMANDATION_NOTE_LIBELLES);

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
      validerNote(s, version ? "version" : "creation"),
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
        succes: version ? "Nouveau brouillon enregistré." : "Note créée en brouillon.",
        messageSpecifique: messageDd,
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
      aria-label={version ? "Nouvelle version de la note" : "Nouvelle note au comité"}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Note refusée"
      />
      {!version ? (
        <Champ
          libelle="Titre de la note"
          required
          maxLength={TITRE_MAX}
          value={s.titre}
          onChange={(e) => maj({ titre: e.target.value })}
          erreur={f.erreurs.titre}
        />
      ) : null}
      <Select
        libelle="Recommandation"
        required
        invite="Choisir…"
        options={OPTIONS_RECOMMANDATION}
        value={s.recommandation}
        onChange={(e) => maj({ recommandation: e.target.value })}
        erreur={f.erreurs.recommandation}
        aide="« Favorable » est refusée à la soumission si une exclusion n'est pas levée ou si une hypothèse principale est infirmée."
      />
      <ZoneTexte
        libelle="Synthèse"
        required
        rows={6}
        maxLength={NOTE_SYNTHESE_MAX}
        value={s.synthese}
        onChange={(e) => maj({ synthese: e.target.value })}
        erreur={f.erreurs.synthese}
        aide="Le raisonnement de l'expert, en toutes lettres. Ne recopiez pas les chiffres : le rapport les reprend des moteurs."
      />
      <ZoneTexte
        libelle="Conditions"
        rows={4}
        value={s.conditions}
        onChange={(e) => maj({ conditions: e.target.value })}
        erreur={f.erreurs.conditions}
        aide={`Une condition par ligne (${CONDITIONS_MAX} au plus). Obligatoire pour une recommandation « favorable sous conditions ».`}
      />
      {version ? (
        <ZoneTexte
          libelle="Motif de la modification"
          required
          rows={2}
          maxLength={MOTIF_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide="Conservé dans l'historique des versions."
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {version ? "Enregistrer un nouveau brouillon" : "Créer la note"}
        </Bouton>
        {version ? null : (
          <Bouton variante="secondaire" onClick={() => router.back()}>
            Annuler
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
  const f = useFormulaire<"version">();
  const [confirme, setConfirme] = useState(false);

  async function soumettre() {
    await f.envoyer(
      { ok: true, charge: { version } },
      (charge) => api.post(cheminSoumissionNote(noteId), charge),
      {
        succes: "Note soumise : elle attend la validation d'une autre personne.",
        messageSpecifique: messageDd,
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
        titreErreur="Soumission refusée"
      />
      {bloque ? (
        <Alerte tonalite="danger" titre="Soumission impossible pour le moment" annonce="aucune">
          <p>Corrigez les points bloquants listés dans le contrôle, puis soumettez la note.</p>
        </Alerte>
      ) : null}
      {confirme ? (
        <Alerte tonalite="attention" titre="Soumettre cette version ?" annonce="status">
          <p>
            La base des chiffres est figée à cet instant. Une modification ultérieure du dossier ne
            change plus cette version : il faudra une nouvelle version et une nouvelle validation.
          </p>
        </Alerte>
      ) : null}
      <div className="mp-barre-actions">
        {confirme ? (
          <>
            <Bouton
              chargement={f.enCours}
              texteChargement="Soumission…"
              onClick={() => void soumettre()}
            >
              Confirmer la soumission
            </Bouton>
            <Bouton variante="discret" onClick={() => setConfirme(false)}>
              Annuler
            </Bouton>
          </>
        ) : (
          <Bouton disabled={bloque} onClick={() => setConfirme(true)} aria-disabled={bloque}>
            Soumettre pour validation
          </Bouton>
        )}
      </div>
    </div>
  );
}
