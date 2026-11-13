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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
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
        titreErreur={t("Suppression impossible", "Deletion failed")}
      />
      {constats.length === 0 ? (
        <p className="mp-texte-doux" role="status">
          {t("Aucun constat pour l'instant.", "No findings yet.")}
        </p>
      ) : (
        <ul className="mp-froide__liste">
          {constats.map((c) => (
            <li key={c.id} className="mp-froide__element">
              <div className="mp-froide__ligne">
                <BadgeStatut tonalite={tonaliteGravite(c.gravite)}>
                  {libelleGravite(c.gravite, langue)}
                </BadgeStatut>
                <span className="mp-texte-petit">
                  {libelleCritere(c.critere, langue)} ·{" "}
                  {formaterDateHeure(c.cree_le, undefined, langue)}
                </span>
              </div>
              <p>{c.description}</p>
              {c.recommandation ? (
                <p className="mp-texte-petit">
                  {t("Recommandation", "Recommendation")} : {c.recommandation}
                </p>
              ) : null}
              {modifiable ? (
                <BoutonConfirmation
                  libelle={t("Supprimer", "Delete")}
                  ariaLabel={t(
                    `Supprimer le constat « ${c.description.slice(0, 60)} »`,
                    `Delete the finding "${c.description.slice(0, 60)}"`,
                  )}
                  question={t("Supprimer ce constat ?", "Delete this finding?")}
                  libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
                  texteChargement={t("Suppression…", "Deleting…")}
                  action={async () => {
                    const r = await a.agir(
                      () => api.supprimer(cheminConstat(echantillonId, c.id)),
                      {
                        succes: t("Constat supprimé.", "Finding deleted."),
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
              validerConstat(s, langue),
              (charge) => api.post(cheminConstats(echantillonId), charge),
              {
                succes: t("Constat ajouté.", "Finding added."),
                messageSpecifique: (e) => messageFroide(e, langue),
                apres: () => setS(VIDE),
              },
            );
          }}
        >
          <h3 className="mp-qualite__sous-titre">{t("Ajouter un constat", "Add a finding")}</h3>
          <RetourFormulaire
            erreur={f.erreurGlobale}
            succes={f.succes}
            refAlerte={f.refAlerte}
            titreErreur={t("Constat non ajouté", "Finding not added")}
          />
          <div className="mp-grille-champs">
            <Select
              libelle={t("Gravité", "Severity")}
              required
              value={s.gravite}
              onChange={(e) => maj({ gravite: e.target.value })}
              invite={t("Choisir la gravité", "Choose the severity")}
              options={GRAVITES_CONSTAT_FROID.map((g) => ({
                valeur: g,
                libelle: libelleGravite(g, langue),
              }))}
              erreur={f.erreurs.gravite}
              aide={t(
                "Un constat critique impose une conclusion non conforme ; un constat majeur limite la conclusion aux réserves (calcul du moteur).",
                "A critical finding forces a non-compliant conclusion; a major finding limits the conclusion to reservations (engine computation).",
              )}
            />
            <Select
              libelle={t("Critère concerné", "Related criterion")}
              value={s.critere}
              onChange={(e) => maj({ critere: e.target.value })}
              invite={t("Revue dans son ensemble", "Review as a whole")}
              options={CRITERES_REVUE_FROIDE.map((c) => ({
                valeur: c.code,
                libelle: libelleCritere(c.code, langue),
              }))}
              erreur={f.erreurs.critere}
            />
          </div>
          <ZoneTexte
            libelle={t("Description du constat", "Finding description")}
            required
            rows={3}
            maxLength={2000}
            value={s.description}
            onChange={(e) => maj({ description: e.target.value })}
            erreur={f.erreurs.description}
          />
          <ZoneTexte
            libelle={t("Recommandation", "Recommendation")}
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
              texteChargement={t("Ajout…", "Adding…")}
            >
              {t("Ajouter le constat", "Add finding")}
            </Bouton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
