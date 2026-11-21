"use client";

import { useState } from "react";
import type { DdPortailNotePubliable } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminPublicationsNote,
  libelleRapport,
  publicationPossible,
  validerPublication,
} from "../../lib/due-diligence-portail";
import { formaterDate } from "../../lib/format";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { EtatVide } from "../ui/EtatListe";
import { PartageInvestisseurRetour } from "./PartageInvestisseurRetour";
import { usePartageInvestisseur } from "./usePartageInvestisseur";
import "./due-diligence-lecture.css";

function NotePubliable({
  note,
  optionActive,
}: {
  note: DdPortailNotePubliable;
  optionActive: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  const p = usePartageInvestisseur();
  const [choisis, setChoisis] = useState<string[]>([]);
  const [erreurChoix, setErreurChoix] = useState<string | null>(null);
  const etat = publicationPossible(note, optionActive, langue);

  function basculer(id: string) {
    setErreurChoix(null);
    setChoisis((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  async function publier() {
    const v = validerPublication(note.version, choisis, note.rapports, langue);
    if (!v.ok) {
      setErreurChoix(
        v.erreurs.rapports ?? t("Choix de rapports invalide.", "Invalid report selection."),
      );
      return;
    }
    await p.executer(
      () => api.post(cheminPublicationsNote(note.note_id), v.charge),
      t(
        "Note publiée : les investisseurs invités peuvent la consulter.",
        "Memo published: invited investors can view it.",
      ),
    );
  }

  return (
    <li className="mp-dd-element">
      <h4 className="mp-dd-element__titre">{note.titre}</h4>
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          `Version ${note.version} · validée le ${formaterDate(note.valide_le)}`,
          `Version ${note.version} · approved on ${formaterDate(note.valide_le, "UTC", langue)}`,
        )}
      </p>
      <PartageInvestisseurRetour erreur={p.erreur ?? erreurChoix} succes={p.succes} />
      {!etat.possible ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{etat.raison}</p>
        </Alerte>
      ) : (
        <>
          <fieldset className="mp-dd-groupe">
            <legend>{t("Rapports à joindre (facultatif)", "Reports to attach (optional)")}</legend>
            {note.rapports.length === 0 ? (
              <p className="mp-texte-doux">
                {t(
                  "Aucun rapport n'a été généré pour cette version : seule la note (recommandation, synthèse et conditions) sera publiée.",
                  "No report has been generated for this version: only the memo (recommendation, summary and conditions) will be published.",
                )}
              </p>
            ) : (
              note.rapports.map((r) => (
                <CaseACocher
                  key={r.id}
                  libelle={t(
                    `${libelleRapport(r)} · généré le ${formaterDate(r.genere_le)}`,
                    `${libelleRapport(r, langue)} · generated on ${formaterDate(r.genere_le, "UTC", langue)}`,
                  )}
                  checked={choisis.includes(r.id)}
                  onChange={() => basculer(r.id)}
                />
              ))
            )}
          </fieldset>
          <Bouton
            chargement={p.enCours}
            texteChargement={t("Publication…", "Publishing…")}
            aria-label={t(`Publier ${note.titre}`, `Publish ${note.titre}`)}
            onClick={() => void publier()}
          >
            {t("Publier", "Publish")}
          </Bouton>
        </>
      )}
    </li>
  );
}

export interface PartageInvestisseurNotesProps {
  notes: DdPortailNotePubliable[];
  optionActive: boolean;
}

/** Notes dont la dernière version soumise est validée : choix des rapports puis publication. */
export function PartageInvestisseurNotes({ notes, optionActive }: PartageInvestisseurNotesProps) {
  const t = useT();
  if (notes.length === 0) {
    return (
      <EtatVide icone="envoyer" titre={t("Aucune note publiable", "No publishable memo")}>
        <p>
          {t(
            "Une note le devient quand sa dernière version soumise est validée par un tiers.",
            "A memo becomes publishable when its latest submitted version is approved by a third party.",
          )}
        </p>
      </EtatVide>
    );
  }
  return (
    <ul className="mp-dd-liste" aria-label={t("Notes publiables", "Publishable memos")}>
      {notes.map((n) => (
        <NotePubliable key={n.note_id} note={n} optionActive={optionActive} />
      ))}
    </ul>
  );
}
