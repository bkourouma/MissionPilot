"use client";

import { useState } from "react";
import { CRITERES_REVUE_FROIDE, GRAVITES_CONSTAT_FROID } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { formaterDateHeure } from "../../lib/format";
import {
  cheminConstat,
  cheminConstats,
  libelleCritere,
  libelleGravite,
  messageFroide,
  tonaliteGravite,
  type ConstatFroid,
} from "../../lib/qualite-froide";
import { validerConstat, type SaisieConstat } from "../../lib/qualite-froide-saisie";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { useActionFroide } from "./useActionFroide";

export interface FroideConstatsProps {
  echantillonId: string;
  constats: ConstatFroid[];
  modifiable: boolean;
}

const VIDE: SaisieConstat = { critere: "", gravite: "", description: "", recommandation: "" };

/** Constats de la revue : liste, suppression (avec confirmation) et ajout. */
export function FroideConstats({ echantillonId, constats, modifiable }: FroideConstatsProps) {
  const a = useActionFroide();
  const f = useFormulaire<"critere" | "gravite" | "description" | "recommandation">();
  const [s, setS] = useState<SaisieConstat>(VIDE);
  const maj = (p: Partial<SaisieConstat>) => setS((x) => ({ ...x, ...p }));

  return (
    <div className="mp-froide__pile">
      <RetourFormulaire
        erreur={a.erreur}
        succes={a.succes}
        refAlerte={a.refAlerte}
        titreErreur="Suppression impossible"
      />
      {constats.length === 0 ? (
        <p className="mp-texte-doux" role="status">
          Aucun constat pour l&apos;instant.
        </p>
      ) : (
        <ul className="mp-froide__liste">
          {constats.map((c) => (
            <li key={c.id} className="mp-froide__element">
              <div className="mp-froide__ligne">
                <BadgeStatut tonalite={tonaliteGravite(c.gravite)}>
                  {libelleGravite(c.gravite)}
                </BadgeStatut>
                <span className="mp-texte-petit">
                  {libelleCritere(c.critere)} · {formaterDateHeure(c.cree_le)}
                </span>
              </div>
              <p>{c.description}</p>
              {c.recommandation ? (
                <p className="mp-texte-petit">Recommandation : {c.recommandation}</p>
              ) : null}
              {modifiable ? (
                <BoutonConfirmation
                  libelle="Supprimer"
                  ariaLabel={`Supprimer le constat « ${c.description.slice(0, 60)} »`}
                  question="Supprimer ce constat ?"
                  libelleConfirmation="Oui, supprimer"
                  texteChargement="Suppression…"
                  action={async () => {
                    const r = await a.agir(
                      () => api.supprimer(cheminConstat(echantillonId, c.id)),
                      {
                        succes: "Constat supprimé.",
                      },
                    );
                    return r.ok;
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {modifiable ? (
        <form
          ref={f.refFormulaire}
          className="mp-formulaire"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            await f.envoyer(
              validerConstat(s),
              (charge) => api.post(cheminConstats(echantillonId), charge),
              {
                succes: "Constat ajouté.",
                messageSpecifique: messageFroide,
                apres: () => setS(VIDE),
              },
            );
          }}
        >
          <h3 className="mp-qualite__sous-titre">Ajouter un constat</h3>
          <RetourFormulaire
            erreur={f.erreurGlobale}
            succes={f.succes}
            refAlerte={f.refAlerte}
            titreErreur="Constat non ajouté"
          />
          <div className="mp-grille-champs">
            <Select
              libelle="Gravité"
              required
              value={s.gravite}
              onChange={(e) => maj({ gravite: e.target.value })}
              invite="Choisir la gravité"
              options={GRAVITES_CONSTAT_FROID.map((g) => ({
                valeur: g,
                libelle: libelleGravite(g),
              }))}
              erreur={f.erreurs.gravite}
              aide="Un constat critique impose une conclusion non conforme ; un constat majeur limite la conclusion aux réserves (calcul du moteur)."
            />
            <Select
              libelle="Critère concerné"
              value={s.critere}
              onChange={(e) => maj({ critere: e.target.value })}
              invite="Revue dans son ensemble"
              options={CRITERES_REVUE_FROIDE.map((c) => ({ valeur: c.code, libelle: c.libelle }))}
              erreur={f.erreurs.critere}
            />
          </div>
          <ZoneTexte
            libelle="Description du constat"
            required
            rows={3}
            maxLength={2000}
            value={s.description}
            onChange={(e) => maj({ description: e.target.value })}
            erreur={f.erreurs.description}
          />
          <ZoneTexte
            libelle="Recommandation"
            rows={2}
            maxLength={2000}
            value={s.recommandation}
            onChange={(e) => maj({ recommandation: e.target.value })}
            erreur={f.erreurs.recommandation}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              variante="secondaire"
              chargement={f.enCours}
              texteChargement="Ajout…"
            >
              Ajouter le constat
            </Bouton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
