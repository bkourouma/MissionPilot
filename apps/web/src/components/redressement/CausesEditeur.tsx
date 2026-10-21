"use client";

import { RED_CAUSES_MAX, RED_DOMAINE_LIBELLES, RED_DOMAINES } from "@missionpilot/shared";
import { OPTIONS_CONFIANCE_CAUSE } from "../../lib/redressement-diagnostic";
import { causeVide, type SaisieCause } from "../../lib/redressement-diagnostic-saisie";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const OPTIONS_DOMAINES = RED_DOMAINES.map((d) => ({ valeur: d, libelle: RED_DOMAINE_LIBELLES[d] }));

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
  const maj = (i: number, patch: Partial<SaisieCause>) =>
    onChange(causes.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  return (
    <div className="mp-pile">
      <ul className="mp-diag-liste" aria-label="Causes racines à modifier">
        {causes.map((c, i) => (
          <li key={c.id ?? `nouvelle-${i}`} className="mp-diag-cause">
            <Champ
              libelle={`Libellé de la cause ${i + 1}`}
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
                libelle="Domaine"
                value={c.domaine}
                disabled={desactive}
                options={OPTIONS_DOMAINES}
                onChange={(e) => maj(i, { domaine: e.target.value as SaisieCause["domaine"] })}
                erreur={erreurs[`${i}.domaine`]}
              />
              <Select
                libelle="Niveau de confiance"
                value={c.confiance}
                disabled={desactive}
                invite="Non indiqué"
                options={OPTIONS_CONFIANCE_CAUSE}
                onChange={(e) => maj(i, { confiance: e.target.value as SaisieCause["confiance"] })}
                erreur={erreurs[`${i}.confiance`]}
              />
            </div>
            <div className="mp-actions-formulaire">
              <Bouton
                variante="discret"
                disabled={desactive || causes.length <= 1}
                onClick={() => onChange(causes.filter((_, k) => k !== i))}
                aria-label={`Retirer la cause ${i + 1}`}
              >
                Retirer
              </Bouton>
            </div>
          </li>
        ))}
      </ul>
      <div className="mp-actions-formulaire">
        <Bouton
          variante="secondaire"
          disabled={desactive || causes.length >= RED_CAUSES_MAX}
          onClick={() => onChange([...causes, causeVide()])}
        >
          Ajouter une cause
        </Bouton>
        {causes.length >= RED_CAUSES_MAX ? (
          <span className="mp-texte-doux mp-texte-petit">
            {RED_CAUSES_MAX} causes au plus par cartographie.
          </span>
        ) : null}
      </div>
    </div>
  );
}
