"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { Champ } from "../../../../../components/ui/Champ";
import type { MembreEquipe } from "../../../../../lib/catalogue";
import { formaterMontantMineur, formaterNombre, type Devise } from "../../../../../lib/format";
import { validerEquipe, validerTaux } from "../../../../../lib/propositions";
import { aideMontant, montantVersSaisie } from "../../../../../lib/saisie";
import { api } from "../../../../../lib/api";

interface GradeCourt {
  code: string;
  libelle: string;
}

export interface EquipeEtTauxProps {
  propositionId: string;
  devise: Devise;
  modifiable: boolean;
  grades: GradeCourt[];
  equipe: MembreEquipe[];
  /** Taux par grade ; `null` : l'utilisateur n'a pas « finance.lire » (section masquée). */
  taux: Record<string, number | null> | null;
}

/** Équipe proposée et, pour les associés et gestionnaires, taux de vente par grade. */
export function EquipeEtTaux({
  propositionId,
  devise,
  modifiable,
  grades,
  equipe,
  taux,
}: EquipeEtTauxProps) {
  const chemin = `/api/propositions/${encodeURIComponent(propositionId)}`;
  const libelle = (code: string) => grades.find((g) => g.code === code)?.libelle ?? code;
  return (
    <div className="mp-grille-cartes">
      <Carte titre="Équipe proposée">
        {modifiable ? (
          <FormulaireEquipe chemin={chemin} grades={grades} equipe={equipe} />
        ) : equipe.length === 0 ? (
          <p className="mp-texte-doux">Aucune équipe renseignée.</p>
        ) : (
          <ul className="mp-liste-simple">
            {equipe.map((m) => (
              <li
                key={m.grade_code}
              >{`${formaterNombre(m.nombre, 0)} × ${libelle(m.grade_code)}`}</li>
            ))}
          </ul>
        )}
      </Carte>
      {taux ? (
        <Carte
          titre="Taux journaliers de vente"
          actions={<span className="mp-mention-confidentielle">Confidentiel</span>}
        >
          {modifiable ? (
            <FormulaireTaux chemin={chemin} grades={grades} taux={taux} devise={devise} />
          ) : (
            <ul className="mp-liste-simple">
              {Object.entries(taux).map(([code, t]) => (
                <li key={code}>
                  {`${libelle(code)} : ${t === null ? "à renseigner" : formaterMontantMineur(t, devise)}`}
                </li>
              ))}
            </ul>
          )}
        </Carte>
      ) : null}
    </div>
  );
}

function FormulaireEquipe({
  chemin,
  grades,
  equipe,
}: {
  chemin: string;
  grades: GradeCourt[];
  equipe: MembreEquipe[];
}) {
  const [s, setS] = useState<Record<string, string>>(() =>
    Object.fromEntries(equipe.map((m) => [m.grade_code, String(m.nombre)])),
  );
  const f = useFormulaire<string>();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerEquipe(s), (c) => api.patch(chemin, c), {
      succes: "Équipe enregistrée.",
    });
  }
  if (grades.length === 0)
    return <p className="mp-texte-doux">Aucun grade défini dans le cabinet.</p>;
  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-champ__aide">
        Nombre de personnes par grade ; laisser vide si le grade n&apos;intervient pas.
      </p>
      <div className="mp-grille-champs mp-grille-champs--serree">
        {grades.map((g) => (
          <Champ
            key={g.code}
            libelle={g.libelle}
            name={`equipe-${g.code}`}
            inputMode="numeric"
            autoComplete="off"
            value={s[g.code] ?? ""}
            onChange={(e) => setS((x) => ({ ...x, [g.code]: e.target.value }))}
            erreur={f.erreurs[g.code]}
          />
        ))}
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Enregistrer l&apos;équipe
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireTaux({
  chemin,
  grades,
  taux,
  devise,
}: {
  chemin: string;
  grades: GradeCourt[];
  taux: Record<string, number | null>;
  devise: Devise;
}) {
  // Grades de la grille de la proposition d'abord, puis les autres grades du cabinet.
  const codes = [...new Set([...Object.keys(taux), ...grades.map((g) => g.code)])];
  const [s, setS] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(taux).map(([c, t]) => [c, montantVersSaisie(t, devise)])),
  );
  const f = useFormulaire<string>();
  const libelle = (code: string) => grades.find((g) => g.code === code)?.libelle ?? code;
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    // Seuls les grades saisis ou déjà présents sont envoyés (vide = taux retiré).
    const saisis = Object.fromEntries(codes.filter((c) => c in s).map((c) => [c, s[c] ?? ""]));
    await f.envoyer(validerTaux(saisis, devise), (c) => api.put(`${chemin}/taux`, c), {
      succes: "Taux enregistrés.",
    });
  }
  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale ?? f.erreurs._ ?? null}
        succes={f.succes}
        refAlerte={f.refAlerte}
      />
      <p className="mp-champ__aide">{`En ${devise}, par jour. ${aideMontant(devise)}`}</p>
      <div className="mp-grille-champs mp-grille-champs--serree">
        {codes.map((code) => (
          <Champ
            key={code}
            libelle={libelle(code)}
            name={`taux-${code}`}
            inputMode="decimal"
            autoComplete="off"
            value={s[code] ?? ""}
            onChange={(e) => setS((x) => ({ ...x, [code]: e.target.value }))}
            erreur={f.erreurs[code]}
          />
        ))}
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Enregistrer les taux
        </Bouton>
      </div>
    </form>
  );
}
