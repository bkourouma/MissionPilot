"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Champ } from "../../../../components/ui/Champ";
import { EtatVide } from "../../../../components/ui/EtatListe";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../lib/api";
import {
  joursAffiches,
  libelleEnfant,
  libelleNiveau,
  SAISIE_ELEMENT_VIDE,
  saisieDepuisElement,
  validerElement,
  type ChampElement,
  type ChargeElement,
  type NoeudArbre,
  type SaisieElement,
} from "../../../../lib/catalogue";
import { formaterJours } from "../../../../lib/format";

interface GradeCourt {
  code: string;
  libelle: string;
}

interface ContexteArbre {
  typeId: string;
  grades: GradeCourt[];
  peutEcrire: boolean;
}

export interface ArbreModeleProps extends ContexteArbre {
  arbre: NoeudArbre[];
}

/**
 * Découpage phases > lots > tâches en listes imbriquées (la hiérarchie est lisible par les
 * lecteurs d'écran et au clavier, sans widget d'arbre ARIA à gérer).
 */
export function ArbreModele({ arbre, ...ctx }: ArbreModeleProps) {
  const t = useT();
  const [ajoutPhase, setAjoutPhase] = useState(false);
  return (
    <div className="mp-pile">
      {arbre.length === 0 ? (
        <EtatVide
          titre={t(
            "Ce type de mission n'a pas encore de découpage.",
            "This engagement type has no work breakdown yet.",
          )}
          icone="livre"
        >
          {ctx.peutEcrire ? (
            <p>
              {t(
                "Ajoutez une première phase, puis ses lots et ses tâches.",
                "Add a first phase, then its work packages and tasks.",
              )}
            </p>
          ) : null}
        </EtatVide>
      ) : (
        <ol className="mp-arbre" aria-label={t("Découpage type", "Typical work breakdown")}>
          {arbre.map((n) => (
            <Noeud key={n.id} noeud={n} ctx={ctx} />
          ))}
        </ol>
      )}
      {ctx.peutEcrire ? (
        ajoutPhase ? (
          <FormulaireElement
            ctx={ctx}
            titre={t("Nouvelle phase", "New phase")}
            saisieInitiale={{
              ...SAISIE_ELEMENT_VIDE,
              ordre: String((arbre.at(-1)?.ordre ?? 0) + 10),
            }}
            envoyer={(c) =>
              api.post(`/api/types-mission/${encodeURIComponent(ctx.typeId)}/elements`, {
                ...c,
                parent_id: null,
              })
            }
            onFin={() => setAjoutPhase(false)}
            libelleEnvoi={t("Ajouter la phase", "Add the phase")}
          />
        ) : (
          <div>
            <Bouton variante="secondaire" icone="plus" onClick={() => setAjoutPhase(true)}>
              {t("Ajouter une phase", "Add a phase")}
            </Bouton>
          </div>
        )
      ) : null}
    </div>
  );
}

