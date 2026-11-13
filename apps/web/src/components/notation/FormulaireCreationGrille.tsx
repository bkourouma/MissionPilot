"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  CHEMIN_GRILLES,
  codeDepuisTitre,
  hrefVersionGrille,
  messageGrille,
  validerCreationGrille,
  type GrilleDetail,
} from "../../lib/notation-grilles";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

export interface FormulaireCreationGrilleProps {
  /** Grilles du cabinet copiables (titre et code). */
  grilles: { id: string; titre: string; code: string }[];
}

/**
 * Création d'une grille du cabinet par copie de la grille générique (ou d'une grille du
 * cabinet) : la version 1 est un brouillon à affiner, puis à faire valider par un expert métier.
 */
export function FormulaireCreationGrille({ grilles }: FormulaireCreationGrilleProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const id = useId();
  const f = useFormulaire<"code" | "titre" | "grilleId">();
  const [titre, setTitre] = useState("");
  const [code, setCode] = useState("");
  const [codeModifie, setCodeModifie] = useState(false);
  const [source, setSource] = useState<"generique" | "copie">("generique");
  const [grilleId, setGrilleId] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerCreationGrille({ code, titre, source, grilleId }, langue),
      (charge) => api.post<GrilleDetail>(CHEMIN_GRILLES, charge),
      {
        rafraichir: false,
        succes: t(
          "Grille créée : ouverture de son brouillon.",
          "Framework created: opening its draft.",
        ),
        messageSpecifique: (err) => messageGrille(err, langue),
        apres: (g) => {
          const v = g.versions[0];
          router.push(v ? hrefVersionGrille(v.id) : "/notation");
        },
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Création impossible", "Creation failed")}
      />
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">{t("Point de départ", "Starting point")}</legend>
        <div className="mp-groupe__options">
          <div className="mp-case">
            <input
              type="radio"
              className="mp-case__controle"
              id={`${id}-generique`}
              name={`${id}-source`}
              checked={source === "generique"}
              onChange={() => setSource("generique")}
            />
            <label htmlFor={`${id}-generique`} className="mp-case__libelle">
              {t(
                "Copie de la grille générique CabinetPilot",
                "Copy of the CabinetPilot generic framework",
              )}
              <span className="mp-case__aide">
                {t(
                  "10 dimensions en deux familles et 5 secteurs, à affiner par vos experts.",
                  "10 dimensions in two families and 5 sectors, to be refined by your experts.",
                )}
              </span>
            </label>
          </div>
          <div className="mp-case">
            <input
              type="radio"
              className="mp-case__controle"
              id={`${id}-copie`}
              name={`${id}-source`}
              checked={source === "copie"}
              onChange={() => setSource("copie")}
              disabled={grilles.length === 0}
            />
            <label htmlFor={`${id}-copie`} className="mp-case__libelle">
              {t("Copie d'une grille du cabinet", "Copy of a firm framework")}
              <span className="mp-case__aide">
                {grilles.length === 0
                  ? t(
                      "Aucune grille du cabinet à copier pour l'instant.",
                      "No firm framework to copy for now.",
                    )
                  : t(
                      "Reprend la dernière version de la grille choisie.",
                      "Takes the latest version of the chosen framework.",
                    )}
              </span>
            </label>
          </div>
        </div>
      </fieldset>
      {source === "copie" ? (
        <Select
          libelle={t("Grille à copier", "Framework to copy")}
          required
          value={grilleId}
          onChange={(e) => setGrilleId(e.target.value)}
          invite={t("Choisir une grille…", "Choose a framework…")}
          options={grilles.map((g) => ({ valeur: g.id, libelle: `${g.titre} (${g.code})` }))}
          erreur={f.erreurs.grilleId}
        />
      ) : null}
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Titre", "Title")}
          value={titre}
          maxLength={200}
          onChange={(e) => {
            setTitre(e.target.value);
            if (!codeModifie) setCode(codeDepuisTitre(e.target.value));
          }}
          erreur={f.erreurs.titre}
          aide={t(
            "Facultatif : par défaut, celui de la grille copiée.",
            "Optional: defaults to the title of the copied framework.",
          )}
        />
        <Champ
          libelle={t("Code", "Code")}
          required
          value={code}
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setCode(e.target.value);
            setCodeModifie(true);
          }}
          erreur={f.erreurs.code}
          aide={t(
            "Identifiant stable et unique dans le cabinet (ex. grille_industrie).",
            "Stable identifier, unique within the firm (e.g. industry_framework).",
          )}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="copie"
          chargement={f.enCours}
          texteChargement={t("Création…", "Creating…")}
        >
          {t("Créer la grille", "Create the framework")}
        </Bouton>
      </div>
    </form>
  );
}
