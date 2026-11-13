"use client";

import { useState } from "react";
import { useT } from "../../../../../components/i18n/FournisseurLangue";
import { Bouton } from "../../../../../components/ui/Bouton";
import { api } from "../../../../../lib/api";
import { deplacementsEchange, ordreSuivant, type Phase } from "../../../../../lib/decoupage";
import { BoutonsOrdre, Suppression, TotalJours } from "./ArbreDecoupageOutils";
import { NoeudLot } from "./ArbreDecoupageLot";
import { NoeudTache } from "./ArbreDecoupageTache";
import type { Contexte, Mode } from "./arbre-decoupage-types";
import { FormulaireLibelle, FormulaireTache } from "./FormulairesDecoupage";

export function NoeudPhase({
  phase,
  rang,
  total,
  ctx,
}: {
  phase: Phase;
  rang: number;
  total: number;
  ctx: Contexte;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("lecture");
  const base = `/api/missions/${encodeURIComponent(ctx.missionId)}`;
  const phases = ctx.decoupage.phases;
  const nom = t(`la phase ${phase.libelle}`, `phase ${phase.libelle}`);
  const deplacer = (sens: -1 | 1) => {
    const d = deplacementsEchange(phases, phase.id, sens, "phase");
    if (d)
      void ctx.reorganiser(
        d,
        t(
          `Phase « ${phase.libelle} » ${sens < 0 ? "montée" : "descendue"}.`,
          `Phase "${phase.libelle}" moved ${sens < 0 ? "up" : "down"}.`,
        ),
      );
  };
  const enfants = phase.lots.length + phase.taches.length;
  return (
    <li className="mp-arbre__noeud mp-arbre__noeud--niveau-1">
      <div className="mp-arbre__element">
        <div className="mp-arbre__ligne">
          <p className="mp-arbre__titre">
            <span className="mp-arbre__niveau">{t("Phase", "Phase")}</span> {phase.libelle}
          </p>
          {ctx.droits.lireBudget ? <TotalJours valeur={ctx.budgets[phase.id]} /> : null}
        </div>
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
              icone="crayon"
              onClick={() => setMode("edition")}
              aria-label={`${t("Modifier", "Edit")} ${nom}`}
            >
              {t("Modifier", "Edit")}
            </Bouton>
            <Bouton
              variante="discret"
              icone="plus"
              onClick={() => setMode("ajout-lot")}
              aria-label={t(`Ajouter un lot dans ${nom}`, `Add a work package in ${nom}`)}
            >
              {t("Ajouter un lot", "Add a work package")}
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
              chemin={`${base}/phases/${encodeURIComponent(phase.id)}`}
              question={
                enfants > 0
                  ? t(
                      `Supprimer « ${phase.libelle} », ses lots, ses tâches et leurs budgets ?`,
                      `Delete "${phase.libelle}", its work packages, tasks and their budgets?`,
                    )
                  : t(`Supprimer « ${phase.libelle} » ?`, `Delete "${phase.libelle}"?`)
              }
            />
          </div>
        ) : null}
        {mode === "edition" ? (
          <FormulaireLibelle
            titre={`${t("Modifier", "Edit")} ${nom}`}
            libelleEnvoi={t("Enregistrer", "Save")}
            initial={{ libelle: phase.libelle }}
            avecLivrable={false}
            onAnnuler={() => setMode("lecture")}
            envoyer={(c) => api.patch(`${base}/phases/${encodeURIComponent(phase.id)}`, c)}
          />
        ) : null}
      </div>
      {enfants > 0 || mode === "ajout-lot" || mode === "ajout-tache" ? (
        <ol className="mp-arbre" aria-label={t(`Contenu de ${nom}`, `Contents of ${nom}`)}>
          {phase.lots.map((l, i) => (
            <NoeudLot
              key={l.id}
              lot={l}
              phase={phase}
              rang={i}
              total={phase.lots.length}
              ctx={ctx}
            />
          ))}
          {phase.taches.map((ta, i) => (
            <NoeudTache
              key={ta.id}
              tache={ta}
              freres={phase.taches}
              parentId={phase.id}
              rang={i}
              ctx={ctx}
            />
          ))}
          {mode === "ajout-lot" ? (
            <li className="mp-arbre__noeud">
              <FormulaireLibelle
                titre={t(`Nouveau lot dans ${nom}`, `New work package in ${nom}`)}
                libelleEnvoi={t("Ajouter le lot", "Add the work package")}
                initial={{ libelle: "", est_livrable: false }}
                avecLivrable
                onAnnuler={() => setMode("lecture")}
                envoyer={(c) =>
                  api.post(`${base}/lots`, {
                    ...c,
                    phase_id: phase.id,
                    ordre: ordreSuivant(phase.lots),
                  })
                }
              />
            </li>
          ) : null}
          {mode === "ajout-tache" ? (
            <li className="mp-arbre__noeud">
              <FormulaireTache
                titre={t(`Nouvelle tâche dans ${nom}`, `New task in ${nom}`)}
                libelleEnvoi={t("Ajouter la tâche", "Add the task")}
                onAnnuler={() => setMode("lecture")}
                envoyer={(c) =>
                  api.post(`${base}/taches`, {
                    ...c,
                    parent_id: phase.id,
                    ordre: ordreSuivant(phase.taches),
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