function Noeud({ noeud, ctx }: { noeud: NoeudArbre; ctx: ContexteArbre }) {
  const t = useT();
  const langue = useLangue();
  const [mode, setMode] = useState<"lecture" | "edition" | "ajout">("lecture");
  const suppression = useFormulaire<never>();
  const jours = joursAffiches(noeud.jours_par_grade, ctx.grades);
  const niveau = libelleNiveau(noeud.niveau, langue);
  const enfant = libelleEnfant(noeud.niveau, langue);
  const chemin = `/api/types-mission/${encodeURIComponent(ctx.typeId)}/elements/${encodeURIComponent(noeud.id)}`;

  return (
    <li className={`mp-arbre__noeud mp-arbre__noeud--niveau-${noeud.niveau}`}>
      <div className="mp-arbre__element">
        <p className="mp-arbre__titre">
          <span className="mp-arbre__niveau">{niveau}</span> {noeud.libelle}
        </p>
        {noeud.est_livrable || noeud.est_jalon ? (
          <p className="mp-badges">
            {noeud.est_livrable ? (
              <BadgeStatut tonalite="neutre" sansIcone>
                {t("Livrable", "Deliverable")}
              </BadgeStatut>
            ) : null}
            {noeud.est_jalon ? (
              <BadgeStatut tonalite="neutre" sansIcone>
                {t("Jalon", "Milestone")}
              </BadgeStatut>
            ) : null}
          </p>
        ) : null}
        {jours.length > 0 ? (
          <dl className="mp-jours">
            {jours.map((j) => (
              <div key={j.code} className="mp-jours__ligne">
                <dt>{j.libelle}</dt>
                <dd>{formaterJours(j.jours, langue)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {ctx.peutEcrire && mode === "lecture" ? (
          <>
            <RetourFormulaire
              erreur={suppression.erreurGlobale}
              refAlerte={suppression.refAlerte}
              titreErreur={t("Suppression impossible", "Deletion failed")}
            />
            <div className="mp-barre-actions mp-barre-actions--compacte">
              <Bouton
                variante="discret"
                icone="crayon"
                onClick={() => setMode("edition")}
                aria-label={`${t("Modifier", "Edit")} ${niveau.toLowerCase()} ${noeud.libelle}`}
              >
                {t("Modifier", "Edit")}
              </Bouton>
              {enfant ? (
                <Bouton
                  variante="discret"
                  icone="plus"
                  onClick={() => setMode("ajout")}
                  aria-label={`${t("Ajouter", "Add")} ${enfant} ${t("dans", "to")} ${noeud.libelle}`}
                >
                  {`${t("Ajouter", "Add")} ${enfant}`}
                </Bouton>
              ) : null}
              <BoutonConfirmation
                libelle={t("Supprimer", "Delete")}
                variante="discret"
                icone="corbeille"
                ariaLabel={`${t("Supprimer", "Delete")} ${niveau.toLowerCase()} ${noeud.libelle}`}
                question={
                  noeud.enfants.length > 0
                    ? t(
                        `Supprimer « ${noeud.libelle} » et tout ce qu'il contient ?`,
                        `Delete "${noeud.libelle}" and everything it contains?`,
                      )
                    : t(`Supprimer « ${noeud.libelle} » ?`, `Delete "${noeud.libelle}"?`)
                }
                libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
                texteChargement={t("Suppression…", "Deleting…")}
                action={() =>
                  suppression.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin))
                }
              />
            </div>
          </>
        ) : null}
        {mode === "edition" ? (
          <FormulaireElement
            ctx={ctx}
            titre={`${t("Modifier", "Edit")} ${niveau.toLowerCase()} ${noeud.libelle}`}
            saisieInitiale={saisieDepuisElement(noeud)}
            envoyer={(c) => api.patch(chemin, c)}
            onFin={() => setMode("lecture")}
            libelleEnvoi={t("Enregistrer", "Save")}
          />
        ) : null}
      </div>
      {noeud.enfants.length > 0 || mode === "ajout" ? (
        <ol
          className="mp-arbre"
          aria-label={t(`Contenu de ${noeud.libelle}`, `Contents of ${noeud.libelle}`)}
        >
          {noeud.enfants.map((e) => (
            <Noeud key={e.id} noeud={e} ctx={ctx} />
          ))}
          {mode === "ajout" && enfant ? (
            <li className="mp-arbre__noeud">
              <FormulaireElement
                ctx={ctx}
                titre={`${t("Ajouter", "Add")} ${enfant} ${t("dans", "to")} ${noeud.libelle}`}
                saisieInitiale={{
                  ...SAISIE_ELEMENT_VIDE,
                  ordre: String((noeud.enfants.at(-1)?.ordre ?? 0) + 10),
                }}
                envoyer={(c) =>
                  api.post(`/api/types-mission/${encodeURIComponent(ctx.typeId)}/elements`, {
                    ...c,
                    parent_id: noeud.id,
                  })
                }
                onFin={() => setMode("lecture")}
                libelleEnvoi={t("Ajouter", "Add")}
              />
            </li>
          ) : null}
        </ol>
      ) : null}
    </li>
  );
}

function FormulaireElement({
  ctx,
  titre,
  saisieInitiale,
  envoyer,
  onFin,
  libelleEnvoi,
}: {
  ctx: ContexteArbre;
  titre: string;
  saisieInitiale: SaisieElement;
  envoyer: (charge: ChargeElement) => Promise<unknown>;
  onFin: () => void;
  libelleEnvoi: string;
}) {
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState(saisieInitiale);
  const f = useFormulaire<ChampElement>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerElement(s, langue), envoyer, { apres: onFin });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Libellé", "Label")}
          name="libelle"
          required
          maxLength={200}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle={t("Ordre", "Order")}
          name="ordre"
          required
          inputMode="numeric"
          value={s.ordre}
          onChange={(e) => setS((x) => ({ ...x, ordre: e.target.value }))}
          erreur={f.erreurs.ordre}
          aide={t(
            "Position parmi les éléments de même niveau (10, 20, 30…).",
            "Position among items of the same level (10, 20, 30…).",
          )}
        />
      </div>
      {ctx.grades.length > 0 ? (
        <fieldset className="mp-groupe">
          <legend className="mp-champ__libelle">
            {t("Jours types par grade", "Typical days per grade")}
          </legend>
          <p className="mp-champ__aide">
            {t(
              "Au pas de la demi-journée (ex. 2 ou 2,5). Laisser vide si le grade n'intervient pas.",
              "In half-day steps (e.g. 2 or 2.5). Leave empty if the grade is not involved.",
            )}
          </p>
          <div className="mp-grille-champs mp-grille-champs--serree">
            {ctx.grades.map((g) => (
              <Champ
                key={g.code}
                libelle={g.libelle}
                name={`jours-${g.code}`}
                inputMode="decimal"
                value={s.jours[g.code] ?? ""}
                onChange={(e) =>
                  setS((x) => ({ ...x, jours: { ...x.jours, [g.code]: e.target.value } }))
                }
                erreur={f.erreurs[`jours.${g.code}`]}
                autoComplete="off"
              />
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="mp-groupe__options mp-groupe__options--ligne">
        <CaseACocher
          libelle={t("Livrable", "Deliverable")}
          checked={s.est_livrable}
          onChange={(e) => setS((x) => ({ ...x, est_livrable: e.target.checked }))}
        />
        <CaseACocher
          libelle={t("Jalon", "Milestone")}
          checked={s.est_jalon}
          onChange={(e) => setS((x) => ({ ...x, est_jalon: e.target.checked }))}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {libelleEnvoi}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
