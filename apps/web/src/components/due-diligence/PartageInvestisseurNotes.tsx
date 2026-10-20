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
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { PartageInvestisseurRetour } from "./PartageInvestisseurRetour";
import { usePartageInvestisseur } from "./usePartageInvestisseur";

function NotePubliable({
  note,
  optionActive,
}: {
  note: DdPortailNotePubliable;
  optionActive: boolean;
}) {
  const p = usePartageInvestisseur();
  const [choisis, setChoisis] = useState<string[]>([]);
  const [erreurChoix, setErreurChoix] = useState<string | null>(null);
  const etat = publicationPossible(note, optionActive);

  function basculer(id: string) {
    setErreurChoix(null);
    setChoisis((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  async function publier() {
    const v = validerPublication(note.version, choisis, note.rapports);
    if (!v.ok) {
      setErreurChoix(v.erreurs.rapports ?? "Choix de rapports invalide.");
      return;
    }
    await p.executer(
      () => api.post(cheminPublicationsNote(note.note_id), v.charge),
      "Note publiée : les investisseurs invités peuvent la consulter.",
    );
  }

  return (
    <li className="mp-dd-element">
      <h4 className="mp-dd-element__titre">{note.titre}</h4>
      <p className="mp-texte-doux mp-texte-petit">
        {`Version ${note.version} · validée le ${formaterDate(note.valide_le)}`}
      </p>
      <PartageInvestisseurRetour erreur={p.erreur ?? erreurChoix} succes={p.succes} />
      {!etat.possible ? (
        <p className="mp-texte-doux">{etat.raison}</p>
      ) : (
        <>
          <fieldset className="mp-dd-pile" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Rapports à joindre (facultatif)</legend>
            {note.rapports.length === 0 ? (
              <p className="mp-texte-doux">
                Aucun rapport n&apos;a été généré pour cette version : seule la note
                (recommandation, synthèse et conditions) sera publiée.
              </p>
            ) : (
              note.rapports.map((r) => (
                <CaseACocher
                  key={r.id}
                  libelle={`${libelleRapport(r)} · généré le ${formaterDate(r.genere_le)}`}
                  checked={choisis.includes(r.id)}
                  onChange={() => basculer(r.id)}
                />
              ))
            )}
          </fieldset>
          <Bouton
            chargement={p.enCours}
            texteChargement="Publication…"
            aria-label={`Publier ${note.titre}`}
            onClick={() => void publier()}
          >
            Publier
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
  if (notes.length === 0) {
    return (
      <p className="mp-texte-doux">
        Aucune note validée n&apos;est publiable. Une note le devient quand sa dernière version
        soumise est validée par un tiers.
      </p>
    );
  }
  return (
    <ul className="mp-dd-liste" aria-label="Notes publiables">
      {notes.map((n) => (
        <NotePubliable key={n.note_id} note={n} optionActive={optionActive} />
      ))}
    </ul>
  );
}
