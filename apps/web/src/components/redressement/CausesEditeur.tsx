"use client";

import { RED_CAUSES_MAX, RED_DOMAINES } from "@missionpilot/shared";
import { optionsConfianceCause } from "../../lib/redressement-diagnostic";
import { libelleDomaine } from "../../lib/redressement";
import { causeVide, type SaisieCause } from "../../lib/redressement-diagnostic-saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { indexFocusApresRetrait, useFocusLignes } from "./useFocusLignes";

/**
 * Édition des causes d'un brouillon : libellé, description, domaine et confiance (libellé fixe,
 * jamais un chiffre). Composant contrôlé ; l'enregistrement est fait par la cartographie.
 */
export function CausesEditeur({
  causes,
  onChange,
  erreurs,
  desactive,
}: {
  causes: SaisieCause[];
  onChange: (causes: SaisieCause[]) => void;
  erreurs: Partial<Record<string, string>>;
  desactive?: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  const { refListe, focaliser } = useFocusLignes();
  const optionsDomaines = RED_DOMAINES.map((d) => ({
    valeur: d,
    libelle: libelleDomaine(d, langue),
  }));
  const maj = (i: number, patch: Partial<SaisieCause>) =>
    onChange(causes.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  return (
    <div className="mp-pile">
      <ul
        ref={refListe}
        className="mp-diag-liste"
        aria-label={t("Causes racines à modifier", "Root causes to edit")}
      >
        {causes.map((c, i) => (
          <li key={c.id ?? `nouvelle-${i}`} className="mp-diag-cause">
            <Champ
              libelle={t(`Libellé de la cause ${i + 1}`, `Label of cause ${i + 1}`)}
              autoComplete="off"
              value={c.libelle}
              disabled={desactive}
              onChange={(e) => maj(i, { libelle: e.target.value })}
              erreur={erreurs[`${i}.libelle`]}
            />
            <ZoneTexte
              libelle="Description"
              value={c.description}
              disabled={desactive}
              onChange={(e) => maj(i, { description: e.target.value })}
              erreur={erreurs[`${i}.description`]}
            />
            <div className="mp-grille-champs">
              <Select
                libelle={t("Domaine", "Area")}
                value={c.domaine}
                disabled={desactive}
                options={optionsDomaines}
                onChange={(e) => maj(i, { domaine: e.target.value as SaisieCause["domaine"] })}
                erreur={erreurs[`${i}.domaine`]}
              />
              <Select
                libelle={t("Niveau de confiance", "Confidence level")}
                value={c.confiance}
                disabled={desactive}
                invite={t("Non indiqué", "Not specified")}
                options={optionsConfianceCause(langue)}
                onChange={(e) => maj(i, { confiance: e.target.value as SaisieCause["confiance"] })}
                erreur={erreurs[`${i}.confiance`]}
              />
            </div>
            <div className="mp-actions-formulaire">
              <Bouton
                variante="discret"
                disabled={desactive || causes.length <= 1}
                onClick={() => {
                  onChange(causes.filter((_, k) => k !== i));
                  focaliser(indexFocusApresRetrait(i, causes.length - 1));
                }}
                aria-label={t(`Retirer la cause ${i + 1}`, `Remove cause ${i + 1}`)}
              >
                {t("Retirer", "Remove")}
              </Bouton>
            </div>
          </li>
        ))}
      </ul>
      <div className="mp-actions-formulaire">
        <Bouton
          variante="secondaire"
          disabled={desactive || causes.length >= RED_CAUSES_MAX}
          onClick={() => {
            onChange([...causes, causeVide()]);
            focaliser(causes.length);
          }}
        >
          {t("Ajouter une cause", "Add a cause")}
        </Bouton>
        {causes.length >= RED_CAUSES_MAX ? (
          <span className="mp-texte-doux mp-texte-petit">
            {t(
              `${RED_CAUSES_MAX} causes au plus par cartographie.`,
              `${RED_CAUSES_MAX} causes at most per map.`,
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}
