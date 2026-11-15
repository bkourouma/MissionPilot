"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useT, useLangue } from "../../../components/i18n/FournisseurLangue";
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

const SOURCES: { valeur: SourceModele; libelle: string; aide: string; en: [string, string] }[] = [
  {
    valeur: "gabarit",
    libelle: "Copier un gabarit CabinetPilot",
    aide: "Questionnaire générique complet, à adapter.",
    en: ["Copy a CabinetPilot template", "Complete generic questionnaire, to adapt."],
  },
  {
    valeur: "copie",
    libelle: "Copier un modèle du cabinet",
    aide: "Reprend la dernière version du modèle choisi, sous un nouveau code.",
    en: [
      "Copy a firm template",
      "Takes the latest version of the chosen template, under a new code.",
    ],
  },
  {
    valeur: "vierge",
    libelle: "Partir d'un modèle vierge",
    aide: "Une section et une question à rédiger.",
    en: ["Start from a blank template", "One section and one question to write."],
  },
];

/**
 * Création d'un modèle de questionnaire : la version 1 naît en brouillon et s'ouvre dans
 * l'éditeur. Le code (identifiant stable) est proposé à partir du titre ou de la source.
 */
export function FormulaireModele({ gabarits, modeles, saisieInitiale }: FormulaireModeleProps) {
  const t = useT();
  const langue = useLangue();
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
      validerModele(s, langue),
      (charge) => api.post<ModeleDetail>("/api/questionnaires/modeles", charge),
      {
        rafraichir: false,
        messageSpecifique: (e) => messageQuestionnaire(e, langue),
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
        titreErreur={t("Création impossible", "Creation impossible")}
      />
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">{t("Point de départ", "Starting point")}</legend>
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
                {t(o.libelle, o.en[0])}
                <span id={`source-${o.valeur}-aide`} className="mp-case__aide">
                  {o.valeur === "copie" && modeles.length === 0
                    ? t(
                        "Aucun modèle du cabinet à copier pour l'instant.",
                        "No firm template to copy for now.",
                      )
                    : t(o.aide, o.en[1])}
                </span>
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="mp-grille-champs">
        {s.source === "gabarit" ? (
          <Select
            libelle={t("Gabarit", "Template")}
            name="gabarit"
            required
            invite={t("Choisir un gabarit…", "Choose a template…")}
            options={gabarits.map((g) => ({
              valeur: g.code,
              libelle: t(
                `${g.titre} (${g.questions} questions)`,
                `${g.titre} (${g.questions} questions)`,
              ),
            }))}
            value={s.gabarit}
            erreur={f.erreurs.gabarit}
            onChange={(e) => maj({ gabarit: e.target.value })}
          />
        ) : null}
        {s.source === "copie" ? (
          <Select
            libelle={t("Modèle à copier", "Template to copy")}
            name="modele_id"
            required
            invite={t("Choisir un modèle…", "Choose a template…")}
            options={modeles.map((m) => ({ valeur: m.id, libelle: `${m.titre} (${m.code})` }))}
            value={s.modele_id}
            erreur={f.erreurs.modele_id}
            onChange={(e) => maj({ modele_id: e.target.value })}
          />
        ) : null}
        <Champ
          libelle={t("Titre", "Title")}
          name="titre"
          required={s.source === "vierge"}
          maxLength={200}
          value={s.titre}
          erreur={f.erreurs.titre}
          aide={
            s.source === "vierge"
              ? t(
                  "Vu par les répondants, ex. « Diagnostic express des achats ».",
                  'Seen by respondents, e.g. "Quick procurement diagnostic".',
                )
              : t(
                  "Facultatif : laissé vide, le titre de la source est repris.",
                  "Optional: if left empty, the title of the source is reused.",
                )
          }
          onChange={(e) => maj({ titre: e.target.value })}
        />
        <Champ
          libelle={t("Code du modèle", "Template code")}
          name="code"
          required
          maxLength={80}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={s.code}
          erreur={f.erreurs.code}
          aide={t(
            "Identifiant stable, unique dans le cabinet : minuscules sans accent, chiffres, « _ », « . » ou « - ».",
            'Stable identifier, unique within the firm: lowercase letters without accents, digits, "_", "." or "-".',
          )}
          onChange={(e) => {
            setCodeSaisi(e.target.value !== "");
            setS((x) => ({ ...x, code: e.target.value }));
          }}
        />
      </div>
      <p className="mp-indice mp-texte-doux mp-texte-petit">
        <Icone nom="info" taille={16} />
        <span>
          {t(
            "La version 1 est créée en brouillon et s'ouvre dans l'éditeur : vous la relisez, puis la validez pour pouvoir l'envoyer.",
            "Version 1 is created as a draft and opens in the editor: you review it, then approve it to be able to send it.",
          )}
        </span>
      </p>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="plus"
          chargement={f.enCours}
          texteChargement={t("Création…", "Creating…")}
        >
          {t("Créer le modèle", "Create the template")}
        </Bouton>
        <Link href="/questionnaires" className={classesBouton("secondaire")}>
          {t("Annuler", "Cancel")}
        </Link>
      </div>
    </form>
  );
}
