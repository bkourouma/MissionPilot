"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { Bouton, classesBouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { Icone } from "../../../components/ui/Icone";
import { Select } from "../../../components/ui/Select";
import { api } from "../../../lib/api";
import {
  messageQuestionnaire,
  validerModele,
  type ChampModele,
  type GabaritResume,
  type ModeleDetail,
  type SaisieModele,
  type SourceModele,
} from "../../../lib/questionnaires";
import { suggererIdentifiant } from "../../../lib/questionnaires-definition";

export interface FormulaireModeleProps {
  gabarits: readonly GabaritResume[];
  /** Modèles du cabinet copiables (identifiant, titre, code). */
  modeles: readonly { id: string; titre: string; code: string }[];
  saisieInitiale: SaisieModele;
}

const SOURCES: { valeur: SourceModele; libelle: string; aide: string }[] = [
  {
    valeur: "gabarit",
    libelle: "Copier un gabarit MissionPilot",
    aide: "Questionnaire générique complet, à adapter.",
  },
  {
    valeur: "copie",
    libelle: "Copier un modèle du cabinet",
    aide: "Reprend la dernière version du modèle choisi, sous un nouveau code.",
  },
  {
    valeur: "vierge",
    libelle: "Partir d'un modèle vierge",
    aide: "Une section et une question à rédiger.",
  },
];

/**
 * Création d'un modèle de questionnaire : la version 1 naît en brouillon et s'ouvre dans
 * l'éditeur. Le code (identifiant stable) est proposé à partir du titre ou de la source.
 */
export function FormulaireModele({ gabarits, modeles, saisieInitiale }: FormulaireModeleProps) {
  const router = useRouter();
  const [codeSaisi, setCodeSaisi] = useState(saisieInitiale.code !== "");
  const f = useFormulaire<ChampModele>();

  /** Code proposé tant que l'utilisateur ne l'a pas saisi lui-même. */
  function proposer(suivant: SaisieModele, saisi = codeSaisi): SaisieModele {
    if (saisi) return suivant;
    const source =
      suivant.titre.trim() !== ""
        ? suivant.titre
        : suivant.source === "gabarit"
          ? suivant.gabarit
          : suivant.source === "copie"
            ? `${modeles.find((m) => m.id === suivant.modele_id)?.code ?? ""}_copie`.slice(0, 80)
            : "";
    return { ...suivant, code: suggererIdentifiant(source) };
  }

  const [s, setS] = useState<SaisieModele>(() =>
    proposer(saisieInitiale, saisieInitiale.code !== ""),
  );
  const maj = (patch: Partial<SaisieModele>) => setS((x) => proposer({ ...x, ...patch }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerModele(s),
      (charge) => api.post<ModeleDetail>("/api/questionnaires/modeles", charge),
      {
        rafraichir: false,
        messageSpecifique: messageQuestionnaire,
        apres: (m) => {
          const v1 = m.versions[0];
          router.push(v1 ? `/questionnaires/versions/${v1.id}` : `/questionnaires/${m.id}`);
        },
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Création impossible"
      />
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Point de départ</legend>
        <div className="mp-groupe__options">
          {SOURCES.map((o) => (
            <div key={o.valeur} className="mp-case">
              <input
                type="radio"
                id={`source-${o.valeur}`}
                name="source"
                value={o.valeur}
                className="mp-case__controle"
                checked={s.source === o.valeur}
                disabled={
                  (o.valeur === "copie" && modeles.length === 0) ||
                  (o.valeur === "gabarit" && gabarits.length === 0)
                }
                onChange={() => maj({ source: o.valeur })}
                aria-describedby={`source-${o.valeur}-aide`}
              />
              <label htmlFor={`source-${o.valeur}`} className="mp-case__libelle">
                {o.libelle}
                <span id={`source-${o.valeur}-aide`} className="mp-case__aide">
                  {o.valeur === "copie" && modeles.length === 0
                    ? "Aucun modèle du cabinet à copier pour l'instant."
                    : o.aide}
                </span>
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="mp-grille-champs">
        {s.source === "gabarit" ? (
          <Select
            libelle="Gabarit"
            name="gabarit"
            required
            invite="Choisir un gabarit…"
            options={gabarits.map((g) => ({
              valeur: g.code,
              libelle: `${g.titre} (${g.questions} questions)`,
            }))}
            value={s.gabarit}
            erreur={f.erreurs.gabarit}
            onChange={(e) => maj({ gabarit: e.target.value })}
          />
        ) : null}
        {s.source === "copie" ? (
          <Select
            libelle="Modèle à copier"
            name="modele_id"
            required
            invite="Choisir un modèle…"
            options={modeles.map((m) => ({ valeur: m.id, libelle: `${m.titre} (${m.code})` }))}
            value={s.modele_id}
            erreur={f.erreurs.modele_id}
            onChange={(e) => maj({ modele_id: e.target.value })}
          />
        ) : null}
        <Champ
          libelle="Titre"
          name="titre"
          required={s.source === "vierge"}
          maxLength={200}
          value={s.titre}
          erreur={f.erreurs.titre}
          aide={
            s.source === "vierge"
              ? "Vu par les répondants, ex. « Diagnostic express des achats »."
              : "Facultatif : laissé vide, le titre de la source est repris."
          }
          onChange={(e) => maj({ titre: e.target.value })}
        />
        <Champ
          libelle="Code du modèle"
          name="code"
          required
          maxLength={80}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={s.code}
          erreur={f.erreurs.code}
          aide="Identifiant stable, unique dans le cabinet : minuscules sans accent, chiffres, « _ », « . » ou « - »."
          onChange={(e) => {
            setCodeSaisi(e.target.value !== "");
            setS((x) => ({ ...x, code: e.target.value }));
          }}
        />
      </div>
      <p className="mp-indice mp-texte-doux mp-texte-petit">
        <Icone nom="info" taille={16} />
        <span>
          La version 1 est créée en brouillon et s'ouvre dans l'éditeur : vous la relisez, puis la
          validez pour pouvoir l'envoyer.
        </span>
      </p>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="plus" chargement={f.enCours} texteChargement="Création…">
          Créer le modèle
        </Bouton>
        <Link href="/questionnaires" className={classesBouton("secondaire")}>
          Annuler
        </Link>
      </div>
    </form>
  );
}
