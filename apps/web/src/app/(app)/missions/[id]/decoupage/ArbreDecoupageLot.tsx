"use client";

import { useState } from "react";
import { useT } from "../../../../../components/i18n/FournisseurLangue";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../../components/ui/Bouton";
import { api } from "../../../../../lib/api";
import {
  deplacementChangementParent,
  deplacementsEchange,
  ordreSuivant,
  type Lot,
  type Phase,
} from "../../../../../lib/decoupage";
import { BoutonsOrdre, Suppression, TotalJours } from "./ArbreDecoupageOutils";
import { NoeudTache } from "./ArbreDecoupageTache";
import type { Contexte, Mode } from "./arbre-decoupage-types";
import { FormulaireLibelle, FormulaireParent, FormulaireTache } from "./FormulairesDecoupage";

export function NoeudLot({
  lot,
  phase,
  rang,
  total,
  ctx,
}: {
  lot: Lot;
  phase: Phase;
  rang: number;
  total: number;
  ctx: Contexte;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("lecture");
  const base = `/api/missions/${encodeURIComponent(ctx.missionId)}`;
  const nom = t(`le lot ${lot.libelle}`, `work package ${lot.libelle}`);
  const deplacer = (sens: -1 | 1) => {
    const d = deplacementsEchange(phase.lots, lot.id, sens, "lot", phase.id);
    if (d)
      void ctx.reorganiser(
        d,
        t(
          `Lot « ${lot.libelle} » ${sens < 0 ? "monté" : "descendu"}.`,
          `Work package "${lot.libelle}" moved ${sens < 0 ? "up" : "down"}.`,
        ),
      );
  };
  const autresPhases = ctx.decoupage.phases.map((p) => ({
    valeur: p.id,
    libelle: `${t("Phase : ", "Phase: ")}${p.libelle}`,
  }));
  return (
    <li className="mp-arbre__noeud mp-arbre__noeud--niveau-2">
      <div className="mp-arbre__element">
        <div className="mp-arbre__ligne">
          <p className="mp-arbre__titre">
            <span className="mp-arbre__niveau">{t("Lot", "Work package")}</span> {lot.libelle}
          </p>
          {ctx.droits.lireBudget ? <TotalJours valeur={ctx.budgets[lot.id]} /> : null}
        </div>
        {lot.est_livrable ? (
          <p className="mp-badges">
            <BadgeStatut tonalite="neutre" sansIcone>
              {t("Livrable", "Deliverable")}
            </BadgeStatut>
          </p>
        ) : null}
        {ctx.droits.planifier && mode === "lecture" ? (
          <div className="mp-barre-actions mp-barre-actions--compacte">
            <BoutonsOrdre
              libelle={nom}
              rang={rang}
              total={total}
              monter={() => deplacer(-1)}
              descendre={() => deplacer(1)}
            />
            <Bouton
              variante="discret"
              icone="deplacer"
              onClick={() => setMode("parent")}
              aria-label={t(`Déplacer ${nom} vers une autre phase`, `Move ${nom} to another phase`)}
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
            <Bouton
              variante="discret"
              icone="plus"
              onClick={() => setMode("ajout-tache")}
              aria-label={t(`Ajouter une tâche dans ${nom}`, `Add a task in ${nom}`)}
            >
              {t("Ajouter une tâche", "Add a task")}
            </Bouton>
            <Suppression
              libelle={nom}
              chemin={`${base}/lots/${encodeURIComponent(lot.id)}`}
              question={
                lot.taches.length > 0
                  ? t(
                      `Supprimer « ${lot.libelle} », ses tâches et leurs budgets ?`,
                      `Delete "${lot.libelle}", its tasks and their budgets?`,
                    )
                  : t(`Supprimer « ${lot.libelle} » ?`, `Delete "${lot.libelle}"?`)
              }
            />
          </div>
        ) : null}
        {mode === "edition" ? (
          <FormulaireLibelle
            titre={`${t("Modifier", "Edit")} ${nom}`}
            libelleEnvoi={t("Enregistrer", "Save")}
            initial={{ libelle: lot.libelle, est_livrable: lot.est_livrable }}
            avecLivrable
            onAnnuler={() => setMode("lecture")}
            envoyer={(c) => api.patch(`${base}/lots/${encodeURIComponent(lot.id)}`, c)}
          />
        ) : null}
        {mode === "parent" ? (
          <FormulaireParent
            titre={`${t("Déplacer", "Move")} ${nom}`}
            options={autresPhases}
            actuel={phase.id}
            onAnnuler={() => setMode("lecture")}
            envoyer={(cible) => {
              const lots = ctx.decoupage.phases.find((p) => p.id === cible)?.lots ?? [];
              const d = deplacementChangementParent("lot", lot.id, cible, lots);
              return api
                .post(`${base}/reorganiser`, { deplacements: [d] })
                .then(() =>
                  ctx.annoncer(
                    t(`Lot « ${lot.libelle} » déplacé.`, `Work package "${lot.libelle}" moved.`),
                  ),
                );
            }}
          />
        ) : null}
      </div>
      {lot.taches.length > 0 || mode === "ajout-tache" ? (
        <ol className="mp-arbre" aria-label={t(`Contenu de ${nom}`, `Contents of ${nom}`)}>
          {lot.taches.map((ta, i) => (
            <NoeudTache
              key={ta.id}
              tache={ta}
              freres={lot.taches}
              parentId={lot.id}
              rang={i}
              ctx={ctx}
            />
          ))}
          {mode === "ajout-tache" ? (
            <li className="mp-arbre__noeud">
              <FormulaireTache
                titre={t(`Nouvelle tâche dans ${nom}`, `New task in ${nom}`)}
                libelleEnvoi={t("Ajouter la tâche", "Add the task")}
                onAnnuler={() => setMode("lecture")}
                envoyer={(c) =>
                  api.post(`${base}/taches`, {
                    ...c,
                    parent_id: lot.id,
                    ordre: ordreSuivant(lot.taches),
                  })
                }
              />
            </li>
          ) : null}
        </ol>
      ) : null}
    </li>
  );
}
