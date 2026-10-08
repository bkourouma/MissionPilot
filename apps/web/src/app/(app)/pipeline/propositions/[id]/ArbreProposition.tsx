"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Champ } from "../../../../../components/ui/Champ";
import { EtatVide } from "../../../../../components/ui/EtatListe";
import { api } from "../../../../../lib/api";
import { joursAffiches, libelleNiveau } from "../../../../../lib/catalogue";
import { formaterJours } from "../../../../../lib/format";
import { validerJoursParGrade, type NoeudProposition } from "../../../../../lib/propositions";

interface GradeCourt {
  code: string;
  libelle: string;
}

interface Contexte {
  propositionId: string;
  grades: GradeCourt[];
  modifiable: boolean;
}

export interface ArbreProposeProps extends Contexte {
  arbre: NoeudProposition[];
}

/** Découpage de la proposition en listes imbriquées ; jours par grade modifiables en brouillon. */
export function ArbreProposition({ arbre, ...ctx }: ArbreProposeProps) {
  if (arbre.length === 0) {
    return (
      <EtatVide titre="Cette proposition n'a pas de découpage." icone="livre">
        <p>Le type de mission choisi n&apos;a pas de modèle : complétez-le dans le catalogue.</p>
      </EtatVide>
    );
  }
  return (
    <ol className="mp-arbre" aria-label="Découpage de la proposition">
      {arbre.map((n) => (
        <Noeud key={n.id} noeud={n} ctx={ctx} />
      ))}
    </ol>
  );
}

function Noeud({ noeud, ctx }: { noeud: NoeudProposition; ctx: Contexte }) {
  const [edition, setEdition] = useState(false);
  const jours = joursAffiches(noeud.jours_par_grade, ctx.grades);
  const niveau = libelleNiveau(noeud.niveau);
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
                Livrable
              </BadgeStatut>
            ) : null}
            {noeud.est_jalon ? (
              <BadgeStatut tonalite="neutre" sansIcone>
                Jalon
              </BadgeStatut>
            ) : null}
          </p>
        ) : null}
        {jours.length > 0 ? (
          <dl className="mp-jours">
            {jours.map((j) => (
              <div key={j.code} className="mp-jours__ligne">
                <dt>{j.libelle}</dt>
                <dd>{formaterJours(j.jours)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {ctx.modifiable && !edition ? (
          <div className="mp-barre-actions mp-barre-actions--compacte">
            <Bouton
              variante="discret"
              icone="crayon"
              onClick={() => setEdition(true)}
              aria-label={`Modifier ${niveau.toLowerCase()} ${noeud.libelle}`}
            >
              Modifier
            </Bouton>
          </div>
        ) : null}
        {edition ? (
          <FormulaireElement noeud={noeud} ctx={ctx} onFin={() => setEdition(false)} />
        ) : null}
      </div>
      {noeud.enfants.length > 0 ? (
        <ol className="mp-arbre" aria-label={`Contenu de ${noeud.libelle}`}>
          {noeud.enfants.map((e) => (
            <Noeud key={e.id} noeud={e} ctx={ctx} />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function FormulaireElement({
  noeud,
  ctx,
  onFin,
}: {
  noeud: NoeudProposition;
  ctx: Contexte;
  onFin: () => void;
}) {
  const [libelle, setLibelle] = useState(noeud.libelle);
  const [jours, setJours] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(noeud.jours_par_grade).map(([g, j]) => [g, String(j).replace(".", ",")]),
    ),
  );
  const f = useFormulaire<string>();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const l = libelle.trim();
    const v = validerJoursParGrade(jours);
    const validation =
      l === "" || l.length > 200
        ? { ok: false as const, erreurs: { libelle: "Libellé de 1 à 200 caractères." } }
        : v.ok
          ? { ok: true as const, charge: { libelle: l, ...v.charge } }
          : v;
    await f.envoyer(
      validation,
      (c) =>
        api.patch(
          `/api/propositions/${encodeURIComponent(ctx.propositionId)}/elements/${encodeURIComponent(noeud.id)}`,
          c,
        ),
      { apres: onFin },
    );
  }
  const titre = `Modifier ${libelleNiveau(noeud.niveau).toLowerCase()} ${noeud.libelle}`;
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
      <Champ
        libelle="Libellé"
        name="libelle"
        required
        maxLength={200}
        value={libelle}
        onChange={(e) => setLibelle(e.target.value)}
        erreur={f.erreurs.libelle}
      />
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Jours par grade</legend>
        <p className="mp-champ__aide">Au centième de jour (ex. 2,5). Vide : grade absent.</p>
        <div className="mp-grille-champs mp-grille-champs--serree">
          {ctx.grades.map((g) => (
            <Champ
              key={g.code}
              libelle={g.libelle}
              name={`jours-${g.code}`}
              inputMode="decimal"
              autoComplete="off"
              value={jours[g.code] ?? ""}
              onChange={(e) => setJours((x) => ({ ...x, [g.code]: e.target.value }))}
              erreur={f.erreurs[g.code]}
            />
          ))}
        </div>
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
