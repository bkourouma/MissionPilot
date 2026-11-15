"use client";

import { useState } from "react";
import { CommentairesRepliables } from "../../../../../components/collaboration/Commentaires";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../../components/ui/Bouton";
import { api } from "../../../../../lib/api";
import {
  deplacementChangementParent,
  deplacementsEchange,
  parentsDeTache,
  saisieDepuisTache,
  tachesDuParent,
  type Tache,
} from "../../../../../lib/decoupage";
import { formaterDate, formaterJours, formaterNombre } from "../../../../../lib/format";
import { BoutonsOrdre, Suppression, TotalJours } from "./ArbreDecoupageOutils";
import type { Contexte, Mode } from "./arbre-decoupage-types";
import { FormulaireBudgetTache, FormulaireParent, FormulaireTache } from "./FormulairesDecoupage";

export function NoeudTache({
  tache,
  freres,
  parentId,
  rang,
  ctx,
}: {
  tache: Tache;
  freres: Tache[];
  parentId: string;
  rang: number;
  ctx: Contexte;
}) {
  const t = useT();
  const langue = useLangue();
  const [mode, setMode] = useState<Mode>("lecture");
  const base = `/api/missions/${encodeURIComponent(ctx.missionId)}`;
  const nom = t(`la tâche ${tache.libelle}`, `task ${tache.libelle}`);
  const deplacer = (sens: -1 | 1) => {
    const d = deplacementsEchange(freres, tache.id, sens, "tache", parentId);
    if (d)
      void ctx.reorganiser(
        d,
        t(
          `Tâche « ${tache.libelle} » ${sens < 0 ? "montée" : "descendue"}.`,
          `Task "${tache.libelle}" moved ${sens < 0 ? "up" : "down"}.`,
        ),
      );
  };
  const libelleGrade = (id: string | null, code: string | null) =>
    ctx.grades.find((g) => g.id === id)?.libelle ?? code ?? t("Grade", "Grade");
  return (
    <li className="mp-arbre__noeud mp-arbre__noeud--niveau-3">
      <div className="mp-arbre__element">
        <div className="mp-arbre__ligne">
          <p className="mp-arbre__titre">
            <span className="mp-arbre__niveau">{t("Tâche", "Task")}</span> {tache.libelle}
          </p>
          {ctx.droits.lireBudget ? <TotalJours valeur={ctx.budgets[tache.id]} /> : null}
        </div>
        <p className="mp-texte-doux mp-texte-petit">
          {`${formaterNombre(tache.duree_jours_ouvres, 0, langue)} ${t("jour(s) ouvré(s)", "working day(s)")}`}
          {tache.date_debut
            ? ` · ${t("début souhaité le", "preferred start on")} ${formaterDate(tache.date_debut, "UTC", langue)}`
            : ` · ${t("au plus tôt", "as early as possible")}`}
        </p>
        {tache.est_livrable ? (
          <p className="mp-badges">
            <BadgeStatut tonalite="neutre" sansIcone>
              {t("Livrable", "Deliverable")}
            </BadgeStatut>
          </p>
        ) : null}
        {tache.budget && tache.budget.length > 0 ? (
          <dl className="mp-jours">
            {tache.budget.map((l) => (
              <div key={l.id} className="mp-jours__ligne">
                <dt>
                  {l.collaborateur_id
                    ? (l.collaborateur_nom ?? t("Collaborateur", "Team member"))
                    : libelleGrade(l.grade_id, l.grade_code)}
                </dt>
                <dd>{formaterJours(l.jours, langue)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {mode === "lecture" && (ctx.droits.planifier || ctx.droits.budgeter) ? (
          <div className="mp-barre-actions mp-barre-actions--compacte">
            {ctx.droits.planifier ? (
              <>
                <BoutonsOrdre
                  libelle={nom}
                  rang={rang}
                  total={freres.length}
                  monter={() => deplacer(-1)}
                  descendre={() => deplacer(1)}
                />
                <Bouton
                  variante="discret"
                  icone="deplacer"
                  onClick={() => setMode("parent")}
                  aria-label={t(
                    `Déplacer ${nom} vers une autre phase ou un autre lot`,
                    `Move ${nom} to another phase or work package`,
                  )}
                >
                  {t("Déplacer vers…", "Move to…")}
                </Bouton>
                <Bouton
                  variante="discret"
                  icone="crayon"
                  onClick={() => setMode("edition")}
                  aria-label={`${t("Modifier", "Edit")} ${nom}`}
                >
                  {t("Modifier", "Edit")}
                </Bouton>
              </>
            ) : null}
            {ctx.droits.budgeter ? (
              <Bouton
                variante="discret"
                icone="horloge"
                onClick={() => setMode("budget")}
                aria-label={t(`Budgéter ${nom} en jours`, `Budget ${nom} in days`)}
              >
                {t("Budget en jours", "Budget in days")}
              </Bouton>
            ) : null}
            {ctx.droits.planifier ? (
              <Suppression
                libelle={nom}
                chemin={`${base}/taches/${encodeURIComponent(tache.id)}`}
                question={t(
                  `Supprimer « ${tache.libelle} », son budget et ses dépendances ?`,
                  `Delete "${tache.libelle}", its budget and its dependencies?`,
                )}
              />
            ) : null}
          </div>
        ) : null}
        {mode === "edition" ? (
          <FormulaireTache
            titre={`${t("Modifier", "Edit")} ${nom}`}
            libelleEnvoi={t("Enregistrer", "Save")}
            initial={saisieDepuisTache(tache)}
            onAnnuler={() => setMode("lecture")}
            envoyer={(c) => api.patch(`${base}/taches/${encodeURIComponent(tache.id)}`, c)}
          />
        ) : null}
        {mode === "budget" ? (
          <FormulaireBudgetTache
            tache={tache}
            grades={ctx.grades}
            onAnnuler={() => setMode("lecture")}
            envoyer={(c) => api.put(`${base}/taches/${encodeURIComponent(tache.id)}/budget`, c)}
          />
        ) : null}
        {mode === "parent" ? (
          <FormulaireParent
            titre={`${t("Déplacer", "Move")} ${nom}`}
            options={parentsDeTache(ctx.decoupage, langue)}
            actuel={parentId}
            onAnnuler={() => setMode("lecture")}
            envoyer={(cible) => {
              const d = deplacementChangementParent(
                "tache",
                tache.id,
                cible,
                tachesDuParent(ctx.decoupage, cible),
              );
              return api
                .post(`${base}/reorganiser`, { deplacements: [d] })
                .then(() =>
                  ctx.annoncer(
                    t(`Tâche « ${tache.libelle} » déplacée.`, `Task "${tache.libelle}" moved.`),
                  ),
                );
            }}
          />
        ) : null}
        <CommentairesRepliables
          entiteType="mission_tache"
          entiteId={tache.id}
          utilisateurId={ctx.collaboration.utilisateurId}
          associe={ctx.collaboration.associe}
          nomElement={nom}
        />
      </div>
    </li>
  );
}
